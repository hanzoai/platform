/**
 * Route-level proof for POST /v1/git-webhook.
 *
 * The unit tests in git-webhook.test.ts prove the decoder and the two
 * signature schemes. This proves the ROUTE actually wires them: that a forged
 * or absent signature never reaches the scheduler, and that a good one does —
 * with the org already mapped and the config source pointed back at the forge
 * that sent it.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleBuilds = vi.fn();

vi.mock("@hanzo/platform/services/ci", async (importOriginal) => ({
	...(await importOriginal<typeof import("@hanzo/platform/services/ci")>()),
	scheduleBuilds,
}));

const { POST } = await import("@/app/v1/git-webhook/route");

const SECRET = "forge-s3cr3t";
const SHA = "3f2b1c9d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";

const push = {
	ref: "refs/heads/main",
	before: "1".repeat(40),
	after: SHA,
	commits: [{ id: SHA, message: "fix: x" }],
	total_commits: 1,
	repository: {
		name: "kms",
		full_name: "hanzo/kms",
		html_url: "https://git.hanzo.ai/hanzo/kms",
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

beforeEach(() => {
	vi.clearAllMocks();
	process.env.HANZO_GIT_URL = "https://git.hanzo.ai";
	process.env.HANZO_GIT_WEBHOOK_SECRET = SECRET;
	process.env.HANZO_GIT_ORGANIZATION_ID = "org_1";
	scheduleBuilds.mockResolvedValue({
		organizationId: "org_1",
		config: { builds: [] },
		jobs: [{ buildJobId: "bj_1" }],
	});
});

describe("POST /v1/git-webhook — Hanzo Git", () => {
	it("accepts a validly signed push and schedules the build", async () => {
		const res = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toMatchObject({
			buildJobIds: ["bj_1"],
		});
		expect(scheduleBuilds).toHaveBeenCalledTimes(1);
		expect(scheduleBuilds.mock.calls[0]?.[0]).toEqual({
			// canonical org downstream, forge-native org back at the forge
			repo: "hanzoai/kms",
			sha: SHA,
			ref: "refs/heads/main",
			branch: "main",
			source: {
				forge: "hanzo-git",
				sourceRepo: "hanzo/kms",
			},
		});
	});

	it("REJECTS an invalid signature with 401 and never schedules", async () => {
		const res = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": createHmac("sha256", "wrong")
				.update(body)
				.digest("hex"),
		});
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toMatchObject({
			message: "Invalid signature",
		});
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("REJECTS a missing signature with 401 and never schedules", async () => {
		const res = await post({ "x-hanzo-event": "push" });
		expect(res.status).toBe(401);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("REJECTS a body tampered after signing", async () => {
		const tampered = JSON.stringify({ ...push, after: "9".repeat(40) });
		const res = await post(
			{ "x-hanzo-event": "push", "x-hanzo-signature": goodSig },
			tampered,
		);
		expect(res.status).toBe(401);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("REJECTS a replayed signature under a GitHub-shaped header", async () => {
		// Hanzo Git sends X-Hub-Signature-256 too; its scheme must not accept it
		// in place of its own header.
		const res = await post({
			"x-hanzo-event": "push",
			"x-hub-signature-256": `sha256=${goodSig}`,
		});
		expect(res.status).toBe(401);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("answers ping with pong without scheduling", async () => {
		const res = await post({
			"x-hanzo-event": "ping",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ message: "pong" });
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("ignores an unsupported event gracefully — 422, not 500", async () => {
		const res = await post({
			"x-hanzo-event": "release",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(422);
		await expect(res.json()).resolves.toMatchObject({
			message: expect.stringContaining("unsupported event"),
		});
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("404s a delivery that did not come from our forge", async () => {
		process.env.HANZO_GIT_URL = "https://git.example.com";
		const res = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(404);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("503s — and does not leak the secret — when the forge secret is unset", async () => {
		process.env.HANZO_GIT_WEBHOOK_SECRET = "";
		const res = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(503);
		const text = JSON.stringify(await res.json());
		expect(text).not.toContain(SECRET);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("400s a delivery from no recognizable forge", async () => {
		const res = await post({});
		expect(res.status).toBe(400);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("202s a repo with nothing to build instead of failing the push", async () => {
		// `scheduleBuilds` returns null for BOTH "no hanzo.yml" and "hanzo.yml
		// declares no image", so the message names the observable outcome rather
		// than guessing which of the two it was.
		scheduleBuilds.mockResolvedValue(null);
		const res = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(res.status).toBe(202);
		await expect(res.json()).resolves.toMatchObject({
			message: expect.stringContaining("declares no image to build"),
			scheduled: 0,
		});
	});

	// The three outcomes below share ONE status code, so `scheduled` is what
	// tells them apart. Accepting a push and building nothing is defensible;
	// being indistinguishable from accepting a push and building something is
	// not, and that is the trap this whole route is otherwise careful about.
	it("distinguishes built-nothing from building by more than prose", async () => {
		// The state that had no test and reads as success: the repo DOES declare
		// images, but every matrix entry was skipped (arm64 paused, `{{git.tag}}`
		// empty on a branch push). It takes the scheduled branch with an empty
		// array, so a caller keying on `buildJobIds` being present calls this
		// "building". Only `scheduled: 0` says otherwise.
		scheduleBuilds.mockResolvedValue({ jobs: [] });
		const none = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(none.status).toBe(202);
		const noneBody = (await none.json()) as {
			scheduled: number;
			buildJobIds: string[];
		};
		expect(noneBody.buildJobIds).toEqual([]);
		expect(noneBody.scheduled).toBe(0);

		scheduleBuilds.mockResolvedValue({ jobs: [{ buildJobId: "bj-1" }] });
		const built = await post({
			"x-hanzo-event": "push",
			"x-hanzo-signature": goodSig,
		});
		expect(built.status).toBe(202);
		await expect(built.json()).resolves.toMatchObject({
			scheduled: 1,
			buildJobIds: ["bj-1"],
		});

		// Same code, same key present, opposite meaning — which is the point.
		expect(none.status).toBe(built.status);
	});
});

describe("POST /v1/github-webhook — the GitHub path is unchanged", () => {
	const gh = JSON.stringify({
		ref: "refs/heads/main",
		after: SHA,
		commits: [{ id: SHA }],
		repository: {
			full_name: "hanzoai/kms",
			default_branch: "main",
			html_url: "https://github.com/hanzoai/kms",
		},
		pusher: { name: "z", email: "z@hanzo.ai" },
		sender: { login: "z" },
		installation: { id: 62000701 },
	});

	it("is the exact same handler, not a copy", async () => {
		const alias = await import("@/app/v1/github-webhook/route");
		expect(alias.POST).toBe(POST);
	});

	it("still refuses a GitHub delivery with no installation id", async () => {
		const res = await POST(
			new Request("https://platform.hanzo.ai/v1/github-webhook", {
				method: "POST",
				headers: { "x-github-event": "push" },
				body: JSON.stringify({ ref: "refs/heads/main", after: SHA }),
			}),
		);
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toMatchObject({
			message: "Missing installation id",
		});
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});

	it("still 404s an unknown installation before verifying anything", async () => {
		const res = await POST(
			new Request("https://platform.hanzo.ai/v1/github-webhook", {
				method: "POST",
				headers: { "x-github-event": "push" },
				body: gh,
			}),
		);
		// The global db mock resolves findFirst -> undefined: unknown installation.
		expect(res.status).toBe(404);
		expect(scheduleBuilds).not.toHaveBeenCalled();
	});
});
