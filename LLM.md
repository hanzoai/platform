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
