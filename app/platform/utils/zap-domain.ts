/**
 * utils/zap-domain.ts — native ZAP RPC client (browser) for the Domain
 * capability. Replaces the tRPC `api.domain.*` surface.
 *
 * Opens a single WebSocket to `/zap/domain` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated DomainMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { DomainMethod } from "@/server/zap/schema/domain_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/domain");

// Every Domain method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const byApplicationId = rpc.query(
	DomainMethod.byApplicationId,
	"byApplicationId",
	args,
);
const byComposeId = rpc.query(DomainMethod.byComposeId, "byComposeId", args);
const canGenerateTraefikMeDomains = rpc.query(
	DomainMethod.canGenerateTraefikMeDomains,
	"canGenerateTraefikMeDomains",
	args,
);
const one = rpc.query(DomainMethod.one, "one", args);

export const domain = {
	create: rpc.mutation(DomainMethod.create, args),
	byApplicationId,
	byComposeId,
	generateDomain: rpc.mutation(DomainMethod.generateDomain, args),
	canGenerateTraefikMeDomains,
	update: rpc.mutation(DomainMethod.update, args),
	one,
	delete: rpc.mutation(DomainMethod.delete, args),
	validateDomain: rpc.mutation(DomainMethod.validateDomain, args),
	useUtils: makeUseUtils({
		byApplicationId,
		byComposeId,
		canGenerateTraefikMeDomains,
		one,
	}),
} as const;
