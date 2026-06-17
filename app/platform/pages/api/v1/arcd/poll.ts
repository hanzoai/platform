/**
 * arcd long-poll — POST /v1/arcd/poll
 *
 * Native replacement for GitHub's `workflow_dispatch`. A registered arcd runner
 * long-polls this endpoint with its pool; the request parks up to HOLD_MS on
 * the per-pool waiter. It returns:
 *   - 200 + a `QueuedBuild` JSON body when a job is (or becomes) available, or
 *   - 204 No Content when the hold window elapses with no job.
 * The runner reconnects immediately on 204.
 *
 * Auth: HMAC-SHA256 over the raw request body, keyed by the runner's shared
 * secret (the `arcd_runner` row). Headers:
 *   X-Arcd-Runner:    <runnerId>
 *   X-Arcd-Signature: sha256=<hex>
 * The body is `{ "pool": "<pool-label>", "runner_id": "<id>" }`; the runner_id
 * field must match the X-Arcd-Runner header (and thus the signed identity).
 *
 * Raw-body handling: Next's JSON body parser is disabled so we HMAC the exact
 * bytes the runner signed (re-stringifying would not round-trip).
 */
import { authenticateRunner } from "@hanzo/platform/services/ci/arcd-runner";
import { buildQueue } from "@hanzo/platform/services/ci/build-queue";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
	api: {
		bodyParser: false,
	},
};

/** Long-poll hold window. arcd reconnects on the 204 that follows it. */
const HOLD_MS = 30_000;

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

	let body: { pool?: string; runner_id?: string };
	try {
		body = JSON.parse(rawBody) as { pool?: string; runner_id?: string };
	} catch {
		res.status(400).json({ message: "Body is not valid JSON" });
		return;
	}
	if (!body.pool) {
		res.status(400).json({ message: "Missing `pool`" });
		return;
	}

	const runnerId = header(req, "x-arcd-runner");
	try {
		const runner = await authenticateRunner({
			runnerId,
			signature: header(req, "x-arcd-signature"),
			rawBody,
		});
		// The runner may only poll the pool it registered for, and the body's
		// runner_id must match the signed identity. Both guard against a leaked
		// secret being used to drain a different pool's queue.
		if (body.runner_id && body.runner_id !== runner.runnerId) {
			res.status(400).json({ message: "runner_id does not match X-Arcd-Runner" });
			return;
		}
		if (body.pool !== runner.poolLabel) {
			res.status(403).json({
				message: `runner ${runner.runnerId} is registered for pool ${runner.poolLabel}, not ${body.pool}`,
			});
			return;
		}
	} catch (err) {
		if (err instanceof TRPCError && err.code === "UNAUTHORIZED") {
			res.status(401).json({ message: err.message });
			return;
		}
		res.status(500).json({
			message: `poll auth failed: ${(err as Error).message}`,
		});
		return;
	}

	// Park on the per-pool waiter. Abort on the hold deadline OR when the client
	// disconnects (Next surfaces this via req `close`), so a dropped runner
	// frees its waiter slot immediately instead of holding a job hostage.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HOLD_MS);
	const onClose = () => controller.abort();
	res.on("close", onClose);

	try {
		const build = await buildQueue.wait(body.pool, controller.signal);
		if (!build) {
			res.status(204).end();
			return;
		}
		res.status(200).json(build);
	} finally {
		clearTimeout(timer);
		res.off("close", onClose);
	}
}
