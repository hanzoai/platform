import { scheduleBuilds } from "@hanzo/platform/services/ci/build-scheduler";
import { buildkitArgs } from "@hanzo/platform/services/ci/buildkit-job";
import { repoProblem } from "@hanzo/platform/services/hanzo-git";
import { describe, expect, it } from "vitest";

/**
 * A build reads one repository: the one that authorized it.
 *
 * Two facts decide a build — the `hanzo.yml` that says what to build, read from
 * the forge at a repository path, and the git context BuildKit clones. They
 * name one repository, so what runs is what the config described.
 *
 * The path is the whole of what a build reads, so it is `owner/name` under the
 * forge and nothing else: no scheme, no host, no second fragment, no traversal.
 */

describe("repoProblem", () => {
	it("accepts an owner/name path, on either org spelling the forge serves", () => {
		for (const repo of [
			"hanzoai/platform",
			"hanzo/universe",
			"luxfi/node",
			"zooai/ngo",
			"hanzoai/o11y",
			"hanzoai/kms-operator",
			"hanzoai/z_chain",
		]) {
			expect(repoProblem(repo), repo).toBeNull();
		}
	});

	it("refuses anything that is not exactly two non-empty segments", () => {
		for (const repo of [
			"",
			"platform",
			"hanzoai/",
			"/platform",
			"hanzoai/platform/e2e",
			"hanzoai//platform",
		]) {
			expect(repoProblem(repo), repo).toBeTruthy();
		}
	});

	it("refuses a URL where a repository path belongs", () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"git@git.hanzo.ai:hanzoai/spa.git",
			"//evil.example.com/hanzoai/spa",
		]) {
			expect(repoProblem(repo), repo).toBeTruthy();
		}
	});

	it("refuses a path carrying anything but a name", () => {
		for (const repo of [
			"hanzoai/platform#refs/heads/other",
			"hanzoai/platform?ref=other",
			"hanzoai/../../etc/passwd",
			"hanzoai/..",
			"hanzoai/plat form",
			"hanzoai/platform\n",
			"hanzoai/pl@tform",
		]) {
			expect(repoProblem(repo), repo).toBeTruthy();
		}
	});

	it("refuses a `.git` suffix, because the context appends one", () => {
		expect(repoProblem("hanzoai/platform.git")).toBeTruthy();
	});
});

describe("buildkitArgs", () => {
	const base = {
		gitRef: "refs/heads/main",
		image: "ghcr.io/hanzoai/pricing:v1.0.0",
		buildJobId: "bj_1",
	};

	it("clones the repository it was given", () => {
		expect(buildkitArgs({ ...base, repo: "hanzoai/pricing" })).toContain(
			"--opt=context=https://git.hanzo.ai/hanzoai/pricing.git#refs/heads/main",
		);
	});

	it("builds no context from a value that names no repository", () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"hanzoai/platform#refs/heads/other",
			"hanzoai/../../secrets",
			"spa",
			"",
		]) {
			expect(() => buildkitArgs({ ...base, repo }), repo).toThrow();
		}
	});
});

describe("scheduleBuilds", () => {
	const commit = {
		sha: "0".repeat(40),
		ref: "refs/heads/main",
		branch: "main",
	};

	it("writes no row for a value that names no repository", async () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"hanzoai/platform#refs/heads/other",
			"hanzoai/../../secrets",
			"spa",
		]) {
			await expect(
				scheduleBuilds({
					source: { forge: "github", installationId: "1" },
					repo,
					...commit,
				}),
				repo,
			).rejects.toThrow(/does not name a repository/i);
		}
	});

	it("refuses when the config path and the build name different repositories", async () => {
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git", sourceRepo: "hanzo/universe" },
				repo: "hanzoai/kms",
				...commit,
			}),
		).rejects.toThrow(/one repository/i);
	});

	it("takes the canonical name of the forge path", async () => {
		// `hanzo/kms` on the forge is `hanzoai/kms` everywhere downstream: the
		// pair every delivery carries. It passes the tie and goes on to read the
		// config, which is a different question and fails for its own reasons here.
		const err = await scheduleBuilds({
			source: { forge: "hanzo-git", sourceRepo: "hanzo/kms" },
			repo: "hanzoai/kms",
			...commit,
		}).catch((e: unknown) => e);
		expect(String((err as Error | undefined)?.message ?? "")).not.toMatch(
			/one repository/i,
		);
	});
});
