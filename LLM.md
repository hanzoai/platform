# paas — AI Assistant Context

<div align="center">
  <a href="https://hanzo.ai">
    <img src=".github/sponsors/logo.png" alt="Hanzo - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  </br>
</div>

## Platform-native CI/CD (GHA escape)

Platform owns the build+deploy lifecycle so a GitHub Actions outage cannot
halt shipping. Contract + schema: `docs/PLATFORM_CI.md`.

- Webhook: `app/platform/pages/api/v1/github-webhook.ts` (HMAC per installation).
- Build callback: `app/platform/pages/api/v1/build-callback.ts` (bearer token).
- Service layer: `pkg/platform/src/services/ci/` — `platform-config` (`.platform.yml`
  parser + in-house validator), `github-webhook` (decoder + HMAC), `build-job`
  (DB CRUD), `build-scheduler` (dispatch to arcd via `workflow_dispatch`),
  `deploy-executor` (merge-patch operator `Service` CR `.spec.image`),
  `build-completion` (callback → deploy).
- DB: `build_job` table (`pkg/platform/src/db/schema/build-job.ts`,
  migration `drizzle/0170_platform_native_ci.sql`).
- tRPC: `buildJob` router (org-scoped list/one/logs/trigger).
- arcd decision: dispatch to existing pools via `workflow_dispatch` (arcd
  unchanged); platform owns the system-of-record + deploy decision. Native
  arcd long-poll protocol is the next iteration.
- Per-repo executor workflow template: `hanzoai/.github/workflow-templates/platform-build.yml`.

## Apps inventory — the "observe" half of the control plane

`platform.hanzo.ai/apps` (the apps-lifecycle drift board, `docs/APPS_LIFECYCLE.md`)
lists every org's real apps with **declared / running / latest tag + drift +
health**. The schema (`apps`), drift logic (`apps-drift.ts`), read API
(`apps-api.ts` → `/v1/apps`), and the board UI (`pages/dashboard/apps.tsx` +
`components/dashboard/apps/apps-board.tsx`) were all already built; the table was
EMPTY because nothing populated it (the four specced cron readers were never
merged; the static `db/seed.ts` is a 16-row hardcoded bootstrap only).

The runtime populator is **`pkg/platform/src/services/apps/inventory.ts`** — one
cluster pass that unifies `read_declared_tag` + `read_running_tag`:
- lists operator `Service` CRs (`hanzo.ai/v1`, plural `services`) → `declaredTag`
  = `spec.image.tag`, `org`/`repo`/`registry` from `spec.image.repository`.
- reads the live `Deployment` of the same name → `runningTag` (the container
  whose image repo matches the CR's, so sidecars are ignored) + `health`
  (green=all ready, yellow=partial/scaled-to-0, red=desired>0 & none ready).
- `env` from namespace (`hanzo`→main, `hanzo-testnet`→test, `hanzo-devnet`→dev).
- upserts ONLY observed columns by `<org>/<app>/<env>` id; never clobbers the
  release-reader columns (`latestTag`/`releaseUrl`/`releaseAssets` — follow-up).
- resolves `organizationId` by slug/name + brand alias (hanzoai→hanzo …), else
  the lone org for single-tenant installs.

READ-MOSTLY: lists CRs + Deployments, writes only platform's own SQLite — it
NEVER mutates a cluster object, so it cannot perturb the control plane. RBAC is
already granted (`hanzo-paas-sa` ClusterRole: `hanzo.ai/services` list + `apps`
+ `pods`). Driven by `inventory-scheduler.ts` (`startInventoryScheduler`, leading
run + 60s interval, mirrors `billing-job.ts`), started from `server/server.ts`
in production (gate: `APPS_INVENTORY_DISABLED=true`). On-demand refresh:
`POST /v1/apps/sync` (service-token).

**DEPLOYED (v4.2.7, live in hanzo-k8s).** Merged via PR #45; image built
cache-busted on-cluster by the `arcbuild-platform-v427` BuildKit Job (context
`platform.git#a6831caf0`, target `platform`, `--no-cache`) → `ghcr.io/hanzoai/platform:v4.2.7`,
because ALL 324 org GitHub runners were offline (the `[self-hosted,linux,amd64]`
image jobs could not start — GHA-escape scenario; `quality` gate passed first).
The `paas` Deployment was rolled to v4.2.7 by a direct `kubectl set image`
(NOT via the operator: the operator is wedged on this Deployment — it wants
selector `{app.kubernetes.io/instance,name}` but the live Deployment's selector
is the legacy immutable `{app: paas}`, so every reconcile 422s; this also blocks
captable/console-worker/hanzo-playground). Boot verified clean (`2/2 Running`,
0 restarts); scheduler logged `synced 55 apps … hanzo-k8s=55`; `/v1/apps` → 200,
total=55 (51 hanzoai + grafana/meili/guacamole/hanzobot; envs main=51/test=2/dev=2).

**CR drift fixed:** the `paas` operator CR was reconciled from the stale
`ghcr.io/hanzoai/paas:v4.1.0` to the live `ghcr.io/hanzoai/platform:v4.2.7`
(both repo + tag were wrong — the Deployment had been image-patched out-of-band).
declared==running now.

**Drift column is all-`red` today, by design (not a bug):** `computeDrift`
flags `no-release` (red) for every row because `latestTag`/`releaseUrl` are null
— the GHCR/GH-release reader (`read_latest_tag`/`read_release_meta`) is the
documented follow-up and has not shipped. declared/running/health are accurate;
once the release reader populates those columns the drift verdict becomes
meaningful (stale/un-rolled/zero-assets). Do NOT weaken `computeDrift` to hide
this — it is the honest signal that the release-meta half is unbuilt.

**organizationId today:** the platform DB has ONE org (`slug=admin`), so the
populator's "lone org owns everything" fallback assigns all 55 rows to it (the
`hanzoai→hanzo` alias only fires once a matching org is seeded). Per-org scoping
(`?org=`/`X-Org-Id`, the `org` column, alias resolution) is fully wired for when
more orgs exist.

Lifecycle WRITE (deploy/redeploy = patch the `Service` CR's `spec.image`) is the
CI `deploy-executor` path; the board is the observe surface only. Cross-cluster
(lux-k8s/zoo-k8s) = append `ClusterTarget`s with a KMS-loaded kubeconfig.

## Datastore — Base SQLite (tenancy)

Platform's internal datastore is Base SQLite via better-sqlite3 (`pkg/platform/src/db`).
Connection: single singleton (`index.ts`), PRAGMAs foreign_keys=ON + WAL + busy_timeout.

**Tenancy is shared-DB-with-tenant-column, NOT file-per-tenant.** 24 schema files
carry an `organizationId` column; isolation is enforced by org-scoped queries.
The CTO directive's "file is the tenant boundary" (one SQLite per org, no tenant
column) is the END-STATE, queued as a follow-up — it is NOT what ships today. The
follow-up turns the singleton into a per-org connection factory
(`dbForOrg(orgId)`); until then do not claim per-tenant-file isolation.

Deploy: persistent k8s StatefulSet + 50Gi `do-block-storage-retain` PVC at
`/app/data` (`k8s/platform-statefulset.yaml`), `PLATFORM_DB_PATH=/app/data/platform.db`,
`replicas: 1` (single SQLite writer; multi-replica needs the per-org-file design).
Secrets via KMSSecret → `platform-app-secrets` (`k8s/platform-kmssecret.yaml`).
`.do/app.yaml` is EPHEMERAL-preview-only (`PLATFORM_DB_PATH=:memory:`); App
Platform's filesystem does not survive restarts, so it must never hold a real DB.

## Auth (HIP-0111, one way) + Node-24 build
- Platform login = Hanzo IAM PKCE via **`hanzo.id`** (no Better Auth login, no genericOAuth). The settled flow + files live in `IAM_MIGRATION.md` (CANONICAL header). Don't re-add a `signIn.social`/`signIn.oauth2` button.
- Node 24 build: keep the pnpm override `nan: 2.27.0` (native deps `ssh2`/`node-pty` won't compile on Node 24 without it).

## Versioning — ONE line, `v4.x` (HIP-0111)
There is exactly one version line: **`v4.x`**. `app/platform/package.json`,
git tags, and the published `ghcr.io/hanzoai/platform` image tag are the SAME
string. Current: `v4.2.2`.

`v0.28.x` is DEAD. It was the upstream Dokploy app-string (author Mauricio Siu)
that the fork kept bumping out of habit; `v0.28.9` (#31) was the last one and is
an ancestor of `main`. Do not cut, tag, or publish `v0.28.x` again. The `v4.2.0`
/ `v4.2.1` tags were a short auth-branch snapshot taken before the
Postgres→SQLite merge (#29); their 7 auth commits (Better Auth on `/v1/auth`,
`signIn.oauth2`) are fully superseded by `main`'s IAM-PKCE flow (see Auth
section) — `main` is strictly ahead, nothing to back-merge.

Release = bump `app/platform/package.json` version, tag `main` HEAD with the
same string, let `deploy.yml` build+push the image at that tag. No second
numbering scheme, ever.

## Build resilience — runners cannot reach Docker Hub
The arcd runners resolve DNS via 8.8.8.8 and intermittently time out on
`registry-1.docker.io`; `ghcr.io` is always reachable. Two consequences, both
fixed and load-bearing — do not revert:
- `.github/buildkitd.toml` mirrors `docker.io` → `mirror.gcr.io`; every
  `docker/setup-buildx-action` in `deploy.yml` loads it via `buildkitd-config`.
- `Dockerfile` has **no `# syntax=` pragma** (it would force a Docker Hub pull of
  `docker/dockerfile:1`); the built-in buildkit frontend handles
  `RUN --mount=type=cache` on buildx ≥ v0.34.
The upstream `dokploy.yml` workflow (pushed `dokploy/dokploy` to Docker Hub,
synced `dokploy/{mcp,cli,sdk}`) was deleted — it is upstream noise, never a Hanzo
build. CI jobs that run `pnpm install` need the "Ensure native build toolchain"
step (node-gyp wants make/gcc/python for `ssh2`/`node-pty`/`bcrypt`).
