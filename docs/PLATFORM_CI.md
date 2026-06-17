# Platform-native CI/CD

How `platform.hanzo.ai` owns the build+deploy lifecycle for Hanzo services,
escaping GitHub Actions as a single point of failure.

This document is the contract for the `.platform.yml` schema and the
webhook → scheduler → arcd → deploy pipeline. It is checked in. Schema
changes here are breaking changes to every repo's `.platform.yml`.

## Why

The GHA billing-freeze incident proved that depending on GitHub Actions is a
single point of failure for the entire Hanzo ecosystem: when GHA stops, every
build and deploy stops. Platform now owns the durable system-of-record (the
`build_job` table), the deploy decision, and the rollout. The build *muscle*
still runs on our own hardware — the self-hosted `arcd` runner pools — so a
GHA outage no longer halts shipping.

## Architecture

```
GitHub push/PR ─webhook─▶ platform /v1/github-webhook
                              │  (HMAC-verified per installation secret)
                              ▼
                        BuildScheduler
                              │  reads .platform.yml @ sha, validates,
                              │  enqueues one build_job per matrix entry
                              │  (idempotent on repo+sha+target)
                              ▼
                        workflow_dispatch ──▶ arcd pool (<org>-<os>-<arch>)
                              │                   builds + pushes ghcr image
                              ▼                          │
                        build_job (DB)  ◀─callback─ /v1/build-callback
                              │                   (outcome: success|failure)
                              ▼
                        DeployExecutor
                              │  on deploy branch → merge-patch the operator
                              ▼  Service CR `.spec.image` → operator rolls out
                        hanzo operator (hanzo.ai/v1 Service)
```

## arcd-protocol decision

`arcd` polls **GitHub's own Actions job queue** (JIT runners) — there is no
standalone arcd job-acceptance API (see `hanzoai/.github/RUNNERS.md`).

Two ways to feed arcd from platform were considered:

- **(a) Platform speaks GitHub's runner/job protocol to its own arcds.**
  Requires reimplementing runner registration, JIT-config minting, the
  long-poll job-acquire endpoint, and log streaming as a server inside
  platform. Multi-week effort. Rejected for the MVP.
- **(b) A native arcd long-poll/websocket protocol.** Requires changing the
  arcd binary. Out of scope for this cut.

**Chosen for the MVP: dispatch builds to the EXISTING arcd pools via
`workflow_dispatch`,** pinning the runner pool per matrix entry. arcd is
unchanged; platform owns orchestration, the system-of-record, and the deploy
decision. The build executor is the per-repo `platform-build.yml` workflow
(template in `hanzoai/.github/workflow-templates/`), which builds, pushes to
GHCR, and calls `/v1/build-callback`. Option (b) is the documented next
iteration — it removes the last GitHub-API dependency from the build path.

## `.platform.yml` schema reference

Committed at each repo's root. Parsed + validated by
`pkg/platform/src/services/ci/platform-config.ts`.

```yaml
build:
  matrix:                       # required, non-empty, no duplicates
    - { os: linux, arch: amd64 }
    - { os: linux, arch: arm64 }
  dockerfile: ./Dockerfile      # optional, default ./Dockerfile
  context: .                    # optional, default .
  image: ghcr.io/hanzoai/<repo> # required, BARE repo (no tag)
  tag-pattern: "{{git.sha}}"    # optional, default {{git.sha}}
  push: true                    # optional, default true
deploy:                         # optional; omit for build-only repos
  on:                           # required, non-empty list of deploy branches
    - main
  target:
    cluster: hanzo-k8s
    namespace: hanzo
    operator: hanzo-operator    # only hanzo-operator | hanzo
    crd: Service                # only Service (legacy HanzoService removed)
    name: <service-name>        # operator Service CR to roll the image onto
```

Field rules (validator returns a path-qualified error on any violation):

| Field | Rule |
|-------|------|
| `build.matrix[].os` | `linux` \| `darwin` \| `windows` |
| `build.matrix[].arch` | `amd64` \| `arm64` |
| `build.matrix` | non-empty, no duplicate `os/arch` |
| `build.image` | non-empty, must NOT contain a tag |
| `build.tag-pattern` | template; supports `{{git.sha}}`, `{{git.branch}}` |
| `deploy.on` | non-empty list of branch names |
| `deploy.target.operator` | `hanzo-operator` \| `hanzo` |
| `deploy.target.crd` | `Service` only |

Runner-pool resolution: `<org>-<os>-<arch>`, where `<org>` is the GitHub org
(first path segment of `owner/repo`) and `darwin` maps to `macos`. E.g.
`hanzoai/base` + `linux/amd64` → `hanzoai-linux-amd64`.

## Endpoints

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/v1/github-webhook` | POST | HMAC (`X-Hub-Signature-256`) vs per-installation `githubWebhookSecret` | Accept push/PR/ping; schedule builds |
| `/v1/build-callback` | POST | `Bearer ${PLATFORM_BUILD_CALLBACK_TOKEN}` | arcd reports build outcome; triggers deploy |

tRPC `buildJob` router (org-scoped): `list`, `one`, `logs`, `trigger`.

## Configuration

| Env / secret | Where | Purpose |
|--------------|-------|---------|
| `githubWebhookSecret` | github provider row (DB) | HMAC validation per installation |
| GitHub App creds | github provider row (DB) | Octokit App auth for `workflow_dispatch` + reading `.platform.yml` |
| `PLATFORM_BUILD_CALLBACK_TOKEN` | platform env + repo secret | Authenticates the build → platform callback |
| Repo secret `PLATFORM_BUILD_CALLBACK_TOKEN` | repo Actions secrets | Used by `platform-build.yml` to call back |

## Migration guide: GHA → platform CI

1. Add `.platform.yml` at the repo root (schema above).
2. Add `.github/workflows/platform-build.yml` from
   `hanzoai/.github/workflow-templates/platform-build.yml`.
3. Add the repo Actions secret `PLATFORM_BUILD_CALLBACK_TOKEN`.
4. Point the repo's GitHub App webhook at
   `https://platform.hanzo.ai/v1/github-webhook` (event types: push,
   pull_request). Set the App's webhook secret to match the provider's
   `githubWebhookSecret`.
5. Push a no-op commit; confirm a `build_job` appears (tRPC `buildJob.list`)
   and the image lands at `ghcr.io/<org>/<repo>:<sha>`.

Repos WITHOUT a `.platform.yml` keep using the GHA reusable
`hanzoai/.github/.github/workflows/docker-build.yml@main` (retained as the
fallback build path). The webhook ACKs them with 202 and does nothing.

## Known limitations (this cut)

- Build dispatch still uses GitHub's `workflow_dispatch` API; the build path is
  not yet 100% GitHub-independent (see arcd-protocol option (b)).
- `DeployExecutor` patches an EXISTING operator `Service` CR's `.spec.image`.
  It does not create the CR — the target service must already be operator-
  managed. A missing CR yields a real rollout error, never a silent success.
- Build logs are stored inline on the `build_job` row (MVP). Large logs move to
  object storage in a follow-up.
