/**
 * pin — write a built image into the universe declaration, which is what deploys it.
 *
 * THE ONLY WAY A PLATFORM BUILD REACHES PRODUCTION.
 *
 * A build pushes bytes to ghcr and nothing happens. cd.hanzo.ai does not watch
 * the registry — it watches ONE git repo (infra/k8s/hanzo-cd/applicationset-fleet.yaml
 * globs `charts/app/values/*​/*.yaml` on git.hanzo.ai/hanzo/universe@main). Until
 * the image in that values file moves, the new image is published and unreachable.
 *
 * So promotion is a COMMIT, not a cluster write. Platform proposes; CD disposes.
 * This module replaced a merge-patch of the operator CR's `.spec.image`, which
 * wrote the running state directly and left git saying something else — a deploy
 * with no record, no diff, no history, and no way to roll back but another patch.
 *
 * ── ONE PIN, TWO CALLERS ──────────────────────────────────────────────────────
 *
 * `charts/app/pin.sh` in universe does this same edit for a service whose own CI
 * has a checkout. This does it for a service platform builds, from a pod that has
 * no checkout of a repo that large. Two callers, ONE rule about the bytes:
 *
 *   tag and digest are ONE registry answer, written in ONE edit, read back
 *   together, with every other byte of the file untouched.
 *
 * `pin.sh --verify` asserts that invariant over the whole inventory in CI, and it
 * verifies what this writes for the same reason it verifies a hand edit — the
 * invariant lives in the file, not in whoever wrote it. Both stamp the same
 * `Pinned-by:` trailer, so `git log --format=%(trailers:key=Pinned-by)` still
 * answers "who moved this pin" whichever lane moved it.
 *
 * ── WHY BOTH HALVES ───────────────────────────────────────────────────────────
 *
 * `_helpers.tpl:app.image` renders `repository:tag@digest` when both are set, and
 * a reference carrying both RESOLVES BY DIGEST. The tag is how a human reads the
 * release; the digest is what the kubelet pulls. Writing one without the other is
 * the failure that does not fail: v1.801.362 moved the tag and left the digest on
 * .361's bytes, so the pod reported .362, ran .361, and the release was green.
 *
 * A digest is also the only honest name here. `pullPolicy: IfNotPresent` is what
 * the fleet runs, so a node that has ever pulled `:v1.2.3` keeps those bytes
 * forever; re-pushing a tag reaches a node only if it never saw it. Registry tags
 * are mutable, and a mutable name is not an identity.
 */
import { TRPCError } from "@trpc/server";
import { parse as parseYaml } from "yaml";
import { type HanzoGitConfig, hanzoGitConfig } from "../hanzo-git";
import { parseImageRef } from "./image-ref";

/** The forge repo holding the fleet's declared state. */
export const UNIVERSE_REPO = "hanzo/universe";
/** The branch the fleet ApplicationSet's git generator reads. */
export const UNIVERSE_BRANCH = "main";

/** A manifest digest, and nothing that merely looks like one. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;
/**
 * A tag this may write. Excludes whitespace and `#` because the edit below is
 * textual — either would end the scalar and silently truncate or comment out the
 * rest of the line. Anchored, so nothing sneaks in at either end.
 */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface PinInput {
	/** Namespace the app runs in — the values DIRECTORY. */
	namespace: string;
	/** Workload name — the values FILE. */
	name: string;
	/** The reference the build pushed, e.g. `ghcr.io/hanzoai/cloud:sha-e50ec914`. */
	image: string;
	/** Manifest digest of those exact bytes, `sha256:…`. */
	digest: string;
	/** Recorded in the commit trailer, so a pin traces back to its build. */
	buildJobId: string;
}

export interface PinResult {
	/** False when the file already named this image — a re-tick, not a no-op deploy. */
	committed: boolean;
	/** `charts/app/values/<namespace>/<name>.yaml`. */
	path: string;
	tag: string;
	digest: string;
	/** The forge commit sha, when one was made. */
	commit?: string;
	reason: string;
}

/**
 * The values file that declares a workload.
 *
 * THE INVENTORY IS THE DIRECTORY: the ApplicationSet generates one Application
 * per `charts/app/values/<namespace>/<name>.yaml`, with the directory as the
 * destination namespace and the filename as the release name. So the path is
 * derived, never configured — there is no mapping table to keep in step.
 */
export function valuesPath(namespace: string, name: string): string {
	return `charts/app/values/${namespace}/${name}.yaml`;
}

/** First whitespace-delimited token of a line — awk's `$1`, which is what pin.sh keys on. */
function head(line: string): string {
	return line.trim().split(/\s+/, 1)[0] ?? "";
}

/** Does this scalar, as written, READ as exactly this string? */
function readsAs(written: string, value: string): boolean {
	try {
		return parseYaml(written) === value;
	} catch {
		// A scalar YAML cannot parse is certainly not the string.
		return false;
	}
}

/**
 * A value written so YAML reads it back as the STRING it is.
 *
 * Bare is the default and what nearly every values file uses — it is what a
 * human diffs. It is wrong only when the bare form reads as something else:
 * `values.schema.json` declares `image.tag` a string, so `tag: 9` is an integer
 * and the release fails validation and renders nothing.
 *
 * Not hypothetical. Five live declarations carry a tag that is a string only
 * because it is quoted — `registry: '2'`, `kv: '9'`, `sql`/`insights-sql: '18'`,
 * `image-prepull: "1.36"` — and a textual rewrite drops the quotes along with
 * the value. The read-back in {@link commitPin} catches it (an integer is not
 * the tag it asked for), so the bug was a refusal rather than a bad pin; those
 * five services simply could never be promoted. Quoting where it is load-bearing
 * is what makes this writer total over the inventory instead of over most of it.
 */
function scalar(value: string): string {
	if (readsAs(value, value)) return value;
	return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Rewrite one scalar on a line — unless the line already SAYS that value.
 *
 * "Already says it" is decided by reading the scalar, never by comparing text:
 * `"1.36"` and `'1.36'` are one string written two ways, and turning one into
 * the other is a diff that changes nothing. This module's promise is that a pin
 * moves the two values it came to move and not one byte besides, so a line that
 * is already right is left exactly as its author wrote it.
 */
function put(line: string, key: string, value: string): string {
	const re = new RegExp(`${key}:[ \\t]*([^\\s#]*)`);
	const written = line.match(re)?.[1];
	if (written && readsAs(written, value)) return line;
	return line.replace(re, () => `${key}: ${scalar(value)}`);
}

/** True while the line belongs to the TOP-LEVEL `image:` block. */
function scanImageBlock(
	yaml: string,
	visit: (line: string, inImage: boolean, indent: string) => void,
): void {
	let inImage = false;
	for (const line of yaml.split("\n")) {
		if (line.startsWith("image:")) {
			inImage = true;
			visit(line, false, "");
			continue;
		}
		// A line starting in column 0 ends the block. Indented comments stay in it
		// — these files carry the reasoning for every value, and cloud.yaml's image
		// block is 412 lines holding 4 keys.
		if (inImage && /^\S/.test(line)) inImage = false;
		visit(line, inImage, line.match(/^\s*/)?.[0] ?? "");
	}
}

/** Does the image block already carry a `digest:` LINE (empty value included)? */
function declaresDigest(yaml: string): boolean {
	let found = false;
	scanImageBlock(yaml, (line, inImage) => {
		if (inImage && head(line) === "digest:") found = true;
	});
	return found;
}

/**
 * Rewrite `image.tag` and `image.digest` in place, leaving every other byte alone.
 *
 * These files are mostly prose — a YAML round-trip through a parser would reflow
 * the reasoning away — so the two scalars are rewritten where they sit. A file
 * that has never carried a digest gains one at the tag's indentation, directly
 * beneath it: the pair is one fact and reads as one.
 *
 * Pure. Everything that can refuse does so in {@link commitPin}, before this runs.
 */
export function pin(yaml: string, tag: string, digest: string): string {
	const hasDigest = declaresDigest(yaml);
	const out: string[] = [];
	let wroteTag = false;
	let wroteDigest = false;

	scanImageBlock(yaml, (line, inImage, indent) => {
		if (inImage && !wroteTag && head(line) === "tag:") {
			out.push(put(line, "tag", tag));
			wroteTag = true;
			if (!hasDigest) out.push(`${indent}digest: ${scalar(digest)}`);
			return;
		}
		if (inImage && !wroteDigest && head(line) === "digest:") {
			out.push(put(line, "digest", digest));
			wroteDigest = true;
			return;
		}
		out.push(line);
	});

	return out.join("\n");
}

/** The `image:` map as YAML reads it — the semantics, not the text. */
function readImage(
	yaml: string,
	path: string,
): { repository?: unknown; tag?: unknown; digest?: unknown } {
	let doc: unknown;
	try {
		doc = parseYaml(yaml);
	} catch (err) {
		throw refuse(`${path} is not valid YAML: ${(err as Error).message}`);
	}
	if (typeof doc !== "object" || doc === null) {
		throw refuse(`${path} does not parse to a mapping`);
	}
	const image = (doc as Record<string, unknown>).image;
	if (typeof image !== "object" || image === null) {
		throw refuse(
			`${path} declares no image: block — it owns no workload, so there is nothing to pin`,
		);
	}
	return image as Record<string, unknown>;
}

function refuse(message: string): TRPCError {
	return new TRPCError({
		code: "BAD_REQUEST",
		message: `pin refused: ${message}`,
	});
}

/** Forge contents API. Gitea-shaped body, served at `/v1` — never `/api/v1`. */
function contentsUrl(cfg: Pick<HanzoGitConfig, "url">, path: string): string {
	const [owner, name] = UNIVERSE_REPO.split("/");
	return `${cfg.url}/v1/repos/${owner}/${name}/contents/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
}

function authHeaders(
	cfg: Pick<HanzoGitConfig, "token">,
): Record<string, string> {
	// The forge token is KMS-synced into the pod as HANZO_GIT_TOKEN. Promotion
	// WRITES, so an anonymous read that happens to succeed is not enough — refuse
	// here rather than fail at the PUT with a 403 that reads like an outage.
	if (!cfg.token) {
		throw refuse(
			"HANZO_GIT_TOKEN is unset — the pod cannot commit to the forge (KMS hanzo/prod:/git/admin-token → hanzo-git-secrets)",
		);
	}
	return {
		Accept: "application/json",
		Authorization: `token ${cfg.token}`,
	};
}

/**
 * Commit a built image's tag + digest into its universe values file.
 *
 * Every refusal below is a way an automated pipeline could put something
 * unintended into the declared state, so each is a hard failure and none of them
 * promotes anything. The caller treats a throw as "not promoted"; there is no
 * partial success — either the commit landed or the file is untouched.
 */
export async function commitPin(input: PinInput): Promise<PinResult> {
	const { namespace, name, image, digest, buildJobId } = input;

	if (!DIGEST.test(digest)) {
		throw refuse(
			`"${digest}" is not a manifest digest — the build recorded no digest for these bytes, and a pin without one names a mutable tag`,
		);
	}
	const [repository, tag] = parseImageRef(image);
	if (!repository) throw refuse(`"${image}" names no repository`);
	if (!TAG.test(tag)) {
		throw refuse(
			`"${image}" carries no tag this can write ("${tag}") — a tag is written into YAML as a bare scalar`,
		);
	}

	const cfg = hanzoGitConfig();
	const headers = authHeaders(cfg);
	const path = valuesPath(namespace, name);
	const url = contentsUrl(cfg, path);

	const read = await fetch(
		`${url}?ref=${encodeURIComponent(UNIVERSE_BRANCH)}`,
		{
			headers,
		},
	);
	if (read.status === 404) {
		// Adding a service is a deliberate act — the directory IS the inventory, and
		// a new file starts with cd.automated off, which is the staging property the
		// fleet relies on. A release must not be able to enrol one as a side effect.
		throw refuse(
			`${UNIVERSE_REPO} has no ${path} — a service is added deliberately, not by a build. Add the values file first.`,
		);
	}
	if (!read.ok) {
		throw refuse(`reading ${path} returned ${read.status} from the forge`);
	}
	const file = (await read.json()) as { content?: string; sha?: string };
	if (typeof file.content !== "string" || typeof file.sha !== "string") {
		throw refuse(`the forge returned no content or blob sha for ${path}`);
	}
	const before = Buffer.from(file.content, "base64").toString("utf8");

	// THE REPOSITORY COMES FROM THE FILE, NEVER FROM THE CALLER. `namespace` and
	// `name` reach here from the built repo's own hanzo.yml and are therefore
	// untrusted; this is what stops a build repointing a service at an image of its
	// choosing. The worst a compromised build can do is move its OWN service to
	// another of its own published versions.
	const current = readImage(before, path);
	if (current.repository !== repository) {
		throw refuse(
			`${path} declares image.repository "${String(current.repository)}" but this build produced "${repository}" — refusing to repoint a service at a different image`,
		);
	}
	if (typeof current.tag !== "string" || current.tag.length === 0) {
		throw refuse(
			`${path} declares no image.tag — there is no pin to move (a digest-only declaration is pinned by hand)`,
		);
	}

	const after = pin(before, tag, digest);

	// Read back with a PARSER, not with the same text rules that wrote it. The edit
	// is the only place the two scalars can come apart, and a textual read-back
	// would agree with a textual mistake — a quoted tag rewritten bare, say, which
	// reads back identical as text and as a NUMBER to anything that consumes it.
	const wrote = readImage(after, path);
	if (wrote.tag !== tag || wrote.digest !== digest) {
		throw refuse(
			`${path} was edited but reads back as tag "${String(wrote.tag)}" digest "${String(wrote.digest)}" — expected "${tag}" / "${digest}"`,
		);
	}
	if (wrote.repository !== repository) {
		throw refuse(`${path} was edited and its image.repository changed`);
	}

	// Already there. A watcher tick re-runs this for the same row, and a rebuild of
	// an unchanged tree produces the same digest; neither is a deploy, so neither
	// gets a commit. Byte comparison, so a file whose tag is current but whose
	// digest is stale still falls through and is corrected.
	if (after === before) {
		return {
			committed: false,
			path,
			tag,
			digest,
			reason: `${path} already reads ${tag}@${digest}`,
		};
	}

	const write = await fetch(url, {
		method: "PUT",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({
			// The blob sha we read is the optimistic-concurrency token: a concurrent
			// commit to this file makes the forge reject this write rather than
			// silently overwrite a pin somebody else just moved.
			sha: file.sha,
			branch: UNIVERSE_BRANCH,
			content: Buffer.from(after, "utf8").toString("base64"),
			author: { name: "hanzo-ci", email: "ci@hanzo.ai" },
			committer: { name: "hanzo-ci", email: "ci@hanzo.ai" },
			message: commitMessage({
				name,
				repository,
				from: current.tag,
				tag,
				digest,
				buildJobId,
			}),
		}),
	});
	if (!write.ok) {
		const body = await write.text().catch(() => "");
		throw refuse(
			`committing ${path} returned ${write.status} from the forge${body ? `: ${body.slice(0, 300)}` : ""}`,
		);
	}
	const commit = (await write.json()) as { commit?: { sha?: string } };

	return {
		committed: true,
		path,
		tag,
		digest,
		commit: commit.commit?.sha,
		reason: `${path} ${current.tag} -> ${tag}`,
	};
}

/**
 * Same shape pin.sh writes, including the `Pinned-by:` trailer — one question
 * ("who moved this pin") with one answer format, whichever lane moved it.
 */
function commitMessage(m: {
	name: string;
	repository: string;
	from: string;
	tag: string;
	digest: string;
	buildJobId: string;
}): string {
	return `${m.name} ${m.from} -> ${m.tag}

${m.repository}:${m.tag}
${m.digest}

These bytes started and reached readiness in an isolated pod before this pin
moved, so the declaration names an image that runs. Tag and digest are one
answer written in one edit. cd.hanzo.ai reconciles the change from here.

Pinned-by: platform build ${m.buildJobId}`;
}
