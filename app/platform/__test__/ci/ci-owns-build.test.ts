/**
 * `ciOwnsBuild` decides whether the forge push-webhook yields a build to
 * hanzoai/ci. Getting it wrong in either direction is expensive: yield when ci
 * cannot run and the repo stops shipping entirely; refuse to yield and an
 * ungated build races the gate and wins.
 *
 * The `has_actions` case is not hypothetical. hanzoai/postgres and
 * hanzoai/stream both carry `.hanzo/workflows/cicd.yml` and both have Actions
 * administratively disabled — zero runs, ever — so the file-only rule would
 * have stopped two repos that were being pushed to that day.
 *
 * The question is asked about REPOSITORIES, plural, because it is really about
 * an image: an organization spells itself several ways on the forge and once on
 * the registry, so `hanzo/platform` and `hanzoai/platform` publish one
 * `ghcr.io/hanzoai/platform`. What the scheduler hands in is the pushed path
 * plus the path each declared image names.
 */
import { ciOwnsBuild } from "@hanzo/platform/services/ci";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CFG = { url: "https://git.hanzo.ai", token: "t0ken" };

/**
 * Serve the two GETs `ciOwnsBuild` makes per repository: the repo, then the
 * caller file. Keyed by repo path, so a test can give two repositories two
 * different answers — which is the whole point of asking about more than one.
 */
function serve(
	answers: Record<string, { actions?: boolean; caller?: boolean } | Error>,
) {
	// Both parameters, because the code under test calls `fetch(url, init)` and
	// this file asserts on the init. Declared with one, `f.mock.calls[0]` typed as
	// `[url: string] | undefined` and the cast to `[string, RequestInit]` was a
	// TS2352 — a 1-tuple does not overlap a 2-tuple — which failed `tsc --noEmit`
	// and took the whole cicd lane with it. A mock should carry the signature it
	// stands in for.
	const f = vi.fn(async (url: string, _init?: RequestInit) => {
		const path = /\/v1\/repos\/([^/]+\/[^/]+)/.exec(url)?.[1] ?? "";
		const answer = answers[path];
		if (answer instanceof Error) throw answer;
		if (!answer) return new Response("", { status: 404 });
		if (url.includes("/contents/")) {
			return new Response("{}", { status: answer.caller ? 200 : 404 });
		}
		return new Response(JSON.stringify({ has_actions: answer.actions }), {
			status: 200,
		});
	});
	vi.stubGlobal("fetch", f);
	return f;
}

beforeEach(() => vi.unstubAllGlobals());

describe("ciOwnsBuild — one repository", () => {
	it("OWNS: Actions enabled and the caller exists", async () => {
		serve({ "hanzo/cloud": { actions: true, caller: true } });
		await expect(ciOwnsBuild(CFG, ["hanzo/cloud"])).resolves.toBe(true);
	});

	it("does NOT own: no caller file (the 12 repos that keep building here)", async () => {
		serve({ "hanzo/billing": { actions: true, caller: false } });
		await expect(ciOwnsBuild(CFG, ["hanzo/billing"])).resolves.toBe(false);
	});

	it("does NOT own: caller exists but Actions is DISABLED", async () => {
		// hanzoai/postgres, hanzoai/stream. The file is a claim; Actions is
		// whether the forge will ever honour it.
		serve({ "hanzo/postgres": { actions: false, caller: true } });
		await expect(ciOwnsBuild(CFG, ["hanzo/postgres"])).resolves.toBe(false);
	});

	it("asks the forge at each repo's default branch, with the token", async () => {
		const f = serve({ "hanzo/cloud": { actions: true, caller: true } });
		await ciOwnsBuild(CFG, ["hanzo/cloud"]);
		const [repoUrl, repoInit] = f.mock.calls[0] as [string, RequestInit];
		const [fileUrl] = f.mock.calls[1] as [string];
		expect(repoUrl).toBe("https://git.hanzo.ai/v1/repos/hanzo/cloud");
		expect((repoInit.headers as Record<string, string>).Authorization).toBe(
			"token t0ken",
		);
		expect(fileUrl).toContain("/contents/.hanzo/workflows/cicd.yml");
		// No `?ref=`. What runs a repo's pipeline is a fact about the repo now.
		// Read at the pushed commit, a push that merely DELETES the caller file on
		// a side branch would hand itself the ungated lane; and a repository named
		// only by an image does not have that commit at all, so there is no ref
		// that could be asked of every path in one question.
		expect(fileUrl).not.toContain("ref=");
	});

	it("FAILS OPEN when the forge errors — a blip must not stop the fleet", async () => {
		serve({ "hanzo/cloud": new Error("ECONNRESET") });
		await expect(ciOwnsBuild(CFG, ["hanzo/cloud"])).resolves.toBe(false);
	});

	it("FAILS OPEN when the repo lookup 404s", async () => {
		serve({});
		await expect(ciOwnsBuild(CFG, ["hanzo/gone"])).resolves.toBe(false);
	});

	it("FAILS OPEN on a malformed repo coordinate", async () => {
		const f = serve({ "hanzo/cloud": { actions: true, caller: true } });
		await expect(ciOwnsBuild(CFG, ["nameless"])).resolves.toBe(false);
		expect(f).not.toHaveBeenCalled();
	});
});

describe("ciOwnsBuild — the image's own path, not just the pushed one", () => {
	it("OWNS when a twin path carries the caller and the pushed path does not", async () => {
		// The gap this closes: `hanzo/platform` and `hanzoai/platform` publish one
		// `ghcr.io/hanzoai/platform`. Asked only about the path a caller typed,
		// naming the twin without a cicd.yml yielded an ungated build of the
		// gated image.
		serve({
			"hanzo/platform": { actions: true, caller: false },
			"hanzoai/platform": { actions: true, caller: true },
		});
		await expect(
			ciOwnsBuild(CFG, ["hanzo/platform", "hanzoai/platform"]),
		).resolves.toBe(true);
	});

	it("does NOT own when no path carries the caller", async () => {
		serve({
			"hanzo/billing": { actions: true, caller: false },
			"hanzoai/billing": { actions: true, caller: false },
		});
		await expect(
			ciOwnsBuild(CFG, ["hanzo/billing", "hanzoai/billing"]),
		).resolves.toBe(false);
	});

	it("asks each distinct path once", async () => {
		const f = serve({ "hanzo/cloud": { actions: true, caller: false } });
		await ciOwnsBuild(CFG, ["hanzo/cloud", "hanzo/cloud", "hanzo/cloud"]);
		// Two calls, not six: the repo and the caller file, for the one path.
		expect(f.mock.calls).toHaveLength(2);
	});
});
