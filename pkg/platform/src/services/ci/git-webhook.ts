/**
 * Git-forge webhook decoder + HMAC verifier for platform-native CI/CD.
 *
 * ONE decoder for every forge platform accepts deliveries from. What differs
 * between forges is *transport* — which header carries the event name, which
 * header carries the signature, how that signature is encoded. What does NOT
 * differ is *meaning*: a commit landed on a ref of a repo. This module owns
 * that split, so everything downstream (BuildScheduler, BuildKit Job,
 * DeployExecutor) is forge-agnostic and never learns who delivered the event.
 *
 * Thin and dependency-free: we deliberately do NOT pull in
 * `@octokit/webhooks` — we only need a handful of fields and the signature
 * check, and Node's `crypto` already gives us constant-time HMAC.
 *
 * Forges:
 *   - `github`    — X-GitHub-Event + X-Hub-Signature-256: `sha256=<hex>`
 *   - `hanzo-git` — X-Hanzo-Event  + X-Hanzo-Signature:    `<hex>`
 *
 * Interop note: Hanzo Git today emits the Gitea-compatible header names
 * (`X-Gitea-Event` / `X-Gitea-Signature`) rather than `X-Hanzo-*`. Those are
 * accepted as a wire-compatibility fallback. That is a fact about the bytes
 * on the socket, not a name for the product.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookEvent = "push" | "pull_request" | "ping";

/** Which forge delivered an event. A forge is a transport, not a brand. */
export type GitForge = "github" | "hanzo-git";

export interface DecodedWebhook {
	event: WebhookEvent;
	/** Which forge delivered this. */
	forge: GitForge;
	/** Canonical `owner/repo` — the org mapped through {@link canonicalOrg}. */
	repo: string;
	/** Canonical org: first segment of {@link repo}. Keys the arcd runner pool. */
	org: string;
	/**
	 * `owner/repo` exactly as the delivering forge names it. Differs from
	 * {@link repo} when the forge org is spelled differently (git.hanzo.ai's
	 * `hanzo` vs GitHub's `hanzoai`). Used ONLY to address the source forge
	 * back — never to key a buildJob row.
	 */
	sourceRepo: string;
	/** Full commit SHA the event points at. */
	sha: string;
	/** Git ref, e.g. `refs/heads/main`. */
	ref: string;
	/** Short branch name, e.g. `main`. */
	branch: string;
	/** Default branch of the repo, when the payload carries it. */
	defaultBranch?: string;
	/** Who pushed, as a login/username. Absent when the payload omits it. */
	pusher?: string;
	/** Commit SHAs carried by the push, in payload order. Empty for PR/ping. */
	commits: string[];
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
 * Forge org name -> canonical org name.
 *
 * The ONE place this mapping exists. git.hanzo.ai names the Hanzo org `hanzo`;
 * everything downstream — arcd runner-pool labels (`hanzoai-linux-amd64`),
 * buildJob rows, `ghcr.io/hanzoai/*` image refs — is keyed by the canonical
 * `hanzoai`. `luxfi` and `zooai` are spelled identically on both sides and so
 * are absent: an unmapped org passes through verbatim. NEVER add per-repo
 * entries here; if a repo needs special-casing, the mapping is wrong.
 */
const FORGE_ORG_ALIASES: Readonly<Record<string, string>> = {
	hanzo: "hanzoai",
};

/** Map a forge-native org name to its canonical name. */
export function canonicalOrg(org: string): string {
	return FORGE_ORG_ALIASES[org] ?? org;
}

/** Owner segment of an `owner/repo`; the whole string when there is no slash. */
function orgOf(fullName: string): string {
	const slash = fullName.indexOf("/");
	return slash > 0 ? fullName.slice(0, slash) : fullName;
}

/** Map a forge-native `owner/repo` to its canonical `owner/repo`. */
export function canonicalRepo(sourceRepo: string): string {
	const slash = sourceRepo.indexOf("/");
	if (slash <= 0) return sourceRepo;
	return `${canonicalOrg(sourceRepo.slice(0, slash))}${sourceRepo.slice(slash)}`;
}

/**
 * Hanzo Git's event header, preferred name first.
 *
 * `X-Hanzo-Event` is the name to grow into; today the forge emits the
 * compatibility name, so that is the one actually matched on the wire
 * (hanzoai/git `services/webhook/deliver.go`, `addDefaultHeaders`). Listing
 * both here means the eventual forge-side rename needs no platform change.
 */
const HANZO_GIT_EVENT_HEADERS = ["x-hanzo-event", "x-gitea-event"] as const;
const HANZO_GIT_SIGNATURE_HEADERS = [
	"x-hanzo-signature",
	"x-gitea-signature",
] as const;

/** First of `names` present on `headers`. */
function firstHeader(
	headers: Headers,
	names: readonly string[],
): string | undefined {
	for (const n of names) {
		const v = headers.get(n);
		if (v) return v;
	}
	return undefined;
}

/**
 * Identify the forge from the delivery headers.
 *
 * Order is load-bearing: Hanzo Git stamps `X-GitHub-Event` on EVERY delivery
 * as well (`addDefaultHeaders` adds X-Hub-*, X-Gogs-* and X-GitHub-* aliases
 * so GitHub-shaped receivers work unchanged). Checking GitHub first would
 * therefore misclassify every Hanzo Git delivery as GitHub and reject it for
 * a missing `installation.id`. The forge-native header always wins.
 */
export function detectForge(headers: Headers): GitForge | null {
	if (firstHeader(headers, HANZO_GIT_EVENT_HEADERS)) return "hanzo-git";
	if (headers.get("x-github-event")) return "github";
	return null;
}

/** The event name for a forge, read from that forge's own header. */
export function eventHeaderOf(
	forge: GitForge,
	headers: Headers,
): string | undefined {
	return forge === "hanzo-git"
		? firstHeader(headers, HANZO_GIT_EVENT_HEADERS)
		: (headers.get("x-github-event") ?? undefined);
}

/**
 * Verify GitHub's `X-Hub-Signature-256` against the raw request body.
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

/** Lowercase hex SHA-256 digest, exactly 64 chars — Hanzo Git's shape. */
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Verify a Hanzo Git signature against the raw request body.
 *
 * Differs from GitHub in encoding only: the forge emits the bare lowercase
 * hex digest with NO `sha256=` prefix (hanzoai/git `services/webhook/
 * deliver.go`). The shape check runs first so both operands are a fixed 64
 * bytes and `timingSafeEqual` cannot throw on a length mismatch.
 */
export function verifyHanzoGitSignature(
	rawBody: string,
	signatureHeader: string | undefined,
	secret: string,
): boolean {
	if (!signatureHeader) return false;
	const got = signatureHeader.trim().toLowerCase();
	if (!HEX_SHA256.test(got)) return false;
	const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
	return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * Verify a delivery's signature using the scheme its forge speaks. The ONE
 * entry point routes take — they never pick a header or a scheme themselves.
 */
export function verifyDelivery(
	forge: GitForge,
	rawBody: string,
	headers: Headers,
	secret: string,
): boolean {
	if (forge === "hanzo-git") {
		return verifyHanzoGitSignature(
			rawBody,
			firstHeader(headers, HANZO_GIT_SIGNATURE_HEADERS),
			secret,
		);
	}
	return verifySignature(
		rawBody,
		headers.get("x-hub-signature-256") ?? undefined,
		secret,
	);
}

function branchFromRef(ref: string): string {
	return ref.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

/** Header a forge names its event with — used only for error text. */
function eventHeaderName(forge: GitForge): string {
	return forge === "hanzo-git"
		? "X-Hanzo-Event (or X-Gitea-Event)"
		: "X-GitHub-Event";
}

/**
 * Decode a verified webhook body into the fields the scheduler needs.
 *
 * The SINGLE normalization point: every forge lands here and leaves as one
 * `DecodedWebhook`, org already mapped to canonical. Hanzo Git's push/PR
 * payloads carry the same JSON keys as GitHub's (`ref`, `after`,
 * `repository.full_name`,
 * `repository.default_branch`, `pull_request.head.{sha,ref}`, `commits[].id`)
 * so the field reads are genuinely shared, not coincidentally parallel — the
 * only real divergence is `pusher`, handled in {@link pusherLogin}.
 *
 * Throws `WebhookError(422)` if the event type is unsupported or the body is
 * missing required fields. `ping` is decoded so callers can ACK it.
 */
export function decodeWebhook(
	eventHeader: string | undefined,
	body: unknown,
	forge: GitForge = "github",
): DecodedWebhook {
	if (!eventHeader) {
		throw new WebhookError(`missing ${eventHeaderName(forge)} header`, 400);
	}
	if (eventHeader === "ping") {
		const sourceRepo = repoFullName(body);
		return {
			event: "ping",
			...identityOf(sourceRepo, forge, body, {}),
			sha: "",
			ref: "",
			branch: "",
			commits: [],
		};
	}
	if (eventHeader !== "push" && eventHeader !== "pull_request") {
		throw new WebhookError(`unsupported event: ${eventHeader}`, 422);
	}
	if (typeof body !== "object" || body === null) {
		throw new WebhookError("webhook body must be a JSON object", 400);
	}
	const p = body as Record<string, unknown>;
	const identity = identityOf(repoFullName(body), forge, body, p);

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
			...identity,
			sha: after,
			ref,
			branch: branchFromRef(ref),
			commits: commitShas(p.commits),
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
		...identity,
		sha,
		ref: `refs/heads/${branch}`,
		branch,
		commits: [],
	};
}

/** Provenance fields shared by every event shape — derived once. */
function identityOf(
	sourceRepo: string,
	forge: GitForge,
	body: unknown,
	p: Record<string, unknown>,
): Pick<
	DecodedWebhook,
	"forge" | "repo" | "org" | "sourceRepo" | "defaultBranch" | "pusher"
> {
	return {
		forge,
		repo: canonicalRepo(sourceRepo),
		org: canonicalOrg(orgOf(sourceRepo)),
		sourceRepo,
		defaultBranch: repoDefaultBranch(body),
		pusher: pusherLogin(p),
	};
}

/**
 * Who pushed, as one login string.
 *
 * The one place the two payload shapes genuinely disagree. GitHub's push
 * `pusher` is `{name, email}` (a git identity); Hanzo Git's is a full API User
 * `{id, login, login_name, full_name, email, username, ...}`. Neither forge
 * sets `pusher` on a `pull_request`, so both fall back to `sender.login`.
 */
function pusherLogin(p: Record<string, unknown>): string | undefined {
	return (
		firstString(p.pusher, "login", "username", "name") ??
		firstString(p.sender, "login", "username")
	);
}

/** First non-empty string among `keys` on `v`, when `v` is an object. */
function firstString(v: unknown, ...keys: string[]): string | undefined {
	if (typeof v !== "object" || v === null) return undefined;
	const o = v as Record<string, unknown>;
	for (const k of keys) {
		const got = o[k];
		if (typeof got === "string" && got) return got;
	}
	return undefined;
}

/** Commit SHAs from a push payload's `commits[]` (`id` on both forges). */
function commitShas(commits: unknown): string[] {
	if (!Array.isArray(commits)) return [];
	return commits.flatMap((c) => {
		const id = firstString(c, "id");
		return id ? [id] : [];
	});
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

/**
 * Origin of the forge that sent a delivery, derived from the payload's own
 * `repository.html_url` (`https://git.hanzo.ai/hanzo/kms` ->
 * `https://git.hanzo.ai`). This is Hanzo Git's answer to GitHub's
 * `installation.id`: the delivery naming which configured provider it came
 * from, so the receiver can look up that provider's organization.
 */
export function forgeOrigin(body: unknown): string | undefined {
	const url = firstString(
		(body as Record<string, unknown> | null)?.repository,
		"html_url",
	);
	if (!url) return undefined;
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}
