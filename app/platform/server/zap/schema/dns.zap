# dns.zap — DNS provider + Cloudflare Pages capability.
#
# Native ZAP schema replacing the tRPC `dnsRouter`
# (server/api/routers/dns.ts). Every method was `protectedProcedure`, so the
# mint boundary requires an authenticated session. Inputs are Zod objects
# carried via the shared Args struct (../args.ts); return values via the shared
# Result struct (../result.ts). This schema declares only the method ordinals —
# the request/response payloads ride the generic carriers. Compiled by
# `zapgen schema/dns.zap -out schema/`.

package dns

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).
# Methods reference them by name; the generic struct codecs come from those
# generated modules, not from this file.

interface Dns {
  listZones(args: Args) returns (result: Result)
  createZone(args: Args) returns (result: Result)
  deleteZone(args: Args) returns (result: Result)
  listRecords(args: Args) returns (result: Result)
  createRecord(args: Args) returns (result: Result)
  updateRecord(args: Args) returns (result: Result)
  deleteRecord(args: Args) returns (result: Result)
  verifyDomain(args: Args) returns (result: Result)
  listPagesProjects(args: Args) returns (result: Result)
  getPagesProject(args: Args) returns (result: Result)
  createPagesProject(args: Args) returns (result: Result)
  triggerPagesDeploy(args: Args) returns (result: Result)
  addPagesDomain(args: Args) returns (result: Result)
  removePagesDomain(args: Args) returns (result: Result)
}
