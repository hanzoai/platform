/**
 * Direct build enqueue — POST /v1/runner
 *
 * The native runner fabric's enqueue front door (formerly /v1/arcd/enqueue).
 * "runner" is the platform's own CI/compute pool namespace — distinct from
 * github.com/arc-runner (arcd), the client-side GitHub-Actions BYO product.
 * The GitHub-App-free trigger for platform-native CI. The webhook path
 * (/v1/github-webhook) derives a build from `hanzo.yml` at a SHA; this route
 * lets an operator (or a repo not wired to the GitHub App) enqueue a build by
 * stating it explicitly. The downstream is identical — it reuses
 * `enqueueDirectBuild` → `createBuildJob` + the in-cluster BuildKit build muscle
 * → the build-watcher → deploy/test/publish — so there is exactly ONE build
 * path, two front doors.
 *
 * Auth: the shared machine-to-machine bearer token PLATFORM_BUILD_CALLBACK_TOKEN
 * (same credential as /v1/build-callback) — this is an infra surface, not a
 * user-facing one, so it does not use the IAM session.
 */
import { enqueueDirectBuild } from "@hanzo/platform/services/ci";
import { TRPCError } from "@trpc/server";
import { safeEqual } from "@/server/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnqueueBody {
	repo?: string;
	sha?: string;
	image?: string;
	branch?: string;
	ref?: string;
	dockerfile?: string;
	context?: string;
	/** Docker build stage (`--target`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
	os?: "linux" | "darwin" | "windows";
	arch?: "amd64" | "arm64";
	organizationId?: string;
}

/** Registry orgs we publish. Upstream images are none of our business. */
const FIRST_PARTY = /^ghcr\.io\/(luxfi|hanzoai|zooai|parsdao|adnexus|hanzobot|zenlm)\//;
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
		`First-party images must publish vX.Y.Z — no :latest, no branch names, ` +
		`no sha- or -amd64 or -<suffix> tags. Cut a release (x.y.z+1 off the last ` +
		`patch) and build that. An image nothing can trace back to a version is ` +
		`one nobody can rebuild or patch.`
	);
}

export async function POST(req: Request) {
	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		return Response.json(
			{ message: "PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server" },
			{ status: 500 },
		);
	}
	// Constant-time bearer check (no early-exit on the token — timingSafeEqual).
	const header = req.headers.get("authorization") ?? "";
	const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
	if (!provided || !safeEqual(provided, expected)) {
		return Response.json({ message: "Invalid enqueue token" }, { status: 401 });
	}

	const body = (await req.json().catch(() => ({}))) as EnqueueBody;
	if (!body?.repo || !body?.sha || !body?.image) {
		return Response.json(
			{ message: "Missing required field(s): repo, sha, image" },
			{ status: 400 },
		);
	}

	const tagProblem = firstPartyTagProblem(body.image);
	if (tagProblem) {
		return Response.json({ message: tagProblem }, { status: 400 });
	}

	const organizationId = body.organizationId ?? process.env.DEFAULT_BUILD_ORG_ID;
	if (!organizationId) {
		return Response.json(
			{
				message:
					"organizationId is required (no DEFAULT_BUILD_ORG_ID configured on the server)",
			},
			{ status: 400 },
		);
	}

	try {
		const job = await enqueueDirectBuild({
			repo: body.repo,
			sha: body.sha,
			image: body.image,
			branch: body.branch,
			ref: body.ref,
			dockerfile: body.dockerfile,
			context: body.context,
			dockerTarget: body.dockerTarget,
			os: body.os,
			arch: body.arch,
			organizationId,
		});
		return Response.json(
			{
				buildJobId: job.buildJobId,
				status: job.status,
				runnerPool: job.runnerPool,
				image: job.image,
				target: job.target,
			},
			{ status: 202 },
		);
	} catch (err) {
		if (err instanceof TRPCError) {
			// CONFLICT (no live runner for the pool) → 409; everything else → 400.
			const code = err.code === "CONFLICT" ? 409 : 400;
			return Response.json({ message: err.message }, { status: code });
		}
		return Response.json(
			{ message: `enqueue failed: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
