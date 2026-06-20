/**
 * apps-lifecycle reader logic (PR 2 of docs/APPS_LIFECYCLE.md).
 *
 * Pins the deterministic drift-math the four readers share: the semver
 * predicate + "newest" picker (which is what makes a floating tag count as
 * drift), the registry/repo parsers used as the join key, and the health
 * rollup. These are pure functions with no IO — the network/cluster/DB sweeps
 * are validated by typecheck + the operator-CR fixture shape.
 */

import {
	isSemverTag,
	newestSemver,
	parseGhcr,
	parseRepo,
	rollupHealth,
} from "@hanzo/platform/services/apps/shared";
import { describe, expect, it } from "vitest";

describe("isSemverTag", () => {
	it("accepts vX.Y.Z and bare X.Y.Z", () => {
		expect(isSemverTag("v1.15.0")).toBe(true);
		expect(isSemverTag("1.19.5")).toBe(true);
		expect(isSemverTag("v2.14.7")).toBe(true);
	});

	it("rejects floating references (the drift bug class)", () => {
		// These are exactly the tags the contract forbids as declared/running.
		expect(isSemverTag("multi-issuer")).toBe(false);
		expect(isSemverTag("latest")).toBe(false);
		expect(isSemverTag("main")).toBe(false);
		expect(isSemverTag("sha-abc1234")).toBe(false);
		expect(isSemverTag("0.7.8-hanzo")).toBe(true); // prerelease is valid semver
	});

	it("rejects null / undefined / empty", () => {
		expect(isSemverTag(null)).toBe(false);
		expect(isSemverTag(undefined)).toBe(false);
		expect(isSemverTag("")).toBe(false);
	});
});

describe("newestSemver", () => {
	it("picks the highest semver and preserves the original tag string", () => {
		expect(newestSemver(["v1.0.0", "v1.2.0", "v1.1.9"])).toBe("v1.2.0");
		expect(newestSemver(["1.785.0", "1.784.2", "1.700.0"])).toBe("1.785.0");
	});

	it("ignores floating tags so they never win 'latest'", () => {
		expect(newestSemver(["multi-issuer", "v1.0.0", "latest", "v1.3.0"])).toBe(
			"v1.3.0",
		);
	});

	it("returns null when no semver tag exists", () => {
		expect(newestSemver(["latest", "main", "edge"])).toBeNull();
		expect(newestSemver([])).toBeNull();
	});

	it("orders patch/minor/major correctly across mixed v-prefixes", () => {
		expect(newestSemver(["v2.0.0", "10.0.0", "v9.9.9"])).toBe("10.0.0");
	});
});

describe("parseGhcr", () => {
	it("splits a GHCR registry into owner + package", () => {
		expect(parseGhcr("ghcr.io/hanzoai/iam")).toEqual({
			host: "ghcr.io",
			owner: "hanzoai",
			pkg: "iam",
		});
	});

	it("keeps nested package paths intact", () => {
		expect(parseGhcr("ghcr.io/hanzoai/chat-rag-api")).toEqual({
			host: "ghcr.io",
			owner: "hanzoai",
			pkg: "chat-rag-api",
		});
	});

	it("returns null for non-GHCR registries (GAR is a follow-up)", () => {
		expect(parseGhcr("docker.io/getmeili/meilisearch")).toBeNull();
		expect(parseGhcr("us-docker.pkg.dev/proj/repo/img")).toBeNull();
		expect(parseGhcr("ghcr.io/onlyowner")).toBeNull();
	});
});

describe("parseRepo", () => {
	it("splits owner/repo", () => {
		expect(parseRepo("hanzoai/iam")).toEqual({ owner: "hanzoai", repo: "iam" });
	});

	it("returns null for malformed repo strings", () => {
		expect(parseRepo("iam")).toBeNull();
		expect(parseRepo("")).toBeNull();
	});
});

describe("rollupHealth", () => {
	it("green when all desired replicas are ready", () => {
		expect(rollupHealth(3, 3)).toBe("green");
		expect(rollupHealth(1, 1)).toBe("green");
	});

	it("red when desired > 0 but none ready", () => {
		expect(rollupHealth(2, 0)).toBe("red");
	});

	it("yellow while partially rolled out", () => {
		expect(rollupHealth(3, 1)).toBe("yellow");
	});

	it("yellow when scaled to zero (intentional, not serving)", () => {
		expect(rollupHealth(0, 0)).toBe("yellow");
	});
});
