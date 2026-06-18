import { IAM_CONFIGURED, iamLogoutUrl } from "@hanzo/platform/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * RP-initiated logout. The client clears the local better-auth session via
 * `authClient.signOut()`, then navigates here so the IAM session is killed
 * on both sides. IAM bounces back to `/login`.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	res.redirect(302, IAM_CONFIGURED ? iamLogoutUrl() : "/login");
}
