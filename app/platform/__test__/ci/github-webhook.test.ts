import { createHmac } from "node:crypto";
import {
	decodeWebhook,
	verifySignature,
	WebhookError,
} from "@hanzo/platform/services/ci/github-webhook";
import { describe, expect, it } from "vitest";

const SECRET = "s3cr3t";

function sign(body: string): string {
	return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("verifySignature", () => {
	it("accepts a correct signature", () => {
		const body = JSON.stringify({ a: 1 });
		expect(verifySignature(body, sign(body), SECRET)).toBe(true);
	});
	it("rejects a tampered body", () => {
		const body = JSON.stringify({ a: 1 });
		expect(verifySignature(body + "x", sign(body), SECRET)).toBe(false);
	});
	it("rejects a missing header", () => {
		expect(verifySignature("x", undefined, SECRET)).toBe(false);
	});
	it("rejects a non-sha256 header", () => {
		expect(verifySignature("x", "sha1=deadbeef", SECRET)).toBe(false);
	});
	it("rejects a wrong secret", () => {
		const body = JSON.stringify({ a: 1 });
		expect(verifySignature(body, sign(body), "other")).toBe(false);
	});
});

describe("decodeWebhook", () => {
	it("decodes a push event", () => {
		const d = decodeWebhook("push", {
			ref: "refs/heads/main",
			after: "a".repeat(40),
			repository: { full_name: "hanzoai/zip", default_branch: "main" },
		});
		expect(d.event).toBe("push");
		expect(d.repo).toBe("hanzoai/zip");
		expect(d.branch).toBe("main");
		expect(d.sha).toBe("a".repeat(40));
		expect(d.defaultBranch).toBe("main");
	});

	it("decodes a pull_request event from head", () => {
		const d = decodeWebhook("pull_request", {
			pull_request: { head: { sha: "deadbeef", ref: "feature-x" } },
			repository: { full_name: "hanzoai/base" },
		});
		expect(d.event).toBe("pull_request");
		expect(d.branch).toBe("feature-x");
		expect(d.ref).toBe("refs/heads/feature-x");
		expect(d.sha).toBe("deadbeef");
	});

	it("decodes ping", () => {
		const d = decodeWebhook("ping", {
			repository: { full_name: "hanzoai/zip" },
		});
		expect(d.event).toBe("ping");
		expect(d.repo).toBe("hanzoai/zip");
	});

	it("rejects a branch-delete push (zero after)", () => {
		expect(() =>
			decodeWebhook("push", {
				ref: "refs/heads/dead",
				after: "0".repeat(40),
				repository: { full_name: "hanzoai/zip" },
			}),
		).toThrow(WebhookError);
	});

	it("rejects an unsupported event", () => {
		expect(() =>
			decodeWebhook("issues", { repository: { full_name: "x/y" } }),
		).toThrow(/unsupported event/);
	});

	it("rejects a missing repository", () => {
		expect(() => decodeWebhook("push", { ref: "x", after: "y" })).toThrow(
			WebhookError,
		);
	});

	it("rejects a missing event header", () => {
		expect(() => decodeWebhook(undefined, {})).toThrow(
			/missing X-GitHub-Event/,
		);
	});
});
