import { appRouter } from "@/server/api/root";
import { createFetchContext } from "@/server/api/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

// tRPC batch endpoint, served NATIVELY at /v1/trpc/* by the App Router (no
// /api/v1 rewrite). `fetchRequestHandler` is the App Router adapter; the
// endpoint is the canonical public path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) =>
	fetchRequestHandler({
		endpoint: "/v1/trpc",
		req,
		router: appRouter,
		createContext: () => createFetchContext(req),
		onError:
			process.env.NODE_ENV === "development"
				? ({ path, error }) => {
						console.error(
							`❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
						);
					}
				: undefined,
	});

export { handler as GET, handler as POST };
