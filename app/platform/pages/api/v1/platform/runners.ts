/**
 * arcd runner registry — /v1/platform/runners
 *
 * Canonical external URL: api.hanzo.ai/v1/platform/runners (gateway-fronted).
 * The Next pages router serves this module at /api/v1/platform/runners; the
 * next.config.mjs rewrite maps /v1/* → /api/v1/*, so /v1/platform/runners is
 * the canonical request path (no /api/ prefix, per platform convention).
 *
 * This is the OWNERSHIP + management surface for arcd runners: register a
 * runner, list the ones you own, revoke one. It is decomplected from routing
 * — the scheduler dispatches on poolLabel + liveness and NEVER reads a runner's
 * `organizationId`. Ownership here is for registration / audit / isolation /
 * billing only.
 *
 * Auth: IAM/org session (NOT the runner HMAC, which authenticates poll/complete).
 * We reuse `validateRequest` from @hanzo/platform — the same helper the tRPC
 * OpenAPI surface uses (app/platform/pages/api/[...trpc].ts) — which resolves
 * the IAM session (or x-api-key), the caller's active org
 * (`session.activeOrganizationId`), and their org role (`user.role`).
 *
 * Scoping:
 *   - A tenant operates only on runners owned by their active org.
 *   - A platform-admin (org role `owner`/`admin`) sees every runner including
 *     the Hanzo-managed SHARED ones (organizationId = null), and may register a
 *     shared runner by passing organizationId: null.
 *
 * Verbs:
 *   POST   register {runnerId, poolLabel, secret?, organizationId?}
 *          - secret minted via crypto.randomBytes(24).toString("hex") if omitted
 *          - organizationId defaults to the caller's active org
 *          - organizationId: null mints a shared runner (admin only)
 *          - returns the row INCLUDING the secret exactly once (201)
 *   GET    list — the caller's own runners; admins also see shared runners
 *   DELETE revoke ?runnerId=<id> — org-scoped (admin may revoke any)
 */
import { randomBytes } from "node:crypto";
import { validateRequest } from "@hanzo/platform";
import { apiRegisterArcdRunner } from "@hanzo/platform/db/schema";
import {
	findRunner,
	listRunners,
	registerRunner,
	revokeRunner,
} from "@hanzo/platform/services/ci/arcd-runner";
import type { NextApiRequest, NextApiResponse } from "next";

/** Org roles permitted to manage shared runners and operate across all orgs. */
const ADMIN_ROLES = new Set(["owner", "admin"]);

function header(req: NextApiRequest, name: string): string | undefined {
	const v = req.query[name];
	return Array.isArray(v) ? v[0] : v;
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	const { session, user } = await validateRequest(req);
	if (!session || !user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}
	const orgId = session.activeOrganizationId;
	if (!orgId) {
		res.status(403).json({ message: "No active organization" });
		return;
	}
	const isAdmin = ADMIN_ROLES.has(user.role ?? "member");

	switch (req.method) {
		case "POST":
			return handleRegister(req, res, orgId, isAdmin);
		case "GET":
			return handleList(res, orgId, isAdmin);
		case "DELETE":
			return handleRevoke(req, res, orgId, isAdmin);
		default:
			res.setHeader("Allow", ["POST", "GET", "DELETE"]);
			res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
}

async function handleRegister(
	req: NextApiRequest,
	res: NextApiResponse,
	orgId: string,
	isAdmin: boolean,
) {
	const parsed = apiRegisterArcdRunner
		.partial({ secret: true, organizationId: true })
		.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
		return;
	}
	const { runnerId, poolLabel } = parsed.data;

	// Resolve ownership. Default to the caller's org; only an admin may target
	// another org or mint a SHARED runner (organizationId === null). A tenant
	// passing some other org is rejected — ownership is theirs to assign only
	// within their own org.
	let organizationId: string | null;
	if (parsed.data.organizationId === undefined) {
		organizationId = orgId;
	} else if (isAdmin) {
		organizationId = parsed.data.organizationId; // string | null, admin's choice
	} else if (parsed.data.organizationId === orgId) {
		organizationId = orgId;
	} else {
		res.status(403).json({
			message: "Only a platform admin may register a runner for another org or as shared",
		});
		return;
	}

	// A non-admin may not steal a runnerId that is already owned elsewhere
	// (including a shared runner). registerRunner upserts by runnerId, so guard
	// re-registration across an ownership boundary.
	if (!isAdmin) {
		const existing = await findRunner(runnerId);
		if (existing && existing.organizationId !== orgId) {
			res.status(403).json({
				message: `Runner ${runnerId} is owned by another organization`,
			});
			return;
		}
	}

	const secret = parsed.data.secret ?? randomBytes(24).toString("hex");
	const row = await registerRunner({ runnerId, poolLabel, secret, organizationId });
	// The secret is returned exactly once, here. Subsequent GETs do not echo it.
	res.status(201).json(row);
}

async function handleList(res: NextApiResponse, orgId: string, isAdmin: boolean) {
	// Admins get the global view (own + shared + every tenant's). A tenant sees
	// only the runners their org owns.
	const runners = isAdmin ? await listRunners() : await listRunners({ organizationId: orgId });
	res.status(200).json(runners);
}

async function handleRevoke(
	req: NextApiRequest,
	res: NextApiResponse,
	orgId: string,
	isAdmin: boolean,
) {
	const runnerId = header(req, "runnerId");
	if (!runnerId) {
		res.status(400).json({ message: "Missing runnerId" });
		return;
	}
	const existing = await findRunner(runnerId);
	if (!existing) {
		res.status(404).json({ message: `Unknown runner ${runnerId}` });
		return;
	}
	// Org scoping: a tenant may revoke only their own runners. Admins may revoke
	// any, including shared.
	if (!isAdmin && existing.organizationId !== orgId) {
		res.status(403).json({ message: `Runner ${runnerId} is owned by another organization` });
		return;
	}
	await revokeRunner(runnerId);
	res.status(204).end();
}
