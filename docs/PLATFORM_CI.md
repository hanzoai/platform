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
                        dispatch (per pool):
                          native ──enqueue──▶ buildQueue[pool] (in-process)
                              │                   ▲ long-poll
                              │           POST /v1/arcd/poll
                              │                   │ (HMAC X-Arcd-Signature)
                              │              arcd worker ──▶ docker build + push
                              │                   │              ghcr image
                              │           POST /v1/arcd/complete
                              ▼                   │ (status, image_digest)
                        build_job (DB)  ◀─────────┘
                              │
                          fallback: workflow_dispatch ──▶ arcd GHA pool
                              │  (repos not yet migrated to long-poll)
                              ▼
                        DeployExecutor
                              │  on deploy branch → merge-patch the operator
                              ▼  Service CR `.spec.image` → operator rolls out
                        hanzo operator (hanzo.ai/v1 Service)
```

## arcd dispatch: native long-poll (canonical) + workflow_dispatch (fallback)

Platform feeds builds to arcd over a **native long-poll protocol** — the build
path no longer depends on GitHub's `workflow_dispatch` API. The legacy
`workflow_dispatch` hop is retained only as a migration fallback for pools that
have no live native runner yet.

### Native long-poll protocol

The dispatch fabric is `pkg/platform/src/services/ci/build-queue.ts`: a
process-local, per-pool FIFO of `QueuedBuild` wakeups. The DURABLE record stays
the `build_job` table; the queue carries only the "a job for pool P is ready"
signal, so no new queue technology is introduced.

```
runner loop                          platform
───────────                          ────────
POST /v1/arcd/poll  ──long-poll──▶   buildQueue.wait(pool, 30s)
  body { pool, runner_id }              │ parks up to 30s
  HMAC over body                        │
                     ◀─ 200 QueuedBuild ┤ if a job is (or becomes) ready
                     ◀─ 204 No Content ─┘ if the 30s hold elapses
(204 → reconnect immediately)

(arcd: git checkout @ sha → docker build -f dockerfile context
   → docker push image to ghcr.io/<org>/* )

POST /v1/arcd/complete ──────────▶   completeBuild() → DeployExecutor
  body { job_id, status,               │ records terminal status + digest
         image_digest, logs_url,       │ on success → operator rollout
         installation_id }
  HMAC over body          ◀─ 200 ──────┘
```

Long-poll semantics: a 30s server-side hold, immediate 200 handoff when a job
is available, 204 when the hold elapses; arcd reconnects on every 204. A
parked waiter is released immediately if the runner disconnects, and a build
delivered to a since-aborted waiter is re-enqueued — exactly-once handoff, no
dropped jobs.

### Auth — per-runner HMAC

Every poll/complete request is signed: `X-Arcd-Runner: <runnerId>` plus
`X-Arcd-Signature: sha256=<hmac of raw body>`, keyed by the runner's shared
`secret` from its `arcd_runner` row. Verification is constant-time
(`verifyRunnerSignature`). The `secret` is a machine-to-machine credential
(both sides compute the same HMAC), per-runner, rotated by replacing the row —
it is NOT a user password.

### Migration switch — registration gates the native path

A pool is served natively once at least one `arcd_runner` row for it has a
`lastSeen` within `RUNNER_STALE_MS` (90s; a healthy runner refreshes every
≤30s via the poll). `BuildScheduler.resolveDispatchMode` picks per job:

1. `build.dispatch: workflow_dispatch` in `.platform.yml` → always GHA.
2. `WORKFLOW_DISPATCH_FALLBACK=true` env → always GHA (global kill-switch).
3. otherwise → **native** if the pool has a live runner, else transparent
   `workflow_dispatch` so a build is never stranded.

This is the safety property: the GHA path is NOT removed until a real arcd
runner self-registers and refreshes its `lastSeen`. The flip is per-pool and
needs no config change — bring up a native runner and that pool's next build
goes native.

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
  dispatch: native              # optional: native | workflow_dispatch
                                # default native (long-poll); see dispatch section
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
| `build.dispatch` | `native` (default) \| `workflow_dispatch` |
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
| `/v1/arcd/poll` | POST | HMAC (`X-Arcd-Signature`) vs runner `secret` | Native long-poll: 200 `QueuedBuild` or 204 on 30s timeout |
| `/v1/arcd/complete` | POST | HMAC (`X-Arcd-Signature`) vs runner `secret` | Native runner reports build outcome; triggers deploy |
| `/v1/build-callback` | POST | `Bearer ${PLATFORM_BUILD_CALLBACK_TOKEN}` | Legacy `workflow_dispatch` build reports outcome; triggers deploy |

tRPC `buildJob` router (org-scoped): `list`, `one`, `logs`, `trigger`.

## Configuration

| Env / secret | Where | Purpose |
|--------------|-------|---------|
| `githubWebhookSecret` | github provider row (DB) | HMAC validation per installation |
| GitHub App creds | github provider row (DB) | Octokit App auth for reading `.platform.yml` (+ `workflow_dispatch` fallback) |
| `arcd_runner.secret` | `arcd_runner` row (DB) + runner config | Per-runner HMAC key for `/v1/arcd/poll` + `/v1/arcd/complete` |
| `WORKFLOW_DISPATCH_FALLBACK` | platform env | `true` forces every job onto the legacy `workflow_dispatch` path (global kill-switch) |
| `PLATFORM_BUILD_CALLBACK_TOKEN` | platform env + repo secret | Authenticates the legacy build → platform callback |

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

### Moving a pool to native long-poll

1. Provision an `arcd_runner` row: `{ runnerId, poolLabel, secret }` (the
   `secret` is a 32+ char per-runner HMAC key — generate with
   `openssl rand -hex 24`).
2. Configure the arcd host with `ARC_PLATFORM_URL=https://platform.hanzo.ai`
   and `ARC_PLATFORM_SECRET=<same secret>` (see arcd README). The runner's
   `platform_pools` must list `poolLabel`.
3. arcd's platform worker self-registers by polling; its first poll sets
   `lastSeen`. From then on, that pool's `native` jobs dispatch over long-poll;
   `workflow_dispatch` is no longer used for it. No platform redeploy needed.

To roll back a pool, stop its native runner (its `lastSeen` goes stale within
90s and the pool transparently reverts to `workflow_dispatch`) or set
`WORKFLOW_DISPATCH_FALLBACK=true` to force every pool back at once.

## Known limitations (this cut)

- `DeployExecutor` patches an EXISTING operator `Service` CR's `.spec.image`.
  It does not create the CR — the target service must already be operator-
  managed. A missing CR yields a real rollout error, never a silent success.
- Build logs are stored inline on the `build_job` row (MVP). Large logs move to
  object storage in a follow-up.
