import { buildArgsProblem } from "@hanzo/platform/services/ci";
import { repoProblem } from "@hanzo/platform/services/hanzo-git";

export { buildArgsProblem, repoProblem };

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
 * A tag is the name a running binary is traced back by, so it has to name a
 * release: one that a git tag also names, and that can therefore be rebuilt and
 * patched from source. A suffixed one-off answers to nothing, and what runs in
 * production cannot be told apart from what was released.
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
