/**
 * Platform-native CI/CD webhook — POST /v1/git-webhook
 *
 * The ONE front door for git-forge deliveries. Accepts `push` /
 * `pull_request` / `ping` from Hanzo Git (git.hanzo.ai) **and** from GitHub,
 * validates the HMAC using the scheme that forge speaks,
 * normalizes the payload to a single internal shape, and hands accepted
 * events to the BuildScheduler. Platform owns the build+deploy lifecycle,
 * dispatching build work to self-hosted arcd runner pools.
 *
 * WHY one route and not `/v1/hanzo-git-webhook` beside `/v1/github-webhook`:
 * the two deliveries differ only in transport — which header names the event,
 * which header carries the signature, how that signature is encoded, and how
 * the sender identifies itself. Everything after that (decode, org mapping,
 * schedule, build, deploy) is identical. A second route would fork ~90 lines
 * of identical control flow and give the estate two orchestrators to keep in
 * step, which is exactly the failure mode we are moving off GitHub Actions to
 * avoid. So: ONE handler, forge detected from the headers, the two genuine
 * differences isolated to `verifyDelivery` (signature scheme) and
 * `resolveDelivery` (who vouched for this) below.
 *
 * `/v1/github-webhook` remains a zero-logic alias of this handler — the
 * GitHub App's configured delivery URL points there and rewiring a live App
 * is not worth the outage window. It re-exports; it does not re-implement.
 *
 * Distinct from /v1/deploy/github (the app-redeploy webhook). That route
 * redeploys already-defined platform *applications*; THIS route builds and
 * rolls out *services from source* per the repo's `hanzo.yml`.
 *
 * Raw-body handling: HMAC the exact bytes the forge signed (`await
 * req.text()`), then JSON.parse the same string. App Router does not
 * pre-parse the body, so the raw bytes round-trip for signature verification.
 */
import { db } from "@hanzo/platform/db";
import { github } from "@hanzo/platform/db/schema";
import {
	ciOwnsBuild,
	type ConfigSource,
	decodeWebhook,
	detectForge,
	eventHeaderOf,
	forgeOrigin,
	type GitForge,
	scheduleBuilds,
	verifyDelivery,
	WebhookError,
} from "@hanzo/platform/services/ci";
import {
	type HanzoGitConfig,
	hanzoGitConfig,
	isHanzoGitOrigin,
} from "@hanzo/platform/services/hanzo-git";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A delivery that named a provider we trust: its secret + how to read config. */
interface Delivery {
	secret: string;
	source: ConfigSource;
}

/**
 * Establish who vouched for this delivery, and get the secret to verify it.
 *
 * The only forge-specific step besides the signature encoding. GitHub stamps
 * an App `installation.id` into the payload and platform stores that App's
 * webhook secret on the provider row. Hanzo Git has no installation concept —
 * it is our own forge, so it is configured once at the deployment level from
 * KMS `hanzo/platform` (see services/hanzo-git.ts) and a delivery only has to
 * prove it came from that origin and carries a valid HMAC. The secret is
 * never persisted to the app DB, never returned, and never logged.
 *
 * Returns a `Response` (not a throw) for the fail cases so the caller stays a
 * straight line.
 */
async function resolveDelivery(
	forge: GitForge,
	payload: Record<string, unknown>,
): Promise<Delivery | Response> {
	if (forge === "hanzo-git") {
		let cfg: HanzoGitConfig;
		try {
			cfg = hanzoGitConfig();
		} catch (err) {
			// Names the missing key, never a value — see HanzoGitNotConfigured.
			return Response.json(
				{ message: (err as Error).message },
				{ status: 503 },
			);
		}
		const origin = forgeOrigin(payload);
		if (!origin) {
			return Response.json(
				{ message: "Missing repository.html_url; cannot identify the forge" },
				{ status: 400 },
			);
		}
		if (!isHanzoGitOrigin(origin, cfg)) {
			return Response.json(
				{ message: `Not a Hanzo Git origin: ${origin}` },
				{ status: 404 },
			);
		}
		// Which repository the delivery is about is read once, by the decoder,
		// after the signature is verified — this only answers whose secret to
		// verify it with, and our own forge has one.
		return { secret: cfg.webhookSecret, source: { forge: "hanzo-git" } };
	}

	const installation = payload.installation as { id?: number } | undefined;
	if (!installation?.id) {
		return Response.json(
			{ message: "Missing installation id" },
			{ status: 400 },
		);
	}
	const installationId = String(installation.id);
	const provider = await db.query.github.findFirst({
		where: eq(github.githubInstallationId, installationId),
	});
	if (!provider) {
		return Response.json(
			{ message: `No GitHub provider for installation ${installationId}` },
			{ status: 404 },
		);
	}
	if (!provider.githubWebhookSecret) {
		return Response.json(
			{ message: "GitHub webhook secret not configured for provider" },
			{ status: 400 },
		);
	}
	return {
		secret: provider.githubWebhookSecret,
		source: { forge: "github", installationId },
	};
}

export async function POST(req: Request) {
	const rawBody = await req.text();

	const forge = detectForge(req.headers);
	if (!forge) {
		return Response.json(
			{
				message:
					"Unrecognized delivery: no X-Hanzo-Event or X-GitHub-Event header",
			},
			{ status: 400 },
		);
	}

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		return Response.json(
			{ message: "Body is not valid JSON" },
			{ status: 400 },
		);
	}

	const delivery = await resolveDelivery(forge, payload);
	if (delivery instanceof Response) return delivery;

	if (!verifyDelivery(forge, rawBody, req.headers, delivery.secret)) {
		return Response.json({ message: "Invalid signature" }, { status: 401 });
	}

	let decoded: ReturnType<typeof decodeWebhook>;
	try {
		decoded = decodeWebhook(eventHeaderOf(forge, req.headers), payload, forge);
	} catch (err) {
		if (err instanceof WebhookError) {
			// 422 for "valid but nothing to do" so the forge does not retry-storm.
			return Response.json({ message: err.message }, { status: err.status });
		}
		throw err;
	}

	if (decoded.event === "ping") {
		return Response.json({ message: "pong" });
	}

	// ONE LANE. A forge push fans out to both this webhook and the repo's
	// `.hanzo/workflows/cicd.yml`, and only the second one is gated — so where
	// a ci caller exists, it owns the build and this lane yields. Checked
	// BEFORE scheduleBuilds so no row, no Job and no image can exist for a
	// commit ci has not finished gating. See `ciOwnsBuild` for the measurement
	// that made this necessary.
	if (delivery.source.forge === "hanzo-git") {
		const cfg = hanzoGitConfig();
		if (await ciOwnsBuild(cfg, decoded.repo, decoded.sha)) {
			return Response.json(
				{
					message: `Accepted; hanzoai/ci builds ${decoded.repo} (.hanzo/workflows/cicd.yml) — not scheduling a second, ungated build`,
					scheduled: 0,
				},
				{ status: 202 },
			);
		}
	}

	// ACK fast: enqueue + dispatch happen synchronously here but the heavy
	// build runs on arcd. scheduleBuilds is idempotent on (repo, sha, target),
	// so a re-delivery does not double-build.
	try {
		const result = await scheduleBuilds({
			source: delivery.source,
			repo: decoded.repo,
			sha: decoded.sha,
			ref: decoded.ref,
			branch: decoded.branch,
		});
		// `scheduled` is the ONE machine-readable answer to the only question a
		// caller actually has: did this push cause a build? It is on EVERY 202,
		// and `scheduled: 0` means nothing is building whatever the reason.
		//
		// Without it the three outcomes below are one status code and two body
		// SHAPES, and the shapes lie. A repo that declares images but skips every
		// matrix entry (arm64 paused, `{{git.tag}}` empty on a branch push) takes
		// the second branch with an empty array, so a caller branching on the
		// presence of `buildJobIds` classifies "built nothing" as "building" —
		// which is the fleet-wide trap this route is otherwise careful about, and
		// the only thing separating them was the prose "0 build(s)".
		//
		// This body is not just for machines: Hanzo Git persists it
		// (models/webhook/hooktask.go) and renders it in the delivery-history
		// Response tab, and it is the ONLY artifact this path produces — no log
		// line, no metric, no row. Whatever it says here is the entire record
		// that the push was accepted and did nothing.
		if (!result) {
			// Two ways to mean the same thing, and the message must not claim the
			// first when it was the second: the repo has no hanzo.yml, OR it has one
			// that declares no image (a `test:`-only gate for hanzoai/ci, which is
			// most of the estate). Naming only the missing file sent a reader looking
			// for a file that was right there.
			return Response.json(
				{
					message: `Accepted; ${decoded.repo} declares no image to build`,
					scheduled: 0,
				},
				{ status: 202 },
			);
		}
		return Response.json(
			{
				message: `Accepted; scheduled ${result.jobs.length} build(s)`,
				scheduled: result.jobs.length,
				buildJobIds: result.jobs.map((j) => j.buildJobId),
			},
			{ status: 202 },
		);
	} catch (err) {
		return Response.json(
			{ message: `Failed to schedule builds: ${(err as Error).message}` },
			{ status: 500 },
		);
	}
}
