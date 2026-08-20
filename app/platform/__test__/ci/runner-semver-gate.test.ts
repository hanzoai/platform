import { describe, expect, it } from "vitest";

import {
	buildArgsProblem,
	firstPartyTagProblem,
} from "../../server/v1/build-request";

/**
 * Everything we publish carries real semver, no ad-hoc tags.
 *
 * A tag is how a running binary is traced back to its source, so it has to name
 * a release a git tag also names — one that can be rebuilt and patched. The
 * shapes below are the ones that answer to nothing: a bespoke suffix, a floating
 * name, a branch, a bare commit, an arch variant.
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
			"ghcr.io/luxfi/node:v1.36.2-hotfix", // bespoke suffix, no git tag exists
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

	it("reads the namespace the way the push credential reads it", () => {
		// The rule and the credential must agree about which image this is: the
		// credential is derived through `imageOrg`, so the rule is read through
		// `imageOrg` too. A spelling one accepts and the other does not is a
		// destination that publishes with a real token under an unreleasable name.
		for (const img of [
			"GHCR.IO/hanzoai/platform:latest",
			"ghcr.io/HanzoAI/platform:latest",
			"Ghcr.Io/HANZOAI/platform:main",
			"ghcr.io:443/hanzoai/platform:latest",
		]) {
			expect(firstPartyTagProblem(img), img).toContain("not semver");
		}
	});

	it("accepts semver on a first-party image however it is spelled", () => {
		for (const img of [
			"GHCR.IO/hanzoai/platform:v4.4.25",
			"ghcr.io/LUXFI/node:v1.36.49",
		]) {
			expect(firstPartyTagProblem(img), img).toBeNull();
		}
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
