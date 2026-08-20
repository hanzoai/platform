import { buildArgsProblem } from "@hanzo/platform/services/ci";
import { parseImageRef } from "@hanzo/platform/services/ci/image-ref";
import { repoProblem } from "@hanzo/platform/services/hanzo-git";
import { firstParty } from "@hanzo/platform/services/org";

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

const SEMVER_TAG = /^v?\d+\.\d+\.\d+$/;

/**
 * Everything we publish carries real semver — no ad-hoc tags.
 *
 * A tag is the name a running binary is traced back by, so it has to name a
 * release: one that a git tag also names, and that can therefore be rebuilt and
 * patched from source. A suffixed one-off answers to nothing, and what runs in
 * production cannot be told apart from what was released.
 *
 * WHICH images this is about, and how their parts are read, are the same two
 * answers the push path gets: `firstParty` and `parseImageRef`. A rule that
 * recognizes an image by one spelling while the credential recognizes it by
 * another leaves a destination that publishes with a real token under a name no
 * release answers to — so both read the one namespace table through the one
 * parser, and there is no second spelling to disagree about.
 *
 * Returns a message when the requested tag is not publishable, else null.
 * A digest reference is accepted: it is stronger than any tag. Images in
 * namespaces we do not publish under are not judged.
 */
export function firstPartyTagProblem(image: string): string | null {
	if (!firstParty(image)) return null;
	const [, tag, digest] = parseImageRef(image);
	if (digest) return null;
	if (!tag) {
		return `Refusing to build ${image}: no tag. First-party images must publish a semver tag (vX.Y.Z).`;
	}
	if (SEMVER_TAG.test(tag)) return null;

	return (
		`Refusing to build ${image}: "${tag}" is not semver. ` +
		"First-party images must publish vX.Y.Z — no :latest, no branch names, " +
		"no sha- or -amd64 or -<suffix> tags. Cut a release (x.y.z+1 off the last " +
		"patch) and build that. An image nothing can trace back to a version is " +
		"one nobody can rebuild or patch."
	);
}
