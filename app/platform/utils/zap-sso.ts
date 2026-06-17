/**
 * utils/zap-sso.ts — native ZAP RPC client (browser) for the Sso capability.
 * Replaces the tRPC `api.sso.*` surface.
 *
 * Opens a single WebSocket to `/zap/sso` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated SsoMethod ordinal. Inputs ride the shared Args carrier (encodeArgs);
 * results the shared Result carrier. useUtils() exposes per-query invalidation,
 * mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { SsoMethod } from "@/server/zap/schema/sso_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/sso");

// Every Sso method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const showSignInWithSSO = rpc.query(
	SsoMethod.showSignInWithSSO,
	"showSignInWithSSO",
	args,
);
const enforceSSO = rpc.query(SsoMethod.enforceSSO, "enforceSSO", args);
const listProviders = rpc.query(
	SsoMethod.listProviders,
	"listProviders",
	args,
);
const getTrustedOrigins = rpc.query(
	SsoMethod.getTrustedOrigins,
	"getTrustedOrigins",
	args,
);
const one = rpc.query(SsoMethod.one, "one", args);

export const sso = {
	showSignInWithSSO,
	enforceSSO,
	listProviders,
	getTrustedOrigins,
	one,
	update: rpc.mutation(SsoMethod.update, args),
	deleteProvider: rpc.mutation(SsoMethod.deleteProvider, args),
	register: rpc.mutation(SsoMethod.register, args),
	addTrustedOrigin: rpc.mutation(SsoMethod.addTrustedOrigin, args),
	removeTrustedOrigin: rpc.mutation(SsoMethod.removeTrustedOrigin, args),
	updateTrustedOrigin: rpc.mutation(SsoMethod.updateTrustedOrigin, args),
	useUtils: makeUseUtils({
		showSignInWithSSO,
		enforceSSO,
		listProviders,
		getTrustedOrigins,
		one,
	}),
} as const;
