/**
 * Does the commit we are about to build exist on the source of truth?
 *
 * The build path reads git.hanzo.ai. Humans merge on github.com. Nothing in
 * Gitea's mirroring closes that loop by itself: a repo whose mirror row is
 * gone — Gitea's "convert to regular repo" drops it, and the drop is
 * irreversible — keeps serving whatever it last held, forever. A build off a
 * frozen forge repo is byte-for-byte indistinguishable from a build off a
 * current one: same webhook, same green job, same image. `hanzo-docs/docs`
 * sat that way through four merged fixes, serving a seeded import that shared
 * no history with the repo people were actually reviewing.
 *
 * So the build path asks one question, once per build, and it is about the
 * commit rather than about the branch head: is THIS sha reachable from the
 * canonical branch? Not "are the two heads equal" — that races a push that
 * landed a second ago and would flap. Reachability has no such race: a commit
 * that someone merged is on the branch and stays on the branch, and a commit
 * that only ever existed on the forge is not, and never becomes so by waiting.
 *
 * A repo that fails this is REFUSED, not repaired. Divergence is a question
 * for a person — which side is right is not something a build job can know,
 * and the forge holds hand-written content in some of these repos. Refusing
 * is the loud, lossless half; the merge is the human's.
 */

/** Where a repo's truth lives. */
export type Canonical =
	/** github.com/{repo} is authoritative; the forge follows it. */
	| { side: "github"; repo: string }
	/**
	 * The forge is authoritative and GitHub is downstream — a curated split,
	 * an OSS core, a subset publish. `hanzoai/cloud` is the standing example:
	 * its GitHub origin is a 143-file Apache-2.0 core with unrelated history,
	 * so comparing the two is meaningless and "fixing" it would clobber the
	 * split. Declared, never inferred.
	 */
	| { side: "forge" };

/**
 * Declared in `hanzo.yml` as `source:`. Absent means "infer", which is how
 * every repo behaved before this existed and how most still behave — the
 * declaration is only needed where inference would get it wrong.
 *
 *   source: forge                          # forge-primary, no comparison
 *   source: hanzo-docs/docs                # this GitHub repo is the truth
 *   source: github.com/hanzo-docs/docs     # same, spelled out
 */
export function parseSourceDeclaration(raw: unknown): Canonical | null {
	if (typeof raw !== "string") return null;
	const s = raw.trim();
	if (!s) return null;
	if (s === "forge" || s === "hanzo-git") return { side: "forge" };
	const repo = s
		.replace(/^https?:\/\//, "")
		.replace(/^github\.com\//, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
	if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
	return { side: "github", repo };
}

/** `original_url` as the forge records it, reduced to `owner/name`. */
export function githubRepoFromOriginalUrl(url: unknown): string | null {
	if (typeof url !== "string") return null;
	const m = /^https?:\/\/(?:[^@/]*@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
		url.trim(),
	);
	return m ? `${m[1]}/${m[2]}` : null;
}

/** What the forge knows about one of its own repos. */
export interface ForgeRepoFacts {
	/** A pull mirror is running; the forge is downstream of `originalUrl`. */
	mirror: boolean;
	/** The upstream the repo was created from, mirror or not. */
	originalUrl?: string | null;
	/**
	 * A push mirror is configured; the forge is UPSTREAM of GitHub. This is
	 * the forge saying, in its own records, that it is the source of truth —
	 * so it needs no declaration to be treated as one. 57 repos are in this
	 * state today, `hanzoai/cloud` among them.
	 */
	pushMirror?: boolean;
}

/**
 * Resolve which side is canonical.
 *
 * Order matters and is the whole point: an explicit declaration in the repo
 * beats whatever mirror rows happen to exist in the forge database, because
 * the database is the thing that drifted. Inference is the fallback, not the
 * rule — and when inference finds nothing, we do NOT conclude "forge-native".
 * That conclusion is exactly the bug: an unlinked repo and a genuinely
 * forge-only repo are the same row in Gitea, and only GitHub can tell them
 * apart. `null` here means "ask GitHub whether a twin exists".
 */
export function resolveCanonical(
	forgeRepo: string,
	declared: unknown,
	facts: ForgeRepoFacts | null,
): Canonical | null | AmbiguousDirection {
	const explicit = parseSourceDeclaration(declared);
	if (explicit) return explicit;

	// Which mirror exists IS the direction — the forge already states it, and a
	// repo should not have to repeat in YAML what its own forge config says.
	const pull = facts?.mirror === true;
	const push = facts?.pushMirror === true;
	if (pull && push) return AMBIGUOUS;
	if (push) return { side: "forge" };

	const upstream = githubRepoFromOriginalUrl(facts?.originalUrl);
	if (upstream) return { side: "github", repo: upstream };
	return null;
}

/**
 * The forge pulls from a remote AND pushes to the same remote. There is no
 * canonical side; whichever job ran last won. Eight repos are configured this
 * way today. It cannot be inferred out of — someone has to say which way the
 * code is supposed to flow.
 */
export const AMBIGUOUS = Symbol("ambiguous-direction");
export type AmbiguousDirection = typeof AMBIGUOUS;

/** Whether `sha` is reachable from the default branch of a GitHub repo. */
export type ReachabilityProbe = (
	repo: string,
	sha: string,
) => Promise<
	| { kind: "reachable" }
	/** The repo exists; the sha is not on its default branch. */
	| { kind: "unreachable"; head: string; relation: string }
	/** No such repo on GitHub — nothing to compare against. */
	| { kind: "no-such-repo" }
>;

export class ForgeSourceRefusal extends Error {
	constructor(
		readonly repo: string,
		readonly sha: string,
		message: string,
	) {
		super(message);
		this.name = "ForgeSourceRefusal";
	}
}

/**
 * Refuse a build whose commit is not on the canonical GitHub branch.
 *
 * Returns the reason it was allowed, so a caller can log WHY a build passed —
 * "no gate ran" and "the gate ran and said yes" must not look the same in a
 * log. That symmetry is the same one this whole module exists to break.
 */
export async function assertBuildableFromCanonicalSource(args: {
	/** `owner/name` as the FORGE names it. */
	forgeRepo: string;
	sha: string;
	/** `source:` from hanzo.yml, if the repo declared one. */
	declared: unknown;
	/** What the forge says about itself; null when it could not be read. */
	facts: ForgeRepoFacts | null;
	probe: ReachabilityProbe;
}): Promise<string> {
	const { forgeRepo, sha, declared, facts, probe } = args;

	const canonical = resolveCanonical(forgeRepo, declared, facts);

	if (canonical === AMBIGUOUS) {
		throw new ForgeSourceRefusal(
			forgeRepo,
			sha,
			`Refusing to build ${forgeRepo}@${sha}: the forge both pulls this repo from GitHub and pushes it ` +
				"back, so neither side is canonical and whichever mirror ran last wins. Declare `source:` in " +
				"hanzo.yml — `forge` if the forge is authoritative, or `owner/name` if GitHub is — and remove " +
				"the mirror pointing the other way.",
		);
	}

	if (canonical?.side === "forge") {
		return `${forgeRepo} is forge-primary — forge is authoritative, nothing to compare`;
	}

	// No declaration and no upstream recorded. Either genuinely forge-native,
	// or unlinked — indistinguishable here, distinguishable on GitHub.
	const target = canonical?.repo ?? forgeRepo;
	const result = await probe(target, sha);

	if (result.kind === "no-such-repo") {
		if (canonical) {
			throw new ForgeSourceRefusal(
				forgeRepo,
				sha,
				`Refusing to build ${forgeRepo}@${sha}: its declared source github.com/${target} does not exist. ` +
					"Fix `source:` in hanzo.yml, or set `source: forge` if this repo is forge-primary.",
			);
		}
		return `${forgeRepo} has no GitHub counterpart — forge-native, forge is the only source`;
	}

	if (result.kind === "reachable") {
		return `${forgeRepo}@${sha} is on github.com/${target}'s default branch`;
	}

	throw new ForgeSourceRefusal(
		forgeRepo,
		sha,
		`Refusing to build ${forgeRepo}@${sha}: that commit is not on github.com/${target} ` +
			`(its head is ${result.head}; ${result.relation}). The forge and GitHub have drifted, so this build ` +
			"would ship code no one merged. Reconcile the two — do not force-push either side — " +
			"or declare `source: forge` in hanzo.yml if the forge is meant to be authoritative here.",
	);
}
