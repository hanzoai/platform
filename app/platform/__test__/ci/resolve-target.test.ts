/**
 * Unit: resolveTarget — dispatch TARGET RESOLUTION, decomplected.
 *
 * `resolveTarget` is the ONE routing function (it replaced the old
 * `resolveDispatchMode`). It takes an ORDERED list of candidate pools and
 * picks the first with a live runner, else falls back to workflow_dispatch.
 * It is orthogonal to runner ownership: it never reads organizationId and
 * does not know which pool is "tenant" vs "shared" — that priority is encoded
 * solely as the order of the `pools` array by the caller.
 *
 * The only seam mocked is `poolHasLiveRunner` (the liveness query over the
 * arcd_runner table) — mirroring the arcd-longpoll integration test, which
 * mocks the db layer the same query rides on. Everything else is real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Seam: control per-pool liveness without a DB. A Set of "live" pools backs
// the mock so each case states exactly which pools have a runner.
const live = vi.hoisted(() => ({ pools: new Set<string>() }));

vi.mock("@hanzo/platform/services/ci/arcd-runner", () => ({
	poolHasLiveRunner: vi.fn(async (pool: string) => live.pools.has(pool)),
}));

import { poolHasLiveRunner } from "@hanzo/platform/services/ci/arcd-runner";
import {
	type BuildTarget,
	resolveTarget,
} from "@hanzo/platform/services/ci/build-scheduler";
import type {
	DispatchMode,
	PlatformConfig,
} from "@hanzo/platform/services/ci/platform-config";

/** A minimal valid config; `dispatch` defaults to native unless overridden. */
function config(dispatch: DispatchMode = "native"): PlatformConfig {
	return {
		build: {
			matrix: [{ os: "linux", arch: "amd64" }],
			dockerfile: "./Dockerfile",
			context: ".",
			image: "ghcr.io/hanzoai/zip",
			tagPattern: "{{git.sha}}",
			push: true,
			dispatch,
		},
	};
}

const TENANT = "luxfi-linux-amd64";
const SHARED = "hanzo-linux-amd64";

describe("resolveTarget — ordered-pool dispatch resolution", () => {
	beforeEach(() => {
		live.pools.clear();
		vi.mocked(poolHasLiveRunner).mockClear();
		delete process.env.WORKFLOW_DISPATCH_FALLBACK;
	});

	it("(a) explicit pin: build.dispatch=workflow_dispatch ⇒ fallback, never probes a pool", async () => {
		live.pools.add(TENANT); // a live runner exists, but the pin wins
		const target = await resolveTarget(config("workflow_dispatch"), [
			TENANT,
			SHARED,
		]);
		expect(target).toEqual<BuildTarget>({ kind: "workflow_dispatch" });
		// Pinned path short-circuits before any liveness query.
		expect(poolHasLiveRunner).not.toHaveBeenCalled();
	});

	it("(b) env kill-switch: WORKFLOW_DISPATCH_FALLBACK=true ⇒ fallback, never probes a pool", async () => {
		process.env.WORKFLOW_DISPATCH_FALLBACK = "true";
		live.pools.add(TENANT);
		const target = await resolveTarget(config("native"), [TENANT, SHARED]);
		expect(target).toEqual<BuildTarget>({ kind: "workflow_dispatch" });
		expect(poolHasLiveRunner).not.toHaveBeenCalled();
	});

	it("(c) tenant pool live ⇒ native(tenant)", async () => {
		live.pools.add(TENANT);
		live.pools.add(SHARED); // both live; order decides
		const target = await resolveTarget(config("native"), [TENANT, SHARED]);
		expect(target).toEqual<BuildTarget>({ kind: "native", pool: TENANT });
	});

	it("(c) tenant dead + shared live ⇒ native(shared)", async () => {
		live.pools.add(SHARED);
		const target = await resolveTarget(config("native"), [TENANT, SHARED]);
		expect(target).toEqual<BuildTarget>({ kind: "native", pool: SHARED });
		// Probed tenant first (miss), then shared (hit).
		expect(poolHasLiveRunner).toHaveBeenNthCalledWith(1, TENANT, expect.any(Number));
		expect(poolHasLiveRunner).toHaveBeenNthCalledWith(2, SHARED, expect.any(Number));
	});

	it("(d) both dead ⇒ fallback after probing every pool", async () => {
		const target = await resolveTarget(config("native"), [TENANT, SHARED]);
		expect(target).toEqual<BuildTarget>({ kind: "workflow_dispatch" });
		expect(poolHasLiveRunner).toHaveBeenCalledTimes(2);
	});

	it("ORDER is the only priority signal: first live pool wins, later ones are not probed", async () => {
		// Both pools are live. Whichever is FIRST in the list is chosen, and the
		// resolver stops — it never probes the second. Reversing the order
		// reverses the winner, with no knowledge of 'tenant' vs 'shared'.
		live.pools.add(TENANT);
		live.pools.add(SHARED);

		const tenantFirst = await resolveTarget(config("native"), [TENANT, SHARED]);
		expect(tenantFirst).toEqual<BuildTarget>({ kind: "native", pool: TENANT });
		// Short-circuited on the first hit: shared was never queried.
		expect(poolHasLiveRunner).toHaveBeenCalledTimes(1);

		vi.mocked(poolHasLiveRunner).mockClear();

		const sharedFirst = await resolveTarget(config("native"), [SHARED, TENANT]);
		expect(sharedFirst).toEqual<BuildTarget>({ kind: "native", pool: SHARED });
		expect(poolHasLiveRunner).toHaveBeenCalledTimes(1);
	});

	it("threads `now` through to the liveness check", async () => {
		const now = 1_700_000_000_000;
		live.pools.add(TENANT);
		await resolveTarget(config("native"), [TENANT], now);
		expect(poolHasLiveRunner).toHaveBeenCalledWith(TENANT, now);
	});

	it("empty pool list ⇒ fallback (the de-duped list is never empty in prod, but the resolver is total)", async () => {
		const target = await resolveTarget(config("native"), []);
		expect(target).toEqual<BuildTarget>({ kind: "workflow_dispatch" });
		expect(poolHasLiveRunner).not.toHaveBeenCalled();
	});

	/**
	 * PRESERVED PROPERTY — zero behaviour change until runners self-register.
	 *
	 * arcd_runner is empty in prod today, so NO pool has a live runner. With
	 * the live-set empty (the prod state), every build — regardless of which
	 * pools the scheduler offers or their order — resolves to
	 * workflow_dispatch. The shared `hanzo-<os>-<arch>` tier is inert until a
	 * runner registers; flipping a pool to native is a runtime registration,
	 * not a config or code change.
	 */
	it("PRESERVED: empty arcd_runner (prod today) ⇒ every build still resolves to workflow_dispatch", async () => {
		// live.pools is empty == arcd_runner has no live rows.
		for (const pools of [
			[TENANT, SHARED],
			[SHARED, TENANT],
			[SHARED], // hanzoai/* repo: tenant pool IS the shared pool (de-duped)
		]) {
			const target = await resolveTarget(config("native"), pools);
			expect(target).toEqual<BuildTarget>({ kind: "workflow_dispatch" });
		}
	});
});
