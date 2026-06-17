/**
 * utils/zap-github.ts — native ZAP RPC client (browser) for the Github
 * capability. Replaces the tRPC `api.github.*` surface.
 *
 * Opens a single WebSocket to `/zap/github` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated GithubMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { GithubMethod } from "@/server/zap/schema/github_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/github");

// Every Github method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(GithubMethod.one, "one", args);
const getGithubRepositories = rpc.query(
	GithubMethod.getGithubRepositories,
	"getGithubRepositories",
	args,
);
const getGithubBranches = rpc.query(
	GithubMethod.getGithubBranches,
	"getGithubBranches",
	args,
);
const githubProviders = rpc.query(
	GithubMethod.githubProviders,
	"githubProviders",
	args,
);

export const github = {
	one,
	getGithubRepositories,
	getGithubBranches,
	githubProviders,
	testConnection: rpc.mutation(GithubMethod.testConnection, args),
	update: rpc.mutation(GithubMethod.update, args),
	useUtils: makeUseUtils({
		one,
		getGithubRepositories,
		getGithubBranches,
		githubProviders,
	}),
} as const;
