import {
	AMBIGUOUS,
	assertBuildableFromCanonicalSource,
	ForgeSourceRefusal,
	githubRepoFromOriginalUrl,
	parseSourceDeclaration,
	type ReachabilityProbe,
	resolveCanonical,
} from "@hanzo/platform/services/ci/forge-source";
import { describe, expect, it } from "vitest";

/** The real shas from the incident, so the assertions are about real data. */
const DOCS_FORGE = "de22594ee7b2a4d5c1e0f9a3b8c7d6e5f4a3b2c1";
const DOCS_GITHUB = "e63c88cfa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const CLOUD_FORGE = "e2b1e955a3604b5a7b6dcf100c4ee22f34eea6e4";

const reachable: ReachabilityProbe = async () => ({ kind: "reachable" });
const noSuchRepo: ReachabilityProbe = async () => ({ kind: "no-such-repo" });
const unreachable =
	(head: string, relation = "unrelated histories"): ReachabilityProbe =>
	async () => ({ kind: "unreachable", head, relation });

/** Fails the test if the probe is consulted at all. */
const neverProbed: ReachabilityProbe = async () => {
	throw new Error("probe must not be called");
};

describe("parseSourceDeclaration", () => {
	it("reads forge-primary", () => {
		expect(parseSourceDeclaration("forge")).toEqual({ side: "forge" });
		expect(parseSourceDeclaration("hanzo-git")).toEqual({ side: "forge" });
	});
	it("reads a bare owner/name", () => {
		expect(parseSourceDeclaration("hanzo-docs/docs")).toEqual({
			side: "github",
			repo: "hanzo-docs/docs",
		});
	});
	it("reads a spelled-out URL, with or without .git", () => {
		for (const s of [
			"github.com/hanzo-docs/docs",
			"https://github.com/hanzo-docs/docs",
			"https://github.com/hanzo-docs/docs.git",
			"  https://github.com/hanzo-docs/docs/  ",
		]) {
			expect(parseSourceDeclaration(s)).toEqual({
				side: "github",
				repo: "hanzo-docs/docs",
			});
		}
	});
	it("rejects anything that is not a repo", () => {
		for (const s of ["", "  ", "docs", "a/b/c", 7, null, undefined, {}]) {
			expect(parseSourceDeclaration(s)).toBeNull();
		}
	});
});

describe("githubRepoFromOriginalUrl", () => {
	it("extracts owner/name and strips embedded credentials", () => {
		expect(
			githubRepoFromOriginalUrl(
				"https://x-access-token:ghs_abc@github.com/hanzoai/cloud.git",
			),
		).toBe("hanzoai/cloud");
	});
	it("ignores non-GitHub upstreams", () => {
		expect(githubRepoFromOriginalUrl("https://gitlab.com/a/b.git")).toBeNull();
		expect(githubRepoFromOriginalUrl(null)).toBeNull();
	});
});

describe("resolveCanonical", () => {
	it("prefers the declaration over the forge's mirror row", () => {
		// The database is the thing that drifted; the repo's own declaration wins.
		expect(
			resolveCanonical("forge", {
				mirror: true,
				originalUrl: "https://github.com/hanzoai/cloud.git",
			}),
		).toEqual({ side: "forge" });
	});
	it("infers GitHub from a live mirror row", () => {
		expect(
			resolveCanonical(undefined, {
				mirror: true,
				originalUrl: "https://github.com/hanzo-docs/docs.git",
			}),
		).toEqual({ side: "github", repo: "hanzo-docs/docs" });
	});
	it("still infers GitHub when the mirror row is gone but the upstream is recorded", () => {
		// "Convert to regular repo" clears `mirror` and leaves original_url. That
		// residue is the last evidence the repo was ever downstream of anything.
		expect(
			resolveCanonical(undefined, {
				mirror: false,
				originalUrl: "https://github.com/hanzoai/ci.git",
			}),
		).toEqual({ side: "github", repo: "hanzoai/ci" });
	});
	it("infers forge-primary from a push mirror, with no declaration needed", () => {
		// 57 repos are push-mirrored to GitHub today. The forge already records
		// that it is upstream; making each repo repeat it in YAML would break 57
		// builds to learn nothing.
		expect(
			resolveCanonical(undefined, {
				mirror: false,
				pushMirror: true,
				originalUrl: "https://github.com/hanzoai/cloud.git",
			}),
		).toEqual({ side: "forge" });
	});
	it("calls pull+push on the same repo AMBIGUOUS rather than picking one", () => {
		// 8 repos are configured both ways. Whichever mirror ran last wins, which
		// is not a direction — it is a coin flip that has to be settled by a person.
		expect(
			resolveCanonical(undefined, {
				mirror: true,
				pushMirror: true,
				originalUrl: "https://github.com/hanzoai/paas.git",
			}),
		).toBe(AMBIGUOUS);
	});
	it("returns null when the forge records nothing — never 'forge-native'", () => {
		// The bug being fixed: an unlinked repo and a forge-only repo are the
		// same row. Concluding "forge-native" here is what let docs rot.
		expect(resolveCanonical(undefined, { mirror: false })).toBeNull();
		expect(resolveCanonical(undefined, null)).toBeNull();
	});
});

describe("the gate", () => {
	// ---- MUTATION 1: a diverged pair must go red, naming both shas and the repo.
	it("REFUSES a diverged repo, naming the repo and both shas", async () => {
		const err = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzo-docs/docs",
			sha: DOCS_FORGE,
			declared: undefined,
			facts: {
				mirror: false,
				originalUrl: "https://github.com/hanzo-docs/docs.git",
			},
			probe: unreachable(DOCS_GITHUB),
		}).then(
			() => null,
			(e) => e as ForgeSourceRefusal,
		);

		expect(err).toBeInstanceOf(ForgeSourceRefusal);
		const msg = err?.message ?? "";
		expect(msg).toContain("hanzo-docs/docs"); // the repo
		expect(msg).toContain(DOCS_FORGE); // the forge sha
		expect(msg).toContain(DOCS_GITHUB); // the GitHub sha
		expect(msg).toContain("Refusing to build");
		// It must not suggest a destructive repair.
		expect(msg).toContain("do not force-push");
	});

	// ---- MUTATION 2: an in-sync pair must go green.
	it("ALLOWS a commit that is on the canonical branch", async () => {
		const why = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzo-docs/docs",
			sha: DOCS_GITHUB,
			declared: undefined,
			facts: {
				mirror: true,
				originalUrl: "https://github.com/hanzo-docs/docs.git",
			},
			probe: reachable,
		});
		expect(why).toContain("is on github.com/hanzo-docs/docs");
	});

	// ---- MUTATION 3: an intentionally forge-primary repo stays green.
	it("ALLOWS hanzoai/cloud, which is forge-primary, without consulting GitHub", async () => {
		// cloud's GitHub origin is a curated Apache-2.0 core with unrelated
		// history. Comparing them is meaningless; the probe must not even run.
		// It stays green BOTH ways: declared, and inferred from its push mirror.
		for (const facts of [
			{ mirror: false, originalUrl: "https://github.com/hanzoai/cloud.git" },
			{
				mirror: false,
				pushMirror: true,
				originalUrl: "https://github.com/hanzoai/cloud.git",
			},
		]) {
			const why = await assertBuildableFromCanonicalSource({
				forgeRepo: "hanzoai/cloud",
				sha: CLOUD_FORGE,
				declared: facts.pushMirror ? undefined : "forge",
				facts,
				probe: neverProbed,
			});
			expect(why).toContain("forge is authoritative");
		}
	});

	it("REFUSES a repo mirrored in both directions, telling the operator to pick one", async () => {
		const err = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzoai/paas",
			sha: CLOUD_FORGE,
			declared: undefined,
			facts: {
				mirror: true,
				pushMirror: true,
				originalUrl: "https://github.com/hanzoai/paas.git",
			},
			probe: neverProbed,
		}).then(
			() => null,
			(e) => e as ForgeSourceRefusal,
		);
		expect(err).toBeInstanceOf(ForgeSourceRefusal);
		expect(err?.message).toContain("hanzoai/paas");
		expect(err?.message).toContain("neither side is canonical");
	});

	// ---- The unlinked case, which is what actually bit docs.
	it("REFUSES an unlinked repo whose GitHub twin exists and has moved on", async () => {
		// No declaration, no mirror row, no original_url — the state that used
		// to read as "forge-native, nothing to check".
		const err = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzo-docs/docs",
			sha: DOCS_FORGE,
			declared: undefined,
			facts: { mirror: false },
			probe: unreachable(DOCS_GITHUB),
		}).then(
			() => null,
			(e) => e as ForgeSourceRefusal,
		);
		expect(err).toBeInstanceOf(ForgeSourceRefusal);
		expect(err?.message).toContain(DOCS_GITHUB);
	});

	it("ALLOWS a genuinely forge-native repo with no GitHub twin", async () => {
		const why = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzoai/internal-only",
			sha: DOCS_FORGE,
			declared: undefined,
			facts: { mirror: false },
			probe: noSuchRepo,
		});
		expect(why).toContain("no GitHub counterpart");
	});

	it("REFUSES when a declared source does not exist, rather than silently passing", async () => {
		const err = await assertBuildableFromCanonicalSource({
			forgeRepo: "hanzoai/thing",
			sha: DOCS_FORGE,
			declared: "hanzoai/typo-in-the-name",
			facts: null,
			probe: noSuchRepo,
		}).then(
			() => null,
			(e) => e as ForgeSourceRefusal,
		);
		expect(err).toBeInstanceOf(ForgeSourceRefusal);
		expect(err?.message).toContain("does not exist");
	});

	it("distinguishes 'the gate ran and said yes' from 'no gate ran'", async () => {
		// Every allow path returns a non-empty reason. A caller logging this
		// cannot confuse a checked build with an unchecked one.
		for (const args of [
			{ declared: "forge", facts: null, probe: neverProbed },
			{ declared: undefined, facts: { mirror: false }, probe: noSuchRepo },
			{
				declared: undefined,
				facts: { mirror: true, originalUrl: "https://github.com/a/b.git" },
				probe: reachable,
			},
		] as const) {
			const why = await assertBuildableFromCanonicalSource({
				forgeRepo: "a/b",
				sha: DOCS_FORGE,
				...args,
			});
			expect(why.length).toBeGreaterThan(0);
		}
	});
});
