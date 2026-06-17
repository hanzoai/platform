/**
 * utils/zap-license-key.ts — native ZAP RPC client (browser) for the LicenseKey
 * capability. Replaces the tRPC `api.licenseKey.*` surface.
 *
 * Opens a single WebSocket to `/zap/license-key` via the shared transport
 * (utils/zap-client.ts), speaks binary ZAP envelopes, dispatches by the
 * generated LicenseKeyMethod ordinal. Inputs ride the shared Args carrier
 * (encodeArgs); results the shared Result carrier. useUtils() exposes
 * per-query invalidation, mirroring tRPC's api.useUtils().
 */

import { encodeArgs } from "@/server/zap/args";
import { LicenseKeyMethod } from "@/server/zap/schema/license-key_zap";
import { makeRpc, makeUseUtils } from "@/utils/zap-client";

const rpc = makeRpc("/zap/license-key");

// Every LicenseKey method carries its input via the generic Args carrier.
const args = (a: Record<string, unknown>) => encodeArgs(a);

const getEnterpriseSettings = rpc.query(
	LicenseKeyMethod.getEnterpriseSettings,
	"getEnterpriseSettings",
	args,
);
const haveValidLicenseKey = rpc.query(
	LicenseKeyMethod.haveValidLicenseKey,
	"haveValidLicenseKey",
	args,
);

export const licenseKey = {
	activate: rpc.mutation(LicenseKeyMethod.activate, args),
	validate: rpc.mutation(LicenseKeyMethod.validate, args),
	deactivate: rpc.mutation(LicenseKeyMethod.deactivate, args),
	getEnterpriseSettings,
	haveValidLicenseKey,
	updateEnterpriseSettings: rpc.mutation(
		LicenseKeyMethod.updateEnterpriseSettings,
		args,
	),
	useUtils: makeUseUtils({ getEnterpriseSettings, haveValidLicenseKey }),
} as const;
