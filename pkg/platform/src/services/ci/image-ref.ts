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
	const host = parts[0] ?? "";
	if (!(host.includes(".") || host.includes(":") || host === "localhost")) {
		return undefined;
	}
	return parts[1] || undefined;
}

/**
 * Registry namespaces this build path is allowed to push to.
 *
 * MUST stay in sync with `orgRegistryNamespaces` in the Go scheduler
 * (hanzoai/cloud apps/platform/runner.go) — the two schedulers mount the same
 * Secrets and a set that differs between them is a hole in whichever is wider.
 *
 * This list is an AUTHORIZATION check, not a naming convention. Without it
 * `pushSecretForImage` derives a secret name from attacker-influenced input:
 * an image ref of `ghcr.io/<anything>/x:v1` yields `push-<anything>`, and the
 * only thing standing between that and a mounted credential is whether such a
 * Secret happens to exist in `hanzo-build`. Deny by list, not by absence.
 */
const PUSH_ORGS = new Set(["hanzoai", "luxfi", "zooai", "parsdao"]);

/**
 * The Kubernetes Secret holding the push credential for an image's org.
 *
 * The MOUNT is per-org: exactly one `push-<org>` is projected into a build pod,
 * derived from the destination rather than configured per call, so a build
 * cannot be pointed at another org's credential by hand.
 *
 * The TOKEN is a separate question, and per-org mounting only bounds blast
 * radius once the tokens are themselves per-org. MEASURED 2026-08-06 against
 * the live `hanzo-build` namespace, they are not:
 *
 *   - push-hanzoai / push-luxfi / push-zooai carry ONE byte-identical classic
 *     PAT (`ghp_`) on the personal account `Darkhorse7stars`, member of 16 orgs,
 *     scopes incl. `admin:enterprise`, `admin:org`, `delete_repo`,
 *     `delete:packages`, `write:packages`.
 *   - push-parsdao is a DIFFERENT token but not a narrower one: a `gho_` OAuth
 *     token on `hanzo-dev`, member of 51 orgs. Its distinct fingerprint reads
 *     as isolation and is not.
 *   - All four authorize push to hanzoai, luxfi and zooai. Verified with a
 *     non-destructive blob-upload probe that returns 403 for orgs the account
 *     does not belong to, so the positive results are meaningful.
 *
 * So a token stolen from a hanzo build CAN today push to ghcr.io/luxfi. The
 * mechanism here is complete and needs no change; the credential values are the
 * outstanding half. Remediation and its proof:
 * hanzoai/universe infra/k8s/hanzo-build/README.md.
 *
 * Returns undefined for a ref with no org, or an org outside `PUSH_ORGS`, so
 * the caller refuses rather than mounting — or naming — someone else's token.
 */
export function pushSecretForImage(ref: string): string | undefined {
	const org = imageOrg(ref);
	if (!org || !PUSH_ORGS.has(org)) return undefined;
	return `push-${org}`;
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
