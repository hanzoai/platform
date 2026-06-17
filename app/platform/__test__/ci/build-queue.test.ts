import {
	BuildQueue,
	type QueuedBuild,
} from "@hanzo/platform/services/ci/build-queue";
import { describe, expect, it } from "vitest";

function build(id: string): QueuedBuild {
	return {
		buildJobId: id,
		repo: "hanzoai/zip",
		sha: "a".repeat(40),
		ref: "refs/heads/main",
		branch: "main",
		target: "linux/amd64",
		image: `ghcr.io/hanzoai/zip:${id}`,
		dockerfile: "./Dockerfile",
		context: ".",
		push: true,
		installationId: "42",
	};
}

/** A controllable AbortController standing in for the long-poll hold/timeout. */
function neverAborts(): AbortSignal {
	return new AbortController().signal;
}

describe("BuildQueue — real channel (no mocks)", () => {
	const POOL = "hanzoai-linux-amd64";

	it("hands a backlogged build to an immediate wait", async () => {
		const q = new BuildQueue();
		q.enqueue(POOL, build("j1"));
		expect(q.backlogSize(POOL)).toBe(1);
		const got = await q.wait(POOL, neverAborts());
		expect(got?.buildJobId).toBe("j1");
		expect(q.backlogSize(POOL)).toBe(0);
	});

	it("resolves a parked waiter when a build is later enqueued", async () => {
		const q = new BuildQueue();
		const pending = q.wait(POOL, neverAborts());
		// No build yet: the waiter is parked.
		expect(q.waiterCount(POOL)).toBe(1);
		q.enqueue(POOL, build("j2"));
		const got = await pending;
		expect(got?.buildJobId).toBe("j2");
		expect(q.waiterCount(POOL)).toBe(0);
		expect(q.backlogSize(POOL)).toBe(0);
	});

	it("returns null when the wait aborts before any build arrives (204 path)", async () => {
		const q = new BuildQueue();
		const ctrl = new AbortController();
		const pending = q.wait(POOL, ctrl.signal);
		expect(q.waiterCount(POOL)).toBe(1);
		ctrl.abort();
		expect(await pending).toBeNull();
		// Aborted waiter is removed, so it cannot capture a later build.
		expect(q.waiterCount(POOL)).toBe(0);
	});

	it("returns null immediately when the signal is already aborted", async () => {
		const q = new BuildQueue();
		const ctrl = new AbortController();
		ctrl.abort();
		expect(await q.wait(POOL, ctrl.signal)).toBeNull();
		expect(q.waiterCount(POOL)).toBe(0);
	});

	it("delivers FIFO across multiple parked waiters", async () => {
		const q = new BuildQueue();
		const a = q.wait(POOL, neverAborts());
		const b = q.wait(POOL, neverAborts());
		expect(q.waiterCount(POOL)).toBe(2);
		q.enqueue(POOL, build("first"));
		q.enqueue(POOL, build("second"));
		expect((await a)?.buildJobId).toBe("first");
		expect((await b)?.buildJobId).toBe("second");
	});

	it("re-homes a build when its target waiter aborted in the same tick", async () => {
		const q = new BuildQueue();
		const ctrl = new AbortController();
		const aborted = q.wait(POOL, ctrl.signal);
		ctrl.abort();
		expect(await aborted).toBeNull();
		// The aborted waiter is gone; a fresh enqueue must backlog, not vanish.
		q.enqueue(POOL, build("survivor"));
		expect(q.backlogSize(POOL)).toBe(1);
		const got = await q.wait(POOL, neverAborts());
		expect(got?.buildJobId).toBe("survivor");
	});

	it("isolates pools — a build for one pool never wakes another's waiter", async () => {
		const q = new BuildQueue();
		const other = q.wait("hanzoai-linux-arm64", neverAborts());
		q.enqueue(POOL, build("amd-only"));
		// The arm64 waiter stays parked; the amd64 build backlogs on its own pool.
		expect(q.waiterCount("hanzoai-linux-arm64")).toBe(1);
		expect(q.backlogSize(POOL)).toBe(1);
		// Sanity: draining the amd64 pool does not settle the arm64 waiter.
		await q.wait(POOL, neverAborts());
		let settled = false;
		void other.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
	});
});
