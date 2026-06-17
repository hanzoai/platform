// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// args.ts — the shared generic ZAP Args carrier for every migrated router's
// request payloads. The request-side mirror of result.ts.
//
// A platform tRPC procedure's input is an arbitrary Zod object (often a large
// Drizzle-derived schema). Rather than hand-author a typed input struct per
// procedure, every method takes a single ZAP struct `Args { json text @0 }`
// whose one Text field carries the canonical encoding of the input object. The
// wire frame stays binary ZAP end to end (a struct with one Text field — never
// a JSON HTTP body); the bytes inside that Text field are the value codec.
//
// This is the ONE definition of that carrier, generated from schema/args.zap
// and reused by every <router>-cap.ts (server, decodeArgs) and
// utils/zap-<router>.ts (client, encodeArgs).

import { ArgsStruct, newArgsStruct } from "./schema/args_zap";

/** Encode an arbitrary procedure input into a ZAP `Args`. */
export function encodeArgs(value: unknown): Uint8Array {
	return newArgsStruct({ json: encodeValue(value) });
}

/** Decode a ZAP `Args` back to the procedure input. `undefined` for no input. */
export function decodeArgs<T = unknown>(bytes: Uint8Array): T {
	return decodeValue(ArgsStruct.wrap(bytes).json) as T;
}

function encodeValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	return JSON.stringify(value, (_k, v) =>
		typeof v === "bigint" ? `${v}n` : v,
	);
}

function decodeValue(s: string): unknown {
	if (s === "") return undefined;
	return JSON.parse(s);
}
