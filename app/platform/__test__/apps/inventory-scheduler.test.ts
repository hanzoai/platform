/**
 * Scheduler watchdog — the guard that keeps the apps board from silently freezing.
 *
 * Each pass is gated by an in-flight boolean (`if (ticking) return`) so two passes
 * never overlap. That guard is correct only if every pass is guaranteed to finish:
 * the k8s and GitHub clients set no request timeout, so a socket that never answers
 * latches the guard `true` forever and every later tick is skipped — the board
 * freezes while the pod stays `1/1 Running` and logs nothing. That exact stall was
 * observed in production.
 *
 * These tests pin the contract that makes the stall self-healing: a pass that
 * outruns `APPS_TICK_TIMEOUT_MS` is abandoned, its guard is released, and the NEXT
 * tick runs. Behaviour only — driven through the exported `runInventoryOnce`, never
 * by reaching into the module's private state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TIMEOUT_MS = 50;

/** Mocked pass functions, re-created per test so call counts are independent. */
const syncInventory = vi.fn();
const syncReleases = vi.fn();
const applyDeclaredCRs = vi.fn();

vi.mock("@hanzo/platform/services/apps/inventory", () => ({
	syncInventory: (...a: unknown[]) => syncInventory(...a),
}));
vi.mock("@hanzo/platform/services/apps/release-reader", () => ({
	syncReleases: (...a: unknown[]) => syncReleases(...a),
}));
vi.mock("@hanzo/platform/services/apps/apply-declared", () => ({
	applyDeclaredCRs: (...a: unknown[]) => applyDeclaredCRs(...a),
}));

/** A pass that never settles — the wedged-socket case. */
const hang = () => new Promise<never>(() => {});
const ok = () =>
	Promise.resolve([
		{ cluster: "hanzo-k8s", observed: 1, upserted: 1, pruned: 0 },
	]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Import the scheduler fresh so it reads the env knobs at module load. */
async function loadScheduler() {
	vi.resetModules();
	process.env.APPS_TICK_TIMEOUT_MS = String(TIMEOUT_MS);
	process.env.PLATFORM_CRS_APPLY = "false"; // isolate the inventory pass
	return await import("@hanzo/platform/services/apps/inventory-scheduler");
}

describe("inventory scheduler watchdog", () => {
	beforeEach(() => {
		syncInventory.mockReset();
		syncReleases.mockReset();
		applyDeclaredCRs.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		process.env.APPS_TICK_TIMEOUT_MS = undefined as unknown as string;
	});

	it("skips a tick while the previous pass is genuinely in flight", async () => {
		const { runInventoryOnce } = await loadScheduler();
		syncInventory.mockImplementation(hang);

		void runInventoryOnce(); // latches the guard
		await runInventoryOnce(); // must be a no-op, not a second pass

		expect(syncInventory).toHaveBeenCalledTimes(1);
	});

	it("releases the guard after the watchdog fires, so the loop resumes", async () => {
		const { runInventoryOnce } = await loadScheduler();
		syncInventory.mockImplementationOnce(hang).mockImplementationOnce(ok);

		void runInventoryOnce(); // pass 1 hangs forever
		await wait(TIMEOUT_MS * 3); // watchdog abandons it

		await runInventoryOnce(); // THE regression: this used to be skipped forever

		expect(syncInventory).toHaveBeenCalledTimes(2);
	});

	it("logs the abandoned pass instead of failing silently", async () => {
		const { runInventoryOnce } = await loadScheduler();
		syncInventory.mockImplementation(hang);
		const err = vi.spyOn(console, "error").mockImplementation(() => {});

		void runInventoryOnce();
		await wait(TIMEOUT_MS * 3);

		expect(err).toHaveBeenCalled();
		const logged = err.mock.calls.flat().map(String).join(" ");
		expect(logged).toMatch(/exceeded .*ms — abandoned|sync failed/);
	});

	it("never throws out of a pass — a failing sync is swallowed and the guard freed", async () => {
		const { runInventoryOnce } = await loadScheduler();
		syncInventory
			.mockImplementationOnce(() => Promise.reject(new Error("apiserver down")))
			.mockImplementationOnce(ok);

		await expect(runInventoryOnce()).resolves.toBeUndefined();
		await runInventoryOnce();

		expect(syncInventory).toHaveBeenCalledTimes(2);
	});
});
