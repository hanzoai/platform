# result.zap — the universal ZAP Result carrier shared by every migrated router.
#
# Platform RPC methods return heterogeneous DB rows / provider payloads with no
# stable column contract at the RPC layer, so each method's return value rides
# inside the single Text field of this struct (canonical record encoding). The
# wire frame is binary ZAP (a struct with one Text field) — never a JSON body.
# See ../result.ts for the value codec layered over this struct.

package result

struct ResultStruct {
  value text @0
}
