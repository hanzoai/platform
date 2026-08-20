/**
 * A build publishes as the organization that owns the repository it read.
 *
 * Two facts decide who a build speaks for: the repository it clones, and the
 * image it pushes. The repository is authorized — somebody with write access to
 * it put the commit there — and the image is DECLARED, in that repository's own
 * `hanzo.yml` or by whoever called the direct door. So the destination is
 * untrusted input, and the credential mounted to reach it is derived from that
 * input.
 *
 * The binding below is what makes that safe: the namespace an image publishes
 * into and the owner of the repository being built belong to the same
 * organization. It is asked at both front doors and again at the muscle, so a
 * build cannot be handed a credential for a namespace its source does not own.
 */
import {
	enqueueDirectBuild,
	scheduleBuilds,
} from "@hanzo/platform/services/ci/build-scheduler";
import { buildBuildkitJob } from "@hanzo/platform/services/ci/buildkit-job";
import { runnerPoolFor } from "@hanzo/platform/services/ci/platform-config";
import {
	destinationProblem,
	firstParty,
	org,
	ownerOf,
	pushSecret,
} from "@hanzo/platform/services/org";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Production-shaped principals: organization ids are nanoids, never brand
 * names. Which row a name resolves to is what `orgId` reads out of the
 * database, and `org.realdb.test.ts` proves that read against a real one; here
 * it is stated, so these tests are about the rules and not about the query.
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

const { launched, rows } = vi.hoisted(() => ({
	launched: [] as { repo: string; image: string }[],
	rows: [] as {
		repo: string;
		sha: string;
		image: string;
		organizationId: string;
	}[],
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

/** What a promotion actually set in motion, in order. */
const { started } = vi.hoisted(() => ({ started: [] as string[] }));

vi.mock("@hanzo/platform/services/ci/smoke-runner", () => ({
	smoke: vi.fn(async () => {
		started.push("smoke");
		return { passed: true, reason: "ready", pod: "p" };
	}),
}));

vi.mock("@hanzo/platform/services/ci/pin", () => ({
	commitPin: vi.fn(async () => {
		started.push("pin");
		return {
			committed: true,
			path: "p",
			tag: "v9.9.9",
			digest: "d",
			reason: "",
		};
	}),
}));

vi.mock("@hanzo/platform/services/ci/buildkit-job", async (orig) => {
	const real =
		await orig<typeof import("@hanzo/platform/services/ci/buildkit-job")>();
	return {
		...real,
		launchBuildJob: vi.fn(async (input: { repo: string; image: string }) => {
			launched.push(input);
			return { jobName: "build-1" };
		}),
	};
});

const SHA = "0".repeat(40);
const COMMIT = { sha: SHA, ref: "refs/heads/main", branch: "main" };

/** Serve a `hanzo.yml` declaring `image`, from whatever repository is asked for. */
function serveForge(image: string) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (!String(url).includes("/contents/hanzo.yml")) {
				return new Response("", { status: 404 });
			}
			const yaml = `
source: forge
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ${image}
  tag-pattern: "v9.9.9"
  push: true
`;
			return new Response(
				JSON.stringify({
					content: Buffer.from(yaml).toString("base64"),
					encoding: "base64",
				}),
				{ status: 200 },
			);
		}),
	);
}

beforeEach(() => {
	vi.unstubAllGlobals();
	launched.length = 0;
	rows.length = 0;
	ids.clear();
	ids.set("hanzo", HANZO);
	ids.set("lux", LUX);
	process.env.HANZO_GIT_WEBHOOK_SECRET = "s3cret";
});

describe("org — the organization a name belongs to", () => {
	it("reads both spellings of one organization as that organization", () => {
		expect(org("hanzo")).toBe("hanzo");
		expect(org("hanzoai")).toBe("hanzo");
		expect(org("lux")).toBe("lux");
		expect(org("luxfi")).toBe("lux");
		expect(org("zoo")).toBe("zoo");
		expect(org("zooai")).toBe("zoo");
	});

	it("reads a name the way the forge and the registry resolve it", () => {
		// One fold, in one place. Every rule that reads this table therefore
		// agrees with every other about which organization an image is in.
		expect(org("HanzoAI")).toBe("hanzo");
		expect(org("LUXFI")).toBe("lux");
		expect(org("ZooAi")).toBe("zoo");
	});

	it("answers for a name nobody owns, rather than answering with the name", () => {
		// A name that resolved to itself would let whoever registers that name
		// resolve to whatever it spells, and the forge hands out names on request.
		for (const name of ["grafana", "evil", "hanzo-fake", "getmeili", ""]) {
			expect(org(name), name).toBeUndefined();
		}
	});

	it("keeps an inherited property an ordinary miss", () => {
		for (const name of ["__proto__", "constructor", "toString"]) {
			expect(org(name), name).toBeUndefined();
		}
	});

	it("claims every namespace a push credential exists for", () => {
		// `hanzo-build` holds push-hanzoai, push-hanzoteam, push-luxfi,
		// push-parsdao and push-zooai. Those are the namespaces something can
		// actually publish to, so those are the ones ownership has to decide —
		// a credential whose namespace nobody claims is one anybody could ask
		// for.
		for (const ns of ["hanzoai", "hanzoteam", "luxfi", "parsdao", "zooai"]) {
			expect(org(ns), ns).toBeDefined();
		}
	});

	it("claims every forge owner that builds here", () => {
		// Refusing a repository that builds today is a worse outage than the
		// cross-org publishing this table exists to refuse, so every owner with
		// live builds resolves.
		for (const owner of [
			"hanzoai",
			"hanzo-apps",
			"hanzo-docs",
			"hanzo-inc",
			"hanzoteam",
			"hanzo",
			"luxfi",
			"zooai",
		]) {
			expect(org(owner), owner).toBeDefined();
		}
	});

	it("keeps the several spellings of one organization together", () => {
		// These publish `ghcr.io/hanzoai/*` and always have.
		for (const owner of ["hanzo-apps", "hanzo-docs", "hanzo-inc", "hanzo"]) {
			expect(org(owner), owner).toBe("hanzo");
		}
	});
});

describe("ownerOf — the owner half of a repository path", () => {
	it("reads the owner of a repository", () => {
		expect(ownerOf("hanzoai/kms")).toBe("hanzoai");
		expect(ownerOf("luxfi/node")).toBe("luxfi");
		expect(ownerOf("hanzoai/a/b")).toBe("hanzoai");
	});

	it("refuses a value with no owner segment rather than inventing one", () => {
		// The two quiet answers are both wrong. Taking the whole string reads
		// `hanzoaix` as an owner, and `hanzoai` is a real one — a repository that
		// does not exist would publish Hanzo's images. Taking the empty string
		// names a runner pool no runner answers to, and the build waits forever.
		for (const repo of ["hanzoai", "hanzoaix", "luxfix", "", "/kms"]) {
			expect(() => ownerOf(repo), repo).toThrow(/does not name a repository/i);
		}
	});

	it("resolves no organization and selects no pool for one", () => {
		for (const repo of ["hanzoaix", "luxfix"]) {
			expect(() => org(ownerOf(repo)), repo).toThrow();
			expect(
				() => runnerPoolFor(ownerOf(repo), { os: "linux", arch: "amd64" }),
				repo,
			).toThrow();
		}
	});

	it("refuses a destination for a value that names no repository", () => {
		expect(() =>
			destinationProblem("hanzoaix", "ghcr.io/hanzoai/cloud:v1.0.0"),
		).toThrow(/does not name a repository/i);
	});
});

describe("destinationProblem — an image belongs to the repository's org", () => {
	it("accepts a repository publishing into its own organization's namespace", () => {
		for (const [repo, image] of [
			["hanzoai/kms", "ghcr.io/hanzoai/kms:v1.0.0"],
			["hanzo/kms", "ghcr.io/hanzoai/kms:v1.0.0"],
			["luxfi/node", "ghcr.io/luxfi/node:v1.0.0"],
			["lux/node", "ghcr.io/luxfi/node:v1.0.0"],
		] as const) {
			expect(destinationProblem(repo, image), `${repo} -> ${image}`).toBeNull();
		}
	});

	it("refuses an image in another organization's namespace", () => {
		for (const [repo, image] of [
			["luxfi/node", "ghcr.io/hanzoai/cloud:v1.0.0"],
			["hanzoai/kms", "ghcr.io/luxfi/node:v1.0.0"],
			["evil/x", "ghcr.io/hanzoai/cloud:v1.0.0"],
			["evil/x", "ghcr.io/zooai/gym:v1.0.0"],
		] as const) {
			expect(destinationProblem(repo, image), `${repo} -> ${image}`).toMatch(
				/refusing/i,
			);
		}
	});

	it("reads the destination the way the registry reads it", () => {
		// `GHCR.IO/HanzoAI/x` and `ghcr.io/hanzoai/x` are one image, so one
		// namespace decides for both.
		expect(
			destinationProblem("evil/x", "GHCR.IO/HanzoAI/cloud:v1.0.0"),
		).toMatch(/refusing/i);
		expect(
			destinationProblem("HanzoAI/kms", "ghcr.io/hanzoai/kms:v1.0.0"),
		).toBeNull();
	});

	it("holds wherever the image is addressed from", () => {
		// The rule is about the namespace, because the namespace is what names
		// the credential — a host we have never heard of does not make
		// `ghcr.io/hanzoai`'s token somebody else's to ask for.
		expect(
			destinationProblem("luxfi/node", "registry.example.com/hanzoai/x:v1.0.0"),
		).toMatch(/refusing/i);
		expect(
			destinationProblem("luxfi/node", "ghcr.io:443/hanzoai/x:v1.0.0"),
		).toMatch(/refusing/i);
	});

	it("publishes a first-party namespace only on a registry we operate", () => {
		// Owning the namespace says where the image belongs, not where it may be
		// written. A build that names its own namespace on somebody else's host is
		// asking for its own credential and a destination we do not run, so the
		// two halves of one destination are decided together.
		for (const image of [
			"evil.example.com/hanzoai/x:v1.0.0",
			"docker.io/hanzoai/x:v1.0.0",
			"ghcr.io.evil.example.com/hanzoai/x:v1.0.0",
			"ghcr.io:443/hanzoai/x:v1.0.0",
		]) {
			expect(destinationProblem("hanzoai/kms", image), image).toMatch(
				/refusing/i,
			);
			expect(pushSecret("hanzoai/kms", image), image).toBeUndefined();
		}
	});

	it("accepts the registries we operate", () => {
		for (const image of [
			"ghcr.io/hanzoai/kms:v1.0.0",
			"registry.hanzo.ai/hanzoai/kms:v1.0.0",
			"oci.hanzo.ai/hanzoai/kms:v1.0.0",
			"GHCR.IO/HanzoAI/kms:v1.0.0",
		]) {
			expect(destinationProblem("hanzoai/kms", image), image).toBeNull();
			expect(pushSecret("hanzoai/kms", image), image).toBe("push-hanzoai");
		}
	});

	it("takes a destination that is one image reference, or none", () => {
		// An image reference is drawn from letters, digits and `._-/:@`. The build
		// muscle writes the destination into one comma-separated field of the
		// image exporter, so a reference bearing a comma or an `=` would be read
		// there as further fields — a second `name=`, or an attribute of the
		// exporter itself. One reference in, one destination out.
		for (const image of [
			"ghcr.io/hanzoai/x,name=ghcr.io/luxfi/node:v1.0.0",
			"ghcr.io/hanzoai/x:v1.0.0,ghcr.io/luxfi/node:v1.0.0",
			'ghcr.io/hanzoai/x:v1.0.0",push=false,"',
			"ghcr.io/hanzoai/x:v1.0.0 ghcr.io/luxfi/node:v1.0.0",
		]) {
			expect(destinationProblem("hanzoai/kms", image), image).toMatch(
				/refusing/i,
			);
			expect(pushSecret("hanzoai/kms", image), image).toBeUndefined();
		}
	});

	it("does not judge a namespace no organization here owns", () => {
		// No credential of ours reaches it and nothing of ours publishes there.
		expect(
			destinationProblem("hanzoai/kms", "docker.io/library/redis:7"),
		).toBeNull();
		expect(destinationProblem("hanzoai/kms", "postgres:16")).toBeNull();
	});
});

describe("pushSecret — the credential follows from both names", () => {
	it("names the namespace's secret for a repository that publishes there", () => {
		expect(pushSecret("hanzo/kms", "ghcr.io/hanzoai/kms:v1.0.0")).toBe(
			"push-hanzoai",
		);
		expect(pushSecret("luxfi/node", "ghcr.io/luxfi/node:v1.0.0")).toBe(
			"push-luxfi",
		);
	});

	it("names no secret for another organization's namespace", () => {
		// Asking for the image is not enough to be handed the token.
		expect(
			pushSecret("luxfi/node", "ghcr.io/hanzoai/cloud:v1.0.0"),
		).toBeUndefined();
		expect(
			pushSecret("evil/x", "ghcr.io/hanzoai/cloud:v1.0.0"),
		).toBeUndefined();
		expect(
			pushSecret("luxfi/node", "GHCR.IO/HanzoAI/cloud:v1.0.0"),
		).toBeUndefined();
	});

	it("names one secret however the namespace was spelled", () => {
		// The secret is a Kubernetes object name, so it is the same object.
		expect(pushSecret("hanzoai/kms", "GHCR.IO/HanzoAI/kms:v1.0.0")).toBe(
			"push-hanzoai",
		);
	});

	it("names no secret for an image that names no namespace", () => {
		expect(pushSecret("hanzoai/kms", "postgres:16")).toBeUndefined();
	});

	it("names no secret for a namespace no organization here claims", () => {
		// A `push-<name>` Secret can exist in the cluster for a namespace this
		// table does not list. The table decides, not the image string, so an
		// unlisted name yields nothing to mount rather than somebody's token.
		expect(
			pushSecret("hanzoai/bootnode", "ghcr.io/bootnode/bootnode:v1.0.0"),
		).toBeUndefined();
		expect(
			pushSecret("hanzoai/kms", "ghcr.io/getmeili/meilisearch:v1"),
		).toBeUndefined();
	});
});

describe("firstParty — which images the tag rules are about", () => {
	it("recognizes an image in a namespace we publish under", () => {
		expect(firstParty("ghcr.io/hanzoai/platform:v1.0.0")).toBe(true);
		expect(firstParty("GHCR.IO/HanzoAI/platform:latest")).toBe(true);
		expect(firstParty("ghcr.io:443/luxfi/node:main")).toBe(true);
	});

	it("leaves everybody else's images alone", () => {
		expect(firstParty("postgres:16")).toBe(false);
		expect(firstParty("docker.io/library/redis:7")).toBe(false);
		expect(firstParty("registry.example.com:5000/foo/bar:v1.0.0")).toBe(false);
	});
});

describe("the direct front door", () => {
	const direct = { sha: SHA, requireOrganizationId: HANZO };

	it("writes no row for an image in another organization's namespace", async () => {
		await expect(
			enqueueDirectBuild({
				...direct,
				repo: "luxfi/node",
				image: "ghcr.io/hanzoai/cloud:v1.0.0",
				requireOrganizationId: LUX,
			}),
		).rejects.toThrow(/refusing/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("owns the build by the organization that owns the repository", async () => {
		await enqueueDirectBuild({
			...direct,
			repo: "luxfi/node",
			image: "ghcr.io/luxfi/node:v1.0.0",
			requireOrganizationId: LUX,
		});
		expect(rows[0]?.organizationId).toBe(LUX);
	});

	it("gives two repositories of two organizations two principals", async () => {
		// The whole point of resolving from the repository: one constant for
		// every repo makes every namespace-keyed grant a grant to everybody.
		await enqueueDirectBuild({
			...direct,
			repo: "hanzoai/kms",
			image: "ghcr.io/hanzoai/kms:v1.0.0",
		});
		await enqueueDirectBuild({
			...direct,
			repo: "luxfi/node",
			image: "ghcr.io/luxfi/node:v1.0.0",
			requireOrganizationId: LUX,
		});
		expect(rows.map((r) => r.organizationId)).toEqual([HANZO, LUX]);
	});

	it("refuses a caller that names no organization at all", async () => {
		// The type says a caller must name one; this is the same answer when the
		// type is not there to say it. A claim that may be left out is a claim
		// that is never wrong, which is not a check.
		await expect(
			enqueueDirectBuild({
				repo: "luxfi/node",
				sha: SHA,
				image: "ghcr.io/luxfi/node:v1.0.0",
			} as never),
		).rejects.toThrow(/another organization/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("refuses a caller acting as an organization the repository is not", async () => {
		await expect(
			enqueueDirectBuild({
				...direct,
				repo: "luxfi/node",
				image: "ghcr.io/luxfi/node:v1.0.0",
				requireOrganizationId: HANZO,
			}),
		).rejects.toThrow(/another organization/i);
		expect(rows).toHaveLength(0);
	});

	it("writes no row for a repository no organization owns", async () => {
		await expect(
			enqueueDirectBuild({
				...direct,
				repo: "evil/x",
				image: "ghcr.io/evil/x:v1.0.0",
			}),
		).rejects.toThrow(/resolves to no organization/i);
		expect(rows).toHaveLength(0);
	});

	it("writes no row for an organization with no row here", async () => {
		ids.delete("lux");
		await expect(
			enqueueDirectBuild({
				...direct,
				repo: "luxfi/node",
				image: "ghcr.io/luxfi/node:v1.0.0",
				requireOrganizationId: LUX,
			}),
		).rejects.toThrow(/resolves to no organization/i);
		expect(rows).toHaveLength(0);
	});
});

describe("the webhook front door", () => {
	it("writes no row for an image in another organization's namespace", async () => {
		serveForge("ghcr.io/hanzoai/cloud");
		await expect(
			scheduleBuilds({
				source: { forge: "hanzo-git" },
				repo: "luxfi/node",
				...COMMIT,
			}),
		).rejects.toThrow(/refusing/i);
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("owns the build by the organization that owns the repository", async () => {
		serveForge("ghcr.io/luxfi/node");
		await scheduleBuilds({
			source: { forge: "hanzo-git" },
			repo: "luxfi/node",
			...COMMIT,
		});
		expect(rows[0]?.organizationId).toBe(LUX);
	});
});

/**
 * `buildJob.trigger` — the console's manual re-run, the one front door whose
 * commit is typed rather than read off a signed delivery. Same call as the
 * router makes: the input it takes, plus the caller's active organization.
 */
describe("the trigger front door", () => {
	const trigger = {
		source: { forge: "hanzo-git" },
		repo: "hanzoai/kms",
		ref: "refs/heads/main",
		branch: "main",
		requireOrganizationId: HANZO,
	} as const;

	it("schedules a build for a commit", async () => {
		serveForge("ghcr.io/hanzoai/kms");
		const result = await scheduleBuilds({ ...trigger, sha: SHA });
		expect(result?.jobs).toHaveLength(1);
		expect(rows[0]?.sha).toBe(SHA);
	});

	it("writes no row for a value that does not name a commit", async () => {
		// A commit is named by its object id and an object id is hex. The value
		// keys the row, names the target, addresses the config on the forge and
		// spells the image tag, so it is read as a commit before it reaches any
		// of them.
		serveForge("ghcr.io/hanzoai/kms");
		for (const sha of [
			"abc1234,name=ghcr.io/luxfi/node",
			`${SHA} --output=type=image`,
			"main",
			"refs/heads/main",
			"../../../etc/passwd",
			"abc1234?ref=main",
		]) {
			await expect(scheduleBuilds({ ...trigger, sha }), sha).rejects.toThrow(
				/does not name a commit/i,
			);
		}
		expect(rows).toHaveLength(0);
		expect(launched).toHaveLength(0);
	});

	it("names one commit however it was spelled", async () => {
		// An object id is hex, and hex is case-insensitive, so both spellings key
		// one row rather than building the same commit twice.
		serveForge("ghcr.io/hanzoai/kms");
		await scheduleBuilds({ ...trigger, sha: "A".repeat(40) });
		expect(rows[0]?.sha).toBe("a".repeat(40));
	});
});

describe("the deploy target", () => {
	/**
	 * Fleet authority is DATA, keyed by namespace and VALUED by organization —
	 * so it only tells organizations apart when they HAVE different principals.
	 * With one principal for every repository it reads as a grant to everybody,
	 * which is why the principal comes from the repository.
	 */
	async function promote(repo: string, image: string, namespace: string) {
		serveForge(image);
		await scheduleBuilds({ source: { forge: "hanzo-git" }, repo, ...COMMIT });
		// The ROW the build wrote — the principal it recorded is what decides
		// this, so the promotion is asked about exactly what was stored.
		const job = {
			...rows[0],
			branch: "main",
			status: "succeeded",
			imageDigest: `sha256:${"a".repeat(64)}`,
		};
		const { promoteBuild } = await import(
			"@hanzo/platform/services/ci/promote"
		);
		return promoteBuild(
			job as never,
			{
				on: ["main"],
				target: {
					cluster: "hanzo-k8s",
					namespace,
					operator: "hanzo-operator",
					name: "cloud",
				},
			} as never,
		);
	}

	beforeEach(() => {
		started.length = 0;
		// The `hanzo` namespace belongs to one organization.
		process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = `hanzo=${HANZO}`;
	});

	it("promotes a build into the namespace its own organization owns", async () => {
		const res = await promote(
			"hanzoai/cloud",
			"ghcr.io/hanzoai/cloud",
			"hanzo",
		);
		expect(res.state).toBe("promoted");
		expect(started).toEqual(["smoke", "pin"]);
	});

	it("refuses a namespace another organization owns, before starting anything", async () => {
		// The luxfi build now carries LUX's principal, so the `hanzo` namespace
		// — which belongs to HANZO — is not its to promote into. This is the
		// same `authorizeNamespace` call as ever; what changed is that the two
		// organizations are now two answers.
		const res = await promote("luxfi/node", "ghcr.io/luxfi/node", "hanzo");
		expect(res.state).toBe("failed");
		expect(res.reason).toMatch(/another organization/i);
		expect(started).toEqual([]);
	});

	it("refuses a namespace no organization owns, before starting anything", async () => {
		const res = await promote(
			"hanzoai/cloud",
			"ghcr.io/hanzoai/cloud",
			"kube-system",
		);
		expect(res.state).toBe("failed");
		expect(started).toEqual([]);
	});
});

describe("the build muscle", () => {
	it("refuses a value that names no repository, before reading it apart", () => {
		// The muscle takes its repo from a row, and decides the name is a
		// repository before anything downstream treats it as owner/name.
		expect(() =>
			buildBuildkitJob({
				repo: "hanzoaix",
				gitRef: "refs/heads/main",
				image: "ghcr.io/hanzoai/cloud:v1.0.0",
				buildJobId: "bj_1",
			}),
		).toThrow(/does not name a repository/i);
	});

	it("refuses to launch a build whose image is another organization's", () => {
		expect(() =>
			buildBuildkitJob({
				repo: "luxfi/node",
				gitRef: "refs/heads/main",
				image: "ghcr.io/hanzoai/cloud:v1.0.0",
				buildJobId: "bj_1",
			}),
		).toThrow(/refusing/i);
	});

	it("mounts the namespace's credential for a build that publishes there", () => {
		const job = buildBuildkitJob({
			repo: "luxfi/node",
			gitRef: "refs/heads/main",
			image: "ghcr.io/luxfi/node:v1.0.0",
			buildJobId: "bj_1",
		});
		const spec = JSON.stringify(job);
		expect(spec).toContain("push-luxfi");
		expect(spec).not.toContain("push-hanzoai");
	});
});
