import { createNextApiHandler } from "@trpc/server/adapters/next";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

// export API handler
// In tRPC v11, the experimental_contentTypeHandlers and separate content-type
// adapters (form-data, json) are removed. The node-http adapter handles
// body parsing natively.
export default createNextApiHandler({
	router: appRouter,
	createContext: createTRPCContext,
	onError:
		process.env.NODE_ENV === "development"
			? ({ path, error }) => {
					console.error(
						`tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
					);
				}
			: undefined,
});

export const config = {
	api: {
		bodyParser: false,
		sizeLimit: "1gb",
	},
};
