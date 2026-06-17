/**
 * utils/zap-certificate.ts — native ZAP RPC client (browser) for the Certificate
 * capability. Replaces the tRPC `api.certificate.*` surface.
 *
 * Opens a single WebSocket to `/zap/certificate` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated CertificateMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { CertificateMethod } from "@/server/zap/schema/certificate_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/certificate");

// Every Certificate method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const all = rpc.query(CertificateMethod.all, "all", args);
const one = rpc.query(CertificateMethod.one, "one", args);

export const certificate = {
	create: rpc.mutation(CertificateMethod.create, args),
	one,
	remove: rpc.mutation(CertificateMethod.remove, args),
	all,
	update: rpc.mutation(CertificateMethod.update, args),
	useUtils: makeUseUtils({ all, one }),
} as const;
