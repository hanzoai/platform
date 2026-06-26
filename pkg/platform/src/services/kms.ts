/**
 * KMS-sourced secret accessor — the single funnel for reading secrets whose
 * source of truth is Hanzo KMS (kms.hanzo.ai / luxfi/kms MPC backend).
 *
 * One way, in one place. Platform NEVER hardcodes a secret and NEVER opens a
 * second secret channel. The canonical Hanzo delivery path is:
 *
 *     KMS (kms.hanzo.ai)
 *       └─ KMSSecret CRD (k8s/platform-kmssecret.yaml, 60s resync)
 *            └─ K8s Secret `platform-app-secrets`
 *                 └─ env var mounted into the platform pod
 *
 * So in-process a KMS secret arrives as an environment variable that the
 * KMSSecret operator populated. This module decomplects two concerns that were
 * previously braided at each `process.env.X` site:
 *   - WHAT secret a caller needs (a named value whose authority is KMS), from
 *   - HOW it physically lands (an env var synced by the KMSSecret operator).
 *
 * Callers ask `requireKmsSecret("PAAS_DO_API_TOKEN")`; the KMS path stays an
 * implementation detail of this funnel. Rotating a value in KMS propagates via
 * the KMSSecret resync with no code change.
 *
 * To add a new KMS-backed secret: add its key to the KMSSecret `keys` list in
 * `k8s/platform-kmssecret.yaml` (so KMS actually syncs it), then read it here.
 */

/** Where this process expects KMS-synced secrets to surface (for error text). */
const KMS_PATH_HINT =
	"KMS → KMSSecret(platform-app-kms-sync) → Secret(platform-app-secrets) → pod env";

/** Thrown when a required KMS-sourced secret is absent from the environment. */
export class KmsSecretMissingError extends Error {
	constructor(public readonly key: string) {
		super(
			`KMS secret "${key}" is not available in the environment. ` +
				`It must be provisioned through KMS and synced via the KMSSecret ` +
				`pipeline (${KMS_PATH_HINT}). Add "${key}" to the KMSSecret keys ` +
				`list in k8s/platform-kmssecret.yaml — never hardcode it.`,
		);
		this.name = "KmsSecretMissingError";
	}
}

/**
 * Read a KMS-sourced secret, returning undefined when it has not been synced.
 * Use for optional secrets; use `requireKmsSecret` when the secret is mandatory
 * and its absence should fail the operation loudly.
 */
export function kmsSecret(key: string): string | undefined {
	const value = process.env[key];
	return value && value.length > 0 ? value : undefined;
}

/**
 * Read a mandatory KMS-sourced secret. Throws `KmsSecretMissingError` (naming
 * the KMS path) when the value is absent, so a misconfigured secret pipeline
 * surfaces as a precise, actionable failure rather than a downstream 401/500
 * from the API the secret authenticates against.
 */
export function requireKmsSecret(key: string): string {
	const value = kmsSecret(key);
	if (value === undefined) throw new KmsSecretMissingError(key);
	return value;
}
