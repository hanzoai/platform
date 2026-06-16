# doks.zap — DOKS (DigitalOcean Kubernetes Service) capability.
#
# Native ZAP schema for the Platform DOKS RPC surface. Replaces the tRPC
# `doksRouter` (app/platform/server/api/routers/doks.ts). Method ordinals (@n)
# are the integers passed to `bootstrap.call(method, …)` on the @zap-proto/web
# Conn, and matched in the server's rootCap dispatch.
#
# Wire note: until `zapgen --target=ts` (zap-proto/ts) is published to npm, the
# concrete views/builders for these structs are hand-authored in ../codec.ts
# against @zap-proto/zap's Builder/StructView, following the field order
# declared here. Field order in each struct IS the wire contract — do not
# reorder without bumping the codec.

# --- Parameter structs (client → server) ---

struct ProvisionParams {
  organizationId @0 :Text;
  region         @1 :Text;
  ha             @2 :Bool;
  nodeSize       @3 :Text;   # optional; "" = unset
  nodeCount      @4 :UInt32; # optional; 0 = unset
}

struct ClusterRef {
  doksClusterId @0 :Text;
}

struct AddNodePoolParams {
  doksClusterId @0 :Text;
  name          @1 :Text;
  size          @2 :Text;
  count         @3 :UInt32;
}

struct UpdateNodePoolParams {
  doksClusterId @0 :Text;
  poolId        @1 :Text;
  count         @2 :UInt32; # 0 = unset
  size          @3 :Text;   # "" = unset
}

struct DeleteNodePoolParams {
  doksClusterId @0 :Text;
  poolId        @1 :Text;
}

# Empty params for parameterless methods (getByOrg, list, sync, listNodeSizes,
# listRegions, orgBilling, fleetBilling, recordSnapshot).
struct Empty {}

# --- Result structs (server → client) ---
#
# DOKS service functions return heterogeneous DB rows / provider payloads. They
# are carried as a single ZAP `Text` value (Result.json) holding the canonical
# encoding of the value, decoded back to JS on the client. This keeps the wire
# binary ZAP (a struct with one Text field) while staying schema-light for the
# 18 service-defined result shapes that have no stable column contract here.

struct Result {
  value @0 :Text;   # the method's return value, ZAP-record encoded
}

# --- The capability ---
#
# One interface method per former tRPC procedure. Ordinals are stable; the
# server dispatches on them and the client calls them by name via the generated
# wrapper in ../../utils/zap.ts.

interface Doks {
  # Cluster lifecycle
  provision      @0  (params :ProvisionParams)        -> (result :Result);
  get            @1  (params :ClusterRef)             -> (result :Result);
  getByOrg       @2  (params :Empty)                  -> (result :Result);
  status         @3  (params :ClusterRef)             -> (result :Result);
  kubeconfig     @4  (params :ClusterRef)             -> (result :Result);
  delete         @5  (params :ClusterRef)             -> (result :Result);
  upgradeToHA    @6  (params :ClusterRef)             -> (result :Result);

  # Node pools
  addNodePool    @7  (params :AddNodePoolParams)      -> (result :Result);
  updateNodePool @8  (params :UpdateNodePoolParams)   -> (result :Result);
  deleteNodePool @9  (params :DeleteNodePoolParams)   -> (result :Result);

  # Fleet (admin)
  list           @10 (params :Empty)                  -> (result :Result);
  sync           @11 (params :Empty)                  -> (result :Result);
  listNodeSizes  @12 (params :Empty)                  -> (result :Result);
  listRegions    @13 (params :Empty)                  -> (result :Result);

  # Billing
  clusterCost    @14 (params :ClusterRef)             -> (result :Result);
  orgBilling     @15 (params :Empty)                  -> (result :Result);
  fleetBilling   @16 (params :Empty)                  -> (result :Result);
  recordSnapshot @17 (params :Empty)                  -> (result :Result);
}
