// ZAP codec roundtrip tests for the migrated DOKS capability.
//
// Proves the zapgen-generated struct views/builders (server/zap/schema/doks_zap.ts)
// and the shared Result carrier (server/zap/result.ts) encode and decode the
// DOKS param structs as native binary ZAP (Builder → Message/StructView), stable
// across the field byte-offsets declared in server/zap/schema/doks.zap. No DB,
// no network — pure wire codec.

import { Message } from "@zap-proto/zap";
import { describe, expect, it } from "vitest";
import { decodeResult, encodeResult } from "@/server/zap/result";
import {
	AddNodePoolParams,
	AttachClusterParams,
	ClusterRef,
	DeleteNodePoolParams,
	Empty,
	ProvisionParams,
	UpdateNodePoolParams,
	newAddNodePoolParams,
	newAttachClusterParams,
	newClusterRef,
	newDeleteNodePoolParams,
	newEmpty,
	newProvisionParams,
	newUpdateNodePoolParams,
} from "@/server/zap/schema/doks_zap";

describe("doks ZAP codec", () => {
	it("encodes to a valid ZAP message (magic + version)", () => {
		const bytes = newClusterRef({ doksClusterId: "doks-abc" });
		// Message.parse throws ZapParseError on bad magic/version/size.
		const msg = Message.parse(bytes);
		expect(msg.size()).toBeGreaterThan(0);
	});

	it("roundtrips ProvisionParams (text/bool/u32 fields)", () => {
		const input = {
			organizationId: "org-1",
			region: "sfo3",
			nodeSize: "s-2vcpu-4gb",
			ha: true,
			nodeCount: 3,
		};
		const v = ProvisionParams.wrap(newProvisionParams(input));
		expect({
			organizationId: v.organizationId,
			region: v.region,
			nodeSize: v.nodeSize,
			ha: v.ha,
			nodeCount: v.nodeCount,
		}).toEqual(input);
	});

	it("roundtrips ProvisionParams with unset optionals", () => {
		const input = {
			organizationId: "org-2",
			region: "nyc1",
			nodeSize: "",
			ha: false,
			nodeCount: 0,
		};
		const v = ProvisionParams.wrap(newProvisionParams(input));
		expect({
			organizationId: v.organizationId,
			region: v.region,
			nodeSize: v.nodeSize,
			ha: v.ha,
			nodeCount: v.nodeCount,
		}).toEqual(input);
	});

	it("roundtrips ClusterRef", () => {
		const v = ClusterRef.wrap(newClusterRef({ doksClusterId: "c-9" }));
		expect(v.doksClusterId).toBe("c-9");
	});

	it("roundtrips AddNodePoolParams", () => {
		const input = {
			doksClusterId: "c-1",
			name: "pool-a",
			size: "s-4vcpu-8gb",
			count: 5,
		};
		const v = AddNodePoolParams.wrap(newAddNodePoolParams(input));
		expect({
			doksClusterId: v.doksClusterId,
			name: v.name,
			size: v.size,
			count: v.count,
		}).toEqual(input);
	});

	it("roundtrips UpdateNodePoolParams (mixed unset)", () => {
		const input = {
			doksClusterId: "c-1",
			poolId: "p-1",
			size: "s-2vcpu-4gb",
			count: 0,
		};
		const v = UpdateNodePoolParams.wrap(newUpdateNodePoolParams(input));
		expect({
			doksClusterId: v.doksClusterId,
			poolId: v.poolId,
			size: v.size,
			count: v.count,
		}).toEqual(input);
	});

	it("roundtrips DeleteNodePoolParams", () => {
		const input = { doksClusterId: "c-1", poolId: "p-2" };
		const v = DeleteNodePoolParams.wrap(newDeleteNodePoolParams(input));
		expect({ doksClusterId: v.doksClusterId, poolId: v.poolId }).toEqual(input);
	});

	it("roundtrips AttachClusterParams (BYO kubeconfig)", () => {
		const input = {
			name: "prod-eu",
			kubeconfig: "apiVersion: v1\nkind: Config\nclusters: []\n",
		};
		const v = AttachClusterParams.wrap(newAttachClusterParams(input));
		expect({ name: v.name, kubeconfig: v.kubeconfig }).toEqual(input);
	});

	it("encodes Empty params to a parseable message", () => {
		const bytes = newEmpty({ _pad: 0 });
		expect(() => Message.parse(bytes)).not.toThrow();
		expect(Empty.wrap(bytes)._pad).toBe(0);
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
		// Parses as a ZAP message of the exact byte length — binary, not a JSON body.
		const msg = Message.parse(bytes);
		expect(msg.size()).toBe(bytes.byteLength);
	});
});
