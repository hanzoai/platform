import {
	parseImageRef,
	withRegistryHost,
} from "@hanzo/platform/services/ci/image-ref";
import { describe, expect, it } from "vitest";

describe("parseImageRef", () => {
	it("splits repo:tag", () => {
		expect(parseImageRef("postgres:16-alpine")).toEqual([
			"postgres",
			"16-alpine",
		]);
	});
	it("handles a bare repo", () => {
		expect(parseImageRef("postgres")).toEqual(["postgres", ""]);
	});
	it("splits a registry/path:tag", () => {
		expect(parseImageRef("ghcr.io/hanzoai/zip:abc1234")).toEqual([
			"ghcr.io/hanzoai/zip",
			"abc1234",
		]);
	});
	it("treats host:port as part of the repo, not a tag", () => {
		expect(parseImageRef("ghcr.io:5000/x/y")).toEqual(["ghcr.io:5000/x/y", ""]);
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
