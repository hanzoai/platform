/**
 * ONE LANE: where hanzoai/ci owns a repo's pipeline, nothing else builds it.
 *
 * A push to the forge starts two things — this scheduler, and the repo's
 * `.hanzo/workflows/cicd.yml`, which runs hanzoai/ci and its `test:` gate. Both
 * push the same image, so where the caller exists ci owns the build and this
 * scheduler yields.
 *
 * The rule lives in `scheduleBuilds`, which is the ONE thing every front door
 * calls, so these prove it from BOTH doors — the signed forge delivery and the
 * console's trigger — with one rule and no second implementation. And the
 * positive control matters as much: the probe has to tell the two apart, or a
 * green test here would only mean "schedules nothing, ever".
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
	findBuildJobById: vi.fn(),
	listBuildJobs: vi.fn(),
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

const { scheduleBuilds } = await import(
	"@hanzo/platform/services/ci/build-scheduler"
);
const { buildJobRouter } = await import("@/server/api/routers/build-job");

const SHA = "3f2b1c9d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
const REPO = "hanzo/cloud";
const ORG = "org_1";

const HANZO_YML = [
	"images:",
	"  - name: cloud",
	"    repo: ghcr.io/hanzoai/cloud",
	'    tag-pattern: "sha-{{git.sha}}"',
	"",
].join("\n");

/** Whether the forge serves the repo a ci caller. Set per test. */
let hasCaller = false;

function forge(): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		const json = (body: unknown) =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		if (url.includes("/contents/hanzo.yml")) {
			return json({
				content: Buffer.from(HANZO_YML).toString("base64"),
				encoding: "base64",
			});
		}
		if (url.includes("/contents/.hanzo/workflows/cicd.yml")) {
			return hasCaller
				? json({ name: "cicd.yml" })
				: new Response("", { status: 404 });
		}
		if (url.includes("/contents/")) return new Response("", { status: 404 });
		return json({ has_actions: true });
	}) as typeof fetch;
}

/** The console's door: an authenticated member of the org that owns the repo. */
function console_() {
	return buildJobRouter.createCaller({
		session: { activeOrganizationId: ORG },
		user: { id: "u1", role: "owner" },
	} as never);
}

const delivery = {
	source: { forge: "hanzo-git" as const },
	repo: REPO,
	sha: SHA,
	ref: "refs/heads/main",
	branch: "main",
};

beforeEach(() => {
	vi.clearAllMocks();
	hasCaller = false;
	process.env.HANZO_GIT_URL = "https://git.hanzo.ai";
	process.env.HANZO_GIT_WEBHOOK_SECRET = "forge-s3cr3t";
	vi.stubGlobal("fetch", forge());
	orgId.mockResolvedValue(ORG);
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
		jobName: "build-cloud-bj-1",
		namespace: "hanzo-build",
		image: `ghcr.io/hanzoai/cloud:sha-${SHA}`,
	});
});

describe("hanzoai/ci owns the build", () => {
	it("the forge delivery yields: no row, no Job", async () => {
		hasCaller = true;
		const result = await scheduleBuilds(delivery);

		expect(result).toMatchObject({ declined: "ci-owns" });
		expect(createBuildJob).not.toHaveBeenCalled();
		expect(launchBuildJob).not.toHaveBeenCalled();
	});

	it("the console's trigger yields too — the rule is not a webhook's", async () => {
		hasCaller = true;
		const res = await console_().trigger(delivery);

		expect(res.scheduled).toBe(0);
		expect(createBuildJob).not.toHaveBeenCalled();
		expect(launchBuildJob).not.toHaveBeenCalled();
	});

	it("says WHY in one sentence, the same at both doors", async () => {
		hasCaller = true;
		const scheduled = await scheduleBuilds(delivery);
		const triggered = await console_().trigger(delivery);

		expect(scheduled).toMatchObject({
			why: expect.stringContaining("hanzoai/ci"),
		});
		expect(triggered.message).toContain(".hanzo/workflows/cicd.yml");
		expect(triggered.message).not.toContain("no hanzo.yml");
	});

	it("a repo with no image says so, and says it differently", async () => {
		// The other reason for scheduling nothing. Naming the missing file when the
		// file is right there sends a reader looking in the wrong place.
		vi.stubGlobal(
			"fetch",
			(async () => new Response("", { status: 404 })) as typeof fetch,
		);
		const result = await scheduleBuilds(delivery);

		expect(result).toMatchObject({ declined: "no-image" });
		expect((result as { why: string }).why).not.toContain("hanzoai/ci");
	});
});

describe("POSITIVE CONTROL: with no ci caller, both doors still build", () => {
	it("the forge delivery builds", async () => {
		const result = await scheduleBuilds(delivery);

		expect(result).not.toHaveProperty("declined");
		expect(launchBuildJob).toHaveBeenCalledTimes(1);
	});

	it("the console's trigger builds", async () => {
		const res = await console_().trigger(delivery);

		expect(res.scheduled).toBe(1);
		expect(launchBuildJob).toHaveBeenCalledTimes(1);
	});
});
