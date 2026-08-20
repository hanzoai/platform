/**
 * One object: what a build is checked against is what a build clones.
 *
 * A build carries ONE commit id. It keys the row, it addresses `hanzo.yml` on
 * the forge, it is what the canonical-source check asks GitHub about, and it
 * spells the image tag. It is also the git context BuildKit checks out — so the
 * bytes compiled are the bytes read and checked, at every front door.
 *
 * `ref` is the trigger's name for where the commit landed — a branch, a tag —
 * and the row keeps it as provenance. A branch resolves to whatever its tip is
 * at the moment the pod fetches, which is a different question from the one the
 * row asks, so it is not the question the build muscle is handed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const launchBuildJob = vi.fn();
const createBuildJob = vi.fn();
const findBuildJobByTarget = vi.fn();
const updateBuildJob = vi.fn();
const readForgeRepoFacts = vi.fn();
const githubReachability = vi.fn();
const orgId = vi.fn();

vi.mock("@hanzo/platform/services/ci/buildkit-job", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@hanzo/platform/services/ci/buildkit-job")
	>()),
	launchBuildJob,
}));
vi.mock("@hanzo/platform/services/ci/build-job", () => ({
	createBuildJob,
	findBuildJobByTarget,
	updateBuildJob,
}));
vi.mock("@hanzo/platform/services/ci/build-secrets", () => ({
	fetchBuildSecrets: vi.fn(async () => ({})),
}));
vi.mock("@hanzo/platform/services/ci/forge-source-probe", () => ({
	readForgeRepoFacts,
	githubReachability,
}));
vi.mock("@hanzo/platform/services/org", async (importOriginal) => ({
	...(await importOriginal<typeof import("@hanzo/platform/services/org")>()),
	orgId,
}));

const { scheduleBuilds, enqueueDirectBuild } = await import(
	"@hanzo/platform/services/ci/build-scheduler"
);

/** The commit on the row: read, checked, tagged, and cloned. */
const SHA = "3f2b1c9d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
/** Where it landed, as a trigger names it. Both point at {@link SHA}. */
const TAG = "refs/tags/v1.2.3";
const BRANCH = "refs/heads/main";

const HANZO_YML = [
	"images:",
	"  - name: kms",
	"    repo: ghcr.io/hanzoai/kms",
	'    tag-pattern: "sha-{{git.sha}}"',
	"",
].join("\n");

/**
 * The forge, as far as this test is concerned: `main` and `v1.2.3` both name
 * {@link SHA}, it serves one `hanzo.yml`, it has Actions on, and it has no ci
 * caller — so this lane is the one that builds.
 *
 * A branch carries its commit as `commit.id` and a tag as `commit.sha`, which
 * is one endpoint per kind and one shape per endpoint.
 */
function forge(): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		if (/\/branches\/main(\?|$)/.test(url)) {
			return new Response(JSON.stringify({ commit: { id: SHA } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (/\/tags\/v1\.2\.3(\?|$)/.test(url)) {
			return new Response(JSON.stringify({ commit: { sha: SHA } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.includes("/contents/hanzo.yml")) {
			return new Response(
				JSON.stringify({
					content: Buffer.from(HANZO_YML).toString("base64"),
					encoding: "base64",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url.includes("/contents/")) return new Response("", { status: 404 });
		return new Response(JSON.stringify({ has_actions: true }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

beforeEach(() => {
	vi.clearAllMocks();
	process.env.HANZO_GIT_URL = "https://git.hanzo.ai";
	process.env.HANZO_GIT_WEBHOOK_SECRET = "forge-s3cr3t";
	vi.stubGlobal("fetch", forge());
	orgId.mockResolvedValue("org_1");
	readForgeRepoFacts.mockResolvedValue(null);
	githubReachability.mockResolvedValue({ kind: "reachable" });
	findBuildJobByTarget.mockResolvedValue(undefined);
	createBuildJob.mockImplementation(async (row: Record<string, unknown>) => ({
		...row,
		buildJobId: "bj_1",
	}));
	updateBuildJob.mockImplementation(
		async (buildJobId: string, patch: Record<string, unknown>) => ({
			buildJobId,
			...patch,
		}),
	);
	launchBuildJob.mockResolvedValue({
		jobName: "build-kms-bj-1",
		namespace: "hanzo-build",
		image: `ghcr.io/hanzoai/kms:sha-${SHA}`,
	});
});

/** The git context the build muscle was handed. */
function cloned(): string {
	return launchBuildJob.mock.calls[0]?.[0]?.commit;
}

describe("a build clones the commit its row names", () => {
	it("the checked commit and the cloned context are one value", async () => {
		const result = await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: TAG,
		});

		// The three that must agree: what GitHub was asked about, what the row
		// records, and what BuildKit checks out.
		expect(githubReachability.mock.calls[0]?.[1]).toBe(SHA);
		expect(createBuildJob.mock.calls[0]?.[0]?.sha).toBe(SHA);
		expect(cloned()).toBe(SHA);
		expect(result).not.toBeNull();
	});

	it("the tag names the commit that was built", async () => {
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: TAG,
		});
		// A row whose image says one commit and whose pod compiled another is a
		// row nothing can be traced by.
		expect(createBuildJob.mock.calls[0]?.[0]?.image).toBe(
			`ghcr.io/hanzoai/kms:sha-${SHA}`,
		);
		expect(cloned()).toBe(SHA);
	});

	it("a branch push clones the commit, not the branch", async () => {
		// A branch head moves, so it is asked about once and the answer is what
		// travels. A pod handed the name would resolve it again at fetch time and
		// could compile a commit nothing here checked.
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: BRANCH,
		});
		expect(cloned()).toBe(SHA);
	});

	it("the row still records the ref that triggered it", async () => {
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: TAG,
		});
		expect(createBuildJob.mock.calls[0]?.[0]?.ref).toBe(TAG);
	});

	it("the direct door clones its commit too", async () => {
		// Nothing here states a commit. The door names a tag, the forge says what
		// it points at, and that answer is the row and the checkout alike.
		await enqueueDirectBuild({
			repo: "hanzo/kms",
			ref: TAG,
			image: "ghcr.io/hanzoai/kms:v1.2.3",
			requireOrganizationId: "org_1",
		});
		expect(createBuildJob.mock.calls[0]?.[0]?.sha).toBe(SHA);
		expect(cloned()).toBe(SHA);
	});

	it("a ref naming neither a branch nor a tag builds nothing", async () => {
		// `refs/pull/7/head` is published and not merged. A build is about a
		// branch or a tag, and a name is the whole of what a caller states — so
		// there is no commit to build in place of one the forge never resolved.
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzo/kms",
				ref: "refs/pull/7/head",
			}),
		).rejects.toThrow(/does not name a branch or a tag/);
		expect(createBuildJob).not.toHaveBeenCalled();
		expect(launchBuildJob).not.toHaveBeenCalled();
	});
});
