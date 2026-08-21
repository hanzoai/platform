/**
 * IAM session cookie bridge — POST/DELETE /v1/iam/session
 *
 * The browser runs the @hanzo/iam PKCE flow and exchanges the code for an
 * access token client-side. It then POSTs that token here so the server can
 * pin it as an httpOnly cookie (`hanzo_iam_access_token`) — the cookie that
 * `validateRequest` / `getServerSession` read for SSR. The token is VERIFIED
 * against hanzo.id's JWKS before any cookie is set; an invalid token never
 * becomes a session.
 *
 * POST   { accessToken, expiresIn? } → sets the httpOnly cookie.
 * DELETE                            → clears it (logout).
 *
 * Served NATIVELY at /v1/iam/session by the App Router — no rewrite. Never /api/.
 */

import type { IncomingMessage } from "node:http";
import { getIamServerSession } from "@hanzo/platform/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "hanzo_iam_access_token";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 3; // 3 days — matches the prior session TTL.

/**
 * Serialize the session cookie. Attributes are fixed (httpOnly, Lax, Secure in
 * prod, root path), so a tiny inline builder beats pulling in an untyped
 * `cookie` dependency — one less thing in the tree, validated at this boundary.
 */
function sessionCookie(value: string, maxAge: number): string {
	const parts = [
		`${COOKIE_NAME}=${encodeURIComponent(value)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${Math.floor(maxAge)}`,
	];
	if (process.env.NODE_ENV === "production") {
		parts.push("Secure");
	}
	return parts.join("; ");
}

export async function DELETE() {
	return new Response(null, {
		status: 204,
		headers: { "Set-Cookie": sessionCookie("", 0) },
	});
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as {
		accessToken?: unknown;
		expiresIn?: unknown;
	};
	const accessToken = (body?.accessToken ?? "") as string;
	if (!accessToken || typeof accessToken !== "string") {
		return Response.json(
			{ message: "accessToken is required" },
			{ status: 400 },
		);
	}

	// Verify the token before trusting it — boundary validation. getServerSession
	// reads the Bearer header, checks the JWKS, and fails closed on a bad audience.
	const identity = await getIamServerSession({
		headers: { authorization: `Bearer ${accessToken}` },
	} as unknown as IncomingMessage);
	if (!identity) {
		return Response.json({ message: "Invalid IAM token" }, { status: 401 });
	}

	const expiresIn =
		typeof body?.expiresIn === "number" && body.expiresIn > 0
			? Math.floor(body.expiresIn)
			: DEFAULT_MAX_AGE;

	return Response.json(
		{ ok: true },
		{ headers: { "Set-Cookie": sessionCookie(accessToken, expiresIn) } },
	);
}
