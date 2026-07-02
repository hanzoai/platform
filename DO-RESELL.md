# Hanzo Compute — DigitalOcean resell map

How the **Compute** product category (hanzo.ai nav) maps onto DigitalOcean
products that Hanzo PaaS already provisions, and the resell model that turns raw
DO cost into metered, margin-bearing revenue billed to the org wallet.

> Hanzo runs on DOKS (`do-sfo3-hanzo-k8s`). "Resell compute" = we provision DO
> resources on the customer's behalf inside our DO account, mark the cost up,
> meter usage, and debit the org wallet. The customer never sees a DO bill.

## 1. Category → DO product → what platform already has

| Hanzo Compute item | DO product | Platform capability (today) | File |
|--------------------|-----------|------------------------------|------|
| **Machines** (VMs) | Droplets | `createInstance`/`resizeInstance`/`deleteInstance`, pools (`scaleUpPool`/`scaleDownPool`/`drainNode`), `createPoolFirewall`, `createPoolLoadBalancer`, `listInstanceSizes`, `listRegions` | `pkg/platform/src/services/digitalocean.ts` |
| **Cloud** (managed k8s) | DOKS | `provisionDoksCluster`, `addNodePool`/`updateNodePool`/`deleteNodePool`, `upgradeToHA`, `getDoksKubeconfig`, `syncDoksFleet`, `listNodeSizes`, **`getDropletPricing(sizeSlug)`** | `pkg/platform/src/services/doks-provisioner.ts` |
| **Functions** (FaaS) | (Hanzo Fission on DOKS) | **LIVE** — see `functions/INTEGRATION.md`. Not a raw DO product; runs on our DOKS, billed per invocation / GPU-second | `universe/infra/k8s/functions/` |
| **Storage / S3** | Spaces (S3) | mapped to Hanzo S3 (`s3.hanzo.ai`, MinIO) today; DO Spaces is the drop-in raw option | — (gap, see §4) |
| **Edge / Realtime / Functions@Edge** | DO App Platform / CDN | not used (App Platform decommissioned Feb 2026); edge = our gateway + functions | — |
| **Containers** | DOKS workloads / DOCR | `compose-cap` / `application-cap` / `deployment-cap` deploy compose+app workloads onto clusters | `app/platform/server/zap/*-cap.ts` |

The provisioning plane is **org-scoped and multi-tenant already**: every cap
verifies `cluster.organizationId === ctx.organizationId` (`doks-cap.ts`,
`digitalocean-cap.ts`), and clusters/pools are rows keyed by org
(`compute-pool` schema). IAM-native via the zap `MintCap` (gateway-injected
identity).

## 2. The resell model (cost × margin → meter → wallet)

```
DO list price ──getDropletPricing(slug)──┐
                                          ▼
                          resale_rate = do_cost × (1 + MARGIN)        ← the gap (§4)
                                          ▼
        hourly meter cron  ── for each running droplet/node/cluster ──┐
                                          ▼
              usage record (provider="compute", meter="machine|cluster|gpu")
                                          ▼
                 wallet-service debit (org wallet)  ──or──  commerce metering
                  (platform billing-cap)                  (company-wide source of truth)
```

- **Raw cost** is known: `getDropletPricing(sizeSlug)` (DOKS) and
  `listInstanceSizes` carry DO's hourly/monthly price.
- **Margin** is the one missing primitive — apply a per-size or per-class markup
  (e.g. 30–50%) to get the customer rate. There is **no margin layer today**
  (grep: only CSS `margin`), so this is the highest-leverage add.
- **Meter**: a cron walks running resources per org each hour and records
  `do_cost × (1+margin) × hours`. Mirrors the LLM/functions metering pattern.
- **Debit**: platform already has org wallets + Stripe top-up
  (`billing/wallet-service`, `getOrganizationWallet`, `billing-cap.ts`). Debit the
  wallet; when empty, gate provisioning (fail-closed) — same 402 semantics as
  functions/LLM. Converge onto **commerce** (`github.com/hanzoai/commerce/metering`,
  `UsageMeterType: 'gpu'|'api_calls'|'network_egress'|…`) so all spend lands in
  one ledger.

## 3. Investor-demo narrative (what's real today)

- **Provision**: one org can spin a DOKS cluster + node pools, or a Droplet
  pool, through the PaaS — org-scoped, IAM-gated, with autoscale/drain. Real DO
  API calls, real cost known per size.
- **Functions**: pure cloud functions (Python/JS/Rust) run on our DOKS with
  scale-to-zero, billed per invocation (and GPU-second) through commerce.
- **Bill**: org wallets + Stripe top-up exist; usage debits the wallet.
- The story: *"We resell DO compute (VMs, k8s, storage) + run a FaaS on top,
  all metered with margin and billed to a single prepaid wallet — a GCP-style
  cloud over commodity infra."*

## 4. Quick wins to extend platform provisioning (do NOT touch commerce/gateway/console2)

Ordered by leverage. All live in `~/work/hanzo/platform` (and `universe` manifests):

1. **Margin layer** (highest leverage). Add `resaleRate(sizeSlug, class)` next to
   `getDropletPricing` — `do_cost × (1 + margin)`, margin from a config/DB table
   (`compute_pricing`), overridable per org/plan. One pure function; everything
   downstream consumes it.
2. **Hourly usage cron**. A `meterCompute` job: list running droplets/nodes per
   org (`listPoolInstances`, `listDoksClusters`), record `resaleRate × hours`.
   Reuse the deployment/scaling-job cron infra already in platform.
3. **Wallet gate on provision**. Before `createInstance`/`provisionDoksCluster`,
   check the org wallet (fail-closed if empty); reuse `getOrganizationWallet`.
4. **Spaces (S3) resell**. Add a `spaces-cap` (DO Spaces create/list/key-issue)
   mirroring `digitalocean-cap`; meter GB-month + egress (`network_egress`).
   Or front it with our existing S3 (`s3.hanzo.ai`) and meter there.
5. **GPU droplets**. DO GPU Droplets → add the GPU classes to `listInstanceSizes`
   + price classes; these are what Functions' GPU envs and Zen-model inference
   resell (see `functions/INTEGRATION.md` §2c).
6. **Converge platform wallet → commerce**. Make the debit call commerce's
   metering client so PaaS compute spend shares the one ledger with LLM +
   Functions, instead of a platform-local wallet only.

The provisioning surface (DO API, pools, DOKS, autoscale) is the hard part and
it already exists. Resell = the thin margin + meter + debit loop on top.
