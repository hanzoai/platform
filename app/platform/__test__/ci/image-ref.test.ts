import {
	imageOrg,
	parseImageRef,
	withRegistryHost,
} from "@hanzo/platform/services/ci/image-ref";
import { describe, expect, it } from "vitest";

describe("parseImageRef", () => {
	it("splits repo:tag", () => {
		expect(parseImageRef("postgres:16-alpine")).toEqual([
			"postgres",
			"16-alpine",
			"",
		]);
	});
	it("handles a bare repo", () => {
		expect(parseImageRef("postgres")).toEqual(["postgres", "", ""]);
	});
	it("splits a registry/path:tag", () => {
		expect(parseImageRef("ghcr.io/hanzoai/zip:abc1234")).toEqual([
			"ghcr.io/hanzoai/zip",
			"abc1234",
			"",
		]);
	});
	it("treats host:port as part of the repo, not a tag", () => {
		expect(parseImageRef("ghcr.io:5000/x/y")).toEqual([
			"ghcr.io:5000/x/y",
			"",
			"",
		]);
	});

	// Digest-pinned refs are the CONVENTION in this fleet (116 chart values files
	// pin `digest:` beside `tag:`), and they were the case this split got wrong:
	// `lastIndexOf(":")` landed inside `sha256:`, so the "tag" came back as the
	// digest hex. The fleet board then printed that hex where an operator reads a
	// version, and drift flagged the row `floating-running` for not being semver —
	// red precisely because the image was pinned properly. These are the live refs
	// off do-sfo3-hanzo-k8s.
	it("separates the digest from the tag on a pinned ref", () => {
		expect(
			parseImageRef(
				"ghcr.io/hanzoai/cloud:v1.801.371@sha256:76e30c9218d01d1e9fb3889122433dd58c70e15483fb67776a7d7ea5c25529f0",
			),
		).toEqual([
			"ghcr.io/hanzoai/cloud",
			"v1.801.371",
			"sha256:76e30c9218d01d1e9fb3889122433dd58c70e15483fb67776a7d7ea5c25529f0",
		]);
	});

	it("reads the version, not the hex, for every live digest-pinned app", () => {
		const live: Array<[string, string, string]> = [
			["ghcr.io/hanzoai/iam:v1.34.4@sha256:9681afd5", "ghcr.io/hanzoai/iam", "v1.34.4"],
			["ghcr.io/hanzoai/chat:1.0.52@sha256:9c1e124a", "ghcr.io/hanzoai/chat", "1.0.52"],
			["ghcr.io/hanzoai/base:1.3.0@sha256:03dbf15b", "ghcr.io/hanzoai/base", "1.3.0"],
		];
		for (const [ref, repo, tag] of live) {
			expect(parseImageRef(ref).slice(0, 2)).toEqual([repo, tag]);
		}
	});

	it("handles a digest with no tag at all", () => {
		expect(parseImageRef("ghcr.io/hanzoai/a@sha256:57c594bc")).toEqual([
			"ghcr.io/hanzoai/a",
			"",
			"sha256:57c594bc",
		]);
	});

	it("keeps the org attribution intact on a pinned ref", () => {
		// `imageOrg` reads parts[1] of the repository; with the digest smuggled
		// into the tag the repository still parsed, but any consumer comparing
		// repositories (sidecar matching in the inventory reader) compared a
		// digest-suffixed string against a clean one and never matched.
		expect(imageOrg("ghcr.io/luxfi/aml-ui:v0.3.8@sha256:80588b9b")).toBe("luxfi");
	});
});

describe("withRegistryHost", () => {
	it("swaps the registry host, preserving org/repo:tag", () => {
		expect(
			withRegistryHost("ghcr.io/hanzoai/pricing:v1.2.3", "registry.hanzo.ai"),
		).toBe("registry.hanzo.ai/hanzoai/pricing:v1.2.3");
	});
	it("prepends a host to a host-less (Docker Hub short) ref", () => {
		expect(withRegistryHost("pricing:v1.2.3", "registry.hanzo.ai")).toBe(
			"registry.hanzo.ai/pricing:v1.2.3",
		);
	});
	it("treats an org first segment as a path, not a host", () => {
		expect(withRegistryHost("hanzoai/pricing:v1", "registry.hanzo.ai")).toBe(
			"registry.hanzo.ai/hanzoai/pricing:v1",
		);
	});
	it("treats a host:port first segment as the host and replaces it", () => {
		expect(withRegistryHost("ghcr.io:5000/x/y:t", "registry.hanzo.ai")).toBe(
			"registry.hanzo.ai/x/y:t",
		);
	});
	it("is idempotent when the host already matches", () => {
		expect(
			withRegistryHost("registry.hanzo.ai/hanzoai/x:t", "registry.hanzo.ai"),
		).toBe("registry.hanzo.ai/hanzoai/x:t");
	});
});
