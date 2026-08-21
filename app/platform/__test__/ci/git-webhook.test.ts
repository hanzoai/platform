import { createHmac } from "node:crypto";
import {
	decodeWebhook,
	detectForge,
	eventHeaderOf,
	forgeOrigin,
	verifyDelivery,
	verifyHanzoGitSignature,
	verifySignature,
	WebhookError,
} from "@hanzo/platform/services/ci/git-webhook";
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
		expect(d.ref).toBe("refs/heads/main");
		expect(d.sha).toBe("a".repeat(40));
		expect(d.defaultBranch).toBe("main");
	});

	it("decodes a tag push as the whole tag ref", () => {
		// A branch and a tag can carry the same name, and only the whole ref tells
		// them apart. What decides whether an image may carry a version reads this
		// value, so it leaves here as the forge wrote it.
		const d = decodeWebhook("push", {
			ref: "refs/tags/v1.2.3",
			after: "a".repeat(40),
			repository: { full_name: "hanzoai/zip", default_branch: "main" },
		});
		expect(d.ref).toBe("refs/tags/v1.2.3");
		expect(d.sha).toBe("a".repeat(40));
	});

	it("decodes a pull_request event from head", () => {
		const d = decodeWebhook("pull_request", {
			pull_request: { head: { sha: "deadbeef", ref: "feature-x" } },
			repository: { full_name: "hanzoai/base" },
		});
		expect(d.event).toBe("pull_request");
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

	it("rejects a push that names neither a branch nor a tag", () => {
		// Those are the two things git moves and the two things a build can be
		// about. The ref decoded here is the one the scheduler goes on to ask the
		// forge about, so a name nothing resolves stops at the door.
		expect(() =>
			decodeWebhook("push", {
				ref: "refs/pull/7/head",
				after: "a".repeat(40),
				repository: { full_name: "hanzoai/zip" },
			}),
		).toThrow(/does not name a branch or a tag/);
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

// ---------------------------------------------------------------------------
// Hanzo Git (git.hanzo.ai)
// ---------------------------------------------------------------------------

/** Hanzo Git signs the bare lowercase hex digest — no `sha256=` prefix. */
function hanzoGitSign(body: string, secret = SECRET): string {
	return createHmac("sha256", secret).update(body).digest("hex");
}

function headers(h: Record<string, string>): Headers {
	return new Headers(h);
}

const SHA = "3f2b1c9d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
const PARENT = "1111111111111111111111111111111111111111";

/**
 * A real Hanzo Git `push` payload, shaped from the forge's own structs
 * (hanzoai/git `modules/structs/hook.go` PushPayload / PayloadCommit,
 * `modules/structs/repo.go` Repository). Note what differs from GitHub:
 * `compare_url` not `compare`, a `total_commits` count, and `pusher` as a
 * full API User rather than GitHub's `{name,email}` git identity. No
 * `installation` object exists.
 */
const hanzoGitPush = {
	ref: "refs/heads/main",
	before: PARENT,
	after: SHA,
	compare_url: `https://git.hanzo.ai/hanzo/kms/compare/${PARENT}...${SHA}`,
	commits: [
		{
			id: SHA,
			message: "fix(kms): rotate slot\n",
			url: `https://git.hanzo.ai/hanzo/kms/commit/${SHA}`,
			author: { name: "Z", email: "z@hanzo.ai", username: "z" },
			committer: { name: "Z", email: "z@hanzo.ai", username: "z" },
			verification: null,
			timestamp: "2026-07-25T00:00:00Z",
			added: [],
			removed: [],
			modified: ["cmd/kms/main.go"],
		},
	],
	total_commits: 1,
	head_commit: { id: SHA },
	repository: {
		id: 42,
		owner: { id: 3, login: "hanzo", full_name: "Hanzo", username: "hanzo" },
		name: "kms",
		full_name: "hanzo/kms",
		html_url: "https://git.hanzo.ai/hanzo/kms",
		clone_url: "https://git.hanzo.ai/hanzo/kms.git",
		default_branch: "main",
		private: false,
		mirror: false,
	},
	pusher: {
		id: 3,
		login: "z",
		login_name: "",
		full_name: "Z",
		email: "z@hanzo.ai",
		username: "z",
	},
	sender: { id: 3, login: "z", username: "z" },
};

/** The same commit as GitHub would deliver it, for the equivalence test. */
const githubPush = {
	ref: "refs/heads/main",
	before: PARENT,
	after: SHA,
	compare: `https://github.com/hanzoai/kms/compare/${PARENT}...${SHA}`,
	commits: [
		{
			id: SHA,
			message: "fix(kms): rotate slot\n",
			author: { name: "Z", email: "z@hanzo.ai", username: "z" },
			modified: ["cmd/kms/main.go"],
		},
	],
	head_commit: { id: SHA },
	repository: {
		id: 1,
		owner: { login: "hanzoai" },
		name: "kms",
		full_name: "hanzoai/kms",
		html_url: "https://github.com/hanzoai/kms",
		default_branch: "main",
	},
	pusher: { name: "z", email: "z@hanzo.ai" },
	sender: { login: "z" },
	installation: { id: 62000701 },
};

describe("detectForge", () => {
	// Load-bearing: Hanzo Git's addDefaultHeaders (hanzoai/git
	// services/webhook/deliver.go) stamps X-GitHub-Event on EVERY delivery for
	// GitHub-receiver compat, so checking GitHub first would misclassify every
	// forge push.
	it("prefers the forge's own event header even when X-GitHub-Event is also present", () => {
		expect(
			detectForge(
				headers({ "x-gitea-event": "push", "x-github-event": "push" }),
			),
		).toBe("hanzo-git");
	});
	it("accepts the forward-looking X-Hanzo-Event name", () => {
		expect(detectForge(headers({ "x-hanzo-event": "push" }))).toBe("hanzo-git");
	});
	it("detects GitHub", () => {
		expect(detectForge(headers({ "x-github-event": "push" }))).toBe("github");
	});
	it("returns null for an unrecognized delivery", () => {
		expect(detectForge(headers({ "content-type": "application/json" }))).toBe(
			null,
		);
	});
});

describe("eventHeaderOf", () => {
	it("reads the forge's own header, not GitHub's alias", () => {
		const h = headers({ "x-gitea-event": "push", "x-github-event": "issues" });
		expect(eventHeaderOf("hanzo-git", h)).toBe("push");
		expect(eventHeaderOf("github", h)).toBe("issues");
	});
	it("prefers the X-Hanzo-Event name when both are present", () => {
		expect(
			eventHeaderOf(
				"hanzo-git",
				headers({ "x-hanzo-event": "push", "x-gitea-event": "ping" }),
			),
		).toBe("push");
	});
	it("is undefined when the forge's header is absent", () => {
		expect(eventHeaderOf("hanzo-git", headers({}))).toBeUndefined();
	});
});

describe("verifyHanzoGitSignature", () => {
	const body = JSON.stringify(hanzoGitPush);

	it("accepts a correct signature", () => {
		expect(verifyHanzoGitSignature(body, hanzoGitSign(body), SECRET)).toBe(
			true,
		);
	});
	it("rejects an invalid signature", () => {
		expect(verifyHanzoGitSignature(body, "0".repeat(64), SECRET)).toBe(false);
	});
	it("rejects a missing signature", () => {
		expect(verifyHanzoGitSignature(body, undefined, SECRET)).toBe(false);
	});
	it("rejects an empty signature", () => {
		expect(verifyHanzoGitSignature(body, "", SECRET)).toBe(false);
	});
	it("rejects a tampered body", () => {
		expect(
			verifyHanzoGitSignature(`${body} `, hanzoGitSign(body), SECRET),
		).toBe(false);
	});
	it("rejects a wrong secret", () => {
		expect(
			verifyHanzoGitSignature(body, hanzoGitSign(body, "other"), SECRET),
		).toBe(false);
	});
	it("rejects a truncated digest", () => {
		expect(
			verifyHanzoGitSignature(body, hanzoGitSign(body).slice(0, 63), SECRET),
		).toBe(false);
	});
	it("rejects a GitHub-style `sha256=` prefixed digest", () => {
		expect(
			verifyHanzoGitSignature(body, `sha256=${hanzoGitSign(body)}`, SECRET),
		).toBe(false);
	});
	it("rejects a non-hex digest of the right length", () => {
		expect(verifyHanzoGitSignature(body, "z".repeat(64), SECRET)).toBe(false);
	});
	it("accepts an upper-case digest (hex is case-insensitive)", () => {
		expect(
			verifyHanzoGitSignature(body, hanzoGitSign(body).toUpperCase(), SECRET),
		).toBe(true);
	});
});

describe("verifyDelivery", () => {
	const body = JSON.stringify(hanzoGitPush);

	it("verifies a Hanzo Git delivery off the wire-compatibility signature header", () => {
		expect(
			verifyDelivery(
				"hanzo-git",
				body,
				headers({ "x-gitea-signature": hanzoGitSign(body) }),
				SECRET,
			),
		).toBe(true);
	});
	it("verifies a Hanzo Git delivery off the X-Hanzo-Signature name", () => {
		expect(
			verifyDelivery(
				"hanzo-git",
				body,
				headers({ "x-hanzo-signature": hanzoGitSign(body) }),
				SECRET,
			),
		).toBe(true);
	});
	it("rejects a Hanzo Git delivery with a bad signature", () => {
		expect(
			verifyDelivery(
				"hanzo-git",
				body,
				headers({ "x-gitea-signature": hanzoGitSign(body, "other") }),
				SECRET,
			),
		).toBe(false);
	});
	it("rejects a Hanzo Git delivery with no signature header at all", () => {
		expect(verifyDelivery("hanzo-git", body, headers({}), SECRET)).toBe(false);
	});
	it("will not let the forge's X-Hub-Signature-256 alias stand in", () => {
		// Hanzo Git also sends X-Hub-Signature-256; its scheme must read its own
		// header, so an alias-only delivery does not authenticate.
		expect(
			verifyDelivery(
				"hanzo-git",
				body,
				headers({ "x-hub-signature-256": `sha256=${hanzoGitSign(body)}` }),
				SECRET,
			),
		).toBe(false);
	});
	it("verifies a GitHub delivery off X-Hub-Signature-256", () => {
		const gh = JSON.stringify(githubPush);
		expect(
			verifyDelivery(
				"github",
				gh,
				headers({ "x-hub-signature-256": sign(gh) }),
				SECRET,
			),
		).toBe(true);
	});
	it("rejects a GitHub delivery with a bad signature", () => {
		const gh = JSON.stringify(githubPush);
		expect(
			verifyDelivery(
				"github",
				gh,
				headers({ "x-hub-signature-256": `sha256=${"0".repeat(64)}` }),
				SECRET,
			),
		).toBe(false);
	});
});

describe("forgeOrigin", () => {
	it("derives the forge origin from repository.html_url", () => {
		expect(forgeOrigin(hanzoGitPush)).toBe("https://git.hanzo.ai");
	});
	it("is undefined when the payload carries no repository url", () => {
		expect(forgeOrigin({ repository: {} })).toBeUndefined();
		expect(forgeOrigin(null)).toBeUndefined();
	});
});

describe("decodeWebhook — Hanzo Git", () => {
	it("normalizes a real Hanzo Git push to the same shape as the equivalent GitHub push", () => {
		const fromForge = decodeWebhook("push", hanzoGitPush, "hanzo-git");
		const fromGithub = decodeWebhook("push", githubPush, "github");

		// The commit is identical; `forge` and `repo` say where it lives.
		const meaning = ({ forge, repo, ...rest }: typeof fromForge) => rest;
		expect(meaning(fromForge)).toEqual(meaning(fromGithub));

		expect(fromForge.forge).toBe("hanzo-git");
		expect(fromGithub.forge).toBe("github");
	});

	it("names the repository the forge delivered, and only that one", () => {
		const d = decodeWebhook("push", hanzoGitPush, "hanzo-git");
		expect(d.event).toBe("push");
		// `hanzo/kms` and `hanzoai/kms` are two repositories on the forge. A
		// delivery is about one of them, and this is the one it named.
		expect(d.repo).toBe("hanzo/kms");
		expect(decodeWebhook("push", githubPush, "github").repo).toBe(
			"hanzoai/kms",
		);
		expect(d.ref).toBe("refs/heads/main");
		expect(d.sha).toBe(SHA);
		expect(d.defaultBranch).toBe("main");
		expect(d.pusher).toBe("z");
		expect(d.commits).toEqual([SHA]);
	});

	it("reads Hanzo Git's User-shaped pusher and GitHub's identity-shaped pusher alike", () => {
		expect(decodeWebhook("push", hanzoGitPush, "hanzo-git").pusher).toBe("z");
		expect(decodeWebhook("push", githubPush, "github").pusher).toBe("z");
	});

	it("decodes a Hanzo Git pull_request from head, falling back to sender", () => {
		const d = decodeWebhook(
			"pull_request",
			{
				action: "opened",
				number: 7,
				pull_request: { head: { label: "feat-x", ref: "feat-x", sha: SHA } },
				repository: {
					full_name: "hanzo/kms",
					default_branch: "main",
					html_url: "https://git.hanzo.ai/hanzo/kms",
				},
				sender: { login: "z", username: "z" },
			},
			"hanzo-git",
		);
		expect(d.event).toBe("pull_request");
		expect(d.repo).toBe("hanzo/kms");
		expect(d.ref).toBe("refs/heads/feat-x");
		expect(d.sha).toBe(SHA);
		expect(d.pusher).toBe("z"); // no `pusher` on a PR — sender stands in
		expect(d.commits).toEqual([]);
	});

	it("decodes a Hanzo Git ping", () => {
		const d = decodeWebhook("ping", hanzoGitPush, "hanzo-git");
		expect(d.event).toBe("ping");
		expect(d.repo).toBe("hanzo/kms");
		expect(d.forge).toBe("hanzo-git");
	});

	it("ignores an unsupported Hanzo Git event gracefully — 422, never a throw-through", () => {
		// `create`, `release`, `issues`... platform has nothing to do with them.
		for (const event of ["create", "release", "issues", "repository"]) {
			try {
				decodeWebhook(event, hanzoGitPush, "hanzo-git");
				throw new Error(`expected ${event} to be refused`);
			} catch (err) {
				expect(err).toBeInstanceOf(WebhookError);
				expect((err as WebhookError).status).toBe(422);
				expect((err as WebhookError).message).toMatch(/unsupported event/);
			}
		}
	});

	it("skips a Hanzo Git branch-delete push (zero after)", () => {
		try {
			decodeWebhook(
				"push",
				{ ...hanzoGitPush, after: "0".repeat(40) },
				"hanzo-git",
			);
			throw new Error("expected branch-delete to be refused");
		} catch (err) {
			expect(err).toBeInstanceOf(WebhookError);
			expect((err as WebhookError).status).toBe(422);
		}
	});

	it("names the forge header when the event header is missing", () => {
		expect(() => decodeWebhook(undefined, hanzoGitPush, "hanzo-git")).toThrow(
			/missing X-Hanzo-Event/,
		);
	});
});

/**
 * Both events name a ref, so both answer the ref rule here.
 *
 * A push carries `ref` whole and is checked on the way through. A pull request
 * carries the short branch and the ref is ASSEMBLED — and an assembled ref is
 * still a name somebody chose. Left unasked, it reached the scheduler, which
 * refuses it as a bad request, which this route has no shape for: the delivery
 * became a 500 and the forge redelivered it five times over a name that will
 * never be buildable. One rule, one place, one answer for both events.
 */
describe("the ref a delivery names", () => {
	const repository = { full_name: "hanzoai/kms" };

	function refuses(event: "push" | "pull_request", branch: string) {
		const body =
			event === "push"
				? { ref: `refs/heads/${branch}`, after: "a".repeat(40), repository }
				: {
						pull_request: { head: { sha: "a".repeat(40), ref: branch } },
						repository,
					};
		try {
			decodeWebhook(event, body);
			return null;
		} catch (err) {
			expect(err).toBeInstanceOf(WebhookError);
			return err as WebhookError;
		}
	}

	it("is refused at the door, with the same status, for either event", () => {
		for (const branch of [
			"../../../luxfi/node/branches/main",
			"a b",
			"a@{1}",
			"x.lock",
		]) {
			for (const event of ["push", "pull_request"] as const) {
				const err = refuses(event, branch);
				expect(err, `${event} ${branch}`).not.toBeNull();
				expect(err?.status, `${event} ${branch}`).toBe(422);
				expect(err?.message).toMatch(/does not name a branch or a tag/i);
			}
		}
	});

	it("still takes the names git makes, on either event", () => {
		for (const branch of [
			"main",
			"feature/a-b_c.d",
			"@",
			`${"a".repeat(200)}/${"b".repeat(200)}`,
		]) {
			expect(refuses("push", branch), `push ${branch}`).toBeNull();
			expect(refuses("pull_request", branch), `pr ${branch}`).toBeNull();
		}
	});
});
