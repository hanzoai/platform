import { getIamServerSession } from "@hanzo/platform/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";

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
 * Canonical path /v1/iam/session (the Next.js pages router serves it under
 * /api/v1/iam via the /v1/:path* rewrite). Never /api/.
 */
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

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.method === "DELETE") {
		res.setHeader("Set-Cookie", sessionCookie("", 0));
		return res.status(204).end();
	}

	if (req.method !== "POST") {
		res.setHeader("Allow", ["POST", "DELETE"]);
		return res
			.status(405)
			.json({ message: `Method ${req.method} not allowed` });
	}

	const accessToken = (req.body?.accessToken ?? "") as string;
	if (!accessToken || typeof accessToken !== "string") {
		return res.status(400).json({ message: "accessToken is required" });
	}

	// Verify the token before trusting it — boundary validation. getServerSession
	// reads the Bearer header, checks the JWKS, and fails closed on a bad audience.
	const identity = await getIamServerSession({
		headers: { authorization: `Bearer ${accessToken}` },
	} as never);
	if (!identity) {
		return res.status(401).json({ message: "Invalid IAM token" });
	}

	const expiresIn =
		typeof req.body?.expiresIn === "number" && req.body.expiresIn > 0
			? Math.floor(req.body.expiresIn)
			: DEFAULT_MAX_AGE;

	res.setHeader("Set-Cookie", sessionCookie(accessToken, expiresIn));
	return res.status(200).json({ ok: true });
}
