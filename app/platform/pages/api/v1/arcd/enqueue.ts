/**
 * Direct build enqueue — POST /v1/arcd/enqueue
 *
 * The GitHub-App-free trigger for platform-native CI. The webhook path
 * (/v1/github-webhook) derives a build from `.platform.yml` at a SHA; this
 * route lets an operator (or a repo not wired to the GitHub App) enqueue a
 * build by stating it explicitly. The downstream is identical — it reuses
 * `enqueueDirectBuild` → `createBuildJob` + the native long-poll fabric — so
 * there is exactly ONE queue and ONE arcd protocol, two front doors.
 *
 * This is the canonical "no GitHub builders" path: it dispatches ONLY natively
 * (it requires a live registered arcd runner for the target pool) and never
 * falls back to workflow_dispatch, so a build can be driven entirely through
 * platform without GitHub Actions.
 *
 * Auth: the shared machine-to-machine bearer token PLATFORM_BUILD_CALLBACK_TOKEN
 * (same credential as /v1/build-callback) — this is an infra surface, not a
 * user-facing one, so it does not use the IAM session.
 *
 * Body (JSON):
 *   {
 *     "repo":   "hanzoai/arc",                       // owner/name (pool org)
 *     "sha":    "<full or short commit sha>",
 *     "image":  "ghcr.io/hanzoai/arc:<tag>",         // image to build + push
 *     "branch": "main",                              // optional (default main)
 *     "ref":    "refs/heads/main",                   // optional
 *     "dockerfile": "./Dockerfile",                  // optional
 *     "context":    ".",                             // optional
 *     "os":   "linux", "arch": "amd64",              // optional (default linux/amd64)
 *     "organizationId": "<org id>"                   // optional (default DEFAULT_BUILD_ORG_ID)
 *   }
 */
import { enqueueDirectBuild } from "@hanzo/platform/services/ci";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

interface EnqueueBody {
	repo?: string;
	sha?: string;
	image?: string;
	branch?: string;
	ref?: string;
	dockerfile?: string;
	context?: string;
	/** Docker build stage (`--target`) for multi-stage Dockerfiles. */
	dockerTarget?: string;
	os?: "linux" | "darwin" | "windows";
	arch?: "amd64" | "arm64";
	organizationId?: string;
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST"]);
		res.status(405).json({ message: `Method ${req.method} not allowed` });
		return;
	}

	const expected = process.env.PLATFORM_BUILD_CALLBACK_TOKEN;
	if (!expected) {
		res.status(500).json({
			message: "PLATFORM_BUILD_CALLBACK_TOKEN is not configured on the server",
		});
		return;
	}
	if (req.headers.authorization !== `Bearer ${expected}`) {
		res.status(401).json({ message: "Invalid enqueue token" });
		return;
	}

	const body = req.body as EnqueueBody;
	if (!body?.repo || !body?.sha || !body?.image) {
		res.status(400).json({ message: "Missing required field(s): repo, sha, image" });
		return;
	}

	const organizationId =
		body.organizationId ?? process.env.DEFAULT_BUILD_ORG_ID;
	if (!organizationId) {
		res.status(400).json({
			message:
				"organizationId is required (no DEFAULT_BUILD_ORG_ID configured on the server)",
		});
		return;
	}

	try {
		const job = await enqueueDirectBuild({
			repo: body.repo,
			sha: body.sha,
			image: body.image,
			branch: body.branch,
			ref: body.ref,
			dockerfile: body.dockerfile,
			context: body.context,
			dockerTarget: body.dockerTarget,
			os: body.os,
			arch: body.arch,
			organizationId,
		});
		res.status(202).json({
			buildJobId: job.buildJobId,
			status: job.status,
			runnerPool: job.runnerPool,
			image: job.image,
			target: job.target,
		});
	} catch (err) {
		if (err instanceof TRPCError) {
			// CONFLICT (no live runner for the pool) → 409; everything else → 400.
			const code = err.code === "CONFLICT" ? 409 : 400;
			res.status(code).json({ message: err.message });
			return;
		}
		res.status(500).json({ message: `enqueue failed: ${(err as Error).message}` });
	}
}
