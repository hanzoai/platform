# Apps Lifecycle

Single canonical lifecycle for every app the Hanzo / Lux / Zoo / Liquidity orgs
build and run. One source of truth per dimension. Semver-only end to end. No
floating tags, no parallel pipelines, no drift unaccounted for.

This document is the contract. Operator implementations, CI workflows, and
remediation scripts that disagree with it are wrong.

## Constraints

These are non-negotiable. Every piece below derives from them.

1. **Semver-only.** Every published artifact (git tag, image tag, npm tag,
   release name) is exactly `vMAJOR.MINOR.PATCH`. No `:latest`, `:main`,
   `:dev`, `:test`, `:edge`, `:nightly`, `:master`, `{{major}}.{{minor}}`,
   `pr-N` (except as ephemeral review-app indirection that never reaches a
   running cluster). Branch pushes produce `sha-<sha7>` as an immutable
   build artifact — never a floating reference.
2. **One workflow per repo.** A repo emits artifacts through exactly one
   CI workflow file. No parallel `build.yml` + `docker-deploy.yml`. The
   workflow calls the shared `hanzoai/.github/.github/workflows/docker-build.yml@main`
   reusable workflow (or its org-local equivalent for luxfi / zooai /
   ).
3. **Declared state is the source of truth.** What is *supposed* to be
   running in a given env is a row in the `apps` table that points to a
   `vX.Y.Z` git tag. Manifests, kustomizations, helm values, KMSSecrets,
   and any other live config derive from that row.
4. **Running state is observed, not assumed.** What is *actually* running
   is read from the cluster (kubectl image refs, helm release values,
   operator status). Memory files and Slack messages are not authoritative.
5. **Drift is loud.** Any deviation between declared / latest-available /
   running tags surfaces immediately on the apps view at
   `platform.hanzo.ai/apps`. Silent drift is the bug class this document
   eliminates.

## Lifecycle States

Each (org, app, env) tuple is in exactly one state at any time. The
operator+verifier transitions it.

| State | Meaning | Entry condition |
|---|---|---|
| **built** | A `sha-<sha7>` immutable image exists in the registry for some commit. No release yet. | Branch push completes `docker-build` job. |
| **released** | Semantic-release minted a `vX.Y.Z` git tag; CI built and pushed `vX.Y.Z` image; GoReleaser uploaded binaries to the GH Release; manifest verified to contain the same `vX.Y.Z`. | All four sub-checks pass (see Verification below). |
| **declared** | A row in `apps.declared_tag` references `vX.Y.Z`. Operator reconciliation will pull this. | PR to universe (or env manifest) merged. |
| **running** | The cluster reports `vX.Y.Z` on every replica of the deployment. | `kubectl get deploy -o jsonpath` shows the image. |
| **verified** | Running tag == declared tag, health probes green, post-deploy smoke pass. | Operator reconcile loop closes. |
| **drift** | Any of: declared ≠ latest+1 (stale), running ≠ declared (un-rolled), running has floating tag (policy violation), no GH Release for the running tag, GH Release has 0 assets. | Detected by drift checker. |

## Components

### 1. `apps` table

Lives in `platform`'s embedded Base/SQLite (`platform.hanzo.ai`,
`data/apps.db`). Schema:

```sql
CREATE TABLE apps (
  id            TEXT PRIMARY KEY,        -- "<org>/<app>/<env>", e.g. "hanzoai/iam/main"
  org           TEXT NOT NULL,
  app           TEXT NOT NULL,
  env           TEXT NOT NULL CHECK(env IN ('dev','test','main')),
  repo          TEXT NOT NULL,           -- "hanzoai/iam"
  registry      TEXT NOT NULL,           -- "ghcr.io/hanzoai/iam"
  declared_tag  TEXT,                    -- "v1.15.0" — from universe manifest
  running_tag   TEXT,                    -- "v1.14.29" — observed from cluster
  latest_tag    TEXT,                    -- "v1.15.0" — observed from GHCR/GAR
  release_url   TEXT,                    -- GH Release for declared_tag
  release_assets INT DEFAULT 0,          -- asset count on GH Release
  health        TEXT,                    -- "green" | "yellow" | "red"
  last_observed DATETIME,
  cluster       TEXT,                    -- "hanzo-k8s" | "lux-k8s" | ...
  namespace     TEXT
);
CREATE UNIQUE INDEX apps_unique ON apps(org, app, env);
```

Populated by four readers running on independent cron in `platform`:

- `read_latest_tag` — polls GHCR/GAR per app, writes `latest_tag`
- `read_declared_tag` — scrapes universe manifests, writes `declared_tag`
- `read_running_tag` — `kubectl` against each cluster, writes `running_tag` + `health`
- `read_release_meta` — `gh release view` for `declared_tag`, writes
  `release_url` + `release_assets`

### 2. Per-repo build contract

Every repo has exactly **one** workflow file at `.github/workflows/build.yml`.
It calls the shared reusable workflow:

```yaml
jobs:
  test: ...        # unit, lint, build — gates everything below
  tag-release:     # semantic-release; outputs new-release-version
    needs: [test]
  github-release:  # GoReleaser / pnpm publish / etc.
    needs: [tag-release]
    if: needs.tag-release.outputs.new-release-published == 'true'
  docker-release:  # uses hanzoai/.github/.github/workflows/docker-build.yml@main
    needs: [tag-release]
    if: needs.tag-release.outputs.new-release-published == 'true'
    with:
      image: ghcr.io/<org>/<app>
      platforms: linux/amd64  # arm64 paused on DOKS
  verify:          # asserts all four release outputs exist; see Verification
    needs: [github-release, docker-release]
  notify-platform: # dispatches to platform/apps so `latest_tag` updates immediately
    needs: [verify]
```

No second workflow ships images. No floating tags. The shared `docker-build.yml`
already enforces `flavor: latest=false` and `type=semver,pattern={{version}}`
plus `type=sha,prefix=sha-`. **Override that and the build is rejected.**

### 3. Verification step

Runs as the last job before `notify-platform`. Hard-fails the workflow if
any check fails (and rolls back the GH Release).

```
- assert: git tag vX.Y.Z exists and matches semantic-release output
- assert: ghcr.io/<org>/<app>:vX.Y.Z manifest exists and is amd64
- assert: GH Release vX.Y.Z has at least N assets (N from build config; iam=4, etc.)
- assert: no floating tag was pushed (registry has no :main, :latest, :dev for this app)
```

The third check is the one that would have caught iam v1.15.0 shipping with
zero binaries — exactly the bug the missing `setup-go@v5` produced.

### 4. Operator reconciler

The universe operator (lives at `universe/operator/`) is extended with an
`Apps` controller that:

1. Watches the `apps` table for `declared_tag != running_tag`
2. Patches the deployment to `declared_tag`, waits for rollout
3. Writes the result back to `apps.last_observed` and `apps.health`
4. Emits an event readable from `platform.hanzo.ai/apps`

The same controller refuses to apply a patch where `declared_tag` is a
floating reference (anything not matching `^v\d+\.\d+\.\d+$`). Semver-only at
the reconcile boundary.

### 5. Upstream-merge guard

Per repo, a GH Action runs on every PR labeled `upstream-sync`:

```yaml
name: upstream-merge-guard
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  check:
    if: contains(github.event.pull_request.labels.*.name, 'upstream-sync')
    steps:
      - run: |
          # repo-local regression rules — examples
          ! grep -rE "from ['\"]antd|from ['\"]@ant-design" src/   # iam: no antd
          ! grep -r "ava-labs/avalanchego" go.mod                  # lux: no upstream
          ! grep -r "PocketBase" .                                 # hanzo/base: rebranded
```

Each repo carries its own ruleset at `.github/upstream-rules.txt`; the action
runs them all. This is the bug class that re-introduced antd in iam after
casdoor v2.368.0 sync — the guard fails the PR until the offending files are
re-converted.

### 6. Drift view at `platform.hanzo.ai/apps`

Single page. Filter by org / env / health. Columns:

| Org/App | Env | Declared | Running | Latest | Drift | GH Release | Health | Last seen |
|---|---|---|---|---|---|---|---|---|
| hanzoai/iam | main | v1.15.0 | v1.14.29 | v1.15.0 | ⚠ 1 ver behind | ✓ 4 assets | green | 2m ago |
| hanzoai/iam | test | v1.15.0 | v1.15.0 | v1.15.0 | — | ✓ 4 assets | green | 30s ago |
| luxfi/node | main | v1.14.0 | v1.14.0 | v1.14.0 | — | ✓ 6 assets | green | 1m ago |
| hanzoai/gateway | main | v1.1.0 | (no image found) | v2.14.1 | ✗ DRIFT | ✗ skipped | red | 5m ago |

Drift column color is the page's keystone. Yellow = stale declaration.
Red = running tag is floating or declared tag missing release artifacts. Both
have one-click "open PR to bump" and "force reconcile" actions backed by the
existing universe auto-bump dispatch.

## Migration sequencing

The kernel can ship in five PRs:

1. **PR 1** — `platform/docs/APPS_LIFECYCLE.md` (this doc) + `apps` table
   migration in `platform/migrations/`.
2. **PR 2** — four readers (`latest`, `declared`, `running`, `release`) as
   `platform/cmd/apps-reader/` running on cron.
3. **PR 3** — `/v1/apps` REST endpoint + Next.js page at
   `platform.hanzo.ai/apps` consuming it.
4. **PR 4** — `verify` step added to the shared `docker-build.yml` reusable
   workflow + repo-local `upstream-merge-guard` action template in
   `hanzoai/.github/workflow-templates/`.
5. **PR 5** — `Apps` controller in `universe/operator/` reconciling
   `declared_tag` → cluster.

Each PR is independently shippable and produces measurable value:

- After PR 1+2: ground truth visible via `sqlite3 apps.db 'select * from apps'`
- After PR 3: anyone can see drift without ssh / kubectl
- After PR 4: new releases verified end-to-end before they're announced;
  upstream merges blocked from regressing
- After PR 5: declared changes auto-reconcile; manual `kubectl set image`
  becomes an emergency-only escape hatch

## Out of scope (deliberately deferred)

- **Multi-cluster orchestration** beyond the existing universe operator —
  the `apps` table records `cluster`+`namespace` per row, but cross-cluster
  scheduling is its own problem.
- **Blue/green / canary** — declared `vX.Y.Z` is a single value per env. The
  app's deployment spec controls rollout strategy; the lifecycle records
  *what is declared*, not *how it ramps*.
- **Cost / quota** — observed but not enforced here.
- **Cross-org auth / RBAC** — `platform.hanzo.ai/apps` reads from IAM via the
  existing X-Org-Id header convention. New permissions = follow-up.

## Anti-patterns this dissolves

| Pattern | Today's symptom | Lifecycle outcome |
|---|---|---|
| Memory drift | "iam claimed 1.51, actual 1.14.0" | `apps.latest_tag` is read from registry, not memory |
| Parallel workflows | iam had build.yml + docker-deploy.yml | verify step refuses second image push |
| Floating tags | `:main` regrew on iam despite `latest=false` | reconciler refuses non-semver `declared_tag` |
| Silent regressions | Casdoor merge re-introduced antd | upstream-merge-guard blocks PR |
| Release-without-assets | v1.15.0 shipped with 0 binaries | verify step refuses to mark released |
| Manifest reality gap | postgres database wired but service uses SQLite | declared state IS what runs; nothing else to wire |

## Open questions

- Where does the `apps` table actually live for multi-org installs? Today
  `platform.hanzo.ai` is Hanzo-tenant; Liquidity has its own `platform`.
  Either each org runs its own apps table (simpler, current direction), or
  there's a federation read-side. Defer to PR 3 review.
- The `verify` step in PR 4 needs a "release artifact contract" per repo
  (Go binary count, npm dist count, etc.). Suggest a `release.contract.json`
  at repo root.
- Apps in DOKS vs GKE vs DO App Platform (deprecated) — readers need cluster
  configuration. Suggest `platform/config/clusters.yaml` enumerating
  `(name, context, kubeconfig_secret)`.
