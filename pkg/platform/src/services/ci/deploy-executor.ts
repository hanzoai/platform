/**
 * DeployExecutor — rolls a freshly-built image onto its target cluster.
 *
 * After a build succeeds, this looks up the repo's deploy config from the
 * already-parsed `.platform.yml`, decides whether the triggering branch is
 * a deploy branch, and (if so) patches the target operator `Service` CR's
 * image tag. The hanzo operator's reconcile loop performs the actual rollout
 * (Deployment update, rolling restart, etc.) — platform does NOT reimplement
 * a deployer; it reuses the operator surface it already drives for datastores.
 *
 * The image is already in ghcr.io/hanzoai/<repo>:<sha> (the build runner
 * pushed it). The executor only records the tag and flips the CR spec.
 */
import { and, db, eq } from "@hanzo/platform/db";
import { applications } from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { resolveDeployClients } from "../clusters";
import {
	buildServiceCR,
	KIND_TO_PLURAL,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	type OperatorKind,
} from "../k8s/operator/cr-builder";
import type { BuildJob } from "./build-job";
import { updateBuildJob } from "./build-job";
import { parseImageRef } from "./image-ref";
import type { DeployConfig } from "./platform-config";

export interface DeployResult {
	rolledOut: boolean;
	target?: string;
	reason: string;
}

/**
 * Roll out a successful build per its deploy config. No-op (rolledOut=false)
 * when there is no deploy block or the build branch is not a deploy branch.
 * Throws only on a genuine rollout failure (operator/cluster error).
 */
export async function executeDeploy(
	job: BuildJob,
	deploy: DeployConfig | undefined,
): Promise<DeployResult> {
	if (job.status !== "succeeded") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot deploy build job ${job.buildJobId} in status ${job.status}`,
		});
	}
	if (!deploy) {
		await updateBuildJob(job.buildJobId, { rolloutStatus: "skipped" });
		return { rolledOut: false, reason: "no deploy block in .platform.yml" };
	}
	if (!deploy.on.includes(job.branch)) {
		await updateBuildJob(job.buildJobId, { rolloutStatus: "skipped" });
		return {
			rolledOut: false,
			reason: `branch ${job.branch} is not a deploy branch (${deploy.on.join(", ")})`,
		};
	}

	const { target } = deploy;
	const kind = target.crd as OperatorKind;
	const plural = KIND_TO_PLURAL[kind];
	if (!plural) {
		await updateBuildJob(job.buildJobId, {
			rolloutStatus: "failed",
			error: `Unsupported operator CRD kind ${target.crd}`,
		});
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported operator CRD kind ${target.crd}`,
		});
	}

	const [repository, tag] = parseImageRef(job.image);

	// Multi-cluster bridge — ONE choke point. The deploy target's cluster is the
	// application's `k8sClusterId`: unset → shared hanzo-k8s (in-cluster SA);
	// managed → DO kubeconfig; external/BYO → the stored, decrypted kubeconfig.
	const k8sClusterId = await clusterIdForJob(job);
	const clients = await resolveDeployClients(k8sClusterId);

	const crName = `${target.namespace}/${target.name}`;
	await updateBuildJob(job.buildJobId, {
		rolloutStatus: "pending",
		rolloutTarget: crName,
	});

	// Merge-patch only `.spec.image`. The operator reconciles the rollout.
	const patch = {
		spec: { image: { repository, tag, pullPolicy: "Always" } },
	};

	try {
		// CustomObjectsApi sends `application/merge-patch+json` for partial CR
		// bodies, so this patch updates only `.spec.image` and leaves the rest
		// of the operator-managed Service CR untouched.
		await clients.custom.patchNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace: target.namespace,
			plural,
			name: target.name,
			body: patch,
		});
	} catch (err) {
		// CR absent → create it from the built image so a freshly connected repo
		// deploys with zero manual CR. Any other error is a genuine failure.
		if (!isNotFound(err)) {
			const msg = operatorError(err);
			await updateBuildJob(job.buildJobId, {
				rolloutStatus: "failed",
				error: `Rollout of ${crName} failed: ${msg}`,
			});
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Rollout of ${kind}/${target.name} in ${target.namespace} failed: ${msg}`,
			});
		}

		const cr = buildServiceCR(
			target.name,
			{
				organizationId: job.organizationId,
				namespace: target.namespace,
				resourceId: target.name,
				source: "platform.hanzo.ai",
			},
			{ image: { repository, tag, pullPolicy: "Always" } },
		);
		try {
			await clients.custom.createNamespacedCustomObject({
				group: OPERATOR_GROUP,
				version: OPERATOR_VERSION,
				namespace: target.namespace,
				plural,
				body: cr as unknown as object,
			});
		} catch (createErr) {
			const msg = operatorError(createErr);
			await updateBuildJob(job.buildJobId, {
				rolloutStatus: "failed",
				error: `Create of ${crName} failed: ${msg}`,
			});
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Create of ${kind}/${target.name} in ${target.namespace} failed: ${msg}`,
			});
		}

		await updateBuildJob(job.buildJobId, { rolloutStatus: "applied" });
		return {
			rolledOut: true,
			target: crName,
			reason: `created ${kind}/${target.name} at image ${tag}`,
		};
	}

	await updateBuildJob(job.buildJobId, { rolloutStatus: "applied" });
	return {
		rolledOut: true,
		target: crName,
		reason: `patched ${kind}/${target.name} image to ${tag}`,
	};
}

/**
 * Resolve which cluster this build deploys to. The target cluster is the
 * application's `k8sClusterId`: find the application(s) configured for this
 * build's repo within the same org and read the target. Returns null (→ shared
 * hanzo-k8s) when there is no app, no configured cluster, or an ambiguous set
 * of clusters for the repo — never a guess.
 */
async function clusterIdForJob(job: BuildJob): Promise<string | null> {
	const slash = job.repo.indexOf("/");
	if (slash < 0) return null;
	const owner = job.repo.slice(0, slash);
	const repository = job.repo.slice(slash + 1);

	const candidates = await db.query.applications.findMany({
		where: and(
			eq(applications.owner, owner),
			eq(applications.repository, repository),
		),
		with: { environment: { with: { project: true } } },
	});

	const clusterIds = new Set<string>();
	for (const app of candidates) {
		if (
			app.environment?.project?.organizationId === job.organizationId &&
			app.k8sClusterId
		) {
			clusterIds.add(app.k8sClusterId);
		}
	}
	return clusterIds.size === 1 ? [...clusterIds][0]! : null;
}

/** True when an operator/k8s error means the CR does not exist. */
function isNotFound(err: unknown): boolean {
	const e = err as { code?: number; statusCode?: number };
	if (e.code === 404 || e.statusCode === 404) return true;
	return operatorError(err).toLowerCase().includes("not found");
}

function operatorError(err: unknown): string {
	const e = err as {
		response?: { body?: { message?: string } };
		body?: { message?: string };
		message?: string;
	};
	return (
		e.response?.body?.message ?? e.body?.message ?? e.message ?? String(err)
	);
}
