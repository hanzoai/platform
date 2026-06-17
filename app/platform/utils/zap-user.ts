/**
 * utils/zap-user.ts — native ZAP RPC client (browser) for the User capability.
 * Replaces the tRPC `api.user.*` surface.
 *
 * Opens a single WebSocket to `/zap/user` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated UserMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { UserMethod } from "@/server/zap/schema/user_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/user");

// Every User method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(UserMethod.all, "all", args);
const one = rpc.query(UserMethod.one, "one", args);
const session = rpc.query(UserMethod.session, "session", args);
const get = rpc.query(UserMethod.get, "get", args);
const getPermissions = rpc.query(
	UserMethod.getPermissions,
	"getPermissions",
	args,
);
const haveRootAccess = rpc.query(
	UserMethod.haveRootAccess,
	"haveRootAccess",
	args,
);
const getBackups = rpc.query(UserMethod.getBackups, "getBackups", args);
const getServerMetrics = rpc.query(
	UserMethod.getServerMetrics,
	"getServerMetrics",
	args,
);
const getUserByToken = rpc.query(
	UserMethod.getUserByToken,
	"getUserByToken",
	args,
);
const getMetricsToken = rpc.query(
	UserMethod.getMetricsToken,
	"getMetricsToken",
	args,
);
const getInvitations = rpc.query(
	UserMethod.getInvitations,
	"getInvitations",
	args,
);
const getContainerMetrics = rpc.query(
	UserMethod.getContainerMetrics,
	"getContainerMetrics",
	args,
);
const checkUserOrganizations = rpc.query(
	UserMethod.checkUserOrganizations,
	"checkUserOrganizations",
	args,
);
const getBookmarkedTemplates = rpc.query(
	UserMethod.getBookmarkedTemplates,
	"getBookmarkedTemplates",
	args,
);

export const user = {
	all,
	one,
	session,
	get,
	getPermissions,
	haveRootAccess,
	getBackups,
	getServerMetrics,
	update: rpc.mutation(UserMethod.update, args),
	getUserByToken,
	getMetricsToken,
	remove: rpc.mutation(UserMethod.remove, args),
	assignPermissions: rpc.mutation(UserMethod.assignPermissions, args),
	getInvitations,
	getContainerMetrics,
	generateToken: rpc.mutation(UserMethod.generateToken, args),
	deleteApiKey: rpc.mutation(UserMethod.deleteApiKey, args),
	createApiKey: rpc.mutation(UserMethod.createApiKey, args),
	checkUserOrganizations,
	createUserWithCredentials: rpc.mutation(
		UserMethod.createUserWithCredentials,
		args,
	),
	sendInvitation: rpc.mutation(UserMethod.sendInvitation, args),
	getBookmarkedTemplates,
	toggleTemplateBookmark: rpc.mutation(UserMethod.toggleTemplateBookmark, args),
	useUtils: makeUseUtils({
		all,
		one,
		session,
		get,
		getPermissions,
		haveRootAccess,
		getBackups,
		getServerMetrics,
		getUserByToken,
		getMetricsToken,
		getInvitations,
		getContainerMetrics,
		checkUserOrganizations,
		getBookmarkedTemplates,
	}),
} as const;
