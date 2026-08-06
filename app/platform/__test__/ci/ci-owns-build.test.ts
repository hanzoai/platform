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
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ciOwnsBuild } from "@hanzo/platform/services/ci";

const CFG = { url: "https://git.hanzo.ai", token: "t0ken" };
const SHA = "7c50638eb180f3d6b0cb95102032d95f91f1cc7f";

/** Serve the two GETs `ciOwnsBuild` makes: the repo, then the caller file. */
function serve(repo: Response | Error, caller?: Response | Error) {
	const f = vi.fn(async (url: string) => {
		const which = url.includes("/contents/") ? caller : repo;
		if (which instanceof Error) throw which;
		if (!which) throw new Error(`unexpected fetch: ${url}`);
		return which;
	});
	vi.stubGlobal("fetch", f);
	return f;
}
const repoJson = (has_actions: boolean) =>
	new Response(JSON.stringify({ has_actions }), { status: 200 });
const ok = () => new Response("{}", { status: 200 });
const notFound = () => new Response("", { status: 404 });

beforeEach(() => vi.unstubAllGlobals());

describe("ciOwnsBuild", () => {
	it("OWNS: Actions enabled and the caller exists", async () => {
		serve(repoJson(true), ok());
		await expect(ciOwnsBuild(CFG, "hanzo/cloud", SHA)).resolves.toBe(true);
	});

	it("does NOT own: no caller file (the 12 repos that keep building here)", async () => {
		serve(repoJson(true), notFound());
		await expect(ciOwnsBuild(CFG, "hanzo/billing", SHA)).resolves.toBe(false);
	});

	it("does NOT own: caller exists but Actions is DISABLED", async () => {
		// hanzoai/postgres, hanzoai/stream. The file is a claim; Actions is
		// whether the forge will ever honour it.
		serve(repoJson(false), ok());
		await expect(ciOwnsBuild(CFG, "hanzo/postgres", SHA)).resolves.toBe(false);
	});

	it("asks the forge at the PUSHED sha, with the token", async () => {
		const f = serve(repoJson(true), ok());
		await ciOwnsBuild(CFG, "hanzo/cloud", SHA);
		const [repoUrl, repoInit] = f.mock.calls[0] as [string, RequestInit];
		const [fileUrl] = f.mock.calls[1] as [string];
		expect(repoUrl).toBe("https://git.hanzo.ai/v1/repos/hanzo/cloud");
		expect((repoInit.headers as Record<string, string>).Authorization).toBe(
			"token t0ken",
		);
		expect(fileUrl).toContain("/contents/.hanzo/workflows/cicd.yml");
		expect(fileUrl).toContain(`ref=${SHA}`);
	});

	it("FAILS OPEN when the forge errors — a blip must not stop the fleet", async () => {
		serve(new Error("ECONNRESET"));
		await expect(ciOwnsBuild(CFG, "hanzo/cloud", SHA)).resolves.toBe(false);
	});

	it("FAILS OPEN when the repo lookup 404s", async () => {
		serve(notFound());
		await expect(ciOwnsBuild(CFG, "hanzo/gone", SHA)).resolves.toBe(false);
	});

	it("FAILS OPEN on a malformed repo coordinate", async () => {
		const f = serve(repoJson(true), ok());
		await expect(ciOwnsBuild(CFG, "nameless", SHA)).resolves.toBe(false);
		expect(f).not.toHaveBeenCalled();
	});
});
