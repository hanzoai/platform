/**
 * utils/zap-registry.ts — native ZAP RPC client (browser) for the Registry
 * capability. Replaces the tRPC `api.registry.*` surface.
 *
 * Opens a single WebSocket to `/zap/registry` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated RegistryMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import type { Registry } from "@hanzo/platform/services/registry";
import { encodeArgs } from "@/server/zap/args";
import { RegistryMethod } from "@/server/zap/schema/registry_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/registry");

// Every Registry method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query<Record<string, unknown>, Registry[]>(
	RegistryMethod.all,
	"all",
	args,
);
const one = rpc.query<Record<string, unknown>, Registry>(
	RegistryMethod.one,
	"one",
	args,
);

export const registry = {
	create: rpc.mutation(RegistryMethod.create, args),
	remove: rpc.mutation(RegistryMethod.remove, args),
	update: rpc.mutation(RegistryMethod.update, args),
	all,
	one,
	testRegistry: rpc.mutation(RegistryMethod.testRegistry, args),
	testRegistryById: rpc.mutation(RegistryMethod.testRegistryById, args),
	useUtils: makeUseUtils({ all, one }),
} as const;
