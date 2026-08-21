/**
 * Which side is canonical is a fact about the REPOSITORY, not about the commit
 * in hand.
 *
 * `source:` decides whether a build is compared against github.com at all, and
 * it is written in a file that travels with the code. Read at the commit being
 * built, the commit answers the question asked about it: one line added to a
 * pushed branch turns the comparison off, and the build proceeds off whatever
 * the forge happens to be holding — the exact state a frozen mirror leaves a
 * repository in.
 *
 * `ciOwnsBuild` already reads its fact at the default branch for this reason,
 * and this is the same reason. The repository's own default branch is where a
 * repository says what it is; a side branch is where a commit says what it
 * would like to be.
 */
import { scheduleBuilds } from "@hanzo/platform/services/ci/build-scheduler";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HANZO = "Yb5GFGDBEwcLsv2O8qWjS";

vi.mock("@hanzo/platform/services/org", async (orig) => {
	const real = await orig<typeof import("@hanzo/platform/services/org")>();
	return { ...real, orgId: vi.fn(async () => HANZO) };
});

const { rows } = vi.hoisted(() => ({ rows: [] as { image: string }[] }));

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

vi.mock("@hanzo/platform/services/ci/buildkit-job", async (orig) => ({
	...(await orig<typeof import("@hanzo/platform/services/ci/buildkit-job")>()),
	launchBuildJob: vi.fn(async () => ({ jobName: "build-1" })),
}));

vi.mock("@hanzo/platform/utils/providers/github", () => ({
	authGithub: vi.fn(),
	appEnvOctokit: vi.fn(),
}));

const { probe } = vi.hoisted(() => ({
	probe: { asked: [] as string[], reachable: false },
}));

vi.mock("@hanzo/platform/services/ci/forge-source-probe", async (orig) => {
	const real =
		await orig<
			typeof import("@hanzo/platform/services/ci/forge-source-probe")
		>();
	return {
		...real,
		githubReachability: vi.fn(async (repo: string, sha: string) => {
			probe.asked.push(`${repo}@${sha}`);
			return probe.reachable
				? { kind: "reachable" as const }
				: {
						kind: "unreachable" as const,
						head: "f".repeat(40),
						relation: "the two have diverged",
					};
		}),
	};
});

const PUSHED = "c0ffee11223344556677889900aabbccddeeff01";

const BUILD = `build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "sha-{{git.sha}}"
  push: true
`;

/**
 * A forge holding one repository that is a pull mirror of github.com — the
 * ordinary state, where the comparison is meant to run.
 *
 * `yamlAt` answers per REF, which is the whole mechanism: the pushed branch and
 * the default branch may say different things, and which of the two is read is
 * what this test is about.
 */
function forge(yamlAt: Record<string, string>) {
	const asked: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const at = new URL(String(url));
			const path = at.pathname;
			asked.push(`${path}${at.search}`);
			if (/\/(branches|tags)\/[^/]+$/.test(path)) {
				return new Response(JSON.stringify({ commit: { id: PUSHED } }), {
					status: 200,
				});
			}
			if (path.endsWith("/contents/hanzo.yml")) {
				const ref = at.searchParams.get("ref") ?? "";
				const yaml = yamlAt[ref];
				if (!yaml) return new Response("", { status: 404 });
				return new Response(
					JSON.stringify({
						content: Buffer.from(yaml).toString("base64"),
						encoding: "base64",
					}),
					{ status: 200 },
				);
			}
			if (path.endsWith("/contents/.hanzo/workflows/cicd.yml")) {
				return new Response("", { status: 404 });
			}
			if (path.endsWith("/push_mirrors")) {
				return new Response("[]", { status: 200 });
			}
			if (/^\/v1\/repos\/[^/]+\/[^/]+$/.test(path)) {
				return new Response(
					JSON.stringify({
						has_actions: true,
						default_branch: "main",
						mirror: true,
						original_url: "https://github.com/hanzoai/kms",
					}),
					{ status: 200 },
				);
			}
			return new Response("", { status: 404 });
		}),
	);
	return asked;
}

beforeEach(() => {
	vi.unstubAllGlobals();
	rows.length = 0;
	probe.asked.length = 0;
	probe.reachable = false;
	process.env.HANZO_GIT_WEBHOOK_SECRET = "s3cret";
	process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = `hanzo=${HANZO}`;
});

function push(ref = "refs/heads/wip") {
	return scheduleBuilds({
		source: { forge: "hanzo-git" },
		repo: "hanzoai/kms",
		ref,
		requireOrganizationId: HANZO,
	});
}

describe("where `source:` is read", () => {
	it("does not let the pushed commit exempt itself from the comparison", async () => {
		forge({
			// The default branch says nothing — this repository is compared.
			main: BUILD,
			// The pushed commit adds the one line that would turn that off.
			[PUSHED]: `source: forge\n${BUILD}`,
		});
		await expect(push()).rejects.toThrow(/not on github\.com/i);
		expect(rows).toHaveLength(0);
		expect(probe.asked).toEqual([`hanzoai/kms@${PUSHED}`]);
	});

	it("honours a declaration the repository itself carries", async () => {
		forge({
			// The repository says it is forge-primary, on its default branch.
			main: `source: forge\n${BUILD}`,
			[PUSHED]: BUILD,
		});
		await expect(push()).resolves.toMatchObject({ organizationId: HANZO });
		// Declared forge-primary, so GitHub is never asked.
		expect(probe.asked).toEqual([]);
		expect(rows).toHaveLength(1);
	});

	it("reads the declaration from the default branch, whichever ref was pushed", async () => {
		const asked = forge({ main: `source: forge\n${BUILD}`, [PUSHED]: BUILD });
		await push();
		expect(asked).toContain(
			"/v1/repos/hanzoai/kms/contents/hanzo.yml?ref=main",
		);
	});

	it("still compares a repository whose default branch declares nothing", async () => {
		forge({ main: BUILD, [PUSHED]: BUILD });
		probe.reachable = true;
		await expect(push()).resolves.toMatchObject({ organizationId: HANZO });
		expect(probe.asked).toEqual([`hanzoai/kms@${PUSHED}`]);
	});
});
