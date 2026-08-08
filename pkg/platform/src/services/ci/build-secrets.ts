/**
 * build-secrets — fetch publishable `build_secrets:` from KMS for the webhook lane.
 *
 * A `build_secrets: [NAME]` entry in hanzo.yml names a PUBLISHABLE value (a client
 * pixel key, a Mapbox token) that a Dockerfile bakes at build time as
 * `--build-arg NAME=<value>`. The ci-reusable and the explicit `/v1/runner`
 * buildArgs path already pass these; the platform webhook lane did NOT, so a repo
 * declaring one built with an empty value and its Dockerfile refused
 * (`PUBLISHABLE_KEY is empty`). scheduleBuilds now calls this and merges the
 * result into that image's buildArgs.
 *
 * FAIL CLOSED. A declared secret that will not resolve — KMS unreachable, no
 * platform credential, an empty value — THROWS. Baking an empty value ships an
 * image that silently misbehaves (a pixel key that drops every event), which is
 * worse than a build that stops and names the secret.
 *
 * The tenant is not spelled here. `/v1/kms/auth/login` returns an IAM JWT scoped
 * by its `owner` claim, and the read endpoint honours that claim — so the
 * platform's own principal (IAM_CLIENT_ID) reads its own org's secrets and no
 * other's. Same broker, same scoping the ci-reusable's KMS step relies on.
 */

const KMS_ENDPOINT = (process.env.KMS_ENDPOINT ?? "https://api.hanzo.ai").replace(
	/\/+$/,
	"",
);

async function kmsLogin(): Promise<string> {
	const clientId = process.env.IAM_CLIENT_ID;
	const clientSecret = process.env.IAM_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			"IAM_CLIENT_ID/IAM_CLIENT_SECRET are unset — the platform has no KMS principal to fetch build_secrets with",
		);
	}
	const res = await fetch(`${KMS_ENDPOINT}/v1/kms/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ clientId, clientSecret }),
	});
	if (!res.ok) {
		throw new Error(`KMS login failed (${res.status}) for build_secrets`);
	}
	const body = (await res.json()) as { accessToken?: string };
	if (!body.accessToken) {
		throw new Error("KMS login returned no accessToken for build_secrets");
	}
	return body.accessToken;
}

export interface KmsSecretLocation {
	/** Folder under the org, e.g. `deploy`. */
	path: string;
	/** Environment, e.g. `prod`. */
	env: string;
}

/**
 * Fetch each NAME from KMS and return a NAME→value map — one login, one read per
 * name. Throws on the first name that cannot be resolved; the caller treats that
 * as "do not schedule this build".
 */
export async function fetchBuildSecrets(
	names: readonly string[],
	loc: KmsSecretLocation,
): Promise<Record<string, string>> {
	if (names.length === 0) return {};
	const token = await kmsLogin();
	const out: Record<string, string> = {};
	for (const name of names) {
		const url = `${KMS_ENDPOINT}/v1/kms/secrets/${encodeURIComponent(
			loc.path,
		)}/${encodeURIComponent(name)}?env=${encodeURIComponent(loc.env)}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			throw new Error(
				`build_secret ${name} is not readable at ${loc.path}/${name} env=${loc.env} (${res.status}) — refusing to bake an empty value`,
			);
		}
		const body = (await res.json()) as { value?: string };
		if (!body.value) {
			throw new Error(
				`build_secret ${name} resolved empty at ${loc.path}/${name} env=${loc.env} — refusing to bake an empty value`,
			);
		}
		out[name] = body.value;
	}
	return out;
}
