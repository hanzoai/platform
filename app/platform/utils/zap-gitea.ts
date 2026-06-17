/**
 * utils/zap-gitea.ts — native ZAP RPC client (browser) for the Gitea
 * capability. Replaces the tRPC `api.gitea.*` surface.
 *
 * Opens a single WebSocket to `/zap/gitea` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated GiteaMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { GiteaMethod } from "@/server/zap/schema/gitea_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/gitea");

// Every Gitea method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(GiteaMethod.one, "one", args);
const giteaProviders = rpc.query(
	GiteaMethod.giteaProviders,
	"giteaProviders",
	args,
);
const getGiteaRepositories = rpc.query(
	GiteaMethod.getGiteaRepositories,
	"getGiteaRepositories",
	args,
);
const getGiteaBranches = rpc.query(
	GiteaMethod.getGiteaBranches,
	"getGiteaBranches",
	args,
);
const getGiteaUrl = rpc.query(GiteaMethod.getGiteaUrl, "getGiteaUrl", args);

export const gitea = {
	create: rpc.mutation(GiteaMethod.create, args),
	one,
	giteaProviders,
	getGiteaRepositories,
	getGiteaBranches,
	testConnection: rpc.mutation(GiteaMethod.testConnection, args),
	update: rpc.mutation(GiteaMethod.update, args),
	getGiteaUrl,
	useUtils: makeUseUtils({
		one,
		giteaProviders,
		getGiteaRepositories,
		getGiteaBranches,
		getGiteaUrl,
	}),
} as const;
