/**
 * Operator integration barrel.
 *
 * High-level API:
 *   - applyDatastoreCR     -- write a SQL/KV/DocDB CR to the cluster
 *   - deletDatastoreCR     -- remove a SQL/KV/DocDB CR
 *   - readDatastoreCRStatus -- read .status.phase + connectionString
 *
 * Per the integration plan (`docs/OPERATOR_INTEGRATION.md`), platform
 * calls these from existing deploy* / remove* service functions when
 * `USE_K8S_OPERATOR=true`. Docker Swarm path is preserved when the flag
 * is off.
 */
import { setHeaderOptions } from "@kubernetes/client-node";
import { TRPCError } from "@trpc/server";

import {
	createK8sClients,
	getDefaultClients,
	type K8sClients,
} from "../k8s-client";
import {
	type CustomResource,
	type DatastoreSpec,
	KIND_TO_PLURAL,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	type OperatorKind,
	type OperatorServiceSpec,
} from "./cr-builder";
import {
	checkQuota,
	defaultQuotaForTier,
	type OrgUsage,
	type PlanTier,
} from "./quota";
import { signPaasTicket } from "./tenant";

export * from "./cr-builder";
export * from "./namespace-authz";
export * from "./quota";
export * from "./tenant";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function getClients(kubeconfig?: string): K8sClients {
	return kubeconfig ? createK8sClients(kubeconfig) : getDefaultClients();
}

function k8sError(err: unknown): string {
	const e = err as {
		response?: { body?: { message?: string } };
		message?: string;
	};
	return e.response?.body?.message ?? e.message ?? String(err);
}

// ---------------------------------------------------------------------------
// Apply CR — two semantics matched to two ownership models:
//   applyCR (replace→create): platform-EXCLUSIVE resources (datastores). One
//     writer, so a full replace is correct and simplest.
//   serverApplyCR (server-side apply): resources SHARED with the operator (the
//     git→CR deploy plane). Field-managed apply force-acquires only the fields
//     git declares and never clobbers fields another manager owns (operator
//     finalizers/annotations, the protected /status). Matches the retired
//     gitops-reconcile cron's `kubectl apply --server-side --force-conflicts
//     --field-manager`.
// ---------------------------------------------------------------------------

export interface ApplyOptions {
	/** Multi-cluster: tenant kubeconfig (if not set, default kubeconfig used). */
	kubeconfig?: string;
}

/** Field-manager identity for platform's server-side applies. */
const FIELD_MANAGER = "hanzo-platform";

/**
 * Apply an operator CR by full REPLACE (create on 404) — for platform-EXCLUSIVE
 * resources (datastores) where platform is the sole writer, so overwriting the
 * whole object is correct. Idempotent: the caller need not track whether the CR
 * exists. Never prunes — removal is `deleteDatastoreCR`.
 */
export async function applyCR<Spec>(
	cr: CustomResource<Spec>,
	opts: ApplyOptions = {},
): Promise<void> {
	const clients = getClients(opts.kubeconfig);
	const plural = KIND_TO_PLURAL[cr.kind];
	const { namespace, name } = cr.metadata;

	// Try update first; fall back to create on 404. This matches the
	// idempotency expectation: caller doesn't need to track whether the
	// CR already exists.
	try {
		await clients.custom.replaceNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural,
			name,
			body: cr as unknown as object,
		});
		return;
	} catch (err) {
		const msg = k8sError(err);
		if (!msg.includes("not found")) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Cannot replace ${cr.kind}/${name} in ${namespace}: ${msg}`,
			});
		}
	}

	try {
		await clients.custom.createNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural,
			body: cr as unknown as object,
		});
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot create ${cr.kind}/${name} in ${namespace}: ${k8sError(err)}`,
		});
	}
}

/**
 * Apply an operator CR by SERVER-SIDE APPLY (field-managed, create-or-update in
 * one call) — for resources SHARED with the operator (the git→CR deploy plane).
 * Force-acquires only the fields git declares; fields owned by another manager
 * (operator finalizers/annotations, the protected /status) are preserved, so a
 * blind replace can never clobber them. Never prunes.
 */
export async function serverApplyCR<Spec>(
	cr: CustomResource<Spec>,
	opts: ApplyOptions = {},
): Promise<void> {
	const clients = getClients(opts.kubeconfig);
	const plural = KIND_TO_PLURAL[cr.kind];
	const { namespace, name } = cr.metadata;

	try {
		await clients.custom.patchNamespacedCustomObject(
			{
				group: OPERATOR_GROUP,
				version: OPERATOR_VERSION,
				namespace,
				plural,
				name,
				body: cr as unknown as object,
				fieldManager: FIELD_MANAGER,
				force: true,
			},
			// Server-side apply is a PATCH with the apply media type; without this
			// header the server treats the body as a merge patch, not an apply.
			setHeaderOptions("Content-Type", "application/apply-patch+yaml"),
		);
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot apply ${cr.kind}/${name} in ${namespace}: ${k8sError(err)}`,
		});
	}
}

/**
 * Apply a datastore CR (SQL / KV / DocDB) to the cluster. Thin typed alias over
 * `applyCR` (REPLACE) — datastores are platform-exclusive. Status is observed by
 * the caller via `readDatastoreCRStatus`.
 */
export function applyDatastoreCR(
	cr: CustomResource<DatastoreSpec>,
	opts: ApplyOptions = {},
): Promise<void> {
	return applyCR(cr, opts);
}

// ---------------------------------------------------------------------------
// Delete CR
// ---------------------------------------------------------------------------

export async function deleteDatastoreCR(
	kind: OperatorKind,
	namespace: string,
	name: string,
	opts: ApplyOptions = {},
): Promise<void> {
	const clients = getClients(opts.kubeconfig);
	const plural = KIND_TO_PLURAL[kind];
	try {
		await clients.custom.deleteNamespacedCustomObject({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural,
			name,
		});
	} catch (err) {
		const msg = k8sError(err);
		if (msg.includes("not found")) return;
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot delete ${kind}/${name} in ${namespace}: ${msg}`,
		});
	}
}

// ---------------------------------------------------------------------------
// Read status
// ---------------------------------------------------------------------------

export interface DatastoreCRStatus {
	phase?: "Pending" | "Creating" | "Running" | "Degraded" | "Deleting";
	readyReplicas: number;
	connectionString?: string;
	observedGeneration?: number;
}

export async function readDatastoreCRStatus(
	kind: OperatorKind,
	namespace: string,
	name: string,
	opts: ApplyOptions = {},
): Promise<DatastoreCRStatus | null> {
	const clients = getClients(opts.kubeconfig);
	const plural = KIND_TO_PLURAL[kind];
	try {
		const res = await clients.custom.getNamespacedCustomObjectStatus({
			group: OPERATOR_GROUP,
			version: OPERATOR_VERSION,
			namespace,
			plural,
			name,
		});
		const obj = res as { status?: DatastoreCRStatus };
		return obj.status ?? null;
	} catch (err) {
		const msg = k8sError(err);
		if (msg.includes("not found")) return null;
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Cannot read ${kind}/${name} status in ${namespace}: ${msg}`,
		});
	}
}

// ---------------------------------------------------------------------------
// Composite: build PaaS ticket + apply CR in one call
// ---------------------------------------------------------------------------

export interface ProvisionInput {
	/** The full CR built by `buildPostgresCR` / `buildRedisCR` / `buildMongoCR`. */
	cr: CustomResource<DatastoreSpec>;
	/** Organization slug from session.activeOrganizationId. */
	organizationId: string;
	/** Org plan tier from billing service. */
	planTier: PlanTier;
	/** Org current operator-CR resource usage (sum across all CRs). */
	currentUsage: OrgUsage;
	/** Kubeconfig string for multi-cluster targeting (optional). */
	kubeconfig?: string;
}

/**
 * Quota-check, ticket-sign, and apply the CR in one step.
 *
 * Used by `deployPostgres`, `deployRedis`, `deployMongo` etc. when
 * `USE_K8S_OPERATOR` is enabled.
 */
export async function provisionDatastore(input: ProvisionInput): Promise<void> {
	const quota = defaultQuotaForTier(input.planTier);
	checkQuota(input.planTier, quota, input.currentUsage, true);

	const ticket = signPaasTicket({
		organizationId: input.organizationId,
		kind: input.cr.kind,
		namespace: input.cr.metadata.namespace,
		name: input.cr.metadata.name,
		quota,
	});

	// Stamp the freshly-minted ticket into the CR (build phase used a
	// placeholder; here we set the real one).
	input.cr.metadata.annotations["hanzo.ai/paas-ticket"] = ticket;

	await applyDatastoreCR(input.cr, { kubeconfig: input.kubeconfig });
}

/**
 * Poll the CR status until phase=Running or timeout. Returns the final
 * status. Throws on timeout or terminal Degraded state.
 *
 * Polling interval is 2 seconds. Default timeout is 5 minutes.
 */
export async function waitDatastoreReady(
	kind: OperatorKind,
	namespace: string,
	name: string,
	opts: ApplyOptions & {
		timeoutMs?: number;
		onProgress?: (msg: string) => void;
	} = {},
): Promise<DatastoreCRStatus> {
	const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
	const intervalMs = 2000;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const status = await readDatastoreCRStatus(kind, namespace, name, opts);
		if (!status) {
			opts.onProgress?.(`Waiting for ${kind}/${name} to appear...`);
		} else if (status.phase === "Running") {
			opts.onProgress?.(
				`${kind}/${name} is Running (${status.readyReplicas} replica(s))`,
			);
			return status;
		} else if (status.phase === "Degraded") {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `${kind}/${name} entered Degraded phase`,
			});
		} else {
			opts.onProgress?.(`${kind}/${name} phase=${status.phase ?? "?"}`);
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}

	throw new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: `${kind}/${name} did not become Running within ${timeoutMs}ms`,
	});
}
