# Platform-native CI/CD

How `platform.hanzo.ai` owns the full **build → deploy → test → publish**
lifecycle for Hanzo repos, with NO GitHub Actions in the path.

This document is the contract for the `hanzo.yml` schema and the
webhook → scheduler → build → watcher → deploy → test → publish pipeline. It is
checked in. Schema changes here are breaking changes to every repo's `hanzo.yml`.

## Why

The GHA billing-freeze incident proved that depending on GitHub Actions is a
single point of failure for the entire Hanzo ecosystem: when GHA stops, every
build and deploy stops. Platform now owns the durable system-of-record (the
`build_job` table), the deploy decision, the rollout, the test run, and the
publish — and every stage executes as an **in-cluster Job on our own runner
pool**, so a GHA outage cannot halt shipping.

## Architecture

One conductor (the `paas` pod), one build path (an in-cluster BuildKit Job), one
heartbeat (the build-watcher) that drives each build through the rest of the
pipeline. No `workflow_dispatch`, no external runner registration, no callback
required.

```
GitHub push/PR ─webhook─▶ /v1/github-webhook (HMAC per installation)
service-token  ─direct──▶ /v1/runner         (Bearer PLATFORM_BUILD_CALLBACK_TOKEN)
                              │
                              ▼
                        BuildScheduler              reads hanzo.yml @ sha, validates,
                              │                     one build_job per matrix entry
                              │                     (idempotent on repo+sha+target)
                              ▼
                        launchBuildJob ──▶ BuildKit Job (moby/buildkit, buildctl-daemonless.sh)
                              │              https://github.com/<repo>.git#<ref>
                              │              --output=type=image,name=ghcr.io/<org>/<repo>:<tag>,push=true
                              │              --secret=id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN
                              ▼              (console-git-token via GIT_AUTH_TOKEN + kaniko-ghcr at /root/.docker)
                        build_job (DB, status=running, buildJobName=<job>)
                              ▲
                              │  every 15s
                        build-watcher ── reads the BuildKit Job status
                              │  succeeded → completeBuild():
                              │     markSucceeded(+digest)
                              │     → DeployExecutor: merge-patch operator Service CR
                              │         `.spec.image` → operator rolls out
                              │     → e2e Job (runE2e) against the LIVE service
                              │     → publish Job (npm/pypi) for library/SDK repos
                              ▼
                        reconcilePostBuild() ── polls e2e + publish Jobs to terminal
```

Source: `pkg/platform/src/services/ci/` — `platform-config` (`hanzo.yml`
parser + validator), `github-webhook` (decoder + HMAC), `build-job` (DB CRUD),
`build-scheduler` (BuildKit dispatch), `buildkit-job` (the build muscle),
`build-watcher` (the heartbeat), `build-completion` (the post-build
orchestrator: deploy → test → publish), `deploy-executor` (operator CR patch),
`e2e-runner` (Playwright Job), `publish-job` (npm/pypi Job).

## The single build path: in-cluster BuildKit

`launchBuildJob` creates a BuildKit Job identical to the build Jobs operators
applied by hand before this was automated:

- context `https://github.com/<owner>/<repo>.git#<ref>` (git auth from the
  `console-git-token` secret, key `token`);
- `--output=type=image,name=ghcr.io/<org>/<repo>:<tag>,push=true` (registry auth
  from the `kaniko-ghcr` secret — legacy name — mounted at `/root/.docker`);
- the in-cluster BuildKit path leaves the image digest unset; a digest is
  recorded only on the external-builder `/v1/build-callback` path when reported;
- scheduled onto `nodeSelector doks.digitalocean.com/node-pool=runner-pool-32g`
  with the `dedicated=ci-runner` toleration;
- `automountServiceAccountToken: false` — the build pod gets no cluster creds.

The `paas` pod's ServiceAccount (`hanzo-paas-sa`) already has the RBAC to
create + watch Jobs and patch operator `Service` CRs — the same seam the
e2e-runner and deploy-executor use. There is exactly ONE k8s client.

## The heartbeat: build-watcher

BuildKit Jobs cannot call back, so the watcher (`startBuildWatcher`, started from
`server/server.ts` in-cluster, gate `BUILD_WATCHER_DISABLED=true`) polls every
`running` build_job's BuildKit Job. On success it calls `completeBuild`, which
records the digest, rolls out the deploy, fires the e2e Job, and arms publish;
on failure it marks the row failed. It then ticks `reconcilePostBuild` for
succeeded rows until e2e + publish reach a terminal state. The pipeline is
fully autonomous — no human polls, no callback is required (the
`/v1/build-callback` REST hook remains for an external builder that wants to
report its own result, sharing the same `completeBuild` brain).

## `hanzo.yml` schema reference

Committed at each repo's root (`hanzo.yml`; legacy `.platform.yml` still read).
Parsed + validated by `pkg/platform/src/services/ci/platform-config.ts`.

```yaml
build:
  matrix:                       # required, non-empty, no duplicates
    - { os: linux, arch: amd64 }
  dockerfile: ./Dockerfile      # optional, default ./Dockerfile
  context: .                    # optional, default .
  image: ghcr.io/hanzoai/<repo> # required, BARE repo (no tag)
  tag-pattern: "{{git.sha}}"    # optional, default {{git.sha}}
  push: true                    # optional, default true
deploy:                         # optional; omit for build-only / library repos
  on:                           # required, non-empty list of deploy branches
    - main
  target:
    cluster: hanzo-k8s
    namespace: hanzo
    operator: hanzo-operator    # only hanzo-operator | hanzo
    crd: App                    # optional, default App | Service
    name: <workload-name>       # operator workload CR to roll the image onto
e2e:                            # optional; runs after a successful deploy
  spec: tests/16-pricing.spec.ts  # required: Playwright spec under universe/e2e
  baseDomain: pricing.hanzo.ai    # optional, default hanzo.ai
  ref: main                       # optional, universe ref (default main)
publish:                        # optional; library/SDK repos
  npm: true                     # publish to npm (npm publish)
  pypi: false                   # publish to PyPI (uv build + uv publish)
  packageDir: .                 # optional, default . (sub-dir holding the package)
  dryRun: false                 # optional; build + validate WITHOUT uploading
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
| `deploy.target.crd` | `App` (default) \| `Service` |
| `deploy.target.namespace` | must be owned by the repo's org — see below |
| `e2e.spec` | required when `e2e:` present |
| `publish` | requires at least one of `npm: true` / `pypi: true` |

### Deploy target: kind and namespace

`crd` is the operator workload kind. **`App` is canonical** — the fleet runs
`apps.hanzo.ai` almost exclusively — and is what you get when `crd` is omitted.
`Service` is the v0.3.0 alias, still accepted. Both carry `spec.image`, and the
deploy leg patches `spec.image.{repository,tag}` on either; it deliberately does
NOT rewrite `pullPolicy`, so rolling an image never changes pull semantics.
Datastore kinds (`SQL`/`KV`/`DocDB`) are rejected — they carry no rollable image.

`namespace` is authorized, not merely validated. A deploy may write only into a
namespace that resolves to the repo's own organization:

| Basis | Rule |
|-------|------|
| tenant | `namespace == tenant-<org>` — derived from the org, so unforgeable |
| fleet  | the namespace is assigned to that org in the fleet ownership table |

The fleet table (`DEFAULT_FLEET_NAMESPACE_OWNERS` in
`services/k8s/operator/namespace-authz.ts`) maps each estate namespace to its
owning org — `hanzo`/`hanzo-testnet`/`hanzo-devnet` → `hanzo`, and the lux/zoo
equivalents. Override it wholesale with `PLATFORM_FLEET_NAMESPACE_OWNERS`
(`ns=org,ns=org,…`); a malformed entry throws rather than silently widening.

Anything else is REFUSED (`FORBIDDEN`, rollout marked failed, nothing written
to the cluster). There is no wildcard and no system-namespace carve-out.

`e2e` runs only after a real rollout; its result is RECORDED on the build_job
(`e2eStatus`), reported not hard-gated. `publish` is gated behind a passing
`e2e` when both are configured (a failing e2e skips publish); otherwise it
fires right after a successful build.

Runner-pool resolution (recorded on the row): `<brand>-build-<os>-<arch>`,
brand-mapped from the GitHub org (`hanzoai`→`hanzo`).

## Endpoints

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/v1/github-webhook` | POST | HMAC (`X-Hub-Signature-256`) vs per-installation `githubWebhookSecret` | Accept push/PR/ping; schedule builds |
| `/v1/runner` | POST | `Bearer ${PLATFORM_BUILD_CALLBACK_TOKEN}` | GitHub-free direct build trigger (repo, sha, image) |
| `/v1/e2e/run` | POST | `Bearer ${PLATFORM_BUILD_CALLBACK_TOKEN}` | Launch a Playwright e2e Job on demand |
| `/v1/build-callback` | POST | `Bearer ${PLATFORM_BUILD_CALLBACK_TOKEN}` | Optional external-builder completion hook → deploy/test/publish |

tRPC `buildJob` router (org-scoped): `list`, `one`, `logs`, `trigger`.

## Configuration

| Env / secret | Where | Purpose |
|--------------|-------|---------|
| `githubWebhookSecret` | github provider row (DB) | HMAC validation per installation |
| `GH_TOKEN` | platform env | Octokit token: reads `hanzo.yml` for the deploy/test/publish decision (no GitHub App needed) |
| GitHub App creds | github provider row (DB) | Octokit App auth for the webhook path's config read |
| `console-git-token` | k8s secret (key `token`) | BuildKit + publish Job git clone |
| `kaniko-ghcr` | k8s secret (key `config.json`) | BuildKit GHCR push credential (secret name is legacy) |
| `npm-token` / `pypi-token` | KMS-synced k8s secret (key `token`) | Publish Job registry auth — KMS-only, never hardcoded (optional refs; dry-run works without them) |
| `PLATFORM_BUILD_CALLBACK_TOKEN` | platform env | Bearer for the direct/e2e/callback REST surfaces |
| `BUILD_WATCHER_INTERVAL_MS` | platform env | Watcher poll interval (default 15000) |
| `BUILD_WATCHER_DISABLED` | platform env | `true` disables the watcher (dev boxes without cluster RBAC) |

### Publish tokens (KMS)

The publish Job reads registry tokens from KMS-synced secrets, never from
source. To enable real (non-dry-run) publishing:

1. Store the tokens in KMS (project `hanzo`, path `/publish`): `npmToken`,
   `pypiToken`.
2. Add a `KMSSecret` (generated by universe `scripts/kms-canonical-v1alpha1-gen.py`)
   that syncs them to the `npm-token` / `pypi-token` k8s secrets (key `token`)
   in `hanzo`.

Until provisioned, `publish.dryRun: true` builds + validates the package
(`npm publish --dry-run` / `uv build` + `twine check`) so the stage is provable
without a token and without mutating any registry.

## Migration guide: GHA → platform CI

1. Add `hanzo.yml` at the repo root (schema above).
2. Point the repo's GitHub App webhook at
   `https://platform.hanzo.ai/v1/github-webhook` (events: push, pull_request),
   webhook secret matching the provider's `githubWebhookSecret`.
3. Push a commit; confirm a `build_job` appears (tRPC `buildJob.list`), the
   image lands at `ghcr.io/<org>/<repo>:<sha>`, and (on a deploy branch) the
   operator Service CR rolls.

A repo can also be built with no GitHub App at all via `POST /v1/runner`.
Repos WITHOUT a `hanzo.yml` are ACKed with 202 and nothing is scheduled.

## Known limitations (this cut)

- `DeployExecutor` patches an EXISTING operator `Service` CR's `.spec.image`.
  It does not create the CR — the target service must already be operator-
  managed. A missing CR yields a real rollout error, never a silent success.
- Builds target the `runner-pool-32g` (amd64) pool; an `arm64` matrix entry
  needs an arm64 runner pool (its Job pends visibly until one exists — never a
  silent mis-build).
- Build logs are stored inline on the `build_job` row (MVP). Large logs move to
  object storage in a follow-up.
```
