/**
 * build-completion — closes the loop after an arcd runner finishes a build.
 *
 * The platform-build workflow (running on an arcd runner) calls back into
 * platform with the build-job id, outcome, and image digest once the image
 * has been built and pushed to GHCR. This module records that outcome and,
 * on success, hands the job to the DeployExecutor.
 *
 * This is the completion side of the arcd-protocol decision: since arcd jobs
 * are dispatched via workflow_dispatch (fire-and-forget from platform's view),
 * the build reports its own terminal status back here. No polling of GitHub's
 * run API is required.
 */

import { authGithub } from "@hanzo/platform/utils/providers/github";
import { TRPCError } from "@trpc/server";
import { findGithubByInstallationId } from "../github";
import {
	appendBuildLog,
	findBuildJobById,
	markBuildFailed,
	markBuildSucceeded,
} from "./build-job";
import { fetchPlatformConfig } from "./build-scheduler";
import { type DeployResult, executeDeploy } from "./deploy-executor";

export interface BuildCompletionInput {
	buildJobId: string;
	outcome: "success" | "failure";
	/** Installation id used to re-read deploy config on success. */
	installationId: string;
	/** Optional final log tail to persist. */
	log?: string;
	/** Optional error message on failure. */
	error?: string;
}

export interface BuildCompletionResult {
	status: "succeeded" | "failed";
	deploy?: DeployResult;
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

	if (input.log) {
		await appendBuildLog(job.buildJobId, input.log);
	}

	if (input.outcome === "failure") {
		await markBuildFailed(
			job.buildJobId,
			input.error ?? "build runner reported failure",
		);
		return { status: "failed" };
	}

	const succeeded = await markBuildSucceeded(job.buildJobId);

	// GitHub-free direct builds (enqueueDirectBuild) carry no installation id:
	// there is no `.platform.yml` to read deploy config from, so the build
	// stands as build-only with no operator rollout. This is the correct
	// terminal state for a manually-specified build, not an error.
	if (!input.installationId) {
		return { status: "succeeded" };
	}

	// Re-read deploy config from the same ref the build ran against. We do
	// not trust a cached config — the source of truth is the repo at that SHA.
	const provider = await resolveProvider(input.installationId);
	const config = await fetchPlatformConfig(provider, job.repo, job.sha);
	if (!config) {
		// .platform.yml vanished between dispatch and completion: nothing to
		// deploy, but the build itself stands.
		return { status: "succeeded" };
	}

	const deploy = await executeDeploy(succeeded, config.deploy);
	return { status: "succeeded", deploy };
}

async function resolveProvider(installationId: string) {
	const row = await findGithubByInstallationId(installationId);
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `No GitHub provider for installation ${installationId}`,
		});
	}
	// Validate creds resolve before handing to fetchPlatformConfig.
	authGithub(row as Parameters<typeof authGithub>[0]);
	return row as Parameters<typeof authGithub>[0];
}
