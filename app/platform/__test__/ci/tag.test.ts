import { tagProblem } from "@hanzo/platform/services/org";
import { describe, expect, it } from "vitest";

/**
 * The name a first-party image publishes under names one build.
 *
 * A tag is how a running binary is traced back to the source that made it, so it
 * has to hold on to something: a version a git tag also names, or the commit the
 * build read. Both name one set of bytes for good. `latest`, a branch name and a
 * bare major do not — they are names that move, and a deploy under a name that
 * moves is one nobody can find their way back from.
 *
 * ONE rule, and every door asks it: the forge delivery, the console's trigger,
 * and the direct enqueue. What a caller may state and what a `tag-pattern` may
 * produce are the same question, so they get the same answer.
 */
describe("tagProblem", () => {
	it("takes a version, however it is spelled", () => {
		for (const img of [
			"ghcr.io/hanzoai/kms-operator:v0.4.3",
			"ghcr.io/luxfi/node:v1.36.49",
			"ghcr.io/hanzoai/platform:4.4.10",
			"ghcr.io/zooai/ngo:v2.0.1",
			"GHCR.IO/hanzoai/platform:v4.4.25",
			"ghcr.io/LUXFI/node:v1.36.49",
			// A pre-release and a fourth part still carry the version they extend.
			"ghcr.io/luxfi/node:v1.36.2-hotfix",
			"ghcr.io/hanzoai/datastore:26.2.3.2",
			"ghcr.io/hanzoai/console:3.158.0-amd64",
		]) {
			expect(tagProblem(img), img).toBeNull();
		}
	});

	it("takes the commit a build read", () => {
		// What every lane of this service produces by default. A tag naming the
		// commit is the strongest traceability there is — stronger than a version,
		// which is a promise about a commit.
		for (const img of [
			`ghcr.io/hanzoai/kms:sha-${"a".repeat(40)}`,
			"ghcr.io/hanzoai/iam:sha-ba43c54",
			`ghcr.io/hanzoai/bootnode:${"9f8e7d6".padEnd(40, "0")}-amd64-api`,
			"ghcr.io/luxfi/dao-vote:lux-f36fd77",
		]) {
			expect(tagProblem(img), img).toBeNull();
		}
	});

	it("takes a digest — stronger than any tag", () => {
		expect(tagProblem("ghcr.io/luxfi/node@sha256:0123456789abcdef")).toBeNull();
	});

	it("refuses a name that moves", () => {
		for (const img of [
			"ghcr.io/hanzoai/kms-operator:latest",
			"ghcr.io/luxfi/bridge:main",
			"ghcr.io/hanzoai/console:stable",
			"ghcr.io/hanzoai/console:nightly",
			"ghcr.io/hanzoai/console:edge",
			"ghcr.io/hanzoai/kv:9",
			"ghcr.io/hanzoai/image-prepull:1.36",
			"ghcr.io/hanzoai/console:release-candidate",
		]) {
			expect(tagProblem(img), img).toMatch(/refusing/i);
		}
	});

	it("refuses a first-party image with no tag at all", () => {
		// An untagged push publishes as `:latest`, which is the one name this rule
		// exists to keep off our registries.
		expect(tagProblem("ghcr.io/hanzoai/platform")).toContain("no tag");
	});

	it("does not judge upstream images — their tags are their publishers' business", () => {
		for (const img of [
			"docker.io/library/busybox:1.36",
			"postgres:16-alpine",
			"moby/buildkit:v0.16.0",
			"rclone/rclone:1.68",
		]) {
			expect(tagProblem(img), img).toBeNull();
		}
	});

	it("does not mistake a registry port for a tag", () => {
		expect(tagProblem("registry.example.com:5000/foo/bar:v1.0.0")).toBeNull();
	});

	it("reads the namespace the way the push credential reads it", () => {
		// The rule and the credential must agree about which image this is: the
		// credential is derived through `imageOrg`, so the rule is read through
		// `imageOrg` too. A spelling one accepts and the other does not is a
		// destination that publishes with a real token under a name that moves.
		for (const img of [
			"GHCR.IO/hanzoai/platform:latest",
			"ghcr.io/HanzoAI/platform:latest",
			"Ghcr.Io/HANZOAI/platform:main",
			"ghcr.io:443/hanzoai/platform:latest",
		]) {
			expect(tagProblem(img), img).toMatch(/refusing/i);
		}
	});
});
