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

## Auth (HIP-0111, one way) + Node-24 build
- Platform login = Hanzo IAM PKCE via **`hanzo.id`** (no Better Auth login, no genericOAuth). The settled flow + files live in `IAM_MIGRATION.md` (CANONICAL header). Don't re-add a `signIn.social`/`signIn.oauth2` button.
- Node 24 build: keep the pnpm override `nan: 2.27.0` (native deps `ssh2`/`node-pty` won't compile on Node 24 without it).
