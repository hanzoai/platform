/**
 * Unit tests for the release-meta reader (services/apps/release-reader).
 *
 * The pure mappers (`parseRepoCoordinate`, `releaseMetaFrom`) and the 404→
 * NO_RELEASE contract in `fetchReleaseMeta` are the load-bearing correctness:
 * they decide what the drift checker sees as `latestTag`/`releaseUrl`/
 * `releaseAssets`, which in turn produce the `stale` / `zero-assets` /
 * `no-release` flags. They take an injected Octokit and never touch the DB, so
 * they run in the mocked unit pool with no network and no SQLite.
 */

import {
	fetchReleaseMeta,
	NO_RELEASE,
	parseRepoCoordinate,
	releaseMetaFrom,
} from "@hanzo/platform/services/apps/release-reader";
import { describe, expect, it, vi } from "vitest";

describe("parseRepoCoordinate", () => {
	it("splits an owner/repo coordinate", () => {
		expect(parseRepoCoordinate("hanzoai/iam")).toEqual({
			owner: "hanzoai",
			name: "iam",
		});
		expect(parseRepoCoordinate("grafana/grafana")).toEqual({
			owner: "grafana",
			name: "grafana",
		});
	});
	it("collapses a monorepo image path to owner/repo (drops trailing segment)", () => {
		expect(parseRepoCoordinate("hanzoai/insights/capture")).toEqual({
			owner: "hanzoai",
			name: "insights",
		});
	});
	it("returns null for a bare name with no owner", () => {
		expect(parseRepoCoordinate("postgres")).toBeNull();
		expect(parseRepoCoordinate("")).toBeNull();
	});
});

describe("releaseMetaFrom", () => {
	it("maps a full release payload (tag + url + asset count)", () => {
		expect(
			releaseMetaFrom({
				tag_name: "v1.25.2",
				html_url: "https://github.com/hanzoai/iam/releases/tag/v1.25.2",
				assets: [{}, {}, {}],
			}),
		).toEqual({
			latestTag: "v1.25.2",
			releaseUrl: "https://github.com/hanzoai/iam/releases/tag/v1.25.2",
			releaseAssets: 3,
		});
	});
	it("records a zero-asset release verbatim (the v1.x.0-no-binaries class)", () => {
		// This is the real iam case: a release exists but shipped 0 assets, which
		// the drift checker must see as `zero-assets`, NOT `no-release`.
		expect(
			releaseMetaFrom({
				tag_name: "v1.25.2",
				html_url: "https://x",
				assets: [],
			}),
		).toEqual({
			latestTag: "v1.25.2",
			releaseUrl: "https://x",
			releaseAssets: 0,
		});
	});
	it("returns NO_RELEASE for a null/tagless payload", () => {
		expect(releaseMetaFrom(null)).toEqual(NO_RELEASE);
		expect(releaseMetaFrom(undefined)).toEqual(NO_RELEASE);
		expect(releaseMetaFrom({ html_url: "https://x" })).toEqual(NO_RELEASE);
	});
});

describe("fetchReleaseMeta", () => {
	const octokitWith = (impl: () => unknown) =>
		({ rest: { repos: { getLatestRelease: vi.fn(impl) } } }) as never;

	it("returns mapped meta on success", async () => {
		const octokit = octokitWith(async () => ({
			data: { tag_name: "v2.0.0", html_url: "https://r", assets: [{}] },
		}));
		await expect(
			fetchReleaseMeta(octokit, "hanzoai", "cloud"),
		).resolves.toEqual({
			latestTag: "v2.0.0",
			releaseUrl: "https://r",
			releaseAssets: 1,
		});
	});

	it("treats a 404 (no release / not visible) as NO_RELEASE, not an error", async () => {
		const octokit = octokitWith(async () => {
			throw { status: 404, message: "Not Found" };
		});
		await expect(
			fetchReleaseMeta(octokit, "hanzoai", "console"),
		).resolves.toEqual(NO_RELEASE);
	});

	it("re-throws non-404 failures (e.g. 403 rate limit) for the caller to handle", async () => {
		const octokit = octokitWith(async () => {
			throw { status: 403, message: "rate limited" };
		});
		await expect(
			fetchReleaseMeta(octokit, "hanzoai", "iam"),
		).rejects.toMatchObject({ status: 403 });
	});
});
