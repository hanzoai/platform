import { auth } from "@hanzo/platform/index";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth (api-key / organization / sso plugins) is mounted NATIVELY at its
// configured basePath "/v1/auth" — the App Router serves this catch-all at
// /v1/auth/* directly, so no path rewriting is needed. `auth.handler` is a
// WHATWG fetch handler; toNextJsHandler wires it to the route's method exports.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler(auth.handler);
