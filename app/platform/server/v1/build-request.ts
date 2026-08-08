import { buildArgsProblem } from "@hanzo/platform/services/ci";

export { buildArgsProblem };

/**
 * Build-enqueue request rules — the pure half of POST /v1/runner.
 *
 * These are decisions about a build request, not about HTTP. They live here
 * rather than in the route because a Next.js App Router `route.ts` may export
 * ONLY the request handlers and its route config (`runtime`, `dynamic`, …);
 * Next's generated `.next/types` constrains every other export to `never`, so
 * exporting a helper from the route is a type error and the tests that import
 * these rules cannot reach them. Route = transport, this = policy.
 */

/** Registry orgs we publish. Upstream images are none of our business. */
const FIRST_PARTY =
	/^ghcr\.io\/(luxfi|hanzoai|zooai|parsdao|adnexus|hanzobot|zenlm)\//;
const SEMVER_TAG = /^v?\d+\.\d+\.\d+$/;

/**
 * Everything we publish carries real semver — no ad-hoc tags.
 *
 * This route is how `ghcr.io/luxfi/node:v1.36.2-blsfix` came to exist and end up
 * running hanzo-mainnet's five validators. There is no git tag of that name and
 * the image carries no OCI revision label, so the binary running production
 * cannot be traced to source, rebuilt, or patched. The enqueue API accepted an
 * arbitrary `image` string, so a one-off suffix was a single POST away and left
 * no record that it was ever a release.
 *
 * Returns a message when the requested tag is not publishable, else null.
 * A digest reference is accepted: it is stronger than any tag. Non-first-party
 * destinations are not judged.
 */
export function firstPartyTagProblem(image: string): string | null {
	if (!FIRST_PARTY.test(image)) return null;
	if (image.includes("@sha256:")) return null;

	// Split off the tag, being careful that a registry host may carry a :port.
	const lastColon = image.lastIndexOf(":");
	const lastSlash = image.lastIndexOf("/");
	if (lastColon < lastSlash) {
		return `Refusing to build ${image}: no tag. First-party images must publish a semver tag (vX.Y.Z).`;
	}
	const tag = image.slice(lastColon + 1);
	if (SEMVER_TAG.test(tag)) return null;

	return (
		`Refusing to build ${image}: "${tag}" is not semver. ` +
		"First-party images must publish vX.Y.Z — no :latest, no branch names, " +
		"no sha- or -amd64 or -<suffix> tags. Cut a release (x.y.z+1 off the last " +
		"patch) and build that. An image nothing can trace back to a version is " +
		"one nobody can rebuild or patch."
	);
}
