# Hanzo PaaS — Operator Integration

How `platform.hanzo.ai` provisions tenant databases and apps as Kubernetes
Custom Resources managed by the `hanzoai/operator`, replacing the Docker
Swarm path on customer-facing deploys.

This document is the contract between two services and is checked in.
Field changes here are breaking changes to the operator's admission
webhook and must be coordinated.

## Why

Platform's current path (`docker run postgres`, `docker run redis`, etc.)
locks customer workloads to a single Docker Swarm host. Moving to operator
CRs gives us:

- Multi-cluster scheduling (DOKS today, GKE/EKS later) via tenant
  kubeconfigs.
- Standard K8s primitives (StatefulSet + PVC + Service + Ingress)
  managed by the same controller stack as Hanzo's internal services.
- Tenant isolation via per-org namespaces and quota enforcement.
- Idempotent reconcile: customer edits → CR update → operator
  reconciles, no platform-side imperative apply loop.

## Architecture

```
Customer browser
       |
       v
platform.hanzo.ai UI/API (Next.js + tRPC)
       |
       v
pkg/platform/services/postgres.ts (deployPostgres)
       |  USE_K8S_OPERATOR === "true"
       v
pkg/platform/services/k8s/operator/
       |
       +-- cr-builder.ts -> buildPostgresCR (+ KV / DocDB)
       +-- tenant.ts     -> signPaasTicket (HS256 over shared secret)
       +-- quota.ts      -> checkQuota (per-CR + per-org caps)
       +-- index.ts      -> applyDatastoreCR (CustomObjectsApi)
       |
       v
hanzo.ai/v1 SQL | KV | DocDB CR
       |
       v
hanzo-operator (tenant mode)
       |
       +-- admission webhook: verify PaaS ticket + quota
       +-- controller:         materialize StatefulSet/Service/PVC
       |
       v
Tenant Pods serving customer traffic
```

## CRD mapping

| Platform DB type | Operator Kind | DatastoreSpec.type | Plural    | Notes                                                            |
|------------------|---------------|--------------------|-----------|------------------------------------------------------------------|
| Postgres         | SQL           | `postgresql`       | `sqls`    | Canonical.                                                       |
| Redis            | KV            | `valkey`           | `kvs`     | Wire-compatible Redis (Valkey fork).                             |
| MongoDB          | DocDB         | `docdb`            | `docdbs`  | FerretDB delivers Mongo wire over PostgreSQL.                    |
| MySQL            | (none)        | —                  | —         | No operator CRD. Surface a UX error before reaching the builder. |
| MariaDB          | (none)        | —                  | —         | No operator CRD. Same as MySQL.                                  |
| App (Git deploy) | Service       | n/a (ServiceSpec)  | `services`| Future phase — not part of the initial scaffold.                 |

Sources:
- Operator CRDs: `~/work/hanzo/operator/src/crd.rs`
- Built CRs:     `~/work/hanzo/platform/pkg/platform/src/services/k8s/operator/cr-builder.ts`

## PaaS ticket protocol

Every CR materialized by platform carries a short-lived JWT in the
annotation `hanzo.ai/paas-ticket`. The operator's admission webhook
validates this ticket on each CREATE/UPDATE.

### Claims

```
iss  "platform.hanzo.ai"
sub  <organizationId from session.activeOrganizationId>
aud  "operator.hanzo.ai"
kind "SQL" | "KV" | "DocDB" | "Service"
ns   "tenant-<org-slug>"
nm   <cr-name, same as metadata.name>
q    { cpu: <quantity>, memory: <quantity>, storage: <quantity> }
iat  <unix seconds>
exp  iat + 300   (5-minute window, enough for one apply)
jti  <random hex>
```

### Signature

HS256 over the JWS signing input `<header>.<payload>`, using the shared
secret in env `OPERATOR_PAAS_SHARED_SECRET` (mounted from the K8s
secret `operator-paas-shared-secret`).

Asymmetric (RS256/EdDSA) was considered and rejected: platform and
operator are both first-party Hanzo workloads in the same trust domain,
so the X.509 / JWKS rotation surface is not worth the complexity.

### Verification (operator side, mirrored in `tenant.ts`)

1. Split on `.`, base64url-decode the parts.
2. Recompute HS256 over `header.payload` and constant-time-compare with
   the supplied signature.
3. Require `alg=HS256`, `iss=platform.hanzo.ai`, `aud=operator.hanzo.ai`.
4. Reject if `now < iat - 30` (forward clock skew tolerance: 30s).
5. Reject if `now > exp` (no skew tolerance on expiry).
6. Reject if `kind/ns/nm/q` don't match `request.object` fields (admission
   webhook only).

A successfully verified ticket is one-shot evidence that platform
authorized this CR. The operator still applies its own per-namespace
quota check on top — defense in depth.

## Quota tiers

Defined in `pkg/platform/services/k8s/operator/quota.ts`. Per-CR and
per-org caps. The operator MUST also enforce these.

| Tier        | Per-CR CPU | Per-CR mem | Per-CR storage | Org CPU | Org mem  | Org storage | Org DB count |
|-------------|-----------:|-----------:|---------------:|--------:|---------:|------------:|-------------:|
| free        |    500m   |    1 GiB   |       5 GiB   |   1 core|   2 GiB  |    10 GiB   |       1      |
| starter     |    2 cores|    4 GiB   |      50 GiB   |   4 cores|  8 GiB  |   100 GiB   |       5      |
| pro         |    8 cores|   32 GiB   |     500 GiB   |  32 cores| 128 GiB |  2 TiB      |      50      |
| enterprise  |   64 cores|  512 GiB   |   10 TiB      | 256 cores|   1 TiB | 100 TiB     |    1000      |

Storage parser accepts `Mi`, `Gi`, `Ti`, `Pi`. CPU accepts bare cores or
`m` suffix. Memory accepts `Ki`, `Mi`, `Gi`, `Ti`, `Pi`.

## Feature flag

`USE_K8S_OPERATOR` env var, default `false`. When `false`, the existing
Docker Swarm path is used unchanged. When `true`, platform routes
provisioning through the operator.

```
USE_K8S_OPERATOR=true
OPERATOR_PAAS_SHARED_SECRET=<32+ bytes>
OPERATOR_STORAGE_CLASS=do-block-storage   # cluster-dependent
```

The flag is read in `pkg/platform/src/constants/index.ts`. Each
deploy function (`deployPostgres`, future `deployRedis` / `deployMongo`)
branches on `USE_K8S_OPERATOR` at the top of its try block.

## Rollout phases

1. **Phase 1 — flag off (current).**
   Docker Swarm path runs everywhere. Zero customer impact. This is the
   default for every existing deployment. Code paths preserved.

2. **Phase 2 — internal dogfood.**
   Set `USE_K8S_OPERATOR=true` only on the staging platform instance
   (`platform.staging.hanzo.ai`). Provision against the
   `hanzoai/operator` running on the `hanzo-k8s` DOKS cluster.
   Tenant namespaces are scoped to internal staff org IDs.
   Validation: end-to-end create-Postgres flow, observe CR.status.phase
   reaching `Running`, connect from a staff service.

3. **Phase 3 — new customers only.**
   Flip the flag on production `platform.hanzo.ai`. New orgs default
   to the operator path. Existing orgs continue on Docker Swarm via
   per-org override (`platform_settings.use_k8s_operator BOOLEAN`,
   resolved on each deploy call). Document UX changes:
   "Manage in console" link points to operator-managed namespace.

4. **Phase 4 — migration tool.**
   Per-org one-shot migration:
   `pnpm tsx scripts/migrate-org-to-operator.ts --org-id=<id>`
   For each DB in the org:
     a. Pause writes (set `applicationStatus=running` → block deploy).
     b. `pg_dump` / `redis-dump` / `mongodump` to MinIO bucket.
     c. Apply operator CR, wait for Running.
     d. Restore dump into the new operator-managed instance.
     e. Switch service alias to the operator-managed service.
     f. Tear down the Swarm container.
     g. Flip `platform_settings.use_k8s_operator=true` for the org.

5. **Phase 5 — decommission Swarm.**
   Once all orgs are migrated, remove the Docker Swarm branch from
   `deploy*` functions. Drop `dockerode` dep. Update `docs/` and
   compose files. Track via the
   `platform_settings.use_k8s_operator=false` query reaching zero rows.

## Module layout

```
pkg/platform/src/services/k8s/operator/
├── index.ts        Barrel + applyDatastoreCR / deleteDatastoreCR /
│                   readDatastoreCRStatus / provisionDatastore /
│                   waitDatastoreReady / tenantNamespace
├── cr-builder.ts   buildPostgresCR / buildRedisCR / buildMongoCR
│                   + DatastoreSpec / OperatorServiceSpec types
│                   + KIND_TO_PLURAL
├── tenant.ts       signPaasTicket / verifyPaasTicket
│                   + TicketClaims / TicketVerificationError
└── quota.ts        checkQuota / defaultQuotaForTier
                    + PLAN_LIMITS / QuotaError
                    + parseCpuToMillicores / parseMemoryToMiB /
                      parseStorageToGiB
```

The K8s API client comes from the existing
`pkg/platform/src/services/k8s/k8s-client.ts` (`createK8sClients` /
`getDefaultClients`). Operator CRs use `CustomObjectsApi`.

## Testing

`app/platform/__test__/operator/`:
- `tenant.test.ts`     — JWT round-trip, tamper, expiry, secret-rotation
- `quota.test.ts`      — parser correctness, per-CR + per-org caps
- `cr-builder.test.ts` — CRD field shape, kind→plural mapping

Run: `pnpm vitest run __test__/operator/ --config __test__/vitest.config.ts`

## Non-goals (this scaffold)

- App (Git deploy) → Service CR. Tracked as the next phase.
- Tenant kubeconfig discovery (multi-cluster targeting). Currently uses
  the default kubeconfig. DOKS provisioner (`services/doks-provisioner.ts`
  per `routers/doks.ts`) will hand back the kubeconfig in Phase 3.
- Operator-side admission webhook implementation. Lives in
  `~/work/hanzo/operator` and is being scaffolded by a separate agent.
  This document fixes the contract; the webhook code is downstream.
- Migration tool. Phase 4 deliverable.

## Operational notes

- Stale ticket clock-skew window is 30s forward, 0s backward. If
  platform's pod and the operator's pod disagree by more than 30s,
  CR applies will fail. Both pods should run NTP (Cluster default on
  DOKS is `chronyd`).
- The shared secret rotates via `KMSSecret` from `kms.hanzo.ai`. Both
  pods mount the same secret; rotation requires a coordinated rollout
  (operator first, platform second, otherwise in-flight tickets fail).
- `tenantNamespace("Org-Acme")` => `tenant-org-acme` (case-normalized,
  non-alphanumeric replaced with `-`). The operator's webhook
  validates the same regex.
- `waitDatastoreReady` polls every 2s with a 5-minute default timeout.
  UI subscribes via the existing `deployWithLogs` tRPC subscription
  channel; each phase transition is yielded as a log line.

## References

- Operator CRDs:        `~/work/hanzo/operator/src/crd.rs`
- Operator CR examples: `~/work/hanzo/universe/infra/k8s/hanzo-operator/crs/`
- K8s client helper:    `pkg/platform/src/services/k8s/k8s-client.ts`
- Feature flag:         `pkg/platform/src/constants/index.ts`
  (`USE_K8S_OPERATOR`, `OPERATOR_STORAGE_CLASS`)
