// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// result.ts — the shared generic ZAP Result carrier for every migrated router.
//
// A platform tRPC procedure returns a heterogeneous DB row / provider payload
// with no stable column contract at the RPC layer. Rather than hand-author a
// typed result struct per procedure (hundreds of them), every method returns a
// single ZAP struct `Result { value text @0 }` whose one Text field carries the
// canonical record encoding of the return value. The wire frame stays binary
// ZAP end to end (a struct with one Text field — never a JSON HTTP body); the
// bytes inside that Text field are the value codec.
//
// This module is the ONE definition of that carrier, generated once from
// schema/result.zap and reused by every <router>-cap.ts (server) and
// utils/zap-<router>.ts (client). DRY: param structs are per-router (generated
// from <router>.zap); the Result carrier is universal and lives here.

import { ResultStruct, newResultStruct } from "./schema/result_zap";

/**
 * Encode an arbitrary service return value into a ZAP `Result`. The value's
 * canonical encoding rides inside the struct's single Text field, so the wire
 * frame is a binary ZAP struct. `undefined`/`null` encode as the empty record,
 * decoded back to `null`.
 */
export function encodeResult(value: unknown): Uint8Array {
	return newResultStruct({ value: encodeValue(value) });
}

/** Decode a ZAP `Result` back to the service return value. */
export function decodeResult(bytes: Uint8Array): unknown {
	return decodeValue(ResultStruct.wrap(bytes).value);
}

// --- value codec (record encoding carried inside the Result's Text field) ---
//
// Platform service functions return DB rows with bigint columns (usage meters,
// timestamps). bigint has no JSON form, so it is tagged `<n>n` on encode and
// restored on decode. This is the carrier *inside* the Text field of a ZAP
// struct, NOT a JSON-over-HTTP transport.

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
