# Apps Lifecycle

Single canonical lifecycle for every app the Hanzo / Lux / Zoo orgs
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
   reusable workflow (or its org-local equivalent for luxfi / zooai).
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
  -- IDENTITY IS WHERE IT RUNS. `<org>/<app>/<env>` was unique only while the
  -- estate was one cluster with one namespace per env; across the fleet the
  -- release `cloud` runs in `hanzo`, `lux-cloud` AND `zoo-cloud` at once.
  id            TEXT PRIMARY KEY,        -- "<cluster>/<namespace>/<app>"
  org           TEXT NOT NULL,           -- brand org: hanzo | lux | zoo | <tenant>
  app           TEXT NOT NULL,
  env           TEXT NOT NULL CHECK(env IN ('dev','test','main')),
  repo          TEXT,                    -- "hanzoai/iam"; NULL = no image observed
  registry      TEXT,                    -- "ghcr.io/hanzoai/iam"; NULL = unobserved
  declared_tag  TEXT,                    -- "v1.15.0" — from the workload CR
  running_tag   TEXT,                    -- "v1.14.29" — observed from the cluster
  latest_tag    TEXT,                    -- "v1.15.0" — observed from GHCR/GH releases
  release_url   TEXT,                    -- GH Release for declared_tag
  release_assets INT DEFAULT 0,          -- asset count on GH Release
  health        TEXT,                    -- "green" | "yellow" | "red"
  sync_status   TEXT,                    -- "synced" | "drifted" | "unknown" (from CD)
  sync_revision TEXT,                    -- the git sha CD last reconciled to
  last_observed DATETIME,
  cluster       TEXT,                    -- "hanzo-k8s" | "lux" | "zoo"
  namespace     TEXT,
  hosts         TEXT                     -- JSON array of public hostnames
);
```

Populated by TWO readers on independent cron in `platform`, folded by one
writer (`services/apps/inventory.ts#syncInventory`). Neither reader guesses: a
value it cannot see is NULL and the board renders "unknown".

- **cluster reader** (`services/apps/inventory.ts`) — lists the operator
  workload CRs and their live Deployments/StatefulSets on every cluster platform
  can reach directly (today: the one it runs in). Owns `declared_tag`,
  `running_tag`, `health`, `hosts`, `org`.
- **delivery reader** (`services/apps/delivery.ts`) — lists CD `Application`
  objects in `hanzo-cd`. This is how lux and zoo are on the board at all: CD
  reconciles those clusters and records what it found on objects that live in
  ours, so `running_tag`, `health`, `sync_status` and `sync_revision` come back
  for every cluster without platform holding another org's credentials.
- **release reader** (`services/apps/release-reader.ts`) — reads each repo's
  latest GitHub Release; owns `latest_tag` / `release_url` / `release_assets`,
  and touches nothing else.

Where the two fleet readers overlap, `mergeObserved` composes them field by
field: the direct reader wins on what it read itself (declared tag, hosts,
health), and the delivery reader alone supplies the sync verdict — nothing else
knows whether git and the cluster still agree.

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
runs them all. This is the bug class the `no antd` rule above exists for: an
upstream sync re-introduces a dependency the repo had already converted away
from — the guard fails the PR until the offending files are re-converted.

### 6. Drift view at `platform.hanzo.ai/apps`

ONE page for the WHOLE fleet — hanzo, lux and zoo together, filtered by org over
the same rows rather than split into a panel each. The org list is derived from
the rows observed, so a new org appears the moment it has an app.

| Org/App | Where | Host | Declared | Running | Latest | Sync | Drift | GH Release | Health | Last seen |
|---|---|---|---|---|---|---|---|---|---|---|
| hanzo/iam | main · hanzo-k8s/hanzo | iam.hanzo.ai | v1.15.0 | v1.14.29 | v1.15.0 | out of sync | ⚠ un-rolled | ✓ 4 assets | green | 2m ago |
| lux/app-lux-finance | main · lux/app-lux-finance | — | unknown | 1.0.3-amd64 | unknown | synced | ✗ floating-running | — | green | 1m ago |
| zoo/zoo-docs | main · zoo/zoo-mainnet | — | unknown | unknown | unknown | out of sync | ⚠ unsynced | — | red | 1m ago |

Drift severity is the page's keystone. Yellow = stale declaration, un-rolled
tag, or the deployer reporting the live objects no longer match git (`unsynced`).
Red = a floating tag, or a declared tag with missing release artifacts.

BRAND: the board carries no org mark, logo or colour at all. A Lux row must
never carry a Hanzo mark, and in a shared table the only way to guarantee that
is to carry no mark; the org is a word in a column.

HONESTY: "unknown" means no reader could observe that value, and it is written
in full rather than left blank so a gap can never be mistaken for a value. A
control plane that guesses is worse than one that admits a gap. Notably, the
declared tag of a remotely-delivered app IS unknown: CD reports what is running
and whether it matches git, never what git declares right now, and filling it in
from the running tag would make every remote app read "no drift" by
construction.

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
| Silent regressions | upstream merge re-introduced antd | upstream-merge-guard blocks PR |
| Release-without-assets | v1.15.0 shipped with 0 binaries | verify step refuses to mark released |
| Manifest reality gap | postgres database wired but service uses SQLite | declared state IS what runs; nothing else to wire |

## Open questions

- Where does the `apps` table actually live for multi-org installs? Today
  `platform.hanzo.ai` is Hanzo-tenant; downstream tenants run their own
  `platform`. Either each org runs its own apps table (simpler, current
  direction), or there's a federation read-side. Defer to PR 3 review.
- The `verify` step in PR 4 needs a "release artifact contract" per repo
  (Go binary count, npm dist count, etc.). Suggest a `release.contract.json`
  at repo root.
- Apps in DOKS vs GKE vs DO App Platform (deprecated) — readers need cluster
  configuration. Suggest `platform/config/clusters.yaml` enumerating
  `(name, context, kubeconfig_secret)`.
