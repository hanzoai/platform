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
export function withRegistryHost(ref: string, host: string): string {
	const slash = ref.indexOf("/");
	const first = slash === -1 ? "" : ref.slice(0, slash);
	const hasHost =
		slash > 0 &&
		(first.includes(".") || first.includes(":") || first === "localhost");
	const path = hasHost ? ref.slice(slash + 1) : ref;
	return `${host}/${path}`;
}
