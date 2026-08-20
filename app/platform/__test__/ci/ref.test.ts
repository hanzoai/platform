/**
 * A build is about ONE git name, and the forge is what says which commit that
 * name holds.
 *
 * Two values used to travel beside each other — a ref and a commit — and only
 * one of them was ever checked. Everything downstream read the unchecked one:
 * `resolveTag` spells the published image from it, `promoteBuild` decides
 * whether a deploy follows from it. So a caller could name a real commit off any
 * branch, call it `main`, and watch it compile, smoke and land in universe with
 * a row that read `main` over a commit main did not carry.
 *
 * The binding below is what makes that unsayable rather than merely refused: a
 * caller states the ref, and the commit is the forge's answer to it. No door
 * takes both — not even the signed one, where the delivery does carry the pair
 * and taking it would save a round-trip. A field a caller can fill is a field to
 * be wrong about, so there is no field, and the answer always comes from the
 * same place.
 */
import {
	enqueueDirectBuild,
	scheduleBuilds,
} from "@hanzo/platform/services/ci/build-scheduler";
import { promoteBuild } from "@hanzo/platform/services/ci/promote";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Production-shaped principals: organization ids are nanoids, never brand
 * names. Which row a name resolves to is what `orgId` reads out of the
 * database; here it is stated, so these tests are about the rules.
 */
const { HANZO, LUX, ids } = vi.hoisted(() => ({
	HANZO: "Yb5GFGDBEwcLsv2O8qWjS",
	LUX: "Lx7QpZm2NvKd8RtYeWc1A",
	ids: new Map<string, string>(),
}));

vi.mock("@hanzo/platform/services/org", async (orig) => {
	const real = await orig<typeof import("@hanzo/platform/services/org")>();
	return {
		...real,
		orgId: vi.fn(async (name: string) => ids.get(real.org(name) ?? "") ?? null),
	};
});

const { rows, launched, pinned, smoked } = vi.hoisted(() => ({
	rows: [] as { repo: string; sha: string; ref: string; image: string }[],
	launched: [] as { repo: string; commit: string; image: string }[],
	pinned: [] as { namespace: string; name: string; image: string }[],
	smoked: [] as string[],
}));

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
		launchBuildJob: vi.fn(async (input: (typeof launched)[number]) => {
			launched.push(input);
			return { jobName: "build-1" };
		}),
	};
});

vi.mock("@hanzo/platform/services/ci/smoke-runner", () => ({
	smoke: vi.fn(async (input: { image: string }) => {
		smoked.push(input.image);
		return { passed: true, reason: "ready", pod: "p" };
	}),
}));

/** The end of the road. Reaching this is what "deployed" means. */
vi.mock("@hanzo/platform/services/ci/pin", () => ({
	commitPin: vi.fn(async (input: (typeof pinned)[number]) => {
		pinned.push(input);
		return {
			committed: true,
			path: "p",
			tag: "t",
			digest: "d",
			reason: "pinned",
		};
	}),
}));

/** The GitHub App reader. Present so the github lane can be asked at all. */
const { githubYaml } = vi.hoisted(() => ({ githubYaml: { value: "" } }));

vi.mock("@hanzo/platform/utils/providers/github", () => ({
	authGithub: vi.fn(() => ({
		rest: {
			repos: {
				getContent: vi.fn(async ({ path }: { path: string }) => {
					if (path !== "hanzo.yml") throw { status: 404 };
					return {
						data: {
							content: Buffer.from(githubYaml.value).toString("base64"),
							encoding: "base64",
						},
					};
				}),
			},
		},
	})),
	appEnvOctokit: vi.fn(() => {
		throw new Error("github must not be probed in these tests");
	}),
}));

/**
 * The GitHub provider row an installation id resolves to. Bound to Hanzo, which
 * is the point: an installation is a credential, and a credential must not be
 * able to lend its organization to a repository of somebody else's.
 */
vi.mock("@hanzo/platform/services/github", () => ({
	findGithubByInstallationId: vi.fn(async () => ({
		githubId: "gh_1",
		gitProvider: { organizationId: HANZO },
	})),
}));

const MAIN = "d1e5f0a9c3b74628ae10fd5c8b3927a4e6d0c1b2";
const SIDE = "3f2b1c9d8e7a6054bd92c1f0a3e5d7b6c4a89012";
const TAGGED = "aa11bb22cc33dd44ee55ff6677889900aabbccdd";

/**
 * A forge holding one repository with `main`, a side branch, and one tag.
 *
 * `refs` is the whole of what it will answer for: a name absent from it does not
 * resolve, which is the same answer the real forge gives for a name nobody
 * pushed.
 */
function forge(
	options: {
		refs?: Record<string, string>;
		yaml?: string;
		cicd?: boolean;
	} = {},
) {
	const refs = options.refs ?? {
		"branches/main": MAIN,
		"branches/wip": SIDE,
		"tags/v1.2.3": TAGGED,
	};
	const yaml =
		options.yaml ??
		`
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "sha-{{git.sha}}"
  push: true
deploy:
  on: [main]
  target:
    cluster: hanzo-k8s
    namespace: hanzo
    operator: hanzo-operator
    crd: App
    name: kms
`;
	const asked: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const at = String(url);
			asked.push(at);
			const which = /\/v1\/repos\/[^/]+\/[^/]+\/((?:branches|tags)\/.+)$/.exec(
				at,
			)?.[1];
			if (which) {
				const sha = refs[decodeURIComponent(which)];
				return sha
					? new Response(JSON.stringify({ commit: { id: sha } }), {
							status: 200,
						})
					: new Response("", { status: 404 });
			}
			if (at.includes("/contents/hanzo.yml")) {
				return new Response(
					JSON.stringify({
						content: Buffer.from(yaml).toString("base64"),
						encoding: "base64",
					}),
					{ status: 200 },
				);
			}
			if (at.includes("/contents/.hanzo/workflows/cicd.yml")) {
				return new Response("{}", { status: options.cicd ? 200 : 404 });
			}
			// The repo lookup, which `ciOwnsBuild` reads `has_actions` from and
			// `readForgeRepoFacts` reads the mirror rows from. Neither is recorded.
			if (/\/v1\/repos\/[^/]+\/[^/]+$/.test(at)) {
				return new Response(JSON.stringify({ has_actions: true }), {
					status: 200,
				});
			}
			return new Response("", { status: 404 });
		}),
	);
	return asked;
}

beforeEach(() => {
	vi.unstubAllGlobals();
	rows.length = 0;
	launched.length = 0;
	pinned.length = 0;
	smoked.length = 0;
	ids.clear();
	ids.set("hanzo", HANZO);
	ids.set("lux", LUX);
	githubYaml.value = "";
	process.env.HANZO_GIT_WEBHOOK_SECRET = "s3cret";
	process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = `hanzo=${HANZO}`;
});

/** Build a ref through the console's door, then take it all the way to a pin. */
async function through(ref: string) {
	forge();
	const result = await scheduleBuilds({
		source: { forge: "hanzo-git" },
		repo: "hanzoai/kms",
		ref,
		requireOrganizationId: HANZO,
	});
	if ("declined" in result) return result;
	const row = {
		...rows[0],
		status: "succeeded",
		imageDigest: `sha256:${"a".repeat(64)}`,
		organizationId: HANZO,
	};
	const config = result.config;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await promoteBuild(row as never, config.deploy);
	return result;
}

describe("the commit a build reads", () => {
	it("is the one the forge says the ref holds", async () => {
		forge();
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(rows[0]?.sha).toBe(MAIN);
		expect(launched[0]?.commit).toBe(MAIN);
	});

	it("changes with the ref, and only with the ref", async () => {
		forge();
		for (const [ref, sha] of [
			["refs/heads/main", MAIN],
			["refs/heads/wip", SIDE],
			["refs/tags/v1.2.3", TAGGED],
		] as const) {
			rows.length = 0;
			await scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref,
				requireOrganizationId: HANZO,
			});
			expect(rows[0]?.sha, ref).toBe(sha);
		}
	});

	it("is refused when the ref names nothing on the forge", async () => {
		forge();
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref: "refs/heads/does-not-exist",
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/names no commit/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("is refused when the caller states something that is not a ref", async () => {
		forge();
		for (const ref of [
			SIDE,
			"main",
			"heads/main",
			"refs/remotes/origin/main",
			"refs/pull/1/head",
			"",
		]) {
			await expect(
				scheduleBuilds({
					source: { forge: "hanzo-git" },
					repo: "hanzoai/kms",
					ref,
					requireOrganizationId: HANZO,
				}),
				ref,
			).rejects.toThrow(/does not name a branch or a tag/i);
		}
		expect(rows).toHaveLength(0);
	});

	it("is asked of the forge by exact name, not by prefix", async () => {
		// A ref listing answers by prefix, so `heads/mai` would come back holding
		// `main`'s commit — a name resolving to a neighbour's commit is the whole
		// thing this binding exists to prevent.
		const asked = forge();
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(asked).toContain(
			"https://git.hanzo.ai/v1/repos/hanzoai/kms/branches/main",
		);
		expect(asked.some((u) => u.includes("/git/refs"))).toBe(false);
	});
});

describe("a fabricated branch and commitPin", () => {
	it("cannot be stated: the door takes a ref, and the forge answers for the commit", async () => {
		forge();
		// The shape of the old attack, written out: a real commit off a side
		// branch, called `main`. Passed straight to the scheduler, past the router
		// that would have stripped the extra keys, because a rule that only holds
		// at one door is not the rule this is about.
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			sha: SIDE,
			branch: "main",
			requireOrganizationId: HANZO,
		} as never);
		// Both extra values land nowhere. The row is `refs/heads/main` over the
		// commit main actually holds, and the image is named after that commit.
		expect(rows[0]).toMatchObject({
			ref: "refs/heads/main",
			sha: MAIN,
			image: `ghcr.io/hanzoai/kms:sha-${MAIN}`,
		});
		expect(rows.map((r) => r.sha)).not.toContain(SIDE);
		expect(launched[0]?.commit).toBe(MAIN);
	});

	it("does not deploy a side branch under main's name", async () => {
		// End to end, through the real scheduler and the real promotion: the row
		// is about `refs/heads/wip`, so the commit is wip's and `deploy.on: [main]`
		// has nothing to match. Nothing is smoked and nothing is written down.
		await through("refs/heads/wip");
		expect(rows[0]?.sha).toBe(SIDE);
		expect(smoked).toEqual([]);
		expect(pinned).toEqual([]);
	});

	it("deploys main, so the refusal above is a refusal and not an outage", async () => {
		await through("refs/heads/main");
		expect(rows[0]?.sha).toBe(MAIN);
		expect(pinned).toHaveLength(1);
		expect(pinned[0]).toMatchObject({ namespace: "hanzo", name: "kms" });
	});

	it("publishes a tag without deploying it", async () => {
		await through("refs/tags/v1.2.3");
		expect(rows[0]?.sha).toBe(TAGGED);
		expect(launched).toHaveLength(1);
		expect(pinned).toEqual([]);
	});
});

describe("the image name follows the ref", () => {
	it("spells a version only on the push that made the tag", async () => {
		forge({
			yaml: `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "{{git.tag}}"
  push: true
`,
		});
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/tags/v1.2.3",
			requireOrganizationId: HANZO,
		});
		expect(rows[0]?.image).toBe("ghcr.io/hanzoai/kms:v1.2.3");
	});

	it("names nothing on a branch push, and the push still succeeds", async () => {
		forge({
			yaml: `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "{{git.tag}}"
  push: true
`,
		});
		const result = await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(result).not.toHaveProperty("declined");
		expect(rows).toHaveLength(0);
	});

	it("refuses a config that asks for a branch name", async () => {
		// A branch head is the one git name that moves, so no token spells one.
		// Refused where the config is read, which is where its author can be told.
		forge({
			yaml: `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "{{git.branch}}"
  push: true
`,
		});
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref: "refs/tags/v1.2.3",
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/not a tag token/i);
		expect(rows).toHaveLength(0);
	});
});

describe("the organization a build acts as", () => {
	it("is the repository's on the github lane, not the installation's", async () => {
		// An installation is a CREDENTIAL. Read as an identity, one bound to Hanzo
		// hands Hanzo's principal to any repository it can see — and the repository
		// is caller input, so the row said Hanzo while the image said lux and the
		// pod mounted `push-luxfi` to publish it.
		githubYaml.value = `
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/luxfi/node
  tag-pattern: "sha-{{git.sha}}"
  push: true
`;
		forge({ refs: { "branches/main": MAIN } });
		await expect(
			scheduleBuilds({
				source: { forge: "github", installationId: "1" },
				repo: "luxfi/node",
				ref: "refs/heads/main",
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/another organization/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("is the repository's on the forge lane too — one answer, both lanes", async () => {
		forge({ refs: { "branches/main": MAIN } });
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "luxfi/node",
				ref: "refs/heads/main",
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/another organization/i);
		expect(rows).toHaveLength(0);
	});

	it("lets lux build lux through the github lane", async () => {
		// The positive control: the installation is still Hanzo's, and it is still
		// what reads the file. Who the build IS comes from `luxfi/node`.
		githubYaml.value = `
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/luxfi/node
  tag-pattern: "sha-{{git.sha}}"
  push: true
`;
		forge({ refs: { "branches/main": MAIN } });
		await scheduleBuilds({
			source: { forge: "github", installationId: "1" },
			repo: "luxfi/node",
			ref: "refs/heads/main",
			requireOrganizationId: LUX,
		});
		expect(rows[0]).toMatchObject({
			organizationId: LUX,
			image: `ghcr.io/luxfi/node:sha-${MAIN}`,
		});
	});
});

describe("the direct door", () => {
	const direct = {
		repo: "hanzoai/kms",
		image: `ghcr.io/hanzoai/kms:sha-${MAIN}`,
		requireOrganizationId: HANZO,
	};

	it("resolves its commit from the forge, like every other door", async () => {
		forge();
		await enqueueDirectBuild({ ...direct, ref: "refs/heads/main" });
		expect(rows[0]).toMatchObject({ sha: MAIN, ref: "refs/heads/main" });
	});

	it("refuses a ref the forge does not resolve", async () => {
		forge();
		await expect(
			enqueueDirectBuild({ ...direct, ref: "refs/heads/nope" }),
		).rejects.toThrow(/names no commit/i);
		expect(rows).toHaveLength(0);
	});

	it("refuses a name claiming a commit this build did not read", async () => {
		// The stated image is a claim about the commit, so it is judged against
		// the commit the forge answered with rather than against a shape.
		forge();
		await expect(
			enqueueDirectBuild({
				...direct,
				ref: "refs/heads/main",
				image: `ghcr.io/hanzoai/kms:sha-${SIDE}`,
			}),
		).rejects.toThrow(/does not name this build/i);
		expect(rows).toHaveLength(0);
	});

	it("asks the canonical-source question, the same one the delivery lane asks", async () => {
		// A repo whose mirror row is gone serves its last state forever, and the
		// build off it looks exactly like a healthy one. `appEnvOctokit` throws in
		// this file, so reaching the probe is visible: here the repo declares
		// `source: forge` and answers for itself.
		forge();
		await enqueueDirectBuild({ ...direct, ref: "refs/heads/main" });
		expect(rows).toHaveLength(1);

		rows.length = 0;
		forge({
			yaml: 'build:\n  matrix:\n    - { os: linux, arch: amd64 }\n  image: ghcr.io/hanzoai/kms\n  tag-pattern: "sha-{{git.sha}}"\n',
		});
		await expect(
			enqueueDirectBuild({ ...direct, ref: "refs/heads/main" }),
		).rejects.toThrow(/github must not be probed/);
		expect(rows).toHaveLength(0);
	});
});

describe("hanzoai/ci owns an image, whichever path publishes it", () => {
	it("yields when the repository the IMAGE names carries the caller", async () => {
		// `ghcr.io/hanzoai/kms` is published by `hanzo/kms` and by `hanzoai/kms`.
		// Asked only about the path a caller typed, naming the twin without a
		// cicd.yml built the gated image on the ungated lane.
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				const at = String(url);
				if (/\/branches\/main$/.test(at)) {
					return new Response(JSON.stringify({ commit: { id: MAIN } }), {
						status: 200,
					});
				}
				if (at.includes("/contents/hanzo.yml")) {
					const yaml =
						'source: forge\nbuild:\n  matrix:\n    - { os: linux, arch: amd64 }\n  image: ghcr.io/hanzoai/kms\n  tag-pattern: "sha-{{git.sha}}"\n';
					return new Response(
						JSON.stringify({
							content: Buffer.from(yaml).toString("base64"),
							encoding: "base64",
						}),
						{ status: 200 },
					);
				}
				if (at.includes("/contents/.hanzo/workflows/cicd.yml")) {
					// Only the repository the image names carries it.
					return new Response("{}", {
						status: at.includes("/repos/hanzoai/kms/") ? 200 : 404,
					});
				}
				if (/\/v1\/repos\/[^/]+\/[^/]+$/.test(at)) {
					return new Response(JSON.stringify({ has_actions: true }), {
						status: 200,
					});
				}
				return new Response("", { status: 404 });
			}),
		);
		const result = await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzo/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(result).toMatchObject({ declined: "ci-owns" });
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});
});
