/**
 * GitHub webhook decoder + HMAC verifier for platform-native CI/CD.
 *
 * Thin, dependency-free decoder of the slice of GitHub's `push` /
 * `pull_request` webhook payloads we act on. We deliberately do NOT pull
 * in `@octokit/webhooks` — we only need a handful of fields and the
 * signature check, and Node's `crypto` already gives us constant-time HMAC.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookEvent = "push" | "pull_request" | "ping";

export interface DecodedWebhook {
	event: WebhookEvent;
	/** `owner/repo`. */
	repo: string;
	/** Full commit SHA the event points at. */
	sha: string;
	/** Git ref, e.g. `refs/heads/main`. */
	ref: string;
	/** Short branch name, e.g. `main`. */
	branch: string;
	/** Default branch of the repo, when the payload carries it. */
	defaultBranch?: string;
}

export class WebhookError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "WebhookError";
	}
}

/**
 * Verify the `X-Hub-Signature-256` header against the raw request body.
 * Returns true only when the signature is present, well-formed, and matches.
 * Uses constant-time comparison to avoid leaking the secret via timing.
 */
export function verifySignature(
	rawBody: string,
	signatureHeader: string | undefined,
	secret: string,
): boolean {
	if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
		return false;
	}
	const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
	const a = Buffer.from(signatureHeader);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function branchFromRef(ref: string): string {
	return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

/**
 * Decode a verified webhook body into the fields the scheduler needs.
 * Throws `WebhookError(422)` if the event type is unsupported or the body
 * is missing required fields. `ping` is decoded so callers can ACK it.
 */
export function decodeWebhook(
	eventHeader: string | undefined,
	body: unknown,
): DecodedWebhook {
	if (!eventHeader) {
		throw new WebhookError("missing X-GitHub-Event header", 400);
	}
	if (eventHeader === "ping") {
		const repo = repoFullName(body);
		return {
			event: "ping",
			repo,
			sha: "",
			ref: "",
			branch: "",
		};
	}
	if (eventHeader !== "push" && eventHeader !== "pull_request") {
		throw new WebhookError(`unsupported event: ${eventHeader}`, 422);
	}
	if (typeof body !== "object" || body === null) {
		throw new WebhookError("webhook body must be a JSON object", 400);
	}
	const p = body as Record<string, unknown>;
	const repo = repoFullName(body);
	const defaultBranch = repoDefaultBranch(body);

	if (eventHeader === "push") {
		const ref = p.after && typeof p.ref === "string" ? p.ref : undefined;
		const after = typeof p.after === "string" ? p.after : undefined;
		if (!ref || !after) {
			throw new WebhookError("push payload missing `ref` or `after`", 422);
		}
		// A deleted-branch push has an all-zero `after` — nothing to build.
		if (/^0+$/.test(after)) {
			throw new WebhookError("push deletes a ref; nothing to build", 422);
		}
		return {
			event: "push",
			repo,
			sha: after,
			ref,
			branch: branchFromRef(ref),
			defaultBranch,
		};
	}

	// pull_request
	const pr = p.pull_request;
	if (typeof pr !== "object" || pr === null) {
		throw new WebhookError("pull_request payload missing `pull_request`", 422);
	}
	const head = (pr as Record<string, unknown>).head;
	if (typeof head !== "object" || head === null) {
		throw new WebhookError(
			"pull_request payload missing `pull_request.head`",
			422,
		);
	}
	const h = head as Record<string, unknown>;
	const sha = typeof h.sha === "string" ? h.sha : undefined;
	const branch = typeof h.ref === "string" ? h.ref : undefined;
	if (!sha || !branch) {
		throw new WebhookError("pull_request head missing `sha` or `ref`", 422);
	}
	return {
		event: "pull_request",
		repo,
		sha,
		ref: `refs/heads/${branch}`,
		branch,
		defaultBranch,
	};
}

function repoFullName(body: unknown): string {
	if (typeof body !== "object" || body === null) {
		throw new WebhookError("webhook body must include `repository`", 422);
	}
	const repository = (body as Record<string, unknown>).repository;
	if (typeof repository !== "object" || repository === null) {
		throw new WebhookError("webhook body missing `repository`", 422);
	}
	const fullName = (repository as Record<string, unknown>).full_name;
	if (typeof fullName !== "string" || fullName.length === 0) {
		throw new WebhookError("repository missing `full_name`", 422);
	}
	return fullName;
}

function repoDefaultBranch(body: unknown): string | undefined {
	if (typeof body !== "object" || body === null) return undefined;
	const repository = (body as Record<string, unknown>).repository;
	if (typeof repository !== "object" || repository === null) return undefined;
	const db = (repository as Record<string, unknown>).default_branch;
	return typeof db === "string" ? db : undefined;
}
