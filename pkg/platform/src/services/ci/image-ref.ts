/**
 * Split a docker image reference into [repository, tag, digest]. Strict-mode safe.
 *
 * `postgres:16-alpine`        -> `["postgres", "16-alpine", ""]`
 * `postgres`                  -> `["postgres", "", ""]`
 * `ghcr.io/hanzoai/zip:abc1`  -> `["ghcr.io/hanzoai/zip", "abc1", ""]`
 * `ghcr.io:5000/x/y`          -> `["ghcr.io:5000/x/y", "", ""]` (registry port, no tag)
 * `ghcr.io/hanzoai/cloud:v1.801.371@sha256:76e3…`
 *                             -> `["ghcr.io/hanzoai/cloud", "v1.801.371", "sha256:76e3…"]`
 *
 * A reference has THREE parts, not two. The digest was previously smuggled into
 * the tag: `lastIndexOf(":")` lands inside `sha256:` on a digest-pinned ref, so
 * the split returned repository `ghcr.io/hanzoai/cloud:v1.801.371@sha256` and
 * tag `76e30c92…` — the hex. Every consumer then treated that hex as the running
 * VERSION: the fleet board printed a digest where an operator reads a version,
 * and `computeDrift` flagged `floating-running` ("not semver") on 43 rows that
 * were in fact pinned correctly. The board went red exactly where the estate was
 * right. Digest-pinning is the convention here (116 values files carry `digest:`
 * beside `tag:`), so this was the common case, not the edge.
 *
 * Returned as a 3-tuple so existing `const [repo, tag] = …` call sites are
 * unchanged; only a caller that must PRESERVE pinning names the third element.
 *
 * Single canonical implementation shared by the CR builder and the deploy
 * executor — do not re-derive this elsewhere.
 */
export function parseImageRef(ref: string): [string, string, string] {
	// The digest is delimited by `@` and always trails the tag, so peel it first;
	// what remains is an ordinary `repository[:tag]`.
	const at = ref.indexOf("@");
	const digest = at === -1 ? "" : ref.slice(at + 1);
	const rest = at === -1 ? ref : ref.slice(0, at);

	const idx = rest.lastIndexOf(":");
	if (idx <= 0) return [rest, "", digest];
	const afterColon = rest.slice(idx + 1);
	// A `/` after the colon means it was a registry `host:port/` — not a tag.
	if (afterColon.includes("/")) return [rest, "", digest];
	return [rest.slice(0, idx), afterColon, digest];
}

/**
 * A leading segment that names a registry rather than a path component.
 *
 * `withRegistryHost("ghcr.io/hanzoai/pricing:v1.2.3", "oci.hanzo.ai")`
 *   -> `"oci.hanzo.ai/hanzoai/pricing:v1.2.3"`
 *
 * The first path segment is replaced as a registry host only when it looks like
 * one (contains `.` or `:`, or is `localhost`); otherwise the ref is host-less
 * (Docker Hub short form) and the host is prepended. Same
 * one-canonical-place rule as `parseImageRef` — do not re-derive this elsewhere.
 */
function isHost(segment: string): boolean {
	return (
		segment.includes(".") || segment.includes(":") || segment === "localhost"
	);
}

/**
 * The registry an image addresses, or undefined for a host-less ref.
 *
 * `ghcr.io/hanzoai/pricing:v1` -> `"ghcr.io"`; `postgres:16` -> `undefined`.
 * Verbatim, like {@link imageOrg}: the host is read here, and whether it is one
 * we publish to is decided in `services/org`.
 */
export function imageHost(ref: string): string | undefined {
	const [repo] = parseImageRef(ref);
	const slash = repo.indexOf("/");
	if (slash <= 0) return undefined;
	const first = repo.slice(0, slash);
	return isHost(first) ? first : undefined;
}

/**
 * The registry namespace an image pushes into.
 *
 * `ghcr.io/hanzoai/pricing:v1` -> `"hanzoai"`;  a host-less or single-segment
 * ref -> `undefined`. Verbatim, as the caller spelled it: this reads a name out
 * of a string and does not decide anything about it. `services/org` is where a
 * name is resolved, and it folds case there so that every reader folds it the
 * same way. Same one-canonical-place rule as `parseImageRef`.
 */
export function imageOrg(ref: string): string | undefined {
	const [repo] = parseImageRef(ref);
	const parts = repo.split("/");
	// [host, org, name…] — an org only exists when a host is present.
	if (parts.length < 3) return undefined;
	if (!isHost(parts[0] ?? "")) return undefined;
	return parts[1] || undefined;
}

/**
 * The name an image carries inside its namespace.
 *
 * `ghcr.io/hanzoai/pricing:v1` -> `"pricing"`. With {@link imageOrg} this is the
 * `owner/name` the image itself spells — the path a repository publishing it
 * would be found at, whichever of an organization's several forge spellings the
 * push happened to arrive under. Verbatim, like the other two: this reads a name
 * out of a string and decides nothing about it.
 */
export function imageName(ref: string): string | undefined {
	const [repo] = parseImageRef(ref);
	const parts = repo.split("/");
	if (parts.length < 3) return undefined;
	if (!isHost(parts[0] ?? "")) return undefined;
	return parts[parts.length - 1] || undefined;
}

/**
 * Re-home an image reference onto a different registry host, preserving the
 * org/repo path and tag. This is how a GHCR ref is mirrored onto the fleet
 * registry for the dual-push:
 *
 * `withRegistryHost("ghcr.io/hanzoai/pricing:v1.2.3", "oci.hanzo.ai")`
 *   -> `"oci.hanzo.ai/hanzoai/pricing:v1.2.3"`
 *
 * The first path segment is replaced as a registry host only when it looks like
 * one (contains `.` or `:`, or is `localhost`); otherwise the ref is host-less
 * (Docker Hub short form) and the host is prepended. Same
 * one-canonical-place rule as `parseImageRef` — do not re-derive this elsewhere.
 */
export function withRegistryHost(ref: string, host: string): string {
	const slash = ref.indexOf("/");
	const hasHost = slash > 0 && isHost(ref.slice(0, slash));
	const path = hasHost ? ref.slice(slash + 1) : ref;
	return `${host}/${path}`;
}
