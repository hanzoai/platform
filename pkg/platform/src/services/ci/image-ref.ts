/**
 * Split a docker image reference into [repository, tag]. Strict-mode safe.
 *
 * `postgres:16-alpine`        -> `["postgres", "16-alpine"]`
 * `postgres`                  -> `["postgres", ""]`
 * `ghcr.io/hanzoai/zip:abc1`  -> `["ghcr.io/hanzoai/zip", "abc1"]`
 * `ghcr.io:5000/x/y`          -> `["ghcr.io:5000/x/y", ""]` (registry port, no tag)
 *
 * Single canonical implementation shared by the CR builder and the deploy
 * executor — do not re-derive this elsewhere.
 */
export function parseImageRef(ref: string): [string, string] {
	const idx = ref.lastIndexOf(":");
	if (idx <= 0) return [ref, ""];
	const afterColon = ref.slice(idx + 1);
	// A `/` after the colon means it was a registry `host:port/` — not a tag.
	if (afterColon.includes("/")) return [ref, ""];
	return [ref.slice(0, idx), afterColon];
}

/**
 * Re-home an image reference onto a different registry host, preserving the
 * org/repo path and tag. This is how a GHCR ref is mirrored onto the fleet
 * registry for the dual-push:
 *
 * `withRegistryHost("ghcr.io/hanzoai/pricing:v1.2.3", "registry.hanzo.ai")`
 *   -> `"registry.hanzo.ai/hanzoai/pricing:v1.2.3"`
 *
 * The first path segment is replaced as a registry host only when it looks like
 * one (contains `.` or `:`, or is `localhost`); otherwise the ref is host-less
 * (Docker Hub short form) and the host is prepended. Same
 * one-canonical-place rule as `parseImageRef` — do not re-derive this elsewhere.
 */
/**
 * The GHCR namespace (org) an image pushes into.
 *
 * `ghcr.io/hanzoai/pricing:v1` -> `"hanzoai"`;  a host-less or single-segment
 * ref -> `undefined`. Same one-canonical-place rule as `parseImageRef`.
 */
export function imageOrg(ref: string): string | undefined {
	const [repo] = parseImageRef(ref);
	const parts = repo.split("/");
	// [host, org, name…] — an org only exists when a host is present.
	if (parts.length < 3) return undefined;
	const host = parts[0];
	if (!(host.includes(".") || host.includes(":") || host === "localhost")) {
		return undefined;
	}
	return parts[1] || undefined;
}

/**
 * The Kubernetes Secret holding the push credential for an image's org.
 *
 * Registries NEVER mix: a build mounts `push-<org>` and only that, so a token
 * stolen from a hanzo build cannot push to ghcr.io/luxfi. One secret per org is
 * the whole isolation mechanism (hanzoai/universe infra/k8s/hanzo-build), so the
 * secret is DERIVED from the destination rather than configured per call —
 * there is no way to point a build at the wrong org's credential by hand.
 *
 * Returns undefined for a ref with no org, so the caller can refuse rather than
 * silently mount someone else's token.
 */
export function pushSecretForImage(ref: string): string | undefined {
	const org = imageOrg(ref);
	return org ? `push-${org}` : undefined;
}

export function withRegistryHost(ref: string, host: string): string {
	const slash = ref.indexOf("/");
	const first = slash === -1 ? "" : ref.slice(0, slash);
	const hasHost =
		slash > 0 &&
		(first.includes(".") || first.includes(":") || first === "localhost");
	const path = hasHost ? ref.slice(slash + 1) : ref;
	return `${host}/${path}`;
}
