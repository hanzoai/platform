/**
 * The two I/O adapters behind the forge-source gate.
 *
 * Kept apart from forge-source.ts on purpose: the decision — which side is
 * canonical, and what to refuse — is pure and exhaustively testable, and
 * stays that way only if no network hides inside it.
 */
import { appEnvOctokit } from "@hanzo/platform/utils/providers/github";
import type { HanzoGitConfig } from "../hanzo-git";
import type { ForgeRepoFacts, ReachabilityProbe } from "./forge-source";

/**
 * Is `sha` an ancestor of (or equal to) the default branch's head?
 *
 * `compare/{base}...{head}` with base=sha, head=branch answers this in one
 * call and without a race: `identical` and `ahead` both mean the branch
 * contains the commit. `behind`/`diverged` mean it does not. A 404 means
 * GitHub cannot see the commit at all, which for our purposes is the same
 * answer — it is not on the branch — but is reported distinctly because it is
 * the signature of a forge-only history, and an operator reading the refusal
 * should be told which of the two they are looking at.
 */
export const githubReachability: ReachabilityProbe = async (repo, sha) => {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return { kind: "no-such-repo" };
	const octokit = appEnvOctokit();

	let branch: string;
	try {
		const info = await octokit.request("GET /repos/{owner}/{repo}", {
			owner,
			repo: name,
		});
		branch = info.data.default_branch;
	} catch (err) {
		if ((err as { status?: number }).status === 404) {
			return { kind: "no-such-repo" };
		}
		throw err;
	}

	// Read the branch head first: every refusal must be able to name it, and a
	// 404 on the comparison below would otherwise leave us with nothing to say.
	const head = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
		owner,
		repo: name,
		ref: branch,
	});
	const headSha = head.data.sha;
	if (headSha === sha) return { kind: "reachable" };

	try {
		const cmp = await octokit.request(
			"GET /repos/{owner}/{repo}/compare/{basehead}",
			{ owner, repo: name, basehead: `${sha}...${branch}` },
		);
		const status = cmp.data.status;
		if (status === "identical" || status === "ahead") return { kind: "reachable" };
		return {
			kind: "unreachable",
			head: headSha,
			relation:
				status === "diverged"
					? "the two have diverged — each side has commits the other lacks"
					: `github.com/${repo} is ${status} relative to this commit`,
		};
	} catch (err) {
		const e = err as { status?: number; message?: string };
		if (e.status === 404) {
			return {
				kind: "unreachable",
				head: headSha,
				relation: /no common ancestor/i.test(e.message ?? "")
					? "they share no common ancestor — these are unrelated histories, not a stale branch"
					: "GitHub has never seen this commit — it exists only on the forge",
			};
		}
		throw err;
	}
};

/**
 * What the forge records about one of its own repos.
 *
 * Returns null rather than throwing when the forge cannot be read: a forge
 * outage must not become a build outage, and losing these facts only costs
 * precision — `resolveCanonical` falls back to asking GitHub whether a
 * same-named twin exists, which is the safe direction to be wrong in.
 */
export async function readForgeRepoFacts(
	cfg: Pick<HanzoGitConfig, "url" | "token">,
	repo: string,
): Promise<ForgeRepoFacts | null> {
	const [owner, name] = repo.split("/");
	if (!owner || !name) return null;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (cfg.token) headers.Authorization = `token ${cfg.token}`;
	try {
		// `/v1/...`, not `/api/v1/...` — see the interop note in services/hanzo-git.
		const res = await fetch(
			`${cfg.url}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
			{ headers },
		);
		if (!res.ok) return null;
		const body = (await res.json()) as {
			mirror?: boolean;
			original_url?: string | null;
		};
		// A push mirror is a separate resource; its mere existence is the forge
		// declaring itself upstream, so an empty list and a failed read must not
		// look alike — a failed read leaves `pushMirror` undefined, not false.
		let pushMirror: boolean | undefined;
		const pm = await fetch(
			`${cfg.url}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/push_mirrors`,
			{ headers },
		);
		if (pm.ok) {
			const list = (await pm.json()) as unknown;
			pushMirror = Array.isArray(list) && list.length > 0;
		}
		return {
			mirror: body.mirror === true,
			originalUrl: body.original_url ?? null,
			pushMirror,
		};
	} catch {
		return null;
	}
}
