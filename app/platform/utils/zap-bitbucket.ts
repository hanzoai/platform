/**
 * utils/zap-bitbucket.ts — native ZAP RPC client (browser) for the Bitbucket
 * capability. Replaces the tRPC `api.bitbucket.*` surface.
 *
 * Opens a single WebSocket to `/zap/bitbucket` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated BitbucketMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { BitbucketMethod } from "@/server/zap/schema/bitbucket_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/bitbucket");

// Every Bitbucket method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(BitbucketMethod.one, "one", args);
const bitbucketProviders = rpc.query(
	BitbucketMethod.bitbucketProviders,
	"bitbucketProviders",
	args,
);
const getBitbucketRepositories = rpc.query(
	BitbucketMethod.getBitbucketRepositories,
	"getBitbucketRepositories",
	args,
);
const getBitbucketBranches = rpc.query(
	BitbucketMethod.getBitbucketBranches,
	"getBitbucketBranches",
	args,
);

export const bitbucket = {
	create: rpc.mutation(BitbucketMethod.create, args),
	one,
	bitbucketProviders,
	getBitbucketRepositories,
	getBitbucketBranches,
	testConnection: rpc.mutation(BitbucketMethod.testConnection, args),
	update: rpc.mutation(BitbucketMethod.update, args),
	useUtils: makeUseUtils({
		one,
		bitbucketProviders,
		getBitbucketRepositories,
		getBitbucketBranches,
	}),
} as const;
