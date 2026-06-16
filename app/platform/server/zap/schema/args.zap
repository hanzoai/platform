# args.zap — the universal ZAP Args carrier shared by every migrated router.
#
# A platform tRPC procedure's input is a Zod object — frequently a large
# Drizzle-derived schema with nested objects, arrays and enums and no stable
# flat-field contract at the RPC layer. Rather than hand-map each to a typed
# struct with byte offsets (hundreds of them, drift-prone), every method takes a
# single ZAP struct `Args { json text @0 }` whose one Text field carries the
# canonical encoding of the input object. The wire frame stays binary ZAP (a
# struct with one Text field) — never a JSON HTTP body. See ../args.ts for the
# value codec, which mirrors ../result.ts on the request side.

package args

struct ArgsStruct {
  json text @0
}
