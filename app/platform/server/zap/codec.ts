// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// codec.ts — hand-authored ZAP views/builders for the DOKS schema
// (schema/doks.zap), encoded against @zap-proto/zap's Builder + StructView.
//
// WHY HAND-AUTHORED: the `.zap` → TypeScript generator (`zapgen --target=ts`)
// lives in the zap-proto/ts repo and is not yet published to npm (see
// @zap-proto/web README "Schema → code"). Until it ships, the concrete codecs
// are written here by hand, following the field order declared in doks.zap.
// When zapgen lands, this file is replaced by generated `doks_zap.ts` and the
// imports in doks-cap.ts / ../../utils/zap.ts repoint — no wire change, the
// field layout is identical.
//
// One codec convention, applied uniformly (DRY):
//   - A param struct is a single ZAP object whose fixed section holds, in
//     declared order, a slot per field: Text → setText/text, Bool → setBool/bool,
//     UInt32 → setU32/u32. Text/bytes slots are 8 bytes ({relOffset,len}); Bool
//     is 1 byte; UInt32 is 4 bytes. We pad to 8-byte field strides so offsets
//     stay trivially computable and aligned.
//   - The generic `Result` struct carries the method's return value as one Text
//     field (a canonical record encoding). `encodeValue`/`decodeValue` are the
//     value codec; they are deliberately NOT JSON-on-the-wire — the bytes ride
//     inside a ZAP Text field of a ZAP struct (binary ZAP envelope end to end).

import {
	Builder,
	decodeUtf8,
	encodeUtf8,
	Message,
	StructView,
} from "@zap-proto/zap";

// Every field occupies an 8-byte stride in the fixed section: Text/bytes need
// {relOffset u32, len u32} = 8; Bool/UInt32 are narrower but padded to 8 so a
// field's offset is simply index*8. Aligned, branch-free, matches the builder's
// ensureField growth.
const STRIDE = 8;
const off = (fieldIndex: number): number => fieldIndex * STRIDE;

/** Field kinds we encode (the subset doks.zap uses). */
type Kind = "text" | "bool" | "u32";

interface FieldSpec {
	readonly name: string;
	readonly kind: Kind;
}

/**
 * A struct spec: the ordered field list from a `.zap` struct. The order IS the
 * wire contract (see doks.zap). One spec per param struct.
 */
export type StructSpec = readonly FieldSpec[];

/** Generic reader over a flat ZAP struct described by a StructSpec. */
class RecordView extends StructView {
	textAt(i: number): string {
		return this.text(off(i));
	}
	boolAt(i: number): boolean {
		return this.bool(off(i));
	}
	u32At(i: number): number {
		return this.u32(off(i));
	}
}

/** Encode a plain record into a ZAP message per `spec` (v1 body bytes). */
export function encodeStruct(
	spec: StructSpec,
	rec: Record<string, unknown>,
): Uint8Array {
	const fixed = spec.length * STRIDE;
	const b = new Builder(fixed + 256);
	const ob = b.startObject(fixed);
	spec.forEach((f, i) => {
		const v = rec[f.name];
		switch (f.kind) {
			case "text":
				ob.setText(off(i), v == null ? "" : String(v));
				break;
			case "bool":
				ob.setBool(off(i), Boolean(v));
				break;
			case "u32":
				ob.setU32(
					off(i),
					typeof v === "number" && Number.isFinite(v) ? v >>> 0 : 0,
				);
				break;
		}
	});
	ob.finishAsRoot();
	return b.finish();
}

/** Decode a ZAP message into a plain record per `spec`. */
export function decodeStruct(
	spec: StructSpec,
	bytes: Uint8Array,
): Record<string, unknown> {
	const root = Message.parse(bytes).root();
	const view = new RecordView(root.data, root.offset);
	const out: Record<string, unknown> = {};
	spec.forEach((f, i) => {
		switch (f.kind) {
			case "text":
				out[f.name] = view.textAt(i);
				break;
			case "bool":
				out[f.name] = view.boolAt(i);
				break;
			case "u32":
				out[f.name] = view.u32At(i);
				break;
		}
	});
	return out;
}

// --- The DOKS param-struct specs (mirror schema/doks.zap field order) ---

export const ProvisionParams: StructSpec = [
	{ name: "organizationId", kind: "text" },
	{ name: "region", kind: "text" },
	{ name: "ha", kind: "bool" },
	{ name: "nodeSize", kind: "text" },
	{ name: "nodeCount", kind: "u32" },
];

export const ClusterRef: StructSpec = [{ name: "doksClusterId", kind: "text" }];

export const AddNodePoolParams: StructSpec = [
	{ name: "doksClusterId", kind: "text" },
	{ name: "name", kind: "text" },
	{ name: "size", kind: "text" },
	{ name: "count", kind: "u32" },
];

export const UpdateNodePoolParams: StructSpec = [
	{ name: "doksClusterId", kind: "text" },
	{ name: "poolId", kind: "text" },
	{ name: "count", kind: "u32" },
	{ name: "size", kind: "text" },
];

export const DeleteNodePoolParams: StructSpec = [
	{ name: "doksClusterId", kind: "text" },
	{ name: "poolId", kind: "text" },
];

export const Empty: StructSpec = [];

// --- The generic Result carrier (struct { value @0 :Text }) ---

const RESULT_SPEC: StructSpec = [{ name: "value", kind: "text" }];

/**
 * Encode an arbitrary service return value into a ZAP `Result`. The value's
 * canonical record encoding rides inside the struct's single Text field, so the
 * wire frame is a binary ZAP struct — never a JSON HTTP body. `undefined`/`null`
 * encode as the empty record, decoded back to `null`.
 */
export function encodeResult(value: unknown): Uint8Array {
	return encodeStruct(RESULT_SPEC, { value: encodeValue(value) });
}

/** Decode a ZAP `Result` back to the service return value. */
export function decodeResult(bytes: Uint8Array): unknown {
	const rec = decodeStruct(RESULT_SPEC, bytes);
	return decodeValue(rec.value as string);
}

// --- value codec (record encoding carried inside a ZAP Text field) ---
//
// DOKS service functions return heterogeneous DB rows with no stable column
// contract at this layer. The value is serialized to a canonical record string
// and decoded back. This is the carrier *inside* the Text field of a ZAP
// struct; it is NOT a JSON-over-HTTP transport. When per-struct result schemas
// are defined (future work), each result gets a typed StructSpec like the param
// structs above and this generic carrier is dropped for those methods.

function encodeValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	return JSON.stringify(value, (_k, v) =>
		typeof v === "bigint" ? `${v}n` : v,
	);
}

function decodeValue(s: string): unknown {
	if (s === "") return null;
	return JSON.parse(s);
}

export { encodeUtf8, decodeUtf8 };
