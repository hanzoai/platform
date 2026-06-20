import type { App } from "@hanzo/platform/db/schema";
import { computeDrift, isSemverTag } from "@hanzo/platform/services/apps";
import { describe, expect, it } from "vitest";

/**
 * computeDrift is the keystone of the apps-lifecycle drift view
 * (docs/APPS_LIFECYCLE.md §6). It is the single place drift is derived, so the
 * page and the REST `/v1/apps` endpoint can never disagree. These tests pin the
 * severity order (red > yellow > green) and every branch.
 */

/** Minimal apps row with sane defaults; override the observed columns per case. */
const row = (over: Partial<App>): App =>
	({
		id: "hanzoai/iam/main",
		org: "hanzoai",
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
		lastObserved: null,
		cluster: "hanzo-k8s",
		namespace: "hanzo",
		createdAt: new Date(),
		updatedAt: new Date(),
		organizationId: null,
		...over,
	}) as App;

describe("isSemverTag", () => {
	it("accepts vMAJOR.MINOR.PATCH only", () => {
		expect(isSemverTag("v1.15.0")).toBe(true);
		expect(isSemverTag("v0.0.1")).toBe(true);
	});
	it("rejects floating / non-semver refs", () => {
		for (const t of [
			"multi-issuer",
			"latest",
			"main",
			"1.15.0", // no leading v
			"v1.15", // not three parts
			"sha-abc1234",
			"v1.15.0-rc1",
			"",
			null,
			undefined,
		]) {
			expect(isSemverTag(t as string)).toBe(false);
		}
	});
});

describe("computeDrift", () => {
	it("is green when declared == running == latest and the release has assets", () => {
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "v1.15.0",
				latestTag: "v1.15.0",
				releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.15.0",
				releaseAssets: 4,
			}),
		);
		expect(d.level).toBe("ok");
		expect(d.kind).toBe("none");
	});

	it("flags a floating declared tag as red (the kms `multi-issuer` case)", () => {
		const d = computeDrift(
			row({ declaredTag: "multi-issuer", runningTag: "v1.0.0" }),
		);
		expect(d.level).toBe("error");
		expect(d.kind).toBe("floating");
	});

	it("flags a floating running tag as red", () => {
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "main",
				releaseUrl: "https://example/r",
				releaseAssets: 4,
			}),
		);
		expect(d.level).toBe("error");
		expect(d.kind).toBe("floating");
	});

	it("flags a declared semver tag with no GH Release as red", () => {
		const d = computeDrift(
			row({ declaredTag: "v1.15.0", runningTag: "v1.15.0", releaseUrl: null }),
		);
		expect(d.level).toBe("error");
		expect(d.kind).toBe("no-release");
	});

	it("flags a GH Release with zero assets as red (the iam v1.15.0 bug)", () => {
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "v1.15.0",
				releaseUrl: "https://example/r",
				releaseAssets: 0,
			}),
		);
		expect(d.level).toBe("error");
		expect(d.kind).toBe("no-release");
	});

	it("flags running != declared as yellow (un-rolled)", () => {
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "v1.14.29",
				latestTag: "v1.15.0",
				releaseUrl: "https://example/r",
				releaseAssets: 4,
			}),
		);
		expect(d.level).toBe("warn");
		expect(d.kind).toBe("un-rolled");
	});

	it("flags declared behind latest as yellow (stale)", () => {
		const d = computeDrift(
			row({
				declaredTag: "v1.14.0",
				runningTag: "v1.14.0",
				latestTag: "v1.15.0",
				releaseUrl: "https://example/r",
				releaseAssets: 4,
			}),
		);
		expect(d.level).toBe("warn");
		expect(d.kind).toBe("stale");
	});

	it("red outranks yellow: a floating tag wins over a version gap", () => {
		// running is floating AND behind — floating (red) must win.
		const d = computeDrift(
			row({
				declaredTag: "v1.15.0",
				runningTag: "latest",
				latestTag: "v2.0.0",
			}),
		);
		expect(d.kind).toBe("floating");
	});

	it("degrades to unknown (not green) when observations are missing", () => {
		expect(computeDrift(row({})).kind).toBe("unknown"); // nothing observed
		expect(
			computeDrift(
				row({ declaredTag: "v1.15.0", releaseUrl: "x", releaseAssets: 1 }),
			).kind,
		).toBe("unknown"); // running not observed
		expect(
			computeDrift(
				row({
					declaredTag: "v1.15.0",
					runningTag: "v1.15.0",
					latestTag: null,
					releaseUrl: "x",
					releaseAssets: 1,
				}),
			).kind,
		).toBe("unknown"); // latest not observed
	});
});
