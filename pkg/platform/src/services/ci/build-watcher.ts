/**
 * build-watcher — the autonomous heartbeat of the platform CI pipeline.
 *
 * BuildKit build Jobs cannot call back, so platform watches them: each tick it
 * reads every `running` buildJob's BuildKit Job and, when one terminates, hands
 * it to `completeBuild` (success → deploy → test → publish). It then ticks the
 * e2e + publish sub-stages of already-succeeded rows via `reconcilePostBuild`
 * until they reach a terminal state. This is what makes a push flow all the way
 * through with NO human polling — the watcher is the conductor's pulse.
 *
 * Mirrors the apps-inventory / billing scheduler pattern: idempotent start (a
 * module guard makes a second call a no-op), a leading run, then `setInterval`.
 * Every read is against the cluster + platform's own SQLite; failures are
 * logged and swallowed so a transient blip never stops future ticks. Started
 * from the custom server (`server/server.ts`) in-cluster; gate with
 * `BUILD_WATCHER_DISABLED=true`.
 */
import { type BuildJob, listBuildJobs } from "./build-job";
import { completeBuild, reconcilePostBuild } from "./build-completion";
import { buildNamespace, readBuildOutcome } from "./buildkit-job";
import { releaseHandle } from "../../lib/timer";

/** How often to poll in-flight build / e2e / publish Jobs (ms, default 15s). */
const INTERVAL_MS = Number.parseInt(
	process.env.BUILD_WATCHER_INTERVAL_MS || "15000",
	10,
);

let started = false;
let ticking = false;

/**
 * Advance one `running` build whose BuildKit Job has terminated.
 *
 * The build Job is read from `buildNamespace()` — the SAME seam the dispatcher
 * launches it through — not from a second literal. This watcher held its own
 * `CI_NAMESPACE = "hanzo"`, so it polled the application namespace for a Job
 * that only ever existed in `hanzo-build`: the read found nothing, `done` was
 * never true, and EVERY build stayed `running` with a null digest forever. The
 * builds themselves succeeded, so the failure was silent — deploy, e2e and
 * publish simply never fired, and the image had to be pinned into universe by
 * hand. One namespace, one seam; a literal here is the bug.
 */
async function advanceRunning(job: BuildJob): Promise<void> {
	if (!job.buildJobName) return; // not dispatched to a BuildKit Job (shouldn't happen)
	const outcome = await readBuildOutcome(buildNamespace(), job.buildJobName);
	if (!outcome.done) return;
	await completeBuild({
		buildJobId: job.buildJobId,
		outcome: outcome.succeeded ? "success" : "failure",
		digest: outcome.digest,
		error: outcome.reason,
		// The `logs` column existed and was never written: 436 failures, 0 logs.
		log: outcome.log,
	});
}

/** A succeeded row still has work while any sub-stage is non-terminal. */
function needsReconcile(job: BuildJob): boolean {
	return (
		job.e2eStatus === "queued" ||
		job.publishStatus === "pending" ||
		job.publishStatus === "queued"
	);
}

/** Run one watcher pass; logs the outcome, never throws. */
export async function runBuildWatcherOnce(): Promise<void> {
	if (ticking) return; // skip if the previous tick is still in flight
	ticking = true;
	try {
		const running = await listBuildJobs({ status: "running", limit: 200 });
		for (const job of running) {
			try {
				await advanceRunning(job);
			} catch (err) {
				console.error(`[build-watcher] advance ${job.buildJobId} failed`, err);
			}
		}

		const succeeded = await listBuildJobs({ status: "succeeded", limit: 200 });
		for (const job of succeeded.filter(needsReconcile)) {
			try {
				await reconcilePostBuild(job);
			} catch (err) {
				console.error(
					`[build-watcher] reconcile ${job.buildJobId} failed`,
					err,
				);
			}
		}
	} catch (err) {
		console.error("[build-watcher] tick failed", err);
	} finally {
		ticking = false;
	}
}

/** Start the watcher (idempotent): a leading run + interval. */
export function startBuildWatcher(): void {
	if (started) return;
	if (process.env.BUILD_WATCHER_DISABLED === "true") {
		console.log("[build-watcher] disabled via BUILD_WATCHER_DISABLED");
		return;
	}
	started = true;
	console.log(`[build-watcher] scheduler starting (every ${INTERVAL_MS}ms)`);
	void runBuildWatcherOnce();
	const handle = setInterval(() => void runBuildWatcherOnce(), INTERVAL_MS);
	releaseHandle(handle);
}
