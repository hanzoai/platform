/**
 * ONE LANE: a forge push must not produce an ungated build.
 *
 * A push to git.hanzo.ai fans out twice — the forge-wide system webhook lands
 * here, and the repo's `.hanzo/workflows/cicd.yml` starts hanzoai/ci. Only the
 * second one runs `test:`, and BOTH push the image. Measured on
 * hanzoai/cloud@7c50638e: ci run 36368's `Test (per hanzo.yml)` failed, ci
 * skipped its `image` job, and this lane built
 * `ghcr.io/hanzoai/cloud:sha-7c50638eb180` with push=true regardless.
 *
 * So these prove the yield, and — just as important — that the probe can tell
 * the two apart: the no-caller case MUST still schedule, or a green test here
 * would mean nothing.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleBuilds = vi.fn();
const ciOwnsBuild = vi.fn();

vi.mock("@hanzo/platform/services/ci", async (importOriginal) => ({
	...(await importOriginal<typeof import("@hanzo/platform/services/ci")>()),
	scheduleBuilds,
	ciOwnsBuild,
}));

const { POST } = await import("@/app/v1/git-webhook/route");

const SECRET = "forge-s3cr3t";
const SHA = "7c50638eb180f3d6b0cb95102032d95f91f1cc7f";

const push = {
	ref: "refs/heads/main",
	before: "1".repeat(40),
	after: SHA,
	commits: [{ id: SHA, message: "one line again" }],
	total_commits: 1,
	repository: {
		name: "cloud",
		full_name: "hanzo/cloud",
		html_url: "https://git.hanzo.ai/hanzo/cloud",
		default_branch: "main",
		owner: { login: "hanzo", username: "hanzo" },
	},
	pusher: { id: 3, login: "z", username: "z", email: "z@hanzo.ai" },
	sender: { id: 3, login: "z", username: "z" },
};

const body = JSON.stringify(push);
const goodSig = createHmac("sha256", SECRET).update(body).digest("hex");

function post(h: Record<string, string>, raw = body): Promise<Response> {
	return POST(
		new Request("https://platform.hanzo.ai/v1/git-webhook", {
			method: "POST",
			headers: { "content-type": "application/json", ...h },
			body: raw,
		}),
	);
}

const signed = { "x-hanzo-event": "push", "x-hanzo-signature": goodSig };

beforeEach(() => {
	vi.clearAllMocks();
	process.env.HANZO_GIT_URL = "https://git.hanzo.ai";
	process.env.HANZO_GIT_WEBHOOK_SECRET = SECRET;
	scheduleBuilds.mockResolvedValue({
		organizationId: "org_1",
		config: { builds: [] },
		jobs: [{ buildJobId: "bj_1" }],
	});
});

describe("POST /v1/git-webhook — hanzoai/ci owns the build", () => {
	it("YIELDS when the repo has a ci caller: no build is scheduled", async () => {
		ciOwnsBuild.mockResolvedValue(true);
		const res = await post(signed);

		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toMatchObject({ scheduled: 0 });
		// The one thing that matters: no row, no Job, no image for a commit ci
		// has not finished gating.
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("says WHY, naming ci and the file — the body is the only record", async () => {
		// The forge persists this body and renders it in delivery history. It is
		// the entire artifact of the push, so "declares no image to build" — the
		// other reason for scheduled: 0 — would send a reader to the wrong place.
		ciOwnsBuild.mockResolvedValue(true);
		const { message } = (await (await post(signed)).json()) as {
			message: string;
		};
		expect(message).toContain("hanzoai/ci");
		expect(message).toContain(".hanzo/workflows/cicd.yml");
		expect(message).not.toContain("declares no image");
	});

	it("POSITIVE CONTROL: with no ci caller this lane still builds", async () => {
		// Without this, every assertion above passes for a route that schedules
		// nothing ever. The 17 repos with a hanzo.yml and no caller live here.
		ciOwnsBuild.mockResolvedValue(false);
		const res = await post(signed);

		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toMatchObject({
			buildJobIds: ["bj_1"],
		});
		expect(scheduleBuilds).toHaveBeenCalledTimes(1);
	});

	it("asks about the FORGE-native repo at the PUSHED sha", async () => {
		// `hanzo/cloud` on the forge is `hanzoai/cloud` downstream, and the
		// caller must be read at the commit that was pushed — not at a branch
		// name, which moves, and not at the canonical name, which 404s here.
		ciOwnsBuild.mockResolvedValue(true);
		await post(signed);

		expect(ciOwnsBuild).toHaveBeenCalledTimes(1);
		expect(ciOwnsBuild.mock.calls[0]?.[1]).toBe("hanzo/cloud");
		expect(ciOwnsBuild.mock.calls[0]?.[2]).toBe(SHA);
	});

	it("checks the signature FIRST — an unsigned push never asks the forge", async () => {
		ciOwnsBuild.mockResolvedValue(false);
		const res = await post({ "x-hanzo-event": "push" });

		expect(res.status).toBe(401);
		expect(ciOwnsBuild).not.toHaveBeenCalled();
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});
});
