/**
 * IAM tenant scoping for a package.
 *
 * Provisioning a package needs the org's IAM tenant scoped: an application
 * registered as `<org>-<app>` (the canonical client id), under the org's IAM
 * org, optionally with its own issuer (`iamTemplate.ownIssuer`).
 *
 * GROUND TRUTH (honest): the platform authenticates to IAM ONE WAY — it
 * VALIDATES tokens (JWKS, `lib/iam.ts`); it does NOT hold Casdoor admin
 * credentials and there is no admin-API client here today. So:
 *
 *   - if `IAM_ADMIN_URL` + `IAM_ADMIN_TOKEN` are present (KMS-synced), this makes
 *     the real Casdoor admin call to add the application (idempotent), and
 *     returns `provisioned`.
 *   - otherwise it computes the deterministic `<org>-<app>` client id, records
 *     the INTENT, and returns `pending` with a clear reason — NEVER a faked
 *     "provisioned". The org's IAM org is assumed to already exist (the console
 *     seeds hanzo/lux/zoo/pars in Casdoor out-of-band; per-reseller sub-orgs are
 *     the follow-up that needs the admin token).
 *
 * When the admin token lands in KMS, `provisionPackage` starts scoping IAM for
 * real with zero code change — the pending path becomes the provisioned path.
 */
import { kmsSecret } from "../kms";
import { expandPattern } from "./logic";

export interface IamScopeInput {
	/** Org slug (the `{slug}` in appPattern), e.g. `acme`. */
	slug: string;
	/** The package's iamTemplate. */
	iamTemplate: { ownIssuer: boolean; appPattern: string };
	/** IAM org name (owner claim) — defaults to slug. */
	iamOrgName?: string;
}

export interface IamScopeResult {
	/** The `<org>-<app>` client id (always computed, deterministic). */
	iamApp: string;
	state: "provisioned" | "pending" | "failed";
	detail: string;
}

/** Expand `{slug}` in an appPattern to the concrete `<org>-<app>` client id. */
export function iamAppFor(input: IamScopeInput): string {
	return expandPattern(input.iamTemplate.appPattern, input.slug);
}

function adminConfig(): { url: string; token: string } | null {
	const url = kmsSecret("IAM_ADMIN_URL") ?? process.env.IAM_ADMIN_URL;
	const token = kmsSecret("IAM_ADMIN_TOKEN");
	if (!url || !token) return null;
	return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Scope the org's IAM tenant for a package. Real Casdoor call when admin creds
 * are present; otherwise records the deterministic client id as pending
 * (honest). Never throws for the pending case — provisioning continues and the
 * grant records the honest per-service state.
 */
export async function scopeIamTenant(
	input: IamScopeInput,
): Promise<IamScopeResult> {
	const iamApp = iamAppFor(input);
	const admin = adminConfig();
	const org = input.iamOrgName ?? input.slug;

	if (!admin) {
		return {
			iamApp,
			state: "pending",
			detail:
				`IAM application "${iamApp}" (org "${org}", ` +
				`ownIssuer=${input.iamTemplate.ownIssuer}) recorded pending — ` +
				`platform has no IAM admin token (set IAM_ADMIN_URL + IAM_ADMIN_TOKEN ` +
				`via KMS to auto-register the Casdoor application).`,
		};
	}

	// Real Casdoor admin registration (idempotent add-application).
	try {
		const res = await fetch(`${admin.url}/api/add-application`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${admin.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				owner: "admin",
				name: iamApp,
				organization: org,
				displayName: iamApp,
				grantTypes: ["authorization_code", "refresh_token"],
			}),
		});
		if (!res.ok && res.status !== 409) {
			const text = await res.text().catch(() => res.statusText);
			return {
				iamApp,
				state: "failed",
				detail: `IAM add-application failed (${res.status}): ${text}`,
			};
		}
		return {
			iamApp,
			state: "provisioned",
			detail:
				res.status === 409
					? `IAM application "${iamApp}" already exists (idempotent)`
					: `IAM application "${iamApp}" registered in org "${org}"`,
		};
	} catch (err) {
		return {
			iamApp,
			state: "failed",
			detail: `IAM admin call errored: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
