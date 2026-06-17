import { parseImageRef } from "@hanzo/platform/services/ci/image-ref";
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
