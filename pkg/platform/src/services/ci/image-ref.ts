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
