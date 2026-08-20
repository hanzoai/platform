import {
	enqueueDirectBuild,
	scheduleBuilds,
} from "@hanzo/platform/services/ci/build-scheduler";
import { buildkitArgs } from "@hanzo/platform/services/ci/buildkit-job";
import { repoName, repoProblem } from "@hanzo/platform/services/hanzo-git";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { launched, rows } = vi.hoisted(() => ({
	launched: [] as { repo: string; image: string }[],
	rows: [] as { repo: string; organizationId: string; runnerPool: string }[],
}));

/**
 * Which organization row a name resolves to is a database read, and this file
 * is about repository paths. `destination.test.ts` covers the ownership rules
 * and `org.realdb.test.ts` covers the read; here Hanzo simply has a row.
 */
const ORG = "Yb5GFGDBEwcLsv2O8qWjS";

vi.mock("@hanzo/platform/services/org", async (orig) => {
	const real = await orig<typeof import("@hanzo/platform/services/org")>();
	return {
		...real,
		orgId: vi.fn(async (name: string) =>
			real.org(name) === "hanzo" ? ORG : null,
		),
	};
});

vi.mock("@hanzo/platform/services/ci/build-job", () => ({
	findBuildJobByTarget: vi.fn(async () => undefined),
	createBuildJob: vi.fn(async (row: Record<string, unknown>) => {
		rows.push(row as (typeof rows)[number]);
		return { ...row, buildJobId: "bj_1" };
	}),
	updateBuildJob: vi.fn(
		async (_id: string, patch: Record<string, unknown>) => patch,
	),
}));

vi.mock("@hanzo/platform/services/ci/buildkit-job", async (orig) => {
	const real =
		await orig<typeof import("@hanzo/platform/services/ci/buildkit-job")>();
	return {
		...real,
		launchBuildJob: vi.fn(async (input: { repo: string; image: string }) => {
			launched.push(input);
			return { jobName: "build-kms-bj1" };
		}),
	};
});

const SHA = "0".repeat(40);
/** The one git name a caller states. The forge answers for the commit. */
const REF = "refs/heads/main";

/** Forge-primary so the build reads the forge and compares against nothing else. */
const CONFIG = `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "v9.9.9"
  push: true
`;

/** Serve `hanzo.yml` from any repository asked for, and record every URL. */
function serveForge(): string[] {
	const seen: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, _init?: RequestInit) => {
			seen.push(String(url));
			if (/\/branches\/[^/]+$/.test(String(url))) {
				return new Response(JSON.stringify({ commit: { id: SHA } }), {
					status: 200,
				});
			}
			if (String(url).includes("/contents/hanzo.yml")) {
				return new Response(
					JSON.stringify({
						content: Buffer.from(CONFIG).toString("base64"),
						encoding: "base64",
					}),
					{ status: 200 },
				);
			}
			return new Response("", { status: 404 });
		}),
	);
	return seen;
}

/** The `owner/name` a forge API url addresses. */
function addressed(url: string): string {
	const m = /\/v1\/repos\/([^/]+)\/([^/?]+)/.exec(url);
	return m ? `${m[1]}/${m[2]}` : "";
}

beforeEach(() => {
	vi.unstubAllGlobals();
	launched.length = 0;
	rows.length = 0;
	process.env.HANZO_GIT_WEBHOOK_SECRET = "s3cret";
});

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

	it("refuses a suffix that names something beside the repository", () => {
		// `.git` the git context appends; `.wiki` is the repository's wiki, which
		// is a repository of its own with its own contents. Neither is the
		// repository at `owner/name`, which is the only thing a build reads.
		// The forge reads a name without regard to case, so this rule does too —
		// it decides about the same name `repoName` resolves to.
		for (const repo of [
			"hanzoai/platform.git",
			"hanzoai/platform.wiki",
			"hanzoai/platform.GIT",
			"hanzoai/platform.WIKI",
			"hanzoai/platform.Wiki",
		]) {
			expect(repoProblem(repo), repo).toBeTruthy();
			expect(repoProblem(repoName(repo)), repo).toBeTruthy();
		}
	});
});

describe("buildkitArgs", () => {
	const base = {
		commit: SHA,
		image: "ghcr.io/hanzoai/pricing:v1.0.0",
		buildJobId: "bj_1",
	};

	it("clones the repository it was given", () => {
		expect(buildkitArgs({ ...base, repo: "hanzoai/pricing" })).toContain(
			`--opt=context=https://git.hanzo.ai/hanzoai/pricing.git#${SHA}`,
		);
	});

	it("builds no context from a value that names no repository", () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"hanzoai/platform#refs/heads/other",
			"hanzoai/../../secrets",
			"hanzoai/platform.wiki",
			"spa",
			"",
		]) {
			expect(() => buildkitArgs({ ...base, repo }), repo).toThrow();
		}
	});
});

describe("scheduleBuilds", () => {
	it("writes no row for a value that names no repository", async () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"hanzoai/platform#refs/heads/other",
			"hanzoai/../../secrets",
			"hanzoai/platform.wiki",
			"spa",
		]) {
			await expect(
				scheduleBuilds({
					source: { forge: "github", installationId: "1" },
					repo,
					ref: REF,
				}),
				repo,
			).rejects.toThrow(/does not name a repository/i);
			expect(rows, repo).toHaveLength(0);
			expect(launched, repo).toHaveLength(0);
		}
	});

	it("clones the repository whose config it read", async () => {
		// `hanzo/kms` and `hanzoai/kms` are two repositories on the forge, with
		// their own contents. The config says what to build and the git context
		// is what gets built, so they come from the same one.
		const seen = serveForge();
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: REF,
		});
		const read = seen.find((u) => u.includes("/contents/hanzo.yml"));
		expect(addressed(read ?? "")).toBe("hanzo/kms");
		expect(launched).toHaveLength(1);
		expect(launched[0]?.repo).toBe("hanzo/kms");
	});

	it("reads and clones one repository however the caller spelled it", async () => {
		const seen = serveForge();
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "HanzoAI/KMS",
			ref: REF,
		});
		const read = seen.find((u) => u.includes("/contents/hanzo.yml"));
		expect(addressed(read ?? "")).toBe("hanzoai/kms");
		expect(launched[0]?.repo).toBe("hanzoai/kms");
	});
});

describe("enqueueDirectBuild", () => {
	const direct = {
		ref: REF,
		image: "ghcr.io/hanzoai/kms:v9.9.9",
		requireOrganizationId: ORG,
	};

	it("writes no row for a value that names no repository", async () => {
		for (const repo of [
			"https://github.com/hanzoai/spa.git",
			"hanzoai/platform#refs/heads/other",
			"hanzoai/../../secrets",
			"hanzoai/platform.wiki",
			"hanzoai/platform.WIKI",
			"spa",
		]) {
			await expect(
				enqueueDirectBuild({ ...direct, repo }),
				repo,
			).rejects.toThrow(/does not name a repository/i);
			expect(rows, repo).toHaveLength(0);
			expect(launched, repo).toHaveLength(0);
		}
	});

	it("refuses a caller acting as an organization that does not own the build", async () => {
		await expect(
			enqueueDirectBuild({
				...direct,
				repo: "hanzo/kms",
				requireOrganizationId: "someone-elses-org",
			}),
		).rejects.toThrow(/another organization/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("owns the build by the repository, not by what the caller named", async () => {
		// `organizationId` on the row is what later gates reading this build's
		// logs, so it comes from the repository — a caller only confirms it.
		serveForge();
		await enqueueDirectBuild({
			...direct,
			repo: "hanzo/kms",
			requireOrganizationId: ORG,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.organizationId).toBe(ORG);
		expect(rows[0]?.repo).toBe("hanzo/kms");
		expect(rows[0]?.runnerPool).toBe("hanzo-build-linux-amd64");
		expect(launched[0]?.repo).toBe("hanzo/kms");
	});
});

describe("repoName", () => {
	it("gives one name to the spellings the forge resolves alike", () => {
		expect(repoName("HanzoAI/KMS")).toBe("hanzoai/kms");
		expect(repoName("hanzoai/kms")).toBe("hanzoai/kms");
	});
});
