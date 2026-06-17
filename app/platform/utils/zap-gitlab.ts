/**
 * utils/zap-gitlab.ts — native ZAP RPC client (browser) for the Gitlab
 * capability. Replaces the tRPC `api.gitlab.*` surface.
 *
 * Opens a single WebSocket to `/zap/gitlab` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated GitlabMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { GitlabMethod } from "@/server/zap/schema/gitlab_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/gitlab");

// Every Gitlab method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const one = rpc.query(GitlabMethod.one, "one", args);
const gitlabProviders = rpc.query(
	GitlabMethod.gitlabProviders,
	"gitlabProviders",
	args,
);
const getGitlabRepositories = rpc.query(
	GitlabMethod.getGitlabRepositories,
	"getGitlabRepositories",
	args,
);
const getGitlabBranches = rpc.query(
	GitlabMethod.getGitlabBranches,
	"getGitlabBranches",
	args,
);

export const gitlab = {
	create: rpc.mutation(GitlabMethod.create, args),
	one,
	gitlabProviders,
	getGitlabRepositories,
	getGitlabBranches,
	testConnection: rpc.mutation(GitlabMethod.testConnection, args),
	update: rpc.mutation(GitlabMethod.update, args),
	useUtils: makeUseUtils({
		one,
		gitlabProviders,
		getGitlabRepositories,
		getGitlabBranches,
	}),
} as const;
