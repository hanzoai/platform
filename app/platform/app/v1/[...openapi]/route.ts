import { validateRequest } from "@hanzo/platform";
import { appRouter } from "@/server/api/root";
import { createFetchContext } from "@/server/api/trpc";
import { asIncomingMessage } from "@/server/v1/request";
import { createOpenApiFetchHandler } from "@dokploy/trpc-openapi";

// OpenAPI REST mapping of the tRPC router, served at /v1/<procedure> by the App
// Router. This is a CATCH-ALL: specific /v1 routes (health, auth, trpc, org,
// apps, deploy, providers, iam, …) take precedence; anything else falls through
// to the REST-mapped procedures. The segment name ([...openapi]) is arbitrary —
// only the served path (/v1/*) matters, and it never collides with the sibling
// named `trpc` directory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = async (req: Request) => {
	const { session, user } = await validateRequest(asIncomingMessage(req));
	if (!user || !session) {
		return Response.json({ message: "Unauthorized" }, { status: 401 });
	}

	return createOpenApiFetchHandler({
		endpoint: "/v1",
		req,
		router: appRouter,
		createContext: () => createFetchContext(req),
		onError:
			process.env.NODE_ENV === "development"
				? ({ path, error }: { path: string | undefined; error: Error }) => {
						console.error(
							`❌ OpenAPI failed on ${path ?? "<no-path>"}: ${error.message}`,
						);
					}
				: undefined,
	});
};

export {
	handler as GET,
	handler as POST,
	handler as PUT,
	handler as PATCH,
	handler as DELETE,
};
