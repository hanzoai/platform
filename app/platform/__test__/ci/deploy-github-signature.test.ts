/**
 * A signature is over BYTES, and the bytes are the ones that arrived.
 *
 * GitHub signs the exact body it sends. Parsing that body and re-serializing it
 * produces a different string for the same document — key order, spacing, how a
 * number or a non-ASCII character is spelled — so the HMAC is computed over
 * something GitHub never signed. The sibling `/v1/git-webhook` reads the raw
 * text and says so in its own header; this route is reached by the same App's
 * manifest and had to agree.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "app-webhook-s3cr3t";

// The shared setup already mocks the db; this only says what the `github`
// lookup answers with.
const { db } = await import("@hanzo/platform/db");
const findFirst = vi.mocked(db.query.github.findFirst);

const { POST } = await import("@/app/v1/deploy/github/route");

/** A delivery as GitHub actually sends it: pretty-printed, in GitHub's order. */
const RAW = JSON.stringify(
	{
		zen: "Non-blocking is better than blocking.",
		hook_id: 1,
		installation: { id: 62000701 },
		repository: { full_name: "hanzoai/kms" },
	},
	null,
	2,
);

function sign(raw: string) {
	return `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
}

function post(raw: string, signature: string, event = "ping") {
	return POST(
		new Request("https://platform.hanzo.ai/v1/deploy/github", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-event": event,
				"x-hub-signature-256": signature,
			},
			body: raw,
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	findFirst.mockResolvedValue({
		githubId: "gh_1",
		githubInstallationId: "62000701",
		githubWebhookSecret: SECRET,
	} as never);
});

describe("POST /v1/deploy/github verifies what arrived", () => {
	it("accepts a delivery signed over the body GitHub sent", async () => {
		const res = await post(RAW, sign(RAW));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({
			message: expect.stringMatching(/ping/i),
		});
	});

	it("refuses a body altered after it was signed", async () => {
		const good = sign(RAW);
		const tampered = RAW.replace("hanzoai/kms", "luxfi/node");
		const res = await post(tampered, good);
		expect(res.status).toBe(401);
	});

	it("refuses a signature over a re-spelling of the same document", async () => {
		// Same JSON value, different bytes. A verifier that re-serializes would
		// call these equal; one that reads what arrived does not.
		const respelled = JSON.stringify(JSON.parse(RAW));
		const res = await post(RAW, sign(respelled));
		expect(res.status).toBe(401);
	});
});
