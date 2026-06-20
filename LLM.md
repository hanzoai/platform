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
