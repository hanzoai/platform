/**
 * promote — the state machine that decides whether a build reaches production.
 *
 * ONE PROPERTY MATTERS MORE THAN THE REST, and most of this file is about it:
 *
 *   NOTHING IS COMMITTED UNLESS A SMOKE PASSED FIRST.
 *
 * Every other outcome — refused, unnamed, unauthorized, errored, timed out —
 * must leave universe untouched, which means production untouched. So each test
 * below asserts the pin was NOT written, not merely that a status string changed:
 * a state machine that reports `smoke-failed` while having already committed is
 * exactly the bug this replaced.
 *
 * The suite also pins the ORDER. `smoke` must be called before `commitPin`, and
 * `commitPin` must not be reachable from any path where `smoke` did not return
 * passed — that ordering is the whole design, and it is the thing a later
 * refactor is most likely to break silently.
 *
 * Nothing external is contacted: smoke, pin and the row writer are stubs that
 * record what they were asked to do.
 */
import type { BuildJob } from "@hanzo/platform/db/schema";
import type { DeployConfig } from "@hanzo/platform/services/ci/platform-config";
import { promoteBuild } from "@hanzo/platform/services/ci/promote";
import { tenantNamespace } from "@hanzo/platform/services/k8s/operator/namespace-authz";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DIGEST =
	"sha256:60ca34bd76f3472f8c5b4903c6516686bbdfce696b4569aaa80c1fbac4e3085e";

// Production-shaped principals: organization ids are nanoids, never brand names.
// Testing authorization with readable ids would let a brand-keyed bug pass green.
const { FLEET_ORG, OTHER_ORG, TENANT_ORG } = vi.hoisted(() => ({
	FLEET_ORG: "Yb5GFGDBEwcLsv2O8qWjS",
	OTHER_ORG: "Lx7QpZm2NvKd8RtYeWc1A",
	TENANT_ORG: "Mx3KpQr9TvBn2WsLdYe5F",
}));

const spy = vi.hoisted(() => ({
	/** Every stage call, in order — the ordering assertions read this. */
	order: [] as string[],
	smokeInput: null as Record<string, unknown> | null,
	pinInput: null as Record<string, unknown> | null,
	rows: [] as Record<string, unknown>[],
	smokePassed: true,
	smokeReason: "ready",
	smokeThrows: null as unknown,
	pinCommitted: true,
	pinThrows: null as unknown,
}));

vi.mock("@hanzo/platform/services/ci/smoke-runner", () => ({
	smoke: vi.fn(async (input: Record<string, unknown>) => {
		spy.order.push("smoke");
		spy.smokeInput = input;
		if (spy.smokeThrows) throw spy.smokeThrows;
		return { passed: spy.smokePassed, reason: spy.smokeReason, pod: "p" };
	}),
}));

vi.mock("@hanzo/platform/services/ci/pin", () => ({
	commitPin: vi.fn(async (input: Record<string, unknown>) => {
		spy.order.push("pin");
		spy.pinInput = input;
		if (spy.pinThrows) throw spy.pinThrows;
		return {
			committed: spy.pinCommitted,
			path: "charts/app/values/hanzo/cloud.yaml",
			tag: "sha-new1234",
			digest: DIGEST,
			reason: "pinned",
		};
	}),
}));

vi.mock("@hanzo/platform/services/ci/build-job", () => ({
	updateBuildJob: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
		spy.rows.push(patch);
		return {};
	}),
}));

function job(over: Partial<BuildJob> = {}): BuildJob {
	return {
		buildJobId: "bj_1",
		repo: "hanzoai/cloud",
		ref: "refs/heads/main",
		image: "ghcr.io/hanzoai/cloud:sha-new1234",
		imageDigest: DIGEST,
		status: "succeeded",
		organizationId: FLEET_ORG,
		...over,
	} as BuildJob;
}

function deploy(over: Partial<DeployConfig["target"]> = {}): DeployConfig {
	return {
		on: ["main"],
		target: {
			cluster: "hanzo-k8s",
			namespace: "hanzo",
			operator: "hanzo-operator",
			crd: "App",
			name: "cloud",
			...over,
		},
	};
}

/** The last rolloutStatus written — where the machine came to rest. */
const finalState = () =>
	[...spy.rows].reverse().find((r) => r.rolloutStatus)?.rolloutStatus;
const committed = () => spy.order.includes("pin");
/** Every rolloutStatus written, in order — the walk through the machine. */
const states = () =>
	spy.rows
		.map((r) => r.rolloutStatus)
		.filter((s): s is string => typeof s === "string");

/** What the process SAID, as opposed to what it recorded. */
let said: string[] = [];

beforeEach(() => {
	said = [];
	vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
		said.push(parts.map(String).join(" "));
	});
	spy.order = [];
	spy.smokeInput = null;
	spy.pinInput = null;
	spy.rows = [];
	spy.smokePassed = true;
	spy.smokeReason = "ready";
	spy.smokeThrows = null;
	spy.pinCommitted = true;
	spy.pinThrows = null;
	// Fleet authority is DATA, and empty by default. Configure it the way
	// production does — through the env var the real reader reads.
	process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = `hanzo=${FLEET_ORG}`;
});

afterEach(() => {
	process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = "";
	vi.mocked(console.error).mockRestore();
});

describe("promoteBuild — the one path that promotes", () => {
	it("smokes the image, THEN commits the pin — in that order", async () => {
		const res = await promoteBuild(job(), deploy());
		expect(spy.order).toEqual(["smoke", "pin"]);
		expect(res).toMatchObject({ promoted: true, state: "promoted" });
		expect(finalState()).toBe("promoted");
	});

	it("smokes the digest-pinned reference, not the mutable tag", async () => {
		await promoteBuild(job(), deploy());
		// A tag can be overwritten between push and smoke. The bytes cannot.
		expect(spy.smokeInput?.image).toBe(
			`ghcr.io/hanzoai/cloud:sha-new1234@${DIGEST}`,
		);
		expect(spy.smokeInput).toMatchObject({ namespace: "hanzo", name: "cloud" });
	});

	it("pins the same digest it smoked — one resolution, used twice", async () => {
		await promoteBuild(job(), deploy());
		expect(spy.pinInput?.digest).toBe(DIGEST);
		expect(spy.smokeInput?.digest).toBe(DIGEST);
	});

	it("records the target on the row so the board can name it", async () => {
		await promoteBuild(job(), deploy());
		expect(spy.rows.some((r) => r.rolloutTarget === "hanzo/cloud")).toBe(true);
	});

	it("passes through the tenant basis with no special case", async () => {
		const ns = tenantNamespace(TENANT_ORG);
		const res = await promoteBuild(
			job({ organizationId: TENANT_ORG }),
			deploy({ namespace: ns, name: "api" }),
		);
		expect(res.state).toBe("promoted");
		expect(spy.pinInput).toMatchObject({ namespace: ns, name: "api" });
	});

	it("reports promoted:false when the file already named this image", async () => {
		// Idempotence reaching the caller: an unchanged pin gives CD nothing to
		// reconcile, so the stages that follow a rollout must not re-arm.
		spy.pinCommitted = false;
		const res = await promoteBuild(job(), deploy());
		expect(res).toMatchObject({ promoted: false, state: "promoted" });
	});
});

describe("promoteBuild — every other path commits NOTHING", () => {
	it("stops on a failed smoke, terminally, without pinning", async () => {
		spy.smokePassed = false;
		spy.smokeReason = "container cloud is CrashLoopBackOff";
		const res = await promoteBuild(job(), deploy());

		expect(res).toMatchObject({ promoted: false, state: "smoke-failed" });
		expect(committed()).toBe(false);
		expect(spy.order).toEqual(["smoke"]);
		expect(finalState()).toBe("smoke-failed");
		// The reason reaches the row, so the board says why.
		expect(spy.rows.at(-1)?.error).toContain("CrashLoopBackOff");
	});

	it("stops when the smoke itself errors — an unobserved image is an unverified image", async () => {
		spy.smokeThrows = new Error("pods is forbidden: cannot create resource");
		const res = await promoteBuild(job(), deploy());
		expect(res.state).toBe("failed");
		expect(committed()).toBe(false);
		expect(spy.rows.at(-1)?.error).toContain("forbidden");
	});

	it("stops when the build recorded no digest — it cannot name what it made", async () => {
		const res = await promoteBuild(job({ imageDigest: null }), deploy());
		expect(res.state).toBe("failed");
		expect(spy.order).toEqual([]);
		expect(res.reason).toContain("no image digest");
	});

	it("refuses a namespace this org does not own, before starting anything", async () => {
		const res = await promoteBuild(
			job({ organizationId: OTHER_ORG }),
			deploy(),
		);
		expect(res.state).toBe("failed");
		expect(res.reason).toContain("unauthorized");
		expect(spy.order).toEqual([]);
	});

	it("refuses another tenant's namespace — ownership is derived, never asserted", async () => {
		const res = await promoteBuild(
			job({ organizationId: TENANT_ORG }),
			deploy({ namespace: tenantNamespace(OTHER_ORG) }),
		);
		expect(res.state).toBe("failed");
		expect(spy.order).toEqual([]);
	});

	it("refuses a fleet namespace when fleet ownership is unconfigured", async () => {
		// The live default: an empty table means nobody holds fleet authority by
		// accident. This is what has held the old CR-patch path shut in production.
		process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = "";
		const res = await promoteBuild(job(), deploy());
		expect(res.state).toBe("failed");
		expect(spy.order).toEqual([]);
	});

	it("refuses a namespace inherited from Object.prototype", async () => {
		for (const ns of ["constructor", "__proto__", "toString"]) {
			spy.order = [];
			const res = await promoteBuild(job(), deploy({ namespace: ns }));
			expect(res.state).toBe("failed");
			expect(spy.order).toEqual([]);
		}
	});

	it("stops when the pin is refused, leaving the row terminal and unpromoted", async () => {
		spy.pinThrows = new Error(
			"pin refused: has no charts/app/values/hanzo/cloud.yaml",
		);
		const res = await promoteBuild(job(), deploy());
		expect(res).toMatchObject({ promoted: false, state: "failed" });
		expect(finalState()).toBe("failed");
		expect(res.reason).toContain("charts/app/values/hanzo/cloud.yaml");
	});

	it("skips a branch that is not a deploy branch", async () => {
		const res = await promoteBuild(
			job({ ref: "refs/heads/feature/x" }),
			deploy(),
		);
		expect(res).toMatchObject({ promoted: false, state: "skipped" });
		expect(spy.order).toEqual([]);
	});

	it("reads the deploy branch off the ref, and has nowhere else to read it", async () => {
		// `deploy.on` lists branches, and the row's ONE git name is its ref. A
		// second, short copy of that name would be a second answer to the same
		// question, and the two only have to disagree once: `main` written beside a
		// ref that is not main's is a deploy of a commit main does not carry.
		const res = await promoteBuild(
			job({ ref: "refs/heads/feature/x", branch: "main" } as never),
			deploy(),
		);
		expect(res).toMatchObject({ promoted: false, state: "skipped" });
		expect(res.reason).toContain("refs/heads/feature/x");
		expect(committed()).toBe(false);
	});

	it("skips a tag push, whatever the tag is called", async () => {
		// A tag build PUBLISHES. What production runs still follows a push to a
		// branch someone named, so a ref that is not a branch has no answer here —
		// including a tag spelled exactly like one.
		for (const ref of ["refs/tags/v1.2.3", "refs/tags/main"]) {
			spy.order = [];
			const res = await promoteBuild(job({ ref }), deploy());
			expect(res, ref).toMatchObject({ promoted: false, state: "skipped" });
			expect(committed(), ref).toBe(false);
		}
	});

	it("skips a row carrying no ref at all", async () => {
		// Fail closed on a row that cannot say what it is about. There is no
		// default branch to fall back on: falling back is how a row that named
		// nothing deployed as if it had named main.
		for (const ref of ["", "main", "heads/main", "refs/remotes/origin/main"]) {
			spy.order = [];
			const res = await promoteBuild(job({ ref }), deploy());
			expect(res, ref).toMatchObject({ promoted: false, state: "skipped" });
			expect(committed(), ref).toBe(false);
		}
	});

	it("skips a repo with no deploy block", async () => {
		const res = await promoteBuild(job(), undefined);
		expect(res).toMatchObject({ promoted: false, state: "skipped" });
		expect(spy.order).toEqual([]);
	});

	it("refuses a build that is not succeeded", async () => {
		for (const status of [
			"failed",
			"running",
			"queued",
			"cancelled",
		] as const) {
			spy.order = [];
			const res = await promoteBuild(job({ status }), deploy());
			expect(res.state).toBe("failed");
			expect(spy.order).toEqual([]);
		}
	});

	it("never throws — a promotion that cannot happen must not cost the build its publish stage", async () => {
		spy.smokeThrows = new Error("boom");
		await expect(promoteBuild(job(), deploy())).resolves.toBeDefined();
		spy.smokeThrows = null;
		spy.pinThrows = new Error("boom");
		await expect(promoteBuild(job(), deploy())).resolves.toBeDefined();
	});
});

describe("promoteBuild — the position is recorded before the outcome is known", () => {
	it("walks skipped → pending → smoking → promoted, in that order", async () => {
		await promoteBuild(job(), deploy());
		expect(states()).toEqual(["pending", "smoking", "promoted"]);
	});

	it("stamps `pending` BEFORE the smoke starts, so an interrupted run cannot read as skipped", async () => {
		await promoteBuild(job(), deploy());
		// `skipped` is the column default and means "nothing to do". A promotion
		// whose pod dies mid-flight writes nothing more, so the row must already
		// carry a state that says it began — otherwise the two are the same row.
		expect(spy.rows[0]).toMatchObject({
			rolloutStatus: "pending",
			rolloutTarget: "hanzo/cloud",
		});
		expect(states()[0]).toBe("pending");
	});

	it("reaches `pending` even on a path that then refuses — the run still began", async () => {
		await promoteBuild(job({ organizationId: OTHER_ORG }), deploy());
		expect(states()).toEqual(["pending", "failed"]);
		expect(committed()).toBe(false);
	});

	it("stamps nothing but `skipped` when there was nothing to promote", async () => {
		await promoteBuild(job(), undefined);
		expect(states()).toEqual(["skipped"]);
	});
});

describe("promoteBuild — a refusal is announced, not merely recorded", () => {
	it("LOGS an unconfigured fleet table, naming the variable that would fix it", async () => {
		// The load-bearing regression. This refusal was already correct and already
		// recorded, and it still went unnoticed across 1,439 builds, because the
		// only place it appeared was a column nobody was reading. Being right in
		// private is how a deploy path stays dead for months.
		process.env.PLATFORM_FLEET_NAMESPACE_OWNERS = "";
		const res = await promoteBuild(job(), deploy());

		expect(res.state).toBe("failed");
		expect(committed()).toBe(false);
		const out = said.join("\n");
		expect(out).toContain("[promote]");
		expect(out).toContain("hanzo/cloud");
		expect(out).toContain("PLATFORM_FLEET_NAMESPACE_OWNERS");
	});

	it("logs a failed smoke with the reason it failed", async () => {
		spy.smokePassed = false;
		spy.smokeReason = "container cloud is CrashLoopBackOff";
		await promoteBuild(job(), deploy());
		expect(said.join("\n")).toContain("CrashLoopBackOff");
	});

	it("logs a refused pin, so a forge that will not answer is visible", async () => {
		spy.pinThrows = new Error("pin refused: HANZO_GIT_TOKEN is unset");
		await promoteBuild(job(), deploy());
		expect(said.join("\n")).toContain("HANZO_GIT_TOKEN");
	});

	it("stays quiet when there was nothing to promote", async () => {
		// `skipped` is not a problem. A log that cries on every library repo's
		// build is a log everyone learns to scroll past, which costs the line
		// above its meaning.
		await promoteBuild(job(), undefined);
		await promoteBuild(job({ ref: "refs/heads/feature/x" }), deploy());
		expect(said).toEqual([]);
	});
});
