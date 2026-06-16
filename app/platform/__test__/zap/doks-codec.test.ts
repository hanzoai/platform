// ZAP codec roundtrip tests for the migrated DOKS capability.
//
// Proves the hand-authored ZAP views/builders (server/zap/codec.ts) encode and
// decode the DOKS param structs and the generic Result carrier as native ZAP
// binary (Builder → Message/StructView), byte-stable across the field order
// declared in server/zap/schema/doks.zap. No DB, no network — pure wire codec.

import { Message } from "@zap-proto/zap";
import { describe, expect, it } from "vitest";
import {
	AddNodePoolParams,
	ClusterRef,
	DeleteNodePoolParams,
	decodeResult,
	decodeStruct,
	Empty,
	encodeResult,
	encodeStruct,
	ProvisionParams,
	UpdateNodePoolParams,
} from "@/server/zap/codec";

describe("doks ZAP codec", () => {
	it("encodes to a valid ZAP message (magic + version)", () => {
		const bytes = encodeStruct(ClusterRef, { doksClusterId: "doks-abc" });
		// Message.parse throws ZapParseError on bad magic/version/size.
		const msg = Message.parse(bytes);
		expect(msg.size()).toBeGreaterThan(0);
	});

	it("roundtrips ProvisionParams (text/bool/u32 fields)", () => {
		const input = {
			organizationId: "org-1",
			region: "sfo3",
			ha: true,
			nodeSize: "s-2vcpu-4gb",
			nodeCount: 3,
		};
		const out = decodeStruct(
			ProvisionParams,
			encodeStruct(ProvisionParams, input),
		);
		expect(out).toEqual(input);
	});

	it("roundtrips ProvisionParams with unset optionals", () => {
		const input = {
			organizationId: "org-2",
			region: "nyc1",
			ha: false,
			nodeSize: "",
			nodeCount: 0,
		};
		const out = decodeStruct(
			ProvisionParams,
			encodeStruct(ProvisionParams, input),
		);
		expect(out).toEqual(input);
	});

	it("roundtrips ClusterRef", () => {
		const out = decodeStruct(
			ClusterRef,
			encodeStruct(ClusterRef, { doksClusterId: "c-9" }),
		);
		expect(out).toEqual({ doksClusterId: "c-9" });
	});

	it("roundtrips AddNodePoolParams", () => {
		const input = {
			doksClusterId: "c-1",
			name: "pool-a",
			size: "s-4vcpu-8gb",
			count: 5,
		};
		const out = decodeStruct(
			AddNodePoolParams,
			encodeStruct(AddNodePoolParams, input),
		);
		expect(out).toEqual(input);
	});

	it("roundtrips UpdateNodePoolParams (mixed unset)", () => {
		const input = {
			doksClusterId: "c-1",
			poolId: "p-1",
			count: 0,
			size: "s-2vcpu-4gb",
		};
		const out = decodeStruct(
			UpdateNodePoolParams,
			encodeStruct(UpdateNodePoolParams, input),
		);
		expect(out).toEqual(input);
	});

	it("roundtrips DeleteNodePoolParams", () => {
		const input = { doksClusterId: "c-1", poolId: "p-2" };
		const out = decodeStruct(
			DeleteNodePoolParams,
			encodeStruct(DeleteNodePoolParams, input),
		);
		expect(out).toEqual(input);
	});

	it("encodes Empty params to a parseable message", () => {
		const bytes = encodeStruct(Empty, {});
		expect(() => Message.parse(bytes)).not.toThrow();
	});

	it("roundtrips a Result carrying a nested object value", () => {
		const value = {
			doksClusterId: "c-1",
			name: "prod",
			nodePools: [{ poolId: "p-1", count: 2 }],
			ha: true,
		};
		expect(decodeResult(encodeResult(value))).toEqual(value);
	});

	it("roundtrips a Result carrying an array value", () => {
		const value = [
			{ slug: "sfo3", name: "San Francisco 3" },
			{ slug: "nyc1", name: "New York 1" },
		];
		expect(decodeResult(encodeResult(value))).toEqual(value);
	});

	it("encodes null/undefined result as null", () => {
		expect(decodeResult(encodeResult(null))).toBeNull();
		expect(decodeResult(encodeResult(undefined))).toBeNull();
	});

	it("Result wire frame is a binary ZAP message, not JSON text", () => {
		const bytes = encodeResult({ ok: true });
		// First 4 bytes are the ZAP magic — proves binary ZAP, not a JSON body.
		const msg = Message.parse(bytes);
		expect(msg.size()).toBe(bytes.byteLength);
	});
});
