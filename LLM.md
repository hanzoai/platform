# Hanzo Platform — LLM / agent orientation

**What this is.** Hanzo Platform — the self-hostable PaaS that is the *deploy plane*
of the Open AI Cloud. Point it at a repo; it builds, deploys, routes, backs up, and
monitors apps, services, and databases. Fork of Dokploy (Apache-2.0), rebranded and
extended with platform-native CI/CD, an apps-lifecycle drift board, KMS-sourced
secrets, and operator-CR-driven Kubernetes deploys.

**Canonical role.** A *product/infra* repo in the `hanzoai/*` umbrella — the impl
lives here; the site and docs link IN, never duplicate it. This is NOT an SDK. The
one-way SDK model (two lines: generated cloud SDK + AI/agents lib; Python flagship)
is specified in `~/work/hanzo/SDK-ARCHITECTURE.md`.

**Run it.** pnpm monorepo, Node per `.nvmrc`. `pnpm install` → `pnpm platform:setup`
→ `pnpm platform:dev`; `pnpm build`; `pnpm test`. Ship: bump
`app/platform/package.json`, tag `main` HEAD the same `vX.Y.Z` →
`ghcr.io/hanzoai/platform:<tag>` (ONE version line, `v4.x`).

**Key entry points.** `pkg/platform` = server + services (`services/ci/*` =
build→deploy→e2e→publish; `services/apps/*` = inventory/drift). `app/*` = Next.js app
+ schedulers. `openapi.json` = the `/v1` surface. `docs/PLATFORM_CI.md` and
`docs/APPS_LIFECYCLE.md` = the contracts.

**Brand rules (hard).** Voice: "Hanzo — the Open AI Cloud." Never call anything an
"LLM gateway" or position vs LiteLLM — Hanzo is a full AI cloud, not a proxy. HTTP
routes are `/v1/*`, never an `/api/` URL prefix (existing `pages/api/v1/*` are
Next.js *filesystem* paths — real code, leave them). Zen models are our own family;
never name upstream models.

**CLAUDE.md and AGENTS.md are symlinks to this file — edit LLM.md only.**

---

# paas — AI Assistant Context

<div align="center">
  <a href="https://hanzo.ai">
    <img src=".github/sponsors/logo.png" alt="Hanzo - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  </br>
</div>

## Platform-native CI/CD (GHA escape)

Platform owns the FULL build → deploy → test → publish lifecycle so a GitHub
Actions outage cannot halt shipping. ONE conductor (the `paas` pod), ONE build
path (an in-cluster BuildKit Job), ONE heartbeat (the build-watcher). No GHA, no
`workflow_dispatch`, no external runner registration. Contract + schema:
`docs/PLATFORM_CI.md`.

- Triggers: `app/platform/pages/api/v1/github-webhook.ts` (HMAC per
  installation) and `app/platform/app/v1/runner/route.ts` (service-token,
  GitHub-free direct build). `build-callback.ts` is an optional external-builder
  completion hook (bearer token).
- Service layer: `pkg/platform/src/services/ci/` — `platform-config` (`hanzo.yml`
  parser + validator, now incl. `e2e:` + `publish:`), `github-webhook`,
  `build-job` (DB CRUD), `build-scheduler` (dispatch via `launchBuildJob`),
  `buildkit-job` (the build muscle — BuildKit Job + outcome read), `build-watcher`
  (the heartbeat: polls BuildKit Jobs, drives the pipeline), `build-completion`
  (post-build orchestrator: deploy → e2e → publish, App-free config via
  `GH_TOKEN`), `deploy-executor` (merge-patch operator `Service` CR
  `.spec.image`), `e2e-runner` (Playwright Job), `publish-job` (npm/pypi Job,
  KMS tokens).
- DB: `build_job` table (`pkg/platform/src/db/schema/build-job.ts`); migration
  `drizzle/0005_build_pipeline_columns.sql` adds `buildJobName`/`imageDigest`/
  `e2e*`/`publish*` and drops the dead `arcd_runner` table.
- tRPC: `buildJob` router (org-scoped list/one/logs/trigger).
- Build muscle: BuildKit (`moby/buildkit:v0.16.0`, `buildctl-daemonless.sh`,
  `--frontend=dockerfile.v0`) — the PROVEN contract that already builds
  commerce/chat/cloud on this cluster — over an HTTPS git context
  `https://github.com/<repo>.git#<ref>` → `--output=type=image,…,push=true` to
  GHCR, privileged, on `runner-pool-32g` + `dedicated=ci-runner` (git auth from
  `console-git-token` via `GIT_AUTH_TOKEN`, GHCR push cred from `kaniko-ghcr` at
  `/root/.docker`). The RETIRED long-poll/`workflow_dispatch` external-runner
  surface (build-queue, arcd-runner, `/v1/arcd/poll`+`/complete`) was removed —
  it pointed at offline GitHub runners and silently no-op'd.
- PROVEN LIVE (v4.4.4): `POST /v1/runner` for `hanzoai/pricing` created a
  `build_job` row → platform launched the BuildKit Job (`build-pricing-*`,
  `managed-by=platform`) → pushed `ghcr.io/hanzoai/pricing:v1.1.2` → the
  build-watcher flipped the row to `succeeded`. The auto-deploy leg
  (build-completion → deploy-executor) correctly REFUSED via the tenant gate
  (pricing's `hanzo.yml` targets system ns `hanzo` ≠ the build org's
  `tenant-<org>`); system services deploy by patching the operator `Service` CR
  (`kubectl patch services.hanzo.ai/<svc> .spec.image.tag`) → operator rolls it.
  The fully-autonomous build→deploy→e2e one-shot is for TENANT apps whose
  `hanzo.yml` targets their own tenant namespace.

### Gitea Actions on git.hanzo.ai — the GitHub-Actions-compatible on-ramp

The BuildKit pipeline above is the *opinionated* lane (platform owns
build→deploy→e2e→publish from `hanzo.yml`). The **complementary** lane is
**native GitHub-Actions-compatible CI on git.hanzo.ai**: a GitHub user brings
their repo and their existing `.github/workflows` **just run** — no rewrite, on
our own infra. This is the easy on-ramp INTO the Hanzo estate.

- **Enabled:** `GITEA__actions__ENABLED=true` on the `gitea` Deployment
  (`universe/infra/k8s/gitea/deployment.yaml`) → `app.ini [actions] ENABLED=true`.
  `DEFAULT_ACTIONS_URL` stays `github`, so `uses: actions/checkout@v4` (and any
  `owner/action@ref`) resolves to github.com.
- **Runners:** StatefulSet `gitea-act-runner` (2× `gitea/act_runner:0.6.1-dind`,
  privileged bundled dockerd, on `runner-pool-32g` + `dedicated=ci-runner` — the
  SAME CI pool the BuildKit Jobs use) in `universe/infra/k8s/gitea-runner/`.
  Registration token minted by gitea → **KMS** (`hanzo` / `gitea-runner-secrets` /
  `GITEA_RUNNER_REGISTRATION_TOKEN`, env=prod) → `KMSSecret` (kms-operator) →
  k8s Secret. NEVER in git/plaintext (same funnel as every platform secret).
- **`runs-on` map:** `ubuntu-latest` / `ubuntu-22.04` / `ubuntu-24.04` →
  catthehacker act images (GH-hosted-runner-equivalent); plus
  `hanzo-build-linux-amd64` for parity with existing hanzoai `runs-on`.
- **User on-ramp (how a GitHub repo lands):** create/mirror the repo on
  git.hanzo.ai (HTTP push with a Gitea token, or the repo-migration UI/API) → on
  push, gitea auto-discovers workflows and dispatches jobs to the runners.
  GOTCHA: if a repo has BOTH `.gitea/workflows/` and `.github/workflows/`, gitea
  uses **only `.gitea/workflows/`** and ignores `.github/`. Pure-GitHub repos
  (only `.github/workflows/`) run unmodified.
- **PROVEN (PR `hanzoai/universe#412`):** `z/gh-onramp` — a pure
  `.github/workflows/ci.yml` with `actions/checkout@v4` fetched from github.com —
  ran to `status=success` on `gitea-act-runner-1`; `z/actions-smoke`
  (`.gitea/workflows`) also `success`. GH-Actions-compatible CI is live natively
  on git.hanzo.ai.

## Apps inventory — the "observe" half of the control plane

**THE FLEET BOARD (current).** `platform.hanzo.ai/apps` shows **every org on
every cluster in ONE view** — hanzo, lux AND zoo — with declared / running /
latest tag, the deployer's sync verdict, and drift. Measured live 2026-07-29:
**286 rows — hanzo 78, lux 157, zoo 49, maxpower 1 — across 3 clusters**
(hanzo-k8s 81, lux 156, zoo 49), sync `263 drifted / 10 synced / 3 unknown /
10 unmanaged`. Those sync counts match `kubectl get applications -n hanzo-cd`
exactly; health 274 green / 2 red matches CD's 274 Healthy / 2 Degraded.

TWO readers, ONE writer, no third mechanism:

- **cluster reader** — `services/apps/inventory.ts`. Operator workload CRs
  (`hanzo.ai/v1 apps`) + their live Deployments/StatefulSets, on every cluster
  platform can reach directly (today: the one it runs in). Owns `declaredTag`
  (`spec.image.tag`), `runningTag` (the container whose image repo matches the
  CR's, so sidecars are ignored), `health`, `hosts`, `org`.
- **delivery reader** — `services/apps/delivery.ts`. Lists CD `Application`
  objects in `hanzo-cd`. THIS is how lux and zoo are visible at all: CD
  reconciles those clusters and records what it found — `status.summary.images`
  (verified against the live lux/zoo Deployments), `status.sync.status`,
  `status.sync.revision`, `status.health.status` — on objects that live in OUR
  cluster. So the whole fleet is readable from one namespace **with no new
  credential**: the `platform-app` ClusterRole already covers `apps.hanzo.ai`,
  and it is deliberately NOT granted `secrets`, where CD keeps the lux/zoo
  cluster tokens. Verified: `auth can-i list applications.apps.hanzo.ai -n
  hanzo-cd` → yes; `get secrets -n hanzo-cd` → no.
- **release reader** — `services/apps/release-reader.ts`. Latest GH Release per
  repo; owns `latestTag`/`releaseUrl`/`releaseAssets` and nothing else.

`syncInventory` is the ONE writer: it folds the two fleet readers with
`mergeObserved` (`services/apps/observed.ts`) field by field — the direct reader
wins on what it read itself, the delivery reader alone supplies sync — then
upserts once and prunes per observed cluster. 60 rows carry BOTH a declared tag
and a deployer verdict, which is the composition working.

**Identity is WHERE IT RUNS: `<cluster>/<namespace>/<app>`** (migration
`0008_apps_fleet.sql`). `<org>/<app>/<env>` was unique only while the estate was
one cluster; across the fleet the release `cloud` runs in `hanzo`, `lux-cloud`
AND `zoo-cloud` at once (10 such collisions measured). The primary key now
carries the whole identity and the redundant `apps_unique` index is gone.

**Unobservable is NULL, and the board writes "unknown".** `repo`/`registry`
became nullable for the same reason. The declared tag of a remotely-delivered
app IS unknown — CD reports what is RUNNING and whether it matches git, never
what git declares now; filling it from the running tag would make every remote
app read "no drift" by construction.

**RETIRED with this change:** `apply-declared.ts` + `/v1/apps/apply` + the
`PLATFORM_CRS_APPLY` env flag + the now-orphaned `applyServiceCR` wrapper. It
was a second git→CR deployer racing hanzo-cd's `universe-crs` Application (which
is Synced and doing that job), and it had been dead for some time: the live pod
logged `[apps-apply] apply pass failed Error: apply exceeded 45000ms —
abandoned` on EVERY tick. Two mechanisms naming one thing, one of them broken.

**BRAND:** the board carries no org mark, logo or colour — a Lux row must never
carry a Hanzo mark, and in a shared table the only guarantee is to carry none.

---

### History (superseded by the fleet board above)


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

**Release-meta reader — the third tag, now built (v4.2.8).** The drift column
was all-`red`/`no-release` because `latestTag`/`releaseUrl`/`releaseAssets` were
never populated (the `read_latest_tag`/`read_release_meta` follow-up). That
reader now exists: `pkg/platform/src/services/apps/release-reader.ts` reads each
discovered repo's latest GitHub Release (Octokit, `GH_TOKEN` already in the pod)
and bulk-writes ONLY those three columns per repo — orthogonal to `inventory.ts`
(which owns declared/running/health and deliberately omits them on upsert; the
two readers compose, neither clobbers the other). 404→`NO_RELEASE` (honest
`no-release`), non-404 re-thrown + per-repo skip so one bad repo can't stall the
pass; one GitHub call per DISTINCT repo (envs share a repo).
`inventory-scheduler.ts` now drives BOTH readers (inventory 60s; releases 10m,
`APPS_RELEASE_INTERVAL_MS`, after the first inventory pass). `/v1/apps/sync`
runs both passes (skip releases with `?releases=0`). 9 new unit tests; all 38
apps tests green; pkg typecheck clean.

This turns the board from 55 uniform `no-release` into the REAL mix the cluster
already shows: `floating-declared` (commerce `1.42.33-billing`, cloud-api
`sha-*`, chat `sha-dbed3bf`), `stale` (declared behind the latest GH release),
`zero-assets` (iam `v1.25.2` ships 0 binaries), genuine `no-release`
(console/chat/billing have NO GH release). Only 36/55 CR tags are even semver —
the rest were silently red before. Do NOT weaken `computeDrift`; it now has real
inputs to work with.

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
- The build MUST run on Node 24 (`engines` says so): node_modules' better-sqlite3
  is NODE_MODULE_VERSION 137, and page-data collection loads it — under the
  system Node 20 it dies with ERR_DLOPEN_FAILED. `pnpm env use --global 24`.

## UI — 8.x convergence state (@hanzo/ui on @hanzo/gui)
`components/ui/*` is the ONE compat seam between this Dokploy-derived app and
@hanzo/ui 8.x; call sites never import @hanzo/ui or radix directly.
- ON @hanzo/ui (radix + cmdk deps deleted): avatar, button, card, checkbox,
  collapsible, command, dropdown-menu, label, popover, progress, scroll-area,
  select, separator, switch, tabs, tooltip. Radix-era props that gui doesn't
  take (`side/align/sideOffset` on floats, `modal`, `delayDuration`,
  `TooltipPortal`, trigger `type`) are bridged/dropped INSIDE those wrappers —
  never at call sites. `lib/slot.tsx` is the local `asChild` slot
  (breadcrumb/sidebar); toggle is a local plain <button>.
- STILL radix (5 pkgs, deliberate): dialog (app-owned behavior: modal=false +
  cmdk-aware outside-click + footer-pinned scroll layout — port it with e2e
  eyes, not blind), sheet (rides radix dialog), accordion + file-tree,
  alert-dialog, context-menu, radio-group. @hanzo/ui 8.0.44 has no equivalents
  for accordion/alert-dialog/context-menu/radio-group/sheet yet.
- STAY local by design (no radix): input (password generator), textarea
  (react-hook-form takes DOM onChange; gui's field is onChangeText), badge
  (status variants red/yellow/green/blue/blank), table, skeleton, calendar,
  chart, sonner/use-toast.
- `buttonVariants()` in 8.x returns bare class handles (`btn btn-ghost`) with
  NO shipped CSS — never use it as a className; use `<Button asChild>` (the
  remaining internal consumers alert-dialog/calendar carry plain utilities).
- Pages-router SERVER builds externalize CJS deps: react-native-svg +
  @hanzogui/lucide-icons-2 must stay in `transpilePackages` or page-data
  collection parses Flow-typed react-native and dies (`Unexpected token
  'typeof'`).
- Tailwind is still the styling substrate of ~430 component files; the 8.x
  strip so far removed it from the tailwind config scan + gui.css is
  pre-generated (`scripts/gen-gui-css.mjs`). Full utility-class removal is the
  remaining convergence work, alongside the 5 radix holdouts above.

## Versioning — ONE line, `v4.x` (HIP-0111)
There is exactly one version line: **`v4.x`**. `app/platform/package.json`,
git tags, and the published `ghcr.io/hanzoai/platform` image tag are the SAME
string. Current: `v4.4.4`.

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

## Control plane = platform.hanzo.ai (estate registration + PaaS-driven deploy)
Headless via two service-token REST surfaces (Bearer = `PAAS_SERVICE_TOKEN` /
`PLATFORM_SERVICE_TOKEN`, constant-time check in `server/v1/http.ts`). No OIDC.
Live DB = SQLite `/app/data/platform.db` (PVC `paas-app-db`, ns hanzo pod `paas-*`
container `-c paas`; only `node`+better-sqlite3, no `sqlite3` bin). Seeds persist
via the `replicate`→S3 sidecar. Org = `ah7E1dvZROQai5LTnAGsr` (admin, single-tenant,
== `DEFAULT_BUILD_ORG_ID`).
- OBSERVE — `GET /v1/apps` (apps table: declared/running/latest/drift). Reconciler
  `services/apps/inventory.ts#syncInventory` scans ONLY `DEFAULT_TARGETS=hanzo-k8s`
  operator `hanzo.ai/v1 services` CRs → 62 rows. Cross-cluster estate is registered
  by seeding `apps` rows directly (identical shape to `syncTarget`); the reconciler
  never touches non-hanzo clusters, so they persist. Registered the live web/app
  tier: +12 lux-k8s (`luxfi/lux-*` v2.0.0 + `app-lux-finance/market`), +4 zoo-k8s
  (`zoo-industries`,`zoo-bot` green; `zoo-ngo`,`zoo-zips` red/down) = 78 total.
  Greens are declaredTag==runningTag (zero version drift); ALL 78 still `drift=red`
  via the `no-release` flag — repos ship images but no semver GH Releases ("all-red
  rationale"); only per-repo CI release publishing clears it, never the control plane.
- DRIVE — `POST /v1/org/{org}/project/{proj}/env/{env}/container/{id}/redeploy`
  → `findApplicationById` → `resolveDeploymentName`(ns hanzo) → `restartWorkload`
  (rolling restart, `hanzo-paas-sa` RBAC `apps/deployments:patch` via
  `hanzo-paas-workload-manager`). Drive surface is EMPTY by default
  (application/project/environment = 0 rows) — seed the chain to register a
  container. Proof (low-risk `pricing`/`pricing.hanzo.ai`): seeded `app-pricing-001`,
  POST redeploy → `{ok:true}`, deploy gen 3→4, new RS rev4 + new pods, 45/45 health
  checks 200 (zero downtime), zero manual kubectl. This is the canonical
  PaaS-driven deploy — never `kubectl rollout restart` by hand again.

## Dedicated customer clusters — launch a customer's own "Hanzo K8S"
Platform can provision an org its OWN DOKS cluster, install the hanzo-operator +
per-tenant baseline, and make it the org's deploy target. Built on the existing
DOKS/operator primitives — NOT a parallel stack.

- SECRETS — DO token + PaaS-ticket secret come from KMS ONLY, via the one funnel
  `pkg/platform/src/services/kms.ts` (`requireKmsSecret`). Mechanism is the
  canonical KMSSecret→pod-env: both keys (`PAAS_DO_API_TOKEN`,
  `OPERATOR_PAAS_SHARED_SECRET`) are in `k8s/platform-kmssecret.yaml`.
  `doks-provisioner.ts#doHeaders` now reads the DO token through this funnel
  (was a bare `process.env`). The per-cluster KUBECONFIG is NEVER stored — it is
  derived on demand from DO (`getDoksKubeconfig`) using the KMS DO token, so the
  feature adds zero secrets to keep.
- SERVICE — `pkg/platform/src/services/dedicated-cluster.ts`. Pure (unit-tested):
  `buildClusterBaseline` (hanzo-system + tenant ns → operator bundle →
  `operator-paas-shared-secret` → ingress/gateway Service CRs, in dependency
  order), `nextPhase` (total lifecycle reducer requested→provisioning→installing
  →ready/error), `clusterTargetFromRecord` + `redactTarget`. Thin IO:
  `provisionDedicatedCluster` (KMS-gates the DO token BEFORE any paid call, then
  reuses `provisionDoksCluster`), `installClusterBaseline` (on-demand kubeconfig →
  `createK8sClients` → idempotent create-or-replace apply; marks
  operatorInstalled/baselineInstalled/phase), `selectDeployTarget` (≤1 active/org),
  `resolveOrgClusterTarget` (THE bridge → existing `ClusterTarget`; dedicated when
  active+ready+running else shared `DEFAULT_TARGETS[0]`), `migrateOrgToDedicated`.
- DB — `doks_cluster` gained `phase`/`operatorInstalled`/`baselineInstalled`/
  `active`/`baselineError` (migration `drizzle/0004_curly_human_fly.sql`, applies
  clean over 0000-0003). `phase` (platform lifecycle) is orthogonal to `status`
  (DO state): a DO-`running` cluster is not a usable target until `phase=ready`.
- SURFACE — tRPC `dedicatedCluster` router (`server/api/routers/dedicated-cluster.ts`,
  mounted in root.ts; `adminProcedure` + active-org scoped + per-cluster ownership):
  provision/installBaseline/list/get/select/migrate/target. REST mirror
  (service-token, headless): `GET|POST /v1/org/{orgId}/cluster`,
  `GET|POST /v1/org/{orgId}/cluster/select`,
  `POST /v1/org/{orgId}/cluster/{clusterId}/install-baseline`. `target`/`select`/
  `migrate` return `redactTarget` — the kubeconfig is NEVER returned.
- END-TO-END — provision (KMS DO token) → poll DO status → installBaseline (fetch
  kubeconfig on demand → apply operator+baseline) → select/migrate flips `active`
  → `resolveOrgClusterTarget(org)` now returns the dedicated `ClusterTarget`.
- TESTS — `__test__/operator/dedicated-cluster.test.ts` (20, green): baseline wire
  shape, phase reducer totality, target mapping, kubeconfig redaction, and the KMS
  gate (provision REFUSES without the KMS DO token, proven before any DO call).
- DEFERRED (cloud-embedding/CLI wave, by design): wiring `inventory.syncInventory`
  + the CI `deploy-executor` to CALL `resolveOrgClusterTarget` per-org (the single
  integration point exists; consumers still default to shared hanzo-k8s); bulk
  re-apply of an org's EXISTING CRs onto the new cluster on migrate (new deploys
  already retarget); the full operator controller bundle apply is wired
  (`applyManifestBundle` fetch+loadAllYaml+create/replace) but not exercised against
  a live cluster in CI (the pure baseline CONTRACT is what's unit-tested).

## Build → Test → Deploy → Publish lifecycle — the real map, the complecting, the one native way

Canonical lifecycle doc (was fragmented across ~6 systems). Verified against live
`do-sfo3-hanzo-k8s` 2026-07. This section is the source of truth for HOW a commit
becomes a running pod, WHERE that path forks, and the ONE native path we collapse to.

> **⚠️ CURRENT STATE + DECISION (re-verified live `do-sfo3-hanzo-k8s`, 2026-07-16) — supersedes §1–5 below where they conflict.** The §1–5 trace is accurate HISTORY of the complecting + the 07-05 breaks, but predates the operator 0.7.x cutover:
> - **CD is now operator-native, NOT ArgoCD.** ArgoCD was torn out (no `argocd` ns, no `applications.argoproj.io` CRDs); the live deployer is the Rust operator **0.7.6** running a `GitSource` CR (`gitsource/universe` → `github.com/hanzoai/universe` path `infra/k8s/operator/crs`, 45s, `prune:false`, 21 objects, Running; `imageupdates.hanzo.ai` CRD live/0 instances). `src/controllers/gitsource.rs` states ArgoCD was removed on purpose. All "ArgoCD ApplicationSet auto-sync" + "operator v0.6.17" references below are historical.
> - **`hanzoai/deploy` (the "ArgoCD fork") is a pristine unmodified upstream clone — 0 hanzo commits, deployed nowhere.** CTO decision (2026-07-16): make it real by embedding its **gitops-engine** as the CD library inside the cloud binary's `/v1/deploy` (`cloud/clients/deploy`, already mounted at `apps/apps.go:247`), NOT as a standalone `argocd` namespace (that re-adds the second control plane the operator deleted). Operator `GitSource` stays the interim engine until `/v1/deploy` is proven, then retires. The `applyDeclaredCRs` TS path duplicated that same universe crs apply → **RETIRED 2026-07-29** (deleted; platform is observe + thin drive, and the observe half now reads hanzo-cd for the whole fleet — see "Apps inventory" above).
> - **CI target = the cloud binary's `/v1/git` forge** (`cloud/clients/git`, Gitea-ported, mounted `apps/apps.go:281`) with push→build via `build.go:334 RegisterPushBuilder`. **ARC self-hosted GitHub Actions (`arc-system`) remains LOAD-BEARING — builds every image today; do NOT retire it until `/v1/git` builds prod.** The "Gitea Actions on git.hanzo.ai" lane above is superseded as the target by the one-binary forge (and Gitea is not currently hosted in this cluster).
> - **End-state = ONE Go binary (`hanzoai/cloud`) embedding forge + CD + platform** (HIP-0106). Convergence is by native Go reimplementation; `cloud/go.mod` imports none of operator/deploy/platform/git.
>
> **UPDATE (verified 2026-07-26, supersedes the CI bullet above).** The cutover happened: `git.hanzo.ai` is canonical and **does** build prod — it cut `v1.801.219`…`v1.801.225`. Repos moved their pipeline to **`.hanzo/workflows/`** (`cicd.yml`, which builds only `on: push: branches: [main]`); the single remaining GitHub-side job is `.github/workflows/sync.yml`, which pushes `main` to the forge and does nothing else. So ARC is still load-bearing, but only for that hand-off, not for builds.
> Two failure modes this exposed, both real today:
> - `sync.yml` needs **`HANZO_GIT_TOKEN` as an org secret** (value: KMS `hanzo/prod:/git/admin-token`). It was never provisioned, so every hand-off failed and no GitHub merge reached the forge. Provisioned 2026-07-26.
> - The two `main`s have **diverged** (forge ahead by ~1537, GitHub ahead by ~13), so `sync.yml`'s non-force push is rejected regardless of the token. Reconciliation is a **merge on the forge** ("Merge github/main into canonical"), which is what the forge history has always done. Until that lands, a merged GitHub PR is not a shipped commit.

### 1. Today's lifecycle, traced end to end (verified)

1. **Source — canonical TODAY = GitHub (`github.com/hanzoai/*`).** `git.hanzo.ai`
   (the `hanzoai/git` Gitea fork, rebranded "Hanzo", **1.24.7**) is a **read-only
   pull-mirror**: 29/30 repos report `mirror=true`, pulled FROM GitHub; nothing
   writes to it. Both deploy inputs point at GitHub, not Gitea — ArgoCD
   `spec.source.repoURL = github.com/hanzoai/universe`, ARC `githubConfigUrl =
   github.com/hanzoai`. So GitHub is source-of-truth today; git.hanzo.ai is
   downstream. (Target flips this — see §4.)

2. **CI / build — THREE overlapping systems (the complecting):**
   - **GitHub Actions on ARC self-hosted runners** — `arc-system` ns:
     `hanzo-build-linux-amd64` + `hanzo-deploy-linux-amd64` scale sets,
     `arc-gha-rs-controller`. LOAD-BEARING: every image this session was built
     here → `ghcr.io/hanzoai/*` (4 runners were mid-build during diagnosis).
   - **Platform-native BuildKit (`arcd`)** — the `paas` pod conducts an in-cluster
     BuildKit Job (see "Platform-native CI/CD (GHA escape)" above); the real build
     fleet is `arcbuild*` on spark/evo/dbc (healthy). This is the intended
     GHA-escape and matches the "NO GITHUB BUILDERS" directive.
     *(A stray `arcd-control` Deployment was crash-looping `TypeError: Cannot
     redefine property: query` — it ran a stale image `platform:0c009a0-arcd`
     built from a commit not in the repo, was NOT in git, had no CR owner, and
     served the RETIRED long-poll arcd-runner surface. **Retired 2026-07-05**:
     deleted the Deployment + Service; the conductor is the `paas` pod, the
     workers are `arcbuild*` — one build path, no dead component.)*
     BuildKit Job (see "Platform-native CI/CD (GHA escape)" above); worker pods
     `arcbuild*` + `arcd-control` in `hanzo` (build fleet on spark/evo/dbc). This
     is the intended GHA-escape and matches the "NO GITHUB BUILDERS" directive.
     `arcd-control` is currently **crash-looping** (`TypeError: Cannot redefine
     property: query`) — the native path is deployed but degraded.
   - **Gitea Actions** — the TARGET native CI (GitHub-workflow-compatible, runs
     `.github/workflows`). **NOT enabled**: no `act_runner` pods anywhere, no
     `[actions]` block in Gitea `app.ini`. This is the keystone gap.

3. **Registry — `ghcr.io/hanzoai/*` (single, canonical).** No fork here.

4. **Deploy — THREE mechanisms over the same estate (the complecting):**
   - **ArgoCD** (`argocd` ns) — GitOps sync of `universe` → applies CRDs +
     `*.hanzo.ai` CRs + the operator. Two apps (`hanzo-k8s-operator`,
     `hanzo-paas`) generated by ApplicationSet `hanzo-operator`. **Auto-sync is
     OFF** (no `syncPolicy.automated` in the ApplicationSet template) — see
     Break 1.
   - **hanzo-operator** (`operator-system`, Rust **v0.6.17**) — reconciles
     `*.hanzo.ai` CRs → Deployments/Services/Ingress/etc. THE workload deployer
     for the 82 apps in `hanzo`.
   - **PaaS / dokploy** (`platform`, `hanzo` ns) — OBSERVE plane (apps-inventory:
     reads 82 CRs+Deployments) + DRIVE plane (`deploy-executor` patches the
     operator `Service` CR `.spec.image`). Its dokploy `docker.sock` path is
     disconnected in-cluster (`ENOENT /var/run/docker.sock`), so PaaS does NOT run
     a parallel runtime — it deploys BY patching operator CRs, i.e. it rides the
     operator. It is the human/REST surface, not a 3rd engine.
   - (+ **direct `kubectl apply`** of kustomize: `mgr=kustomize` → kms/platform;
     `mgr=universe` → code-exec/grafana/livekit/metrics — a 4th provenance that
     bypasses the operator entirely.)

5. **Cluster** — DOKS `do-sfo3-hanzo-k8s`, ns `hanzo`.

**Worked example (`pricing`, today):** commit → GHA/ARC runner builds →
`ghcr.io/hanzoai/pricing:vX` → EITHER a universe PR bumps
`services.hanzo.ai/pricing.spec.image.tag` (and ArgoCD must be **manually** synced)
OR `POST /v1/runner` drives platform BuildKit and `deploy-executor` patches
the CR → operator rolls the Deployment. Two independent ways to ship one change.

### 2. The two GitOps breaks behind "CR changes don't reach the cluster"

These are the real cause of the "we keep having to `kubectl patch services.hanzo.ai`"
symptom — NOT the orphan warning.

**Break 1 — ArgoCD auto-sync is disabled.** ApplicationSet `hanzo-operator`
template carries `syncPolicy` = `retry` + `syncOptions` (`ServerSideApply`,
`ApplyOutOfSyncOnly`, `PruneLast`, `RespectIgnoreDifferences`) but **no
`automated` block** — and the template comment explicitly gates it: "NO automated
sync until the live diff is verified to be a no-op (git==live)." Both generated
apps are manual-sync. A merged universe PR editing `infra/k8s/operator/crs/*.yaml`
(e.g. #410 retire-temporal, #409 social-repin) goes OutOfSync and WAITS until a
human runs `argocd app sync`. That is exactly why the workaround has been
hand-patching CRs.
*Intended fix (one edit to the ApplicationSet template in `universe`):*
```yaml
syncPolicy:
  automated: { selfHeal: true, prune: false }   # prune:false: never auto-delete the load-bearing secrets
```
**HELD — do NOT flip yet (verified outage risk).** The gate is currently
violated: `hanzo-k8s-operator` has **107 OutOfSync resources**, and a git(main)
vs live image audit found **git BEHIND live for 5 production services** — enabling
selfHeal would ROLL THEM BACK:
`commerce` v1.46.37→v1.46.35, `studio` 0.14.4→0.14.3, `cloud` v1.786.110→v1.786.106
(critical API, carries an explicit "never regress" floor comment), `console`
v8.4.111→v8.4.109, `visor` v1.108.11→sha-6085b5d. (The remaining diffs are
crane-promoted `0.1.0` semver aliases of the live digest — verify per-digest.)
*Safe sequence (author's documented intent):* (1) reconcile git main to live —
bump those CR tags in `universe` so `git==live`; (2) verify the app diff is a
no-op; (3) THEN add `automated:{selfHeal,prune:false}` and re-apply the
ApplicationSet. Flipping before step 2 regresses prod.
`automated` block**. Both generated apps are manual-sync. A merged universe PR
editing `infra/k8s/operator/crs/*.yaml` (e.g. #410 retire-temporal, #409
social-repin) goes OutOfSync and WAITS until a human runs `argocd app sync`. That
is exactly why the workaround has been hand-patching CRs.
*Fix (one edit to the ApplicationSet template in `universe`):*
```yaml
syncPolicy:
  automated: { selfHeal: true, prune: false }   # prune:false first; enable after an orphan audit
```
Re-apply the ApplicationSet → both apps auto-converge on every git change.

**Break 2 — operator immutable-selector wedge.** operator v0.6.17
`src/manifests.rs:69 selector_labels()` emits selector
`{app.kubernetes.io/name, app.kubernetes.io/instance}`. Legacy Deployments were
created by an older operator with `{app:<name>}`. `spec.selector` is **immutable**
→ every operator apply 422s → the reconcile aborts for that app, freezing it at
its last generation (e.g. `analytics` is stuck at gen 93 — healthy on the OLD
selector, but no new CR change can land). Verified affected (operator logs):
`analytics, bot-gateway, bot-hub, dns, hanzo-bot-site, o11y, paas, stream`
(+ Service reconcile failures on `insights-kafka/kv/sql`). The pod template
already carries the full `app.kubernetes.io/*` set, so the ONLY resolution for an
immutable selector is delete+recreate — the operator OWNS these Deployments and
recreates them fresh with the correct selector.
*Fix runbook (per stuck app; brief single-pod restart; least-critical first;
verify each; do `paas` LAST):*
```
kubectl delete deploy <app> -n hanzo --cascade=orphan   # old pods keep serving
kubectl annotate services.hanzo.ai <app> -n hanzo hanzo.ai/reconcile=$(date +%s) --overwrite
# operator's next reconcile takes the CREATE path → new Deployment, new selector
kubectl rollout status deploy/<app> -n hanzo
```
**EXECUTED (2026-07-05, CTO go-ahead).** All 8 wedged Deployments recreated
one-at-a-time with `--cascade=orphan` (zero-downtime — the k8s Service selects on
labels both old orphaned pods and new pods carry): `hanzo-bot-site, stream,
bot-hub, bot-gateway, o11y, analytics` (off its frozen gen 93), `dns` (2/2),
`paas` (rolling, control plane stayed up). Each verified Ready on the new selector
with the operator's per-app 422 cleared. The operator error set collapsed from 11
apps to **3 residual: `insights-kafka, insights-kv, insights-sql`** — same class,
same fix, held for a separate go-ahead (they back the analytics pipeline; a
recreate is a brief single-pod blip).
# operator's next reconcile takes the CREATE path → new Deployment, new selector
kubectl rollout status deploy/<app> -n hanzo
```
NOT executed here — a production restart of 8 Deployments needs an explicit
go-ahead; the runbook is ready and safe with `--cascade=orphan`.

**The "5 orphaned resources" warning is neither of these and must NOT be
"pruned".** The orphans are the hand-created secrets in `operator-system`
(`hanzo`, `registry-hanzo` = GHCR pull creds; `operator-apps-token`,
`operator-cloud-token`, `operator-visor-cred` = operator auth tokens). The app's
AppProject sets `orphanedResources.warn=true` → **informational only**; it does
NOT drive OutOfSync/Degraded and ArgoCD never auto-prunes it. Deleting them would
break image pull + operator auth. Correct resolution: bring them under
`KMSSecret` (kms-operator) so they are declaratively KMS-sourced and no longer
"untracked" — that clears the warning the right way. Left in place intentionally.
(App health `Degraded` is drift/CR-health noise from the manual-sync + wedge
above, surfaced through the operator-managed CR tree — not the orphan warning.)

### 3. The complecting, named (one way to do a thing)

- **Source hosting ×2:** GitHub (canonical) + git.hanzo.ai (mirror) — two homes.
- **CI ×3:** GHA/ARC (real) + platform BuildKit/`arcd` (real, control crash-looping)
  + Gitea Actions (target, off).
- **Deploy ×3–4:** ArgoCD (CR GitOps) + operator (CR→workload) + PaaS (CR patch)
  + direct kustomize/universe `kubectl apply`.

Three "how do I ship" answers and two "where's the code" answers. Each is a place
a deploy silently stalls: auto-sync off, `arcd-control` crashing, operator wedged.

### 4. The decomplected ONE native way (target)

One line, source→run, no forks:

> **git.hanzo.ai (Hanzo Git, canonical) → Gitea Actions native CI (runs the SAME
> `.github/workflows`) → ghcr.io/hanzoai → hanzo-operator reconcile (the ONE k8s
> deployer) → console.hanzo.ai (unified management: repos · PRs · Actions runs ·
> apps/drift).**

- **GitHub → OSS mirror only.** Flip the mirror: push OUT to GitHub for public
  repos; GitHub stops being an input to CI/CD.
- **ArgoCD keeps its ONE job** (Hanzo-Git commit on `infra/k8s/**` → applied CRs)
  **with auto-sync ON** — OR fold that job into the operator watching Hanzo Git
  directly. Pick one; delete the other. Never both, never manual.
- **operator = the ONLY workload deployer.** PaaS "drive" stays a thin UI/REST
  over the operator CR patch (already true). Retire direct kustomize/universe
  `kubectl apply` (fold code-exec/grafana/livekit/metrics into operator CRs).
- **CI = Gitea Actions**, with the platform BuildKit/`arcd` path as the runner
  backend (same BuildKit muscle) — one build path, GH-workflow-compatible so
  GitHub users on-ramp to our PaaS for free.

### 5. Migration (keystone first)

1. **Enable Gitea Actions** — nothing native ships until this exists.
   - Gitea `app.ini`: add `[actions]` `ENABLED = true` (+ `DEFAULT_ACTIONS_URL =
     github` so upstream `uses:` still resolves). On the deployed pod this is the
     `gitea` ConfigMap/CR in `hanzo`; roll the pod.
   - Deploy a `gitea/act_runner` Deployment (labels `linux/amd64`; use the
     platform BuildKit backend for image builds, not DinD-in-prod).
   - Register: get a token at `git.hanzo.ai/-/admin/actions/runners` →
     `act_runner register --instance https://git.hanzo.ai --token <TOKEN>`. Store
     the token via **KMSSecret**, never plaintext.
   - Verify: push a repo with `.github/workflows/ci.yml` → run shows in the repo
     Actions tab → image pushed to ghcr.
2. **Flip source-of-truth to git.hanzo.ai** — make Gitea hold canonical `universe`
   (GitHub becomes a push-mirror target). In the same change, point ArgoCD (or the
   operator) at `git.hanzo.ai/hanzoai/universe` and turn **auto-sync ON**
   (fixes Break 1).
3. **Wire console.hanzo.ai to Hanzo Git** — surface repos/PRs/Actions-runs.
   Leverage the existing PaaS Gitea provider
   `packages/server/src/utils/providers/gitea.ts`
   (`getGiteaRepositories`/`getGiteaBranches`/`testGiteaConnection`/
   `refreshGiteaToken`) so console is the one management pane.
4. **PaaS build-from-Hanzo-Git = default** — the dokploy Gitea provider is the
   bridge; default new apps' git source to git.hanzo.ai.
5. **Retire GHA/ARC** (`arc-system` scale sets) once Gitea Actions carries load;
   fix or fold `arcd-control` into the act_runner backend.
6. **One-time: clear the operator selector wedge** (Break 2 runbook) so every app
   reconciles cleanly on the new one-way path.

## Execution model — Goja vs Node vs Go-native (VERIFIED, evidence-based)

Settles the claim *"the PaaS TypeScript runs as goroutines loaded by Goa in Goja,
with Base features."* Verdict: **the PaaS TS is valid (typecheck green) but it does
NOT run in Goja — it runs as a Node.js process.** The Docker/k8s/fs/exec
orchestration is Go-native. "Goa" and "Goja" are unrelated pieces that both exist
in the stack but neither runs the PaaS TS. Full trace below.

### Three deployments, three runtimes (live, ns `hanzo`, `do-sfo3-hanzo-k8s`)

| Deploy | Image | PID 1 | Runtime | Role |
|---|---|---|---|---|
| `platform` | `ghcr.io/hanzoai/base:0.39.11` | `/app/base serve --http=0.0.0.0:8090 --dir=/data` | **Go** (Base) | platform.hanzo.ai data/auth/org backend + static `/public` admin UI |
| `paas` | `ghcr.io/hanzoai/platform:v4.4.10` | `node /usr/local/bin/pnpm start` (node v24, `.next/` present) | **Node.js** | the dokploy-derived PaaS TS (Next.js + server) |
| `cloud` | `ghcr.io/hanzoai/cloud:v1.786.110` | cloud goa binary | **Go** | goa.design services incl. `clients/platform` k8s orchestration |

The `platform` (Base) pod: `/app` holds only `base` (51 MB Go binary) + `public`.
No Node, no PaaS `dist`. `/data` = SQLite (`data.db`, `auxiliary.db`). **`/hooks`
and `/migrations` are EMPTY** → Base loads **zero JS** in production. It is a pure
Go backend.

### What actually runs in Goja (Base's JS engines) — and it is NOT the PaaS

Base ships two goja engines; neither runs the PaaS orchestration:

- **`plugins/jsvm`** — PocketBase-style hooks. Loads `*.base.js` / `*.base.ts`
  from `HooksDir = <DataDir>/../hooks` (`jsvm.go:129`) into a **pool of per-execution
  `goja.Runtime` instances** (`jsvm.go:312` `newPool(...)`, each `goja.New()`).
  Per-goroutine VM isolation is correct — `goja.Runtime` is not concurrency-safe.
  Host binds (`plugins/jsvm/binds.go`): `$app`, `routerAdd`, `cronAdd/cronRemove`,
  `Record`, `Collection`, `DynamicModel`, field constructors, `sleep` (a *blocking*
  Go sleep, not async). **No fs / exec / docker binds exist.** In the live pod the
  hooks dir is empty → this engine loads nothing.
- **`plugins/gojavm`** — manifest extensions (`extension.json`, `"runtime":"goja"`).
  Wraps zip's shared `*runtime.JSRuntime` VM pool; esbuild bundles TS/JSX/ESM →
  **CommonJS** (`module.go:47-59`). Every `Invoke` borrows a pooled VM and calls the
  export **synchronously**. It **hard-rejects any handler returning a pending
  promise** — `module.go:125-127`: *"gojavm: async handler returned a pending
  promise; handler must resolve synchronously"*. goja has no event loop / microtask
  queue.

"Goa" (goa.design) is a **Go** service framework used in the separate `cloud`
service (`~/work/hanzo/cloud/clients/platform/design/design/design.go`). It has
nothing to do with loading TS and is not in the JS path. The claim conflates goa
(Go framework) with goja (JS VM).

### The PaaS TS is a Node app, by construction

`~/work/hanzo/platform` workspace (`pnpm-workspace.yaml`) = `app/{api,platform,
monitoring,schedules}` + `pkg/{platform,mcp,zap}`. The legacy dokploy
`packages/server` is **not in the workspace** (orphaned). The active server is
`pkg/platform` (`@hanzo/platform`). Its `esbuild.config.ts`:

```
platform: "node",        // built for Node, not neutral/browser/goja
packages: "external",    // dockerode/ssh2/better-auth/drizzle NOT bundled — required from node_modules at runtime
format: "esm",
```

`pkg/platform/src`: **280 `.ts` files, of which 168 (60%) use `async`/`await`/
`Promise`** (the async event-loop model goja lacks), and **22 files hit external
I/O goja cannot do**: `dockerode` (Docker daemon, 15), `ssh2`/`net` (6),
`child_process` (2). A further 42 use `fs`/`path`. The `paas` pod runs this under
real Node v24 — which is exactly why it works.

### Base features the PaaS uses — consumed as a service, not built ON

The PaaS TS uses Base as a **backend it talks to over HTTP**, not as its host
runtime. The `base:0.39.11` pod's `plugins/platform` (Go-native) provides the
multi-tenant layer: org isolation, IAM/KMS proxies, org collections/db, and
`/v1/platform/*` auth routes (`plugins/platform/{org,org_isolation,auth_proxy,
iam_proxy,kms}.go`). Base does **not** import `cloud/clients/platform` (`base/go.mod`
has no `hanzoai/cloud`). So: PaaS-TS (Node) → Base (Go) over HTTP; k8s deploy
orchestration → cloud goa/client-go (Go). Three processes, clean seams.

### Verdict: "all PaaS as goroutines in Goja" — NOT achievable for the orchestration

Achievable only for pure-synchronous slices (constants, schema, pure transforms).
The orchestration cannot move into goja:

1. **60% of files are async.** goja has no event loop; gojavm rejects pending
   promises outright. Every `await` in a deploy path would need a synchronous
   rewrite.
2. **22 files need Docker daemon / SSH / child_process.** goja has no OS-process,
   raw-socket, or Docker-client capability. Each would need a Go host-function
   bridge — and even bridged, the async call-sites still violate the sync-only
   contract, forcing a rewrite anyway.
3. **esbuild target is `platform:"node"` + `packages:"external"`** — the code and
   its deps assume Node builtins + node_modules, absent in goja.

At which point you have reimplemented the orchestration in Go — which is **already
done**: `cloud/clients/platform` (goa design + `k8s.io/client-go`, ~4.6k LOC:
`deploy.go`, `k8s.go`, `reconcile.go`, `domains.go`, `secrets.go`, `store.go`)
drives operator Service CRs natively. That is the correct home for the
Docker/k8s/fs/exec work. The production split is already the right one: **Base (Go)
for data/auth/org, cloud (Go/goa/client-go) for k8s orchestration, Node for the
dokploy PaaS TS.** Goja is for synchronous PocketBase-style hooks only.

### TS validity (typecheck) — now green

`corepack pnpm@10.22.0 -r --no-bail run typecheck` (node 24) over the 5 TS projects.
Was: 4/5 pass, `app/api` failed `TS2307: Cannot find module '@hanzo/platform'` —
app/api imported the bare `@hanzo/platform` root but its `tsconfig` mapped only the
subpath `@hanzo/platform/*` to pkg source, so tsc fell through to the package
`exports` (`./dist/index.js`, no emitted `.d.ts`; `dist/` does not exist).
Fix (PR #58, branch `fix/platform-typecheck`): add the bare-root path mapping to
`app/api/tsconfig.json`, matching `app/schedules` which already carried both. Now:
**all 5 projects `Done`.** (`pkg/zap` is a Rust crate, no `typecheck` script.)
