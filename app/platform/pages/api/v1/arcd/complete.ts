/**
 * arcd build completion — POST /v1/arcd/complete
 *
 * A registered arcd runner calls this once it has built and (per push policy)
 * pushed the image to GHCR. Platform records the terminal status, persists the
 * image digest + logs reference, and on success hands the job to the
 * DeployExecutor for rollout — the same completion path the legacy
 * /v1/build-callback drives, but authenticated by the runner's HMAC rather than
 * a static bearer token.
 *
 * Body (JSON, HMAC-signed):
 *   {
 *     "job_id":       "<buildJobId>",
 *     "status":       "success" | "failed",
 *     "installation_id": "<id>",        // echoed from the poll payload
 *     "image_digest": "sha256:...",     // optional, recorded on success
 *     "logs_url":     "https://...",    // optional, recorded as a log line
 *     "error":        "..."             // optional, recorded on failure
 *   }
 *
 * Auth: HMAC-SHA256 over the raw body keyed by the runner's secret, exactly as
 * the poll endpoint. Headers X-Arcd-Runner + X-Arcd-Signature.
 */
import { authenticateRunner } from "@hanzo/platform/services/ci/arcd-runner";
import { completeBuild } from "@hanzo/platform/services/ci/build-completion";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
	api: {
		bodyParser: false,
	},
};

async function readRawBody(req: NextApiRequest): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function header(req: NextApiRequest, name: string): string | undefined {
	const v = req.headers[name];
	return Array.isArray(v) ? v[0] : v;
}

interface CompleteBody {
	job_id?: string;
	status?: string;
	installation_id?: string;
	image_digest?: string;
	logs_url?: string;
	error?: string;
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

	const rawBody = await readRawBody(req);

	let body: CompleteBody;
	try {
		body = JSON.parse(rawBody) as CompleteBody;
	} catch {
		res.status(400).json({ message: "Body is not valid JSON" });
		return;
	}

	try {
		await authenticateRunner({
			runnerId: header(req, "x-arcd-runner"),
			signature: header(req, "x-arcd-signature"),
			rawBody,
		});
	} catch (err) {
		if (err instanceof TRPCError && err.code === "UNAUTHORIZED") {
			res.status(401).json({ message: err.message });
			return;
		}
		res.status(500).json({
			message: `complete auth failed: ${(err as Error).message}`,
		});
		return;
	}

	if (!body.job_id) {
		res.status(400).json({ message: "Missing job_id" });
		return;
	}
	if (body.status !== "success" && body.status !== "failed") {
		res.status(400).json({ message: "status must be 'success' or 'failed'" });
		return;
	}
	// installation_id is OPTIONAL: GitHub-App-driven builds carry it (so the
	// deploy config can be re-read at completion); GitHub-free direct builds
	// (enqueueDirectBuild) leave it empty, and completeBuild treats that as
	// build-only (no operator rollout). Don't reject an empty value.

	// Fold the digest + logs pointer into the persisted build log so the record
	// is self-contained even before object-storage log offload lands.
	const logParts: string[] = [];
	if (body.image_digest) logParts.push(`image_digest=${body.image_digest}`);
	if (body.logs_url) logParts.push(`logs_url=${body.logs_url}`);
	const log = logParts.length ? logParts.join(" ") : undefined;

	try {
		const result = await completeBuild({
			buildJobId: body.job_id,
			outcome: body.status === "success" ? "success" : "failure",
			installationId: body.installation_id ?? "",
			log,
			error: body.error,
		});
		res.status(200).json(result);
	} catch (err) {
		if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
			res.status(400).json({ message: err.message });
			return;
		}
		res.status(500).json({
			message: `Failed to complete build: ${(err as Error).message}`,
		});
	}
}
