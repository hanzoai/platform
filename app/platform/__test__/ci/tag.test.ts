import { tagProblem } from "@hanzo/platform/services/org";
import { describe, expect, it } from "vitest";

/**
 * The name a first-party image publishes under names one build — this one.
 *
 * A tag is how a running binary is traced back to the source that made it, so it
 * has to hold on to something: a version, or the commit the build read. Both
 * name one set of bytes for good. `latest`, a branch name and a bare major do
 * not — they are names that move, and a deploy under a name that moves is one
 * nobody can find their way back from.
 *
 * ONE rule, and every door asks it: the forge delivery, the console's trigger,
 * and the direct enqueue. What a caller may state and what a `tag-pattern` may
 * produce are the same question, so they get the same answer.
 */

/** The commit under test. Every commit-shaped tag below has to be its. */
const SHA = "7c50638eb180f3d6b0cb95102032d95f91f1cc7f";

describe("tagProblem — a version", () => {
	it("takes one, however it is spelled", () => {
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
			expect(tagProblem(img, SHA), img).toBeNull();
		}
	});

	it("refuses a name that merely CONTAINS one", () => {
		// Read as a substring, each of these is a version. Read whole, each is a
		// name something else moves, with a version sitting inside it as
		// decoration — and it is the name that gets pulled, not the decoration.
		for (const img of [
			"ghcr.io/hanzoai/console:release-1.2.3",
			"ghcr.io/hanzoai/console:latest-1.0.0",
			"ghcr.io/hanzoai/console:main-0.0.0",
			"ghcr.io/hanzoai/console:nightly-2.1.0",
		]) {
			expect(tagProblem(img, SHA), img).toMatch(/does not name this build/i);
		}
	});
});

describe("tagProblem — the commit a build read", () => {
	it("takes the commit, wherever the declared decoration puts it", () => {
		// What every lane of this service produces by default. A tag naming the
		// commit is the strongest traceability there is — stronger than a version,
		// which is a promise about a commit. The shapes are the fleet's: the bare
		// id, `sha-<id>`, the `{{git.sha}}-<arch>-<name>` matrix form, and a
		// brand prefix.
		for (const tag of [
			SHA,
			`sha-${SHA}`,
			"sha-7c50638",
			`${SHA}-amd64-api`,
			"lux-7c50638eb180",
		]) {
			const img = `ghcr.io/hanzoai/kms:${tag}`;
			expect(tagProblem(img, SHA), img).toBeNull();
		}
	});

	it("refuses hex that names some OTHER commit", () => {
		// The point of taking the sha. Hex alone says only that a string looks
		// like an object id; the row already knows which one this build read, so a
		// tag claiming a different provenance is refused rather than published.
		for (const tag of [
			"0123456789abcdef",
			`sha-${"a".repeat(40)}`,
			"sha-ba43c54",
			"lux-f36fd77",
		]) {
			const img = `ghcr.io/hanzoai/kms:${tag}`;
			expect(tagProblem(img, SHA), img).toMatch(/does not name this build/i);
		}
	});

	it("refuses hex that is a word somebody chose", () => {
		// `deadbeef` and `cafebabe` are hex, and neither names a build. Read as
		// "does this look like an object id" they both passed; read as "is this
		// the object id this build read" neither does.
		for (const tag of ["deadbeef", "cafebabe", "acce55ed", "0ff1ce"]) {
			const img = `ghcr.io/hanzoai/kms:${tag}`;
			expect(tagProblem(img, SHA), img).toMatch(/does not name this build/i);
		}
	});

	it("takes hex that IS this commit even when it reads like a word", () => {
		// The rule is about the commit, not about how the hex reads. A build of
		// `deadbeef…` publishes `deadbeef` and traces straight back.
		const beef = "deadbeef".padEnd(40, "0");
		expect(tagProblem("ghcr.io/hanzoai/kms:deadbeef", beef)).toBeNull();
	});
});

describe("tagProblem — a name that moves", () => {
	it("refuses it", () => {
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
			expect(tagProblem(img, SHA), img).toMatch(/refusing/i);
		}
	});

	it("refuses a first-party image with no tag at all", () => {
		// An untagged push publishes as `:latest`, which is the one name this rule
		// exists to keep off our registries.
		expect(tagProblem("ghcr.io/hanzoai/platform", SHA)).toContain("no tag");
	});

	it("refuses one that a digest is written beside", () => {
		// A destination is a TAG. A digest is what the registry answers WITH after
		// a push, not something a push can ask for, so a digest here decides
		// nothing and hides the tag that does — this reference publishes `latest`.
		expect(
			tagProblem(
				`ghcr.io/hanzoai/platform:latest@sha256:${"0".repeat(64)}`,
				SHA,
			),
		).toMatch(/refusing/i);
	});

	it("refuses a reference that is only a digest", () => {
		// Nothing to push to. A digest names bytes that already exist.
		expect(
			tagProblem(`ghcr.io/luxfi/node@sha256:${"0".repeat(64)}`, SHA),
		).toContain("no tag");
	});
});

describe("tagProblem — whose image it is", () => {
	it("does not judge upstream images — their tags are their publishers' business", () => {
		for (const img of [
			"docker.io/library/busybox:1.36",
			"postgres:16-alpine",
			"moby/buildkit:v0.16.0",
			"rclone/rclone:1.68",
		]) {
			expect(tagProblem(img, SHA), img).toBeNull();
		}
	});

	it("does not mistake a registry port for a tag", () => {
		expect(
			tagProblem("registry.example.com:5000/foo/bar:v1.0.0", SHA),
		).toBeNull();
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
			expect(tagProblem(img, SHA), img).toMatch(/refusing/i);
		}
	});
});
