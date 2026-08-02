/**
 * DeployExecutor — rolls a freshly-built image onto its target cluster.
 *
 * After a build succeeds, this looks up the repo's deploy config from the
 * already-parsed `hanzo.yml`, decides whether the triggering branch is a deploy
 * branch, and (if so) patches the target operator workload CR's image tag. The
 * hanzo operator's reconcile loop performs the actual rollout (Deployment
 * update, rolling restart, etc.) — platform does NOT reimplement a deployer; it
 * reuses the operator surface it already drives for datastores.
 *
 * The workload kind is `App` (canonical — the fleet runs 82 of them) or the
 * `Service` alias. Both expose `.spec.image` identically, so this executor is
 * ONE code path parameterized by kind: same patch body, same create path, only
 * the CRD plural differs.
 *
 * The image is already in ghcr.io/hanzoai/<repo>:<sha> (the build runner
 * pushed it). The executor only records the tag and flips the CR spec.
 */
import { PatchStrategy, setHeaderOptions } from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";
import { resolveOrgClusterClients } from "../dedicated-cluster";
import {
	authorizeNamespace,
	buildWorkloadCR,
	defaultQuotaForTier,
	fleetNamespaceOwners,
	isWorkloadKind,
	KIND_TO_PLURAL,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	signPaasTicket,
	WORKLOAD_KINDS,
	type WorkloadKind,
} from "../k8s/operator";
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
		return { rolledOut: false, reason: "no deploy block in hanzo.yml" };
	}
	if (!deploy.on.includes(job.branch)) {
		await updateBuildJob(job.buildJobId, { rolloutStatus: "skipped" });
		return {
			rolledOut: false,
			reason: `branch ${job.branch} is not a deploy branch (${deploy.on.join(", ")})`,
		};
	}

	const { target } = deploy;
	// Workload kind — `App` (canonical, 82 live CRs) or `Service` (v0.3.0
	// alias). Both carry `.spec.image` with identical shape, so everything
	// below is parameterized by `kind` rather than forked per kind. A kind
	// outside that set fails loudly here; it is never coerced to a default.
	if (!isWorkloadKind(target.crd)) {
		await updateBuildJob(job.buildJobId, {
			rolloutStatus: "failed",
			error: `Unsupported operator CRD kind ${target.crd}`,
		});
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Unsupported operator CRD kind "${target.crd}" — must be one of ${WORKLOAD_KINDS.join(", ")}`,
		});
	}
	const kind: WorkloadKind = target.crd;
	const plural = KIND_TO_PLURAL[kind];

	// Authorization gate — fail closed. `target.namespace` comes verbatim from
	// the connected repo's `hanzo.yml` and is therefore UNTRUSTED;
	// `job.organizationId` is resolved by platform from the webhook→repo→org
	// binding and is trusted. `authorizeNamespace` is the single place that
	// decides whether this org owns that namespace — either because the
	// namespace is DERIVED from the org (`tenant-<org>`, unforgeable) or
	// because operator-controlled config assigns that fleet namespace to it.
	// Anything else is refused, never silently rewritten, so a misconfigured or
	// malicious repo cannot reach into another org's namespace.
	const authz = authorizeNamespace(
		target.namespace,
		job.organizationId,
		fleetNamespaceOwners(),
	);
	if (authz.decision === "refuse") {
		await updateBuildJob(job.buildJobId, {
			rolloutStatus: "failed",
			error: `Refusing unauthorized deploy: ${authz.reason}`,
		});
		throw new TRPCError({
			code: "FORBIDDEN",
			message: `Deploy refused: ${authz.reason} (hanzo.yml deploy.target.namespace)`,
		});
	}

	// The operator formats the container ref as `repository:tag`, so a digest
	// must ride along in `tag` or pinning is LOST — the CR would name a floating
	// tag and the next pull could serve different bytes under the same version.
	// `repository` stays clean; the digest stays attached to what it pins.
	const [repository, refTag, digest] = parseImageRef(job.image);
	const tag = digest ? `${refTag}@${digest}` : refTag;

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

	// Merge-patch `.spec.image.{repository,tag}` — the exact fields the operator
	// reads to build the container image ref (operator `manifests::image_ref`
	// formats `repository:tag`; the App controller passes `spec.image` through
	// verbatim). The operator reconciles the rollout from there.
	//
	// `pullPolicy` is deliberately NOT written. Rolling an image must not also
	// rewrite the CR's pull policy: most of the fleet runs `IfNotPresent`, and
	// forcing `Always` on every deploy would silently flip pull semantics on
	// every workload platform touches. A rollout does not need it either — the
	// tag changes, so the new image is pulled regardless; and when the tag is
	// unchanged the patch is a no-op and no pull policy would have helped.
	const patch = {
		spec: { image: { repository, tag } },
	};

	try {
		// Merge-patch only `.spec.image`, leaving the rest of the
		// operator-managed CR untouched. The Content-Type MUST be set
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
		if (isNotFound(err) && authz.basis === "fleet") {
			// ...but NEVER auto-create in a fleet namespace. There the CRs are
			// declared in git and already exist, so a 404 means the config names
			// the wrong CR — most often the wrong KIND (`crd: Service` against a
			// fleet that runs `App`). Creating one would materialize a SECOND CR
			// whose controller fights the existing one over the same Deployment.
			// Fail loudly and name the likely fix instead.
			const sibling = kind === "App" ? "Service" : "App";
			const hint = `no ${kind} CR "${target.name}" in namespace "${target.namespace}" — refusing to create one there (fleet CRs are declared in git). If this workload is a ${sibling} CR, set deploy.target.crd: ${sibling} in hanzo.yml`;
			await updateBuildJob(job.buildJobId, {
				rolloutStatus: "failed",
				error: `Rollout of ${crName} failed: ${hint}`,
			});
			throw new TRPCError({ code: "NOT_FOUND", message: hint });
		}
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

		// Bind the new workload to the tenant: mint a signed PaaS ticket so the
		// operator's tenant-mode admission webhook admits this CR for THIS org
		// only (ticket sub=org, ns=tenant namespace). Without it the operator
		// cannot bind the created workload to the tenant.
		let paasTicket: string;
		try {
			paasTicket = signPaasTicket({
				organizationId: job.organizationId,
				kind,
				namespace: target.namespace,
				name: target.name,
				// The deploy-path workload CR declares no explicit resource requests
				// (the operator fills defaults); the ticket claims the minimal app
				// envelope and the operator re-enforces the org's real plan quota on
				// admission — defense in depth, per docs/OPERATOR_INTEGRATION.md.
				quota: defaultQuotaForTier("free"),
			});
		} catch (signErr) {
			const msg = operatorError(signErr);
			await updateBuildJob(job.buildJobId, {
				rolloutStatus: "failed",
				error: `Create of ${crName} failed: cannot mint tenant ticket: ${msg}`,
			});
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Cannot mint tenant ticket for ${kind}/${target.name} in ${target.namespace}: ${msg}`,
			});
		}

		const cr = buildWorkloadCR(
			kind,
			target.name,
			{
				organizationId: job.organizationId,
				namespace: target.namespace,
				resourceId: target.name,
				paasTicket,
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
