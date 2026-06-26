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
import { PatchStrategy, setHeaderOptions } from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";
import { resolveOrgClusterClients } from "../dedicated-cluster";
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

	// Multi-cluster bridge — ONE choke point. resolveOrgClusterClients pins the
	// rollout to the org's selected cluster (dedicated DOKS or attached BYO), else
	// the shared in-cluster SA. This is what joins the build→deploy pipeline to
	// the cluster control plane (it previously always hit the shared cluster).
	const clients = await resolveOrgClusterClients(job.organizationId);

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
		// Merge-patch only `.spec.image`, leaving the rest of the
		// operator-managed Service CR untouched. The Content-Type MUST be set
		// explicitly: @kubernetes/client-node v1.x defaults patch requests to
		// JSON-Patch (an array of ops), so a merge object is rejected by the API
		// server with "cannot unmarshal object into []jsonPatchOp" (a 400).
		// setHeaderOptions wires `application/merge-patch+json` via middleware —
		// merge-patch (not strategic-merge, which CRDs do not support).
		await clients.custom.patchNamespacedCustomObject(
			{
				group: OPERATOR_GROUP,
				version: OPERATOR_VERSION,
				namespace: target.namespace,
				plural,
				name: target.name,
				body: patch,
			},
			setHeaderOptions("Content-Type", PatchStrategy.MergePatch),
		);
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
