/**
 * Cluster registry resolution — the single bridge between a stored cluster
 * record and a live set of Kubernetes API clients.
 *
 * Platform tracks two kinds of target cluster in `doks_cluster`:
 *   - managed  — provisioned by platform on DigitalOcean (`doClusterId` set);
 *                its kubeconfig is fetched fresh from the DO API each time so
 *                DO credential rotation is transparent.
 *   - external — a bring-your-own cluster attached by the customer
 *                (`doClusterId` NULL, `kubeconfigEncrypted` set); platform has
 *                no API to fetch credentials from, so it stores the kubeconfig
 *                ENCRYPTED at rest and decrypts it on demand.
 *
 * `resolveDeployClients()` is the ONE choke point every targeted deploy goes
 * through: clusterId → kubeconfig → K8sClients (or the shared in-cluster SA
 * when no cluster is targeted). This keeps multi-cluster targeting in exactly
 * one place instead of braided through each deploy path.
 *
 * Kubeconfig-at-rest: reuses the repo's existing symmetric helper
 * (`better-auth/crypto`, AES-GCM), keyed by PAAS_SECRET_KEY (falling back to
 * BETTER_AUTH_SECRET — the same app secret already used to encrypt 2FA
 * material). Plaintext kubeconfig is NEVER persisted.
 */
import { db } from "@hanzo/platform/db";
import { doksCluster, organization } from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
	createK8sClients,
	getDefaultClients,
	type K8sClients,
} from "./k8s/k8s-client";
import { getDoksKubeconfig } from "./doks-provisioner";

type DoksClusterRow = typeof doksCluster.$inferSelect;

// ---------------------------------------------------------------------------
// Kubeconfig-at-rest crypto
// ---------------------------------------------------------------------------

/**
 * Symmetric key for encrypting cluster credentials at rest. Prefer the
 * cluster-scoped PAAS_SECRET_KEY; fall back to BETTER_AUTH_SECRET so a single
 * app secret can cover both. Fail closed: refuse to operate without a key
 * rather than silently store a kubeconfig in the clear.
 */
function clusterSecretKey(): string {
	const key = process.env.PAAS_SECRET_KEY ?? process.env.BETTER_AUTH_SECRET;
	if (!key) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"PAAS_SECRET_KEY (or BETTER_AUTH_SECRET) must be set to encrypt cluster kubeconfigs at rest",
		});
	}
	return key;
}

/** Encrypt a secret string for storage. */
export function encryptSecret(plaintext: string): Promise<string> {
	return symmetricEncrypt({ key: clusterSecretKey(), data: plaintext });
}

/** Decrypt a stored secret string. */
export function decryptSecret(ciphertext: string): Promise<string> {
	return symmetricDecrypt({ key: clusterSecretKey(), data: ciphertext });
}

// ---------------------------------------------------------------------------
// Resolution: cluster record → kubeconfig → clients
// ---------------------------------------------------------------------------

/**
 * Resolve a cluster record to its kubeconfig YAML. Managed clusters fetch a
 * fresh kubeconfig from DigitalOcean; external clusters decrypt the stored one.
 */
export async function clusterKubeconfig(
	cluster: DoksClusterRow,
): Promise<string> {
	if (cluster.kubeconfigEncrypted) {
		return decryptSecret(cluster.kubeconfigEncrypted);
	}
	if (cluster.doClusterId) {
		return getDoksKubeconfig(cluster.doksClusterId);
	}
	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: `Cluster ${cluster.doksClusterId} has no kubeconfig source (neither an attached kubeconfig nor a DigitalOcean cluster)`,
	});
}

/**
 * The one choke point for a targeted deploy's K8s clients.
 *
 *   - no clusterId  → shared in-cluster SA (default hanzo-k8s).
 *   - clusterId set → that cluster's kubeconfig (managed or external) → typed
 *                     clients pinned to it. A set-but-unresolvable id is an
 *                     error, never a silent fall-back to the wrong cluster.
 */
export async function resolveDeployClients(
	k8sClusterId: string | null | undefined,
): Promise<K8sClients> {
	if (!k8sClusterId) {
		return getDefaultClients();
	}
	const cluster = await db.query.doksCluster.findFirst({
		where: eq(doksCluster.doksClusterId, k8sClusterId),
	});
	if (!cluster) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Target cluster ${k8sClusterId} not found`,
		});
	}
	return createK8sClients(await clusterKubeconfig(cluster));
}

// ---------------------------------------------------------------------------
// BYO-DOKS attach
// ---------------------------------------------------------------------------

export interface AttachExternalClusterInput {
	organizationId: string;
	name: string;
	/** Raw kubeconfig YAML; encrypted before it touches the DB. */
	kubeconfig: string;
}

/**
 * Attach an external (bring-your-own) Kubernetes cluster to an organization.
 *
 * The kubeconfig is validated (it must parse and expose a server endpoint),
 * then stored ENCRYPTED. `doClusterId` stays NULL — platform never created
 * this cluster and has no DO lifecycle over it. The returned record omits the
 * ciphertext.
 */
export async function attachExternalCluster(
	input: AttachExternalClusterInput,
): Promise<Omit<DoksClusterRow, "kubeconfigEncrypted">> {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, input.organizationId),
	});
	if (!org) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
	}

	// Validate the kubeconfig parses and capture its endpoint. loadFromString
	// (inside createK8sClients) throws on a malformed kubeconfig.
	let endpoint: string | null = null;
	try {
		const clients = createK8sClients(input.kubeconfig);
		endpoint = clients.kc.getCurrentCluster()?.server ?? null;
	} catch (err) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Invalid kubeconfig: ${(err as Error).message}`,
		});
	}

	const kubeconfigEncrypted = await encryptSecret(input.kubeconfig);

	const inserted = await db
		.insert(doksCluster)
		.values({
			name: input.name,
			doClusterId: null,
			kubeconfigEncrypted,
			region: "external",
			status: "running",
			endpoint,
			organizationId: input.organizationId,
			tags: ["external", "byo"],
		})
		.returning()
		.then((v) => v[0]);

	if (!inserted) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to save cluster record",
		});
	}

	// Never hand the ciphertext back to callers.
	const { kubeconfigEncrypted: _omit, ...safe } = inserted;
	return safe;
}
