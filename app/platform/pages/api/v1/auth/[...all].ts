import type { IncomingMessage, ServerResponse } from "node:http";
import { auth } from "@hanzo/platform/index";
import { toNodeHandler } from "better-auth/node";

// Disallow body parsing, we will parse it manually.
export const config = { api: { bodyParser: false } };

// Canonical auth path is /v1/auth/* (never /api/). Next.js physically serves it
// under pages/api/v1/auth via the /v1/:path* -> /api/v1/:path* rewrite, so the
// request arrives here as /api/v1/auth/*. Restore the canonical /v1/auth path so
// better-auth (basePath "/v1/auth") matches its routes and emits /v1/auth URLs.
const nodeHandler = toNodeHandler(auth.handler);

export default function handler(req: IncomingMessage, res: ServerResponse) {
	if (req.url) req.url = req.url.replace(/^\/api\/v1\/auth/, "/v1/auth");
	return nodeHandler(req, res);
}
