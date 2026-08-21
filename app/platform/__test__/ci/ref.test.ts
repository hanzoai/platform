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
import { commitAt, refProblem } from "@hanzo/platform/services/hanzo-git";
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

/**
 * The GitHub App reader, and what GitHub says about who holds a repository.
 *
 * `held` is the installation GitHub names for whatever repository is asked
 * about — the answer `/repos/{owner}/{repo}/installation` gives. It defaults to
 * the installation these tests deliver as, so a test that is about something
 * else is not also about entitlement.
 */
const { githubYaml, held } = vi.hoisted(() => ({
	githubYaml: { value: "" },
	held: { by: 1 as number | null, status: 404 },
}));

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
			apps: {
				getRepoInstallation: vi.fn(async () => {
					if (held.by === null) {
						throw Object.assign(new Error("github said no"), {
							status: held.status,
						});
					}
					return { data: { id: held.by } };
				}),
			},
		},
	})),
	appEnvOctokit: vi.fn(),
}));

/**
 * Is the commit on the canonical GitHub branch? Recorded and answerable, so a
 * test can show the question was ASKED and what each answer costs — "the check
 * ran and said yes" and "no check ran" must not look alike.
 */
const { probe } = vi.hoisted(() => ({
	probe: { asked: [] as string[], reachable: true },
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
				return new Response(
					JSON.stringify({ has_actions: true, default_branch: "main" }),
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
	launched.length = 0;
	pinned.length = 0;
	smoked.length = 0;
	ids.clear();
	ids.set("hanzo", HANZO);
	ids.set("lux", LUX);
	githubYaml.value = "";
	held.by = 1;
	held.status = 404;
	probe.asked.length = 0;
	probe.reachable = true;
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

	it("is nothing to build on the delivery lane, and a refusal at the door that stated it", async () => {
		// Both doors ask the forge and get the same nothing. They owe their
		// callers different sentences: a delivery is a healthy push of a branch
		// that has since gone, and a caller that TYPED the ref asked for
		// something that is not there.
		forge();
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref: "refs/heads/does-not-exist",
				requireOrganizationId: HANZO,
			}),
		).resolves.toEqual({
			declined: "no-commit",
			why: expect.stringMatching(/names no commit/i),
		});

		await expect(
			enqueueDirectBuild({
				repo: "hanzoai/kms",
				ref: "refs/heads/does-not-exist",
				image: "ghcr.io/hanzoai/kms:sha-abc",
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

	it("builds the names git makes that a whole-name rule used to refuse", async () => {
		// `@` is a whole refname git keeps for itself; under refs/heads/ the whole
		// refname is never `@`, so it is an ordinary branch. And the storage bound
		// is on a path COMPONENT, so a hierarchical name is as long as its parts
		// allow — 401 characters here, which generated branches really reach.
		// Both were refused by a rule written against the whole name, and a
		// refused push is an outage wearing a control's clothes.
		const DEEP = `${"a".repeat(200)}/${"b".repeat(200)}`;
		for (const [name, sha] of [
			["@", MAIN],
			[DEEP, SIDE],
		] as const) {
			rows.length = 0;
			launched.length = 0;
			const asked = forge({ refs: { [`branches/${name}`]: sha } });
			const result = await scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref: `refs/heads/${name}`,
				requireOrganizationId: HANZO,
			});
			expect("declined" in result, name).toBe(false);
			expect(rows[0]?.ref, name).toBe(`refs/heads/${name}`);
			expect(rows[0]?.sha, name).toBe(sha);
			expect(launched[0]?.commit, name).toBe(sha);
			// Asked of the forge by that exact name, encoded per segment.
			expect(
				asked.some((u) => u.includes("/branches/")),
				name,
			).toBe(true);
		}
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

	it("refuses a config that spells a constant", async () => {
		// A pattern with no token resolves to the same name on every push, so it
		// names no build in particular — `v1.2.3` from `main` and `v1.2.3` from a
		// side branch are one image and two commits. The name is version-shaped,
		// so nothing downstream can tell them apart either.
		const constant = `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "v1.2.3"
  push: true
`;
		for (const ref of ["refs/heads/main", "refs/heads/wip"]) {
			forge({ yaml: constant });
			await expect(
				scheduleBuilds({
					source: { forge: "hanzo-git" },
					repo: "hanzoai/kms",
					ref,
					requireOrganizationId: HANZO,
				}),
				ref,
			).rejects.toThrow(/names the same image on every push/i);
		}
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
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
		// build off it looks exactly like a healthy one. This door reads no config
		// of its own, so it used to skip the question entirely — a rule that runs
		// at one door is not a rule.
		const undeclared =
			'build:\n  matrix:\n    - { os: linux, arch: amd64 }\n  image: ghcr.io/hanzoai/kms\n  tag-pattern: "sha-{{git.sha}}"\n';
		forge({ yaml: undeclared });
		await enqueueDirectBuild({ ...direct, ref: "refs/heads/main" });
		expect(probe.asked).toEqual([`hanzoai/kms@${MAIN}`]);
		expect(rows).toHaveLength(1);

		rows.length = 0;
		probe.reachable = false;
		forge({ yaml: undeclared });
		await expect(
			enqueueDirectBuild({ ...direct, ref: "refs/heads/main" }),
		).rejects.toThrow(/not on github\.com/i);
		expect(rows).toHaveLength(0);
	});

	it("takes the repo's own word when it declares the forge canonical", async () => {
		// `source: forge` is a declaration that there is nothing to compare
		// against, and it beats whatever mirror rows happen to exist. Asked and
		// answered without a probe is a different thing from never asked.
		forge();
		await enqueueDirectBuild({ ...direct, ref: "refs/heads/main" });
		expect(probe.asked).toEqual([]);
		expect(rows).toHaveLength(1);
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

/**
 * A ref is a NAME, and only the names git makes are names.
 *
 * The name is not free text once it leaves here: it becomes a path segment on
 * the forge, so `..` in it is the one sequence a URL resolves away. Percent-
 * encoding a segment does not touch a dot, so a ref carrying `..` addressed a
 * repository the caller never named — `refs/heads/../../../luxfi/node/branches/main`
 * on `hanzoai/kms` came back holding luxfi/node's HEAD, and the row said kms
 * over it. `git check-ref-format` already refuses every such name at the moment
 * a ref is created, so reading the same rule here keeps what we ask the forge
 * about equal to what the forge can hold.
 */
describe("the name a ref carries", () => {
	const FOREIGN = "9c8b7a6d5e4f30211fedcba9876543210abcdef1";
	const TRAVERSAL = "refs/heads/../../../luxfi/node/branches/main";

	/**
	 * Two repositories on one forge, addressed the way a real request addresses
	 * it: the URL is PARSED before it is answered. A stub matching the raw string
	 * cannot see this — `fetch` resolves the path, and resolving is the whole
	 * mechanism.
	 */
	function twoRepos(): string[] {
		const asked: string[] = [];
		const heads: Record<string, string> = {
			"/v1/repos/hanzoai/kms/branches/main": MAIN,
			"/v1/repos/luxfi/node/branches/main": FOREIGN,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				const path = new URL(String(url)).pathname;
				asked.push(path);
				const sha = heads[path];
				if (sha) {
					return new Response(JSON.stringify({ commit: { id: sha } }), {
						status: 200,
					});
				}
				if (path.endsWith("/contents/hanzo.yml")) {
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
				if (/^\/v1\/repos\/[^/]+\/[^/]+$/.test(path)) {
					return new Response(JSON.stringify({ has_actions: true }), {
						status: 200,
					});
				}
				return new Response("", { status: 404 });
			}),
		);
		return asked;
	}

	it("cannot re-address the forge to another repository", async () => {
		const asked = twoRepos();
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "hanzoai/kms",
				ref: TRAVERSAL,
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/does not name a branch or a tag/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
		expect(asked.some((p) => p.includes("/luxfi/node"))).toBe(false);
	});

	it("never leaves the process, so the forge is not asked at all", async () => {
		const asked = twoRepos();
		await expect(
			commitAt({ url: "https://git.hanzo.ai" }, "hanzoai/kms", TRAVERSAL),
		).resolves.toBeNull();
		expect(asked).toEqual([]);
	});

	it("is refused for every name git would not make", async () => {
		for (const name of [
			"..",
			"a..b",
			".hidden",
			"nested/.hidden",
			"x.lock",
			"nested/x.lock",
			"a b",
			"a~1",
			"a^",
			"a:b",
			"a?",
			"a*",
			"a[",
			"a\\b",
			"a@{1}",
			"a//b",
			"a/",
			"trailing.",
			"a".repeat(251),
			`ok/${"a".repeat(251)}`,
		]) {
			expect(refProblem(`refs/heads/${name}`), name).toMatch(
				/does not name a branch or a tag/i,
			);
			expect(refProblem(`refs/tags/${name}`), name).toMatch(
				/does not name a branch or a tag/i,
			);
		}
	});

	it("still takes every name git does make", async () => {
		for (const ref of [
			"refs/heads/main",
			"refs/heads/feature/a-b_c.d",
			"refs/heads/release/2026.1",
			"refs/heads/a.b",
			"refs/heads/-dash",
			"refs/heads/UPPER",
			"refs/tags/v1.2.3",
			"refs/tags/v1.36.2-rc.1",
			// `@` is a whole refname git keeps for itself, and under refs/heads/
			// the whole refname is never `@` — so it is an ordinary branch name.
			"refs/heads/@",
			"refs/tags/@",
			// The bound is on a component, so a hierarchical name is as long as
			// its parts allow. A generated branch really does reach this.
			`refs/heads/${"a".repeat(200)}/${"b".repeat(200)}`,
			`refs/heads/renovate/${"services-gateway/".repeat(6)}pkg-1.2.3`,
			// C1 controls are ordinary bytes to git: no byte of their UTF-8 is
			// below \040.
			"refs/heads/a\u0085b",
			"refs/heads/a\u0080b",
			"refs/heads/a\u009fb",
		]) {
			expect(refProblem(ref), ref).toBeNull();
		}
	});

	it("keeps addressing the forge by exact name", async () => {
		const asked = twoRepos();
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(rows[0]?.sha).toBe(MAIN);
		expect(asked).toContain("/v1/repos/hanzoai/kms/branches/main");
	});
});

/**
 * A delivery is about a repository, and the credential that signed it has to
 * hold that repository.
 *
 * On our own forge the secret is one deployment-level key over one forge we
 * run, so a delivery it signed is about a repository it serves. A GitHub App
 * INSTALLATION is a tenant's credential and covers exactly the repositories it
 * was installed on — while `repository.full_name` is written in the body the
 * tenant signs. The signature proves who sent it and nothing about whose
 * repository they named, so GitHub is asked which installation holds it.
 *
 * What the installation TOKEN can READ is a different question: an installation
 * token reads any public repository, so every first-party repository that is
 * public on github.com answered a config read from an installation holding none
 * of ours.
 */
describe("what a delivery may be about", () => {
	const delivery = {
		source: { forge: "github", installationId: "1" },
		repo: "hanzoai/kms",
		ref: "refs/heads/main",
	} as const;

	beforeEach(() => {
		githubYaml.value = `
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/kms
  tag-pattern: "sha-{{git.sha}}"
  push: true
`;
	});

	it("builds when the installation holds the repository", async () => {
		forge();
		held.by = 1;
		await scheduleBuilds(delivery);
		expect(rows[0]).toMatchObject({
			repo: "hanzoai/kms",
			image: `ghcr.io/hanzoai/kms:sha-${MAIN}`,
		});
	});

	it("refuses when GitHub says another installation holds it", async () => {
		const asked = forge();
		held.by = 2;
		await expect(scheduleBuilds(delivery)).rejects.toThrow(
			/not installed on it/i,
		);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
		// Asked before the forge is, so a delivery naming a repository it does
		// not hold cannot use the answer as a commit-existence oracle.
		expect(asked).toEqual([]);
	});

	it("refuses when GitHub says no installation holds it", async () => {
		// A 404 IS the answer: no installation of this App holds that repository.
		forge();
		held.by = null;
		held.status = 404;
		await expect(scheduleBuilds(delivery)).rejects.toThrow(
			/not installed on it/i,
		);
		expect(rows).toHaveLength(0);
	});

	it("does not call a credential failure a permission", async () => {
		// Failing to ASK is a different sentence from being told no, and it points
		// at a different thing to fix. Nothing is built either way.
		forge();
		held.by = null;
		held.status = 401;
		await expect(scheduleBuilds(delivery)).rejects.toThrow(/github said no/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("asks nothing of GitHub on our own forge, which has one secret", async () => {
		// The forge lane's credential is deployment-level and covers the forge it
		// is the secret for. There is no installation to look up and no second
		// answer to keep in step.
		forge();
		held.by = null;
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "hanzoai/kms",
			ref: "refs/heads/main",
			requireOrganizationId: HANZO,
		});
		expect(rows).toHaveLength(1);
	});
});
