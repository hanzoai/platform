# doks.zap — DOKS (DigitalOcean Kubernetes Service) capability.
#
# Native ZAP schema for the Platform DOKS RPC surface. Replaces the tRPC
# `doksRouter` (app/platform/server/api/routers/doks.ts). Compiled by
# `zapgen schema/doks.zap -out schema/` into schema/doks_zap.ts (typed struct
# views/builders + the DoksMethod ordinal table + DoksClient/DoksServer).
#
# Field @n are BYTE OFFSETS in the struct's fixed section (text/bytes/u64 = 8B,
# bool = 1B, u32 = 4B) — packed sequentially. Method ordinals are auto-assigned
# 1,2,3,... in declaration order; appending a method never renumbers existing
# ones. Heterogeneous service return values ride the shared Result carrier
# (schema/result.zap → ../result.ts).

package doks

# --- Parameter structs (client → server) ---

struct ProvisionParams {
  organizationId text @0
  region         text @8
  nodeSize       text @16   # optional; "" = unset
  ha             bool @24
  nodeCount      u32  @28   # optional; 0 = unset
}

struct ClusterRef {
  doksClusterId text @0
}

struct AddNodePoolParams {
  doksClusterId text @0
  name          text @8
  size          text @16
  count         u32  @24
}

struct UpdateNodePoolParams {
  doksClusterId text @0
  poolId        text @8
  size          text @16   # "" = unset
  count         u32  @24   # 0 = unset
}

struct DeleteNodePoolParams {
  doksClusterId text @0
  poolId        text @8
}

# Attach an external (bring-your-own) cluster: a display name + raw kubeconfig.
struct AttachClusterParams {
  name       text @0
  kubeconfig text @8
}

# Empty params for parameterless methods.
struct Empty {
  _pad u8 @0
}

# --- The capability ---
#
# One interface method per former tRPC procedure, in the original declaration
# order so the auto-assigned ordinals are stable. Every method returns the
# shared Result carrier (../result.ts).

interface Doks {
  # Cluster lifecycle
  provision(params: ProvisionParams) returns (result: Result)
  get(params: ClusterRef) returns (result: Result)
  getByOrg(params: Empty) returns (result: Result)
  status(params: ClusterRef) returns (result: Result)
  kubeconfig(params: ClusterRef) returns (result: Result)
  delete(params: ClusterRef) returns (result: Result)
  upgradeToHA(params: ClusterRef) returns (result: Result)

  # Node pools
  addNodePool(params: AddNodePoolParams) returns (result: Result)
  updateNodePool(params: UpdateNodePoolParams) returns (result: Result)
  deleteNodePool(params: DeleteNodePoolParams) returns (result: Result)

  # Fleet (admin)
  list(params: Empty) returns (result: Result)
  sync(params: Empty) returns (result: Result)
  listNodeSizes(params: Empty) returns (result: Result)
  listRegions(params: Empty) returns (result: Result)

  # Billing
  clusterCost(params: ClusterRef) returns (result: Result)
  orgBilling(params: Empty) returns (result: Result)
  fleetBilling(params: Empty) returns (result: Result)
  recordSnapshot(params: Empty) returns (result: Result)

  # BYO cluster attach (appended last so ordinals 1-18 stay stable)
  attachCluster(params: AttachClusterParams) returns (result: Result)
}
