/**
 * build-completion — the post-build orchestrator.
 *
 * When a build Job terminates, `completeBuild` records the outcome and, on
 * success, drives the rest of the pipeline: PROMOTE (smoke the exact image, then
 * commit its digest to universe) → TEST (e2e Job) → PUBLISH (npm/pypi Job). It
 * is the single shared brain used by BOTH the build-watcher (which polls the
 * BuildKit Job and calls in when it finishes) and the `/v1/build-callback` REST
 * hook (for an external builder that reports its own result).
 *
 * Deploy / e2e / publish intent is read from the repo's `hanzo.yml` via the
 * pod's `GH_TOKEN` — no GitHub App required, so the App-free direct-build path
 * gets a full build→deploy→test→publish lifecycle too. The source of truth is
 * always the repo at that ref; nothing is trusted from a cached config.
 *
 * `reconcilePostBuild` is the idempotent follow-up the watcher ticks for a
 * succeeded row until its e2e + publish sub-stages reach a terminal state:
 *   - e2e queued → poll the e2e Job → passed/failed; a passing e2e releases a
 *     publish that was gated behind it; a failing e2e skips publish.
 *   - publish queued → poll the publish Job → published/failed.
 */

import { TRPCError } from "@trpc/server";
import {
	appendBuildLog,
	type BuildJob,
	findBuildJobById,
	markBuildFailed,
	markBuildSucceeded,
	updateBuildJob,
} from "./build-job";
import { fetchBuiltConfig } from "./build-scheduler";
import { readJobStatus } from "./buildkit-job";
import { runE2e } from "./e2e-runner";
import type { PublishConfig } from "./platform-config";
import { type Promotion, promoteBuild } from "./promote";
import { launchPublishJob } from "./publish-job";

/** Namespace the platform launches its CI Jobs into. */
const CI_NAMESPACE = "hanzo";

export interface BuildCompletionInput {
	buildJobId: string;
	outcome: "success" | "failure";
	/** Image digest recorded on success (build evidence). */
	digest?: string;
	/** Optional final log tail to persist. */
	log?: string;
	/** Optional error message on failure. */
	error?: string;
	/** Accepted for REST back-compat; config is read via GH_TOKEN, so unused. */
	installationId?: string;
}

export interface BuildCompletionResult {
	status: "succeeded" | "failed";
	promotion?: Promotion;
}

export async function completeBuild(
	input: BuildCompletionInput,
): Promise<BuildCompletionResult> {
	const job = await findBuildJobById(input.buildJobId);

	if (job.status !== "running" && job.status !== "queued") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Build job ${job.buildJobId} is already terminal (${job.status})`,
		});
	}

	if (input.log) await appendBuildLog(job.buildJobId, input.log);

	if (input.outcome === "failure") {
		await markBuildFailed(
			job.buildJobId,
			input.error ?? "build runner reported failure",
		);
		return { status: "failed" };
	}

	if (input.digest) {
		await updateBuildJob(job.buildJobId, { imageDigest: input.digest });
	}
	const succeeded = await markBuildSucceeded(job.buildJobId);
	const promotion = await initPostBuild(succeeded);
	return { status: "succeeded", promotion };
}

/**
 * On build success: promote (if `deploy:`), launch e2e (if `e2e:` and a new pin
 * landed), and arm publish (if `publish:`). Each sub-stage's state is stamped on
 * the row so `reconcilePostBuild` can advance it idempotently and the board
 * reflects the true pipeline position.
 *
 * `promoteBuild` owns the whole promotion decision and never throws, so a
 * refused or failed promotion cannot cost this build its publish stage. What it
 * cannot do is promote quietly: `promoted` is true only when a new image was
 * committed to universe.
 */
async function initPostBuild(job: BuildJob): Promise<Promotion> {
	const config = await fetchBuiltConfig(job.repo, job.sha);

	const promotion = await promoteBuild(job, config?.deploy);
	const deployed = promotion.promoted;

	// e2e runs against the LIVE service, so it only fires when a new pin landed —
	// that is the only case where a rollout is coming. CD reconciles it out of
	// band, so this races the rollout exactly as it raced the operator before.
	if (config?.e2e && deployed) {
		const e2e = await runE2e({
			spec: config.e2e.spec,
			baseDomain: config.e2e.baseDomain,
			ref: config.e2e.ref,
		});
		await updateBuildJob(job.buildJobId, {
			e2eJobName: e2e.jobName,
			e2eStatus: "queued",
		});
	} else {
		await updateBuildJob(job.buildJobId, { e2eStatus: "skipped" });
	}

	// Publish (library/SDK repos). Gate behind e2e only when e2e actually runs.
	if (config?.publish) {
		const gateOnE2e = Boolean(config.e2e && deployed);
		await updateBuildJob(job.buildJobId, {
			publishSpec: JSON.stringify(config.publish),
			publishStatus: gateOnE2e ? "pending" : "queued",
		});
		if (!gateOnE2e) {
			await launchPublish(job, config.publish);
		}
	} else {
		await updateBuildJob(job.buildJobId, { publishStatus: "skipped" });
	}

	return promotion;
}

/** Launch the publish Job and record its name. */
async function launchPublish(
	job: BuildJob,
	publish: PublishConfig,
): Promise<void> {
	const pub = await launchPublishJob({
		repo: job.repo,
		branch: job.branch,
		publish,
		buildJobId: job.buildJobId,
	});
	await updateBuildJob(job.buildJobId, {
		publishStatus: "queued",
		publishJobName: pub.jobName,
	});
}

/**
 * Idempotently advance a succeeded build's e2e + publish sub-stages. Safe to
 * call every tick: it only acts on `queued`/`pending` sub-states and no-ops
 * once both are terminal.
 */
export async function reconcilePostBuild(job: BuildJob): Promise<void> {
	// e2e in flight → poll it.
	if (job.e2eStatus === "queued" && job.e2eJobName) {
		const o = await readJobStatus(CI_NAMESPACE, job.e2eJobName);
		if (!o.done) return;
		await updateBuildJob(job.buildJobId, {
			e2eStatus: o.succeeded ? "passed" : "failed",
		});
		if (job.publishStatus === "pending" && job.publishSpec) {
			if (o.succeeded) {
				await launchPublish(job, JSON.parse(job.publishSpec) as PublishConfig);
			} else {
				// Never publish a build whose e2e failed.
				await updateBuildJob(job.buildJobId, { publishStatus: "skipped" });
			}
		}
		return;
	}

	// publish in flight → poll it.
	if (job.publishStatus === "queued" && job.publishJobName) {
		const o = await readJobStatus(CI_NAMESPACE, job.publishJobName);
		if (!o.done) return;
		await updateBuildJob(job.buildJobId, {
			publishStatus: o.succeeded ? "published" : "failed",
		});
	}
}
