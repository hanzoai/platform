/**
 * build-queue — in-process, per-pool long-poll dispatch fabric.
 *
 * This is the native replacement for GitHub's `workflow_dispatch` hop. When
 * the BuildScheduler accepts a build it enqueues a `QueuedBuild` keyed by the
 * job's `runnerPool`. An arcd runner long-polls `POST /v1/arcd/poll` with its
 * pool; the request parks on a per-pool waiter until either a build is
 * available or the hold window elapses.
 *
 * Why a hand-rolled channel and not a queue library:
 *   - The durable system-of-record is already the `build_job` table. This
 *     fabric only carries the *wakeup* — "a job for pool P is ready, go claim
 *     it" — so the data plane is the DB, not this structure. No new queue tech.
 *   - Long-poll semantics (30s hold, immediate handoff, 204 on timeout) are a
 *     few dozen lines of Promise plumbing; a library would add a dependency and
 *     obscure the back-pressure model.
 *
 * Concurrency model (single Node process, event-loop serialized):
 *   - `enqueue(pool, build)`: if a waiter is parked for `pool`, hand the build
 *     to the oldest waiter (FIFO) and resolve it. Otherwise push onto the
 *     pool's backlog.
 *   - `wait(pool, signal)`: if the backlog is non-empty, shift and return
 *     immediately. Otherwise park a waiter and return a Promise that resolves
 *     with the next enqueued build, or `null` when `signal` aborts (timeout /
 *     client disconnect).
 *
 * Exactly-once handoff: a build is delivered to exactly one waiter. A build
 * claimed by a waiter that later aborts before the resolve runs is
 * re-enqueued (see `wait`'s abort handler), so a racing timeout never drops a
 * job on the floor.
 *
 * This module is process-local. Platform runs as a single Next.js instance for
 * the CI control plane; horizontal scale-out would move the wakeup to LISTEN/
 * NOTIFY on the same Postgres that already holds `build_job`. That is a
 * deployment-topology change, not a code change here — the `enqueue`/`wait`
 * contract is the seam.
 */

/** The wakeup payload an arcd runner receives from a long-poll. */
export interface QueuedBuild {
	buildJobId: string;
	repo: string;
	sha: string;
	ref: string;
	branch: string;
	/** Build matrix target, e.g. `linux/amd64`. */
	target: string;
	/** Image reference to build + push, e.g. `ghcr.io/hanzoai/zip:<sha>`. */
	image: string;
	/** Path to the Dockerfile within the checkout. */
	dockerfile: string;
	/** Docker build context directory. */
	context: string;
	/** Whether the runner should push the built image. */
	push: boolean;
	/** Installation id the runner echoes back on completion. */
	installationId: string;
}

interface Waiter {
	resolve: (build: QueuedBuild | null) => void;
	/** Settled guard so a build is never handed to an already-resolved waiter. */
	settled: boolean;
}

/**
 * Per-pool FIFO backlog + waiter list. One `BuildQueue` instance is shared
 * process-wide (see the module singleton below).
 */
export class BuildQueue {
	private backlogs = new Map<string, QueuedBuild[]>();
	private waiters = new Map<string, Waiter[]>();

	/**
	 * Enqueue a build for a pool. Hands it directly to the oldest parked
	 * waiter if one exists (FIFO), else appends to the pool backlog.
	 */
	enqueue(pool: string, build: QueuedBuild): void {
		const waiting = this.waiters.get(pool);
		while (waiting && waiting.length > 0) {
			const waiter = waiting.shift();
			if (!waiter) break;
			if (waiter.settled) continue; // aborted while parked; skip it
			waiter.settled = true;
			waiter.resolve(build);
			return;
		}
		const backlog = this.backlogs.get(pool);
		if (backlog) {
			backlog.push(build);
		} else {
			this.backlogs.set(pool, [build]);
		}
	}

	/**
	 * Long-poll for the next build on `pool`. Resolves immediately with a
	 * backlogged build when one is available; otherwise parks until a build is
	 * enqueued or `signal` aborts (returns `null` on abort).
	 *
	 * The returned promise never rejects — an aborted wait is a normal 204, not
	 * an error.
	 */
	wait(pool: string, signal: AbortSignal): Promise<QueuedBuild | null> {
		const backlog = this.backlogs.get(pool);
		if (backlog && backlog.length > 0) {
			const build = backlog.shift();
			if (backlog.length === 0) this.backlogs.delete(pool);
			return Promise.resolve(build ?? null);
		}

		if (signal.aborted) return Promise.resolve(null);

		return new Promise<QueuedBuild | null>((resolve) => {
			const waiter: Waiter = { settled: false, resolve };

			const onAbort = () => {
				if (waiter.settled) return;
				waiter.settled = true;
				this.removeWaiter(pool, waiter);
				resolve(null);
			};
			signal.addEventListener("abort", onAbort, { once: true });

			// Wrap resolve so the abort listener is always detached, and a build
			// delivered to a since-aborted waiter is re-enqueued (never dropped).
			waiter.resolve = (build) => {
				signal.removeEventListener("abort", onAbort);
				if (signal.aborted && build) {
					// Lost the race to the abort: re-home the build for the next poller.
					this.enqueue(pool, build);
					resolve(null);
					return;
				}
				resolve(build);
			};

			const list = this.waiters.get(pool);
			if (list) {
				list.push(waiter);
			} else {
				this.waiters.set(pool, [waiter]);
			}
		});
	}

	private removeWaiter(pool: string, waiter: Waiter): void {
		const list = this.waiters.get(pool);
		if (!list) return;
		const idx = list.indexOf(waiter);
		if (idx >= 0) list.splice(idx, 1);
		if (list.length === 0) this.waiters.delete(pool);
	}

	/** Number of builds backlogged for a pool (no waiter consumed them yet). */
	backlogSize(pool: string): number {
		return this.backlogs.get(pool)?.length ?? 0;
	}

	/** Number of runners currently parked on a pool. */
	waiterCount(pool: string): number {
		return this.waiters.get(pool)?.length ?? 0;
	}
}

/**
 * Process-wide singleton. Pinned on `globalThis` so Next.js' dev-mode module
 * re-evaluation (and the test harness' module graph) share ONE queue instance
 * across the webhook route, the poll route, and the scheduler — a fresh queue
 * per import would silently drop every handoff.
 */
const globalForQueue = globalThis as unknown as { __hanzoBuildQueue?: BuildQueue };

export const buildQueue: BuildQueue =
	globalForQueue.__hanzoBuildQueue ??
	(globalForQueue.__hanzoBuildQueue = new BuildQueue());
