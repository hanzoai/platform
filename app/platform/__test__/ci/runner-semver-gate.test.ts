import { describe, expect, it } from "vitest";

import {
	buildArgsProblem,
	firstPartyTagProblem,
} from "../../app/v1/runner/route";

/**
 * Owner directive: everything we publish carries real semver, no ad-hoc tags.
 *
 * This route is how `ghcr.io/luxfi/node:v1.36.2-blsfix` came to exist and end up
 * running hanzo-mainnet's five validators. No git tag of that name exists and the
 * image has no OCI revision label, so that binary cannot be traced to source,
 * rebuilt, or patched — and it got there because the enqueue API accepted any
 * `image` string it was handed.
 */
describe("firstPartyTagProblem", () => {
	it("accepts real semver on first-party images", () => {
		for (const img of [
			"ghcr.io/hanzoai/kms-operator:v0.4.3",
			"ghcr.io/luxfi/node:v1.36.49",
			"ghcr.io/hanzoai/platform:4.4.10",
			"ghcr.io/zooai/ngo:v2.0.1",
		]) {
			expect(firstPartyTagProblem(img), img).toBeNull();
		}
	});

	it("accepts a digest reference — stronger than any tag", () => {
		expect(
			firstPartyTagProblem("ghcr.io/luxfi/node@sha256:0123456789abcdef"),
		).toBeNull();
	});

	it("rejects every ad-hoc tag shape we actually found deployed", () => {
		const found = [
			"ghcr.io/luxfi/node:v1.36.2-blsfix", // bespoke suffix, no git tag exists
			"ghcr.io/hanzoai/kms-operator:latest", // floating
			"ghcr.io/luxfi/bridge:main", // branch name
			"ghcr.io/hanzoai/iam:sha-ba43c54", // commit tag
			"ghcr.io/hanzoai/console:3.158.0-amd64", // arch suffix
			"ghcr.io/luxfi/dao-vote:lux-f36fd77", // brand-prefixed
			"ghcr.io/hanzoai/kv:9", // major only
			"ghcr.io/hanzoai/datastore:26.2.3.2", // four-part
		];
		for (const img of found) {
			expect(firstPartyTagProblem(img), img).toContain("not semver");
		}
	});

	it("rejects a first-party image with no tag at all", () => {
		expect(firstPartyTagProblem("ghcr.io/hanzoai/platform")).toContain(
			"no tag",
		);
	});

	it("does not judge upstream images — their tags are their publishers' business", () => {
		for (const img of [
			"docker.io/library/busybox:1.36",
			"postgres:16-alpine",
			"moby/buildkit:v0.16.0",
			"rclone/rclone:1.68",
		]) {
			expect(firstPartyTagProblem(img), img).toBeNull();
		}
	});

	it("does not mistake a registry port for a tag", () => {
		// lastIndexOf(':') lands on the port, not a tag — the slash check catches it.
		expect(
			firstPartyTagProblem("registry.example.com:5000/foo/bar:v1.0.0"),
		).toBeNull();
	});
});

/**
 * A build arg key is spliced into `--opt=build-arg:<key>=<value>`, so a key that
 * is not an ARG name would build a different option than it reads like. Values
 * are free text: they ride as their own argv element and never reach a shell.
 */
describe("buildArgsProblem", () => {
	it("accepts an absent field and a flat string map", () => {
		expect(buildArgsProblem(undefined)).toBeNull();
		expect(buildArgsProblem({})).toBeNull();
		expect(
			buildArgsProblem({ VERSION: "v1.34.1", GO_TAGS: "netgo osusergo" }),
		).toBeNull();
	});

	it("refuses anything that is not an object of strings", () => {
		expect(buildArgsProblem("VERSION=1")).toContain("must be an object");
		expect(buildArgsProblem(["VERSION=1"])).toContain("must be an object");
		expect(buildArgsProblem(null)).toContain("must be an object");
		expect(buildArgsProblem({ VERSION: 1 })).toContain("must be a string");
	});

	it("refuses a key that is not a Dockerfile ARG name", () => {
		for (const k of ["VER SION", "A=B", "--opt=target", "1VERSION", ""]) {
			expect(buildArgsProblem({ [k]: "x" }), k).toContain("ARG name");
		}
	});
});
