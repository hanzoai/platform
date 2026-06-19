# audit-log.zap — enterprise audit-log capability.
#
# Native ZAP schema replacing the tRPC `auditLogRouter`
# (server/api/routers/enterprise/audit-log.ts). The single method was
# `withPermission("auditLog", "read")` with an additional valid-enterprise-
# license gate in a `.use(...)` middleware. Inputs ride the shared Args carrier
# (../args.ts); return values the shared Result carrier (../result.ts).
# Compiled by `zapgen schema/audit-log.zap -out schema/`.

package auditlog

# Args/Result are the shared carriers (schema/args.zap, schema/result.zap).

interface AuditLog {
  all(args: Args) returns (result: Result)
}
