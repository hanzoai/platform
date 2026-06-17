/**
 * arcd-runner service — registration, HMAC auth, and liveness for the native
 * long-poll protocol.
 *
 * Auth model: every poll/complete request carries
 *   X-Arcd-Runner:    <runnerId>
 *   X-Arcd-Signature: sha256=<hex hmac of the raw request body>
 * The runner's `secret` (from the `arcd_runner` row) keys the HMAC. We verify
 * in constant time. This is the same shape as the GitHub webhook HMAC, reused
 * deliberately — one verification idiom across the CI surface.
 *
 * Liveness drives migration: a pool is "served natively" once at least one
 * registered runner for that pool has a `lastSeen` within RUNNER_STALE_MS. The
 * BuildScheduler consults `poolHasLiveRunner` to decide native-enqueue vs the
 * `workflow_dispatch` fallback.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, eq } from "@hanzo/platform/db";
import { type ArcdRunner, arcdRunner } from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";

/**
 * A runner is considered live if it polled within this window. The poll hold is
 * 30s and arcd reconnects immediately on 204, so a healthy runner refreshes
 * `lastSeen` at least every ~30s. 90s tolerates two missed cycles before a pool
 * falls back to `workflow_dispatch`.
 */
export const RUNNER_STALE_MS = 90_000;

export async function registerRunner(input: {
	runnerId: string;
	poolLabel: string;
	secret: string;
}): Promise<ArcdRunner> {
	const now = new Date().toISOString();
	const row = await db
		.insert(arcdRunner)
		.values({ ...input, lastSeen: now })
		.onConflictDoUpdate({
			target: arcdRunner.runnerId,
			set: { poolLabel: input.poolLabel, secret: input.secret, lastSeen: now },
		})
		.returning()
		.then((r) => r[0]);
	if (!row) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to register arcd runner",
		});
	}
	return row;
}

export async function findRunner(
	runnerId: string,
): Promise<ArcdRunner | undefined> {
	return db.query.arcdRunner.findFirst({
		where: eq(arcdRunner.runnerId, runnerId),
	});
}

export async function touchRunner(runnerId: string): Promise<void> {
	await db
		.update(arcdRunner)
		.set({ lastSeen: new Date().toISOString() })
		.where(eq(arcdRunner.runnerId, runnerId));
}

/**
 * True when at least one registered runner for `pool` has reported within
 * RUNNER_STALE_MS. Used by the scheduler to gate the native path.
 */
export async function poolHasLiveRunner(
	pool: string,
	now: number = Date.now(),
): Promise<boolean> {
	const runners = await db.query.arcdRunner.findMany({
		where: eq(arcdRunner.poolLabel, pool),
	});
	return runners.some((r) => isFresh(r.lastSeen, now));
}

function isFresh(lastSeen: string | null, now: number): boolean {
	if (!lastSeen) return false;
	const t = Date.parse(lastSeen);
	return Number.isFinite(t) && now - t <= RUNNER_STALE_MS;
}

/**
 * Compute the canonical signature header value for a raw body under a secret.
 * Exported so the integration test (and arcd's Go side, by mirror) sign
 * identically.
 */
export function signBody(rawBody: string, secret: string): string {
	return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * Constant-time verification of `X-Arcd-Signature` against the raw body and the
 * runner's secret. Returns false on any malformed input — never throws.
 */
export function verifyRunnerSignature(
	rawBody: string,
	signatureHeader: string | undefined,
	secret: string,
): boolean {
	if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
	const expected = signBody(rawBody, secret);
	const a = Buffer.from(signatureHeader);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * Resolve + authenticate a runner from request headers and raw body. Throws
 * TRPCError(UNAUTHORIZED) when the runner is unknown or the HMAC fails. On
 * success, refreshes the runner's `lastSeen` and returns the row.
 */
export async function authenticateRunner(input: {
	runnerId: string | undefined;
	signature: string | undefined;
	rawBody: string;
}): Promise<ArcdRunner> {
	if (!input.runnerId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Missing X-Arcd-Runner header",
		});
	}
	const runner = await findRunner(input.runnerId);
	if (!runner) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: `Unknown runner ${input.runnerId}`,
		});
	}
	if (!verifyRunnerSignature(input.rawBody, input.signature, runner.secret)) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Invalid runner signature",
		});
	}
	await touchRunner(runner.runnerId);
	return runner;
}
