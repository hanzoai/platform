import {
	type App,
	computeDrift,
	computeDriftFlags,
	type DriftKind,
	isSemverTag,
} from "@hanzo/platform/db/schema";
import { describe, expect, it } from "vitest";

/**
 * Drift semantics from docs/APPS_LIFECYCLE.md. These lock the contract's drift
 * rules (state table line 49 + drift-view legend lines 176-179) so the single
 * drift authority can never silently change meaning.
 */

// Minimal observed row; each test overrides the tags/release fields it exercises.
const row = (over: Partial<App>): App =>
	({
		id: "hanzo-k8s/hanzo/iam",
		org: "hanzo",
		app: "iam",
		env: "main",
		repo: "hanzoai/iam",
		registry: "ghcr.io/hanzoai/iam",
		declaredTag: null,
		runningTag: null,
		latestTag: null,
		releaseUrl: null,
		releaseAssets: 0,
		health: null,
		syncStatus: null,
		syncRevision: null,
		lastObserved: null,
		cluster: "hanzo-k8s",
		namespace: "hanzo",
		createdAt: new Date(),
		updatedAt: new Date(),
		organizationId: null,
		...over,
	}) as App;

const kinds = (app: App): DriftKind[] =>
	computeDriftFlags(app).map((f) => f.kind);

describe("isSemverTag", () => {
	it("accepts strict vX.Y.Z", () => {
		expect(isSemverTag("v1.15.0")).toBe(true);
		expect(isSemverTag("v0.0.1")).toBe(true);
	});
	it("rejects floating / non-semver references", () => {
		for (const t of [
			"1.15.0", // no leading v
			"v1.15", // not three parts
			"main",
			"latest",
			"multi-issuer",
			"sha-abc1234",
			"v1.15.0-rc1",
			null,
			undefined,
		]) {
			expect(isSemverTag(t)).toBe(false);
		}
	});
});

describe("computeDrift", () => {
	it("is ok when declared == running == latest and the release has assets", () => {
		// Contract row: hanzoai/iam test — v1.15.0 everywhere, 4 assets, green.
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "v1.15.0",
				latestTag: "v1.15.0",
				releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.15.0",
				releaseAssets: 4,
			}),
		);
		expect(d.severity).toBe("ok");
		expect(d.flags).toEqual([]);
	});

	it("flags un-rolled (yellow) when running != declared", () => {
		// Contract row: hanzoai/iam main — declared v1.15.0, running v1.14.29.
		const app = row({
			declaredTag: "v1.15.0",
			runningTag: "v1.14.29",
			latestTag: "v1.15.0",
			releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.15.0",
			releaseAssets: 4,
		});
		expect(kinds(app)).toEqual(["un-rolled"]);
		expect(computeDrift(app).severity).toBe("yellow");
	});

	it("flags stale (yellow) when declared != latest", () => {
		const app = row({
			declaredTag: "v1.14.0",
			runningTag: "v1.14.0",
			latestTag: "v1.15.0",
			releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.14.0",
			releaseAssets: 4,
		});
		expect(kinds(app)).toEqual(["stale"]);
		expect(computeDrift(app).severity).toBe("yellow");
	});

	it("flags floating-declared (red) for a non-semver declared tag", () => {
		// Contract: kms CR pins a floating `multi-issuer` tag.
		const app = row({ declaredTag: "multi-issuer", releaseUrl: null });
		const ks = kinds(app);
		expect(ks).toContain("floating-declared");
		// A floating declaration suppresses the "stale" comparison.
		expect(ks).not.toContain("stale");
		expect(computeDrift(app).severity).toBe("red");
	});

	it("flags floating-running (red) when the cluster runs a floating tag", () => {
		// Contract row: hanzoai/gateway main — running tag is floating.
		const app = row({
			declaredTag: "v2.14.1",
			runningTag: "main",
			latestTag: "v2.14.1",
			releaseUrl: "https://github.com/hanzoai/gateway/releases/tag/v2.14.1",
			releaseAssets: 3,
		});
		expect(kinds(app)).toContain("floating-running");
		expect(computeDrift(app).severity).toBe("red");
	});

	it("flags no-release (red) when a declared tag has no GH Release", () => {
		const app = row({
			declaredTag: "v1.15.0",
			runningTag: "v1.15.0",
			latestTag: "v1.15.0",
			releaseUrl: null,
		});
		expect(kinds(app)).toEqual(["no-release"]);
		expect(computeDrift(app).severity).toBe("red");
	});

	it("flags zero-assets (red) — the iam v1.15.0-with-0-binaries class", () => {
		const app = row({
			declaredTag: "v1.15.0",
			runningTag: "v1.15.0",
			latestTag: "v1.15.0",
			releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.15.0",
			releaseAssets: 0,
		});
		expect(kinds(app)).toEqual(["zero-assets"]);
		expect(computeDrift(app).severity).toBe("red");
	});

	it("stacks multiple flags and rolls up to the max severity (red)", () => {
		// Stale (yellow) + floating-running (red) + zero-assets (red).
		const app = row({
			declaredTag: "v1.0.0",
			runningTag: "edge",
			latestTag: "v1.2.0",
			releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.0.0",
			releaseAssets: 0,
		});
		const ks = kinds(app);
		expect(ks).toContain("stale");
		expect(ks).toContain("floating-running");
		expect(ks).toContain("zero-assets");
		expect(computeDrift(app).severity).toBe("red");
	});

	it("does not flag release integrity when nothing is declared yet", () => {
		// Contract: platform / id rows have declaredTag = null (no CR declares them).
		const app = row({ declaredTag: null, releaseUrl: null });
		expect(computeDrift(app).flags).toEqual([]);
		expect(computeDrift(app).severity).toBe("ok");
	});
});

describe("the deployer's verdict", () => {
	it("flags a drifted app: git and the live objects no longer agree", () => {
		const d = computeDrift(row({ syncStatus: "drifted" }));
		expect(d.flags.map((f) => f.kind)).toEqual(["unsynced"]);
		expect(d.severity).toBe("yellow");
	});
	it("does NOT flag a synced app", () => {
		expect(kinds(row({ syncStatus: "synced" }))).toEqual([]);
	});
	it("does NOT invent drift from missing evidence (unknown / unmanaged)", () => {
		expect(kinds(row({ syncStatus: "unknown" }))).toEqual([]);
		expect(kinds(row({ syncStatus: null }))).toEqual([]);
	});
	it("never outranks a hard red: a floating tag stays red while drifted", () => {
		const d = computeDrift(
			row({ declaredTag: "sha-abc1234", syncStatus: "drifted" }),
		);
		expect(d.severity).toBe("red");
		expect(d.flags.map((f) => f.kind)).toEqual(
			expect.arrayContaining(["floating-declared", "unsynced"]),
		);
	});
});
