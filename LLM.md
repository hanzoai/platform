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

- Triggers — three doors, two functions: `app/platform/app/v1/git-webhook/route.ts`
  (HMAC per installation; `/v1/github-webhook` is a zero-logic alias of it) and
  the tRPC `buildJob.trigger` both call `scheduleBuilds`;
  `app/platform/app/v1/runner/route.ts` (an IAM identity or an org-scoped
  `x-api-key`, GitHub-free direct build) calls `enqueueDirectBuild` with the
  organization read off that credential. Both settle the repository and the ref
  first, and every rule about whether a commit may be built lives INSIDE those
  two — the principal, the destination, the name it publishes under, the
  canonical-source check, and whether hanzoai/ci already owns the repo's
  pipeline. A door adds transport and an answer to render; a rule a door could
  skip is not a rule. `build-callback.ts` is an optional external-builder
  completion hook (bearer token).
- **A build is about one git name, and the forge says which commit that is.** A
  door states `repo` + `ref` (`refs/heads/main`, `refs/tags/v1.2.3`); `commitAt`
  asks the forge, by exact name, at `/branches/<name>` or `/tags/<name>`. There
  is no field for a commit — not even on the signed webhook lane, where the
  delivery does carry the pair. That single value is what `resolveTag` spells
  the image from and what `promoteBuild` reads to decide whether a deploy
  follows, so the two cannot be made to disagree. `deploy.on` lists BRANCHES:
  a tag build publishes and never deploys.
- **Two tag tokens, and both hold still**: `{{git.sha}}` and `{{git.tag}}` (the
  latter resolves on the push that MAKES the tag, and skips the target on a
  branch push). There is no branch token — a branch head is the one git name
  that moves. `tagProblem(image, sha)` takes the commit, so a commit-shaped tag
  has to be that commit's, and a version is a WHOLE semver line rather than one
  found inside a name that moves.
- **The ci-yield is keyed on the image, not the forge path.** An organization
  has several forge spellings and one registry namespace, so `hanzo/platform`
  and `hanzoai/platform` publish one `ghcr.io/hanzoai/platform`. `ciOwnsBuild`
  is asked about the pushed path AND the path each declared image names, at each
  repo's default branch.
- A call that builds nothing returns `Declined` — `declined` for a caller that
  branches, `why` for one that reports. Two ordinary reasons (`no-image`,
  `ci-owns`) that are different sentences, written where they are known, so the
  forge's delivery history and the console read alike.
- Service layer: `pkg/platform/src/services/ci/` — `platform-config` (`hanzo.yml`
  parser + validator, now incl. `e2e:` + `publish:`), `github-webhook`,
  `build-job` (DB CRUD), `build-scheduler` (dispatch via `launchBuildJob`),
  `buildkit-job` (the build muscle — BuildKit Job + outcome read), `build-watcher`
  (the heartbeat: polls BuildKit Jobs, drives the pipeline), `build-completion`
  (post-build orchestrator: promote → e2e → publish, App-free config via
  `GH_TOKEN`), `promote` (the smoke→pin state machine), `smoke-runner`
  (candidate pod + verdict), `pin` (the universe commit), `e2e-runner`
  (Playwright Job), `publish-job` (npm/pypi Job, KMS tokens).
- DB: `build_job` table (`pkg/platform/src/db/schema/build-job.ts`); migration
  `drizzle/0005_build_pipeline_columns.sql` adds `buildJobName`/`imageDigest`/
  `e2e*`/`publish*` and drops the dead `arcd_runner` table.
  `drizzle/0010_build_job_one_ref.sql` drops `branch`: it was a short copy of
  `ref`, which is one value in two columns and therefore two answers waiting to
  disagree. `git clone --branch` takes either kind of name, so the publish Job
  shortens the ref where it becomes an argument.
- tRPC: `buildJob` router (org-scoped list/one/logs/trigger). `trigger` takes
  `repo` + `ref` and nothing else — no commit, and no forge: the forge holds the
  repository and says what the ref points at, so both follow from what is there.
- Build muscle: BuildKit (`moby/buildkit:v0.16.0`, `buildctl-daemonless.sh`,
  `--frontend=dockerfile.v0`) — the PROVEN contract that already builds
  commerce/chat/cloud on this cluster — over an HTTPS git context
  `https://git.hanzo.ai/<repo>.git#<commit>` → `--output=type=image,…,push=true` to
  GHCR, privileged, on `runner-pool-32g` + `dedicated=ci-runner` (git auth from
  `console-git-token` via `GIT_AUTH_TOKEN`, GHCR push cred from `kaniko-ghcr` at
  `/root/.docker`). The RETIRED long-poll/`workflow_dispatch` external-runner
  surface (build-queue, arcd-runner, `/v1/arcd/poll`+`/complete`) was removed —
  it pointed at offline GitHub runners and silently no-op'd.
- PROVEN LIVE (v4.4.4): `POST /v1/runner` for `hanzoai/pricing` created a
  `build_job` row → platform launched the BuildKit Job (`build-pricing-*`,
  `managed-by=platform`) → pushed `ghcr.io/hanzoai/pricing:v1.1.2` → the
  build-watcher flipped the row to `succeeded`. The auto-deploy leg correctly
  REFUSED via the tenant gate (pricing's `hanzo.yml` targets system ns `hanzo` ≠
  the build org's `tenant-<org>`).

### Promotion is a COMMIT, and a build must START before it earns one

**The change (2026-08).** `build-completion` used to call `executeDeploy`, which
merge-patched the operator CR's `.spec.image` the instant a build compiled. Three
things were wrong at once, and the code said all three out loud:

- **No verification.** A build proves the code compiles. api.hanzo.ai went down
  on an image that compiled and then panicked at init on a duplicate route prefix
  → CrashLoopBackOff, on a single-writer service (RWO PVC + embedded Kafka,
  `strategy: Recreate`) with no safe rollback. Nothing between `docker push` and
  production had ever run those bytes.
- **The test was post-facto.** `build-completion.ts` itself noted "e2e runs
  against the LIVE service, so it only fires after a real rollout". The pipeline
  was build → DEPLOY → test. The test reported; it never gated.
- **It wrote running state, not declared state.** cd.hanzo.ai reconciles
  `charts/app/values/*/*.yaml` from `git.hanzo.ai/hanzo/universe@main`
  (`infra/k8s/hanzo-cd/applicationset-fleet.yaml`). A CR patch moved the cluster
  and left git saying something else — a deploy with no diff and no history.

**Now:** `BUILT → SMOKE → PIN → (CD reconciles, out of band)`, in
`services/ci/promote.ts`, with `rolloutStatus` carrying the position:

```
skipped → pending → smoking → { promoted | smoke-failed | failed }
```

`promoted` is the ONLY value meaning an image was declared; `applied` is gone
with the patcher. `skipped` is the column DEFAULT and the one resting place that
is not an outcome (no `deploy:` block, or not a deploy branch). `pending` is
stamped the moment a target resolves, BEFORE authorization or smoke, so the row
says a promotion began before one does — a pod that dies mid-flight writes
nothing more, and without that write an interrupted run is byte-identical to a
run nobody asked for. A row resting on `pending` or `smoking` is an interrupted
promotion.

- **smoke** (`smoke-runner.ts`) starts the exact digest-pinned image in ONE
  throwaway pod derived from the LIVE Deployment/StatefulSet pod template, and
  waits for the app's own readiness probe. Prod-faithful (real env, secrets,
  probes, SA, placement), prod-inert by four departures: labels REPLACED (a
  Service selects on labels — a candidate wearing the app's would take live
  traffic), every PVC → `emptyDir`, `restartPolicy: Never` so a crash reads as a
  crash, `HANZO_SMOKE=1` on every container. Pod name is
  `<app>-smoke-<digest12>`, so a re-tick adopts the running candidate instead of
  racing a second. Teardown is in a `finally`, including when the create throws.
- **pin** (`pin.ts`) commits `image.tag` + `image.digest` to
  `charts/app/values/<ns>/<name>.yaml` via the forge contents API — GET (blob
  sha = optimistic concurrency) → one-line edit → PUT. **Both halves, always**:
  `_helpers.tpl:app.image` renders `repo:tag@digest` and RESOLVES BY DIGEST, so
  writing one without the other is the failure that succeeds at doing nothing
  (v1.801.362 reported .362 and ran .361). Re-verified byte-for-byte against the
  live inventory — **115 pinnable files × 6 tag shapes = 690 pins, 0 failures**:
  only the differing scalars move, the file still parses, both read back as
  strings, idempotent. **`digest:` is a SIBLING key — never `tag: v1@sha256:…`,
  which would render `repo:tag@NEW@OLD` and pull nothing.**
  - A tag is written as a scalar YAML reads back as the STRING it is.
    `values.schema.json` types `image.tag` as a string, so a bare `tag: 9` is an
    integer and the release fails validation. Five live declarations are strings
    only because they are quoted (`registry: '2'`, `kv: '9'`, `sql` +
    `insights-sql: '18'`, `image-prepull: "1.36"`), and the textual rewrite used
    to drop the quotes with the value: 345 of those 690 pins came back a number.
    `commitPin`'s parser read-back caught every one, so it refused rather than
    mis-pinned — those services simply could never be promoted.
  - A line already saying the right value is left byte-identical, decided by
    READING the scalar, not comparing text: `"1.36"` and `'1.36'` are one string
    written two ways, and rewriting one into the other is a diff that changes
    nothing.
- **Refusals, none of which write anything:** repository must match the file's
  (a build cannot repoint a service at another image); the values file must
  already exist (the directory is the inventory — enrolling a service stays
  deliberate); the build must carry a digest; `authorizeNamespace` runs before
  anything starts. `promoteBuild` never throws — a refused promotion must not
  cost a library repo its publish stage.

**Same invariant, two writers.** `universe charts/app/pin.sh` does this edit for
a service whose own CI has a checkout; this does it from a pod that has none.
Both stamp `Pinned-by:`, and `pin.sh --verify` checks both in CI.

**Whose build it is — `services/org`, one table, four readers.** A forge owner
and a registry namespace are the same kind of name, and `OWNS` says which
organization each belongs to (`hanzo` owns `hanzo`/`hanzoai`/`hanzo-apps`/
`hanzo-docs`/`hanzo-inc`/`hanzoteam`; `lux` owns `lux`/`luxfi`; and so on). A
namespace earns a line when a `push-<namespace>` credential exists for it in
`hanzo-build` — that credential is what the table decides who may ask for.
Reading it:

- `principal(repo)` — the org a build ACTS as, resolved from the repository's
  owner through `organization.slug`. `authorizeNamespace` is keyed by namespace
  and VALUED by org, so it only tells organizations apart when they are
  different answers; one answer for every repository makes every fleet grant a
  grant to everybody.
- `destinationProblem(repo, image)` — three facts about one destination: it is
  ONE image reference (letters, digits and `._-/:@`), it addresses a registry we
  run (`registryProblem`, `HOSTS` = ghcr.io / oci.hanzo.ai — `registry.hanzo.ai`
  came off when the name stopped serving a registry, and its auth entry came out
  of the six dockerconfigs that still carried it), and the namespace it
  publishes into belongs to the same organization as the repository's owner.
  Asked at both front doors and again in `buildkit-job` for EVERY reference a
  build will publish — the row's and, with a fleet registry set, the second one —
  before a credential is mounted. A namespace no organization here owns is not
  judged: it is somebody else's registry.
  - The reference alphabet is what keeps a credentialed destination one field of
    the image exporter — a comma would open a second `name=`, an `=` an attribute
    of the exporter itself. It bounds the destinations we hand a token for, which
    is the set that matters: an unowned namespace is unjudged here, and
    `pushSecret` shares the predicate, so `buildBuildkitJob` refuses it for want
    of a credential before any of it reaches `buildctl`.
- `pushSecret(repo, image)` — names `push-<namespace>` only for a namespace this
  repository publishes into. Takes both names on purpose: "which token does this
  image need" is not the question a build path answers, and the other one cannot
  be spelled here.
- `tagProblem(image)` — the name a first-party image publishes under names ONE
  build: a version (`vX.Y.Z`) or the commit it was built from, or a digest. ONE
  rule at every door, because what a caller may state at the direct enqueue and
  what a repository's `tag-pattern` may produce on a push are the same question.
  The direct door is TOLD (it stated the name); the delivery lane SKIPS that
  target and the push still succeeds, the same shape as `{{git.tag}}` on a branch
  push. `firstParty(image)` decides which images it is about — same table, same
  `parseImageRef` the credential uses, so a rule cannot accept a spelling the
  credential rejects.

Case is folded in exactly one place, `org()`, because the forge and the registry
both resolve a name without regard to case. Slugs are compared exactly: `Hanzo`
and `hanzo` are two tenants, and folding a comparison between principals is a
collision, not a normalization. `runnerPoolFor` is deliberately NOT this table —
it maps an owner to the ARC scale set builds run ON, which is capacity and can be
borrowed (`bootnode` builds on Hanzo's pool without being Hanzo).

A name absent from the table has no principal and no credential, so its builds
are refused rather than defaulted. Adding a brand is one line in `OWNS`, its
`push-<namespace>` KMS path, and an `organization` row carrying its slug.

**What a build is named by.** `build-scheduler` settles the repository AND the
commit for the whole call before either reaches a row — `repoOf` and `shaOf`,
side by side over `hanzo-git`'s `repoProblem`/`commitProblem`, so both front
doors and every future one get the same rule. A commit is named by a WHOLE
object id — 40 hex digits or 64 — folded lowercase so two spellings key one row.
That one value does all five jobs: it keys the row, names the target, addresses
`hanzo.yml` on the forge, spells the image tag, and IS the git context the pod
checks out. `dispatchBuild` takes it off the row (`launchBuildJob({commit:
job.sha})`) rather than from a second argument, so the commit a build was read
and checked at is the commit it compiles; `ref` keeps its one job, naming the
trigger on the row. A prefix is refused because it addresses one commit locally
and no commit over a fetch. Measured on a real Job against git.hanzo.ai: a
`#<sha>` fragment checks out that commit (non-shallow `fetch --tags`, `.git/HEAD`
== the sha), a `#refs/heads/main` fragment checks out the tip, and the two differ.

The tag is settled in `resolveTag`: `{{git.sha}}`, `{{git.branch}}` and
`{{git.tag}}` are all spelled in the docker tag alphabet (`[A-Za-z0-9._-]`), so
what comes out is a tag whatever the triggering context said — and `tagProblem`
then decides whether that tag names a build. `buildkit-job` writes the
destination as ONE quoted `name=` CSV field — one ref or two, one spelling —
which is what makes a ref list a value of the exporter rather than a way to add
fields to it. `destinations()` derives that list once, and `buildBuildkitJob`
judges every entry of it, so the second ref is judged by the same rule as the
first. `fleetRegistryHost()` reads `FLEET_REGISTRY_HOST` through the same
`registryProblem`, so the two ways to name a publish host cannot disagree.

**Load-bearing fact: the old patcher never fired.** All 1,439 `build_job` rows in
the live DB read `rolloutStatus: skipped` — `PLATFORM_FLEET_NAMESPACE_OWNERS` is
unset on the pod, so `fleetNamespaceOwners()` is empty and every fleet deploy was
refused. The bug was a loaded gun with the safety on by accident. Nothing froze
when this landed because nothing was flowing; the fleet deploys via `pin.sh` from
each service's CI.

**So a refusal is now ANNOUNCED, not merely recorded.** `promote.ts` logs every
`failed`/`smoke-failed` to stderr with the build id, the target and the reason —
and `authorizeNamespace`'s reason already names the variable that would fix an
unconfigured table. That refusal was always correct and always written down; it
went unnoticed across 1,439 builds because the only place it appeared was a
column nobody queried. Being right in private is how a deploy path stays dead for
months. `skipped` stays silent on purpose — a line that cries on every library
repo's build is a line everyone learns to scroll past.

**Two preconditions before promotion can work at all** — both intentionally
fail-closed until met: the `platform-app-smoke` Role (`pods: create,get,delete`,
`k8s/platform-rbac.yaml`) must be applied in the target namespace, and
`PLATFORM_FLEET_NAMESPACE_OWNERS` must name real org ids. No privilege, no
deploy — never no privilege, deploy anyway.

**The other gate, which is NOT this one.** `universe
charts/app/templates/e2e-gate.yaml` is a CD **PreSync** hook that boots the
candidate beside Playwright and refuses the sync if routes throw. It is a
different property (does it RENDER) at a different moment (before apply) and it
is opt-in — measured 2026-08: **1 of 124 values files sets `e2e.enabled`**. The
smoke here is universal and needs no per-app authoring. Keep both; they compose.

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

**organizationId today:** the platform DB carries `hanzo`, `lux` and `zoo`
(`organization.slug`), and `services/org` resolves a forge owner or registry
namespace to one of them. Only `hanzo` has members and only `hanzo` holds a
fleet namespace, so a `lux` or `zoo` build publishes into its own registry
namespace and promotes nowhere. Per-org scoping (`?org=`/`X-Org-Id`, the `org`
column) is wired throughout; the apps populator still assigns its rows to the
lone org that owns them.

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
- **The login UI is now IAM-only in fact, not just by convention.** The fork's
  own auth screens were deleted (2026-08): `pages/register.tsx`,
  `pages/{send-,}reset-password.tsx`, `components/auth/sign-in-with-{github,google}.tsx`,
  the enterprise duplicates, and `linking-account/`. The server configures no
  `emailAndPassword`, `emailVerification` or `socialProviders`, so all of them
  called endpoints that do not exist. `/register` was NOT unreachable —
  `pages/index.tsx` sent self-hosted first-run traffic to it, so the documented
  bootstrap was a form that could only fail. **There is no first-run admin
  bootstrap:** the first identity to sign in through IAM gets its home org and
  an `owner` membership from `syncIamOrgMembership`. Don't re-add one.
- `pages/invitation.tsx` accepts, it never registers. Signed-out visitors go to
  IAM and come back to the invitation via `startSignIn(returnTo)` /
  `consumeReturnTo()` in `lib/iam-browser.ts` (same-origin absolute paths only —
  it must never become an open redirect).
- **Better Auth is NOT gone.** It still hosts the `apiKey`, `organization`,
  `sso` and `admin` plugins and owns the `account`/`session`/`verification`
  tables. Remaining stages are in `IAM_MIGRATION.md`. Do not claim platform is
  "off Better Auth" — its login surface is gone; its plugin surface is not.
- Node 24 build: keep the pnpm override `nan: 2.27.0` (native deps `ssh2`/`node-pty` won't compile on Node 24 without it).

## One-way surfaces (things that were built twice)
Standing list of "one and only one way" repairs, so they are not re-split:
- **The `/v1` OpenAPI document** — `app/platform/server/api/openapi-document.ts`
  is the ONLY builder. It was assembled three times (the generate script, the
  `settings.getOpenApiDocument` tRPC procedure, the `SettingsMethod.getOpenApiDocument`
  ZAP cap), each with its own tag list, and they had drifted by 12 tags. The
  runtime copies also advertised `baseUrl = <host>/api`, which the app does not
  serve (the REST surface mounts at `/v1`), and titled themselves "tRPC OpenAPI".
- **`@hanzo/platform`'s export map** — `pkg/platform/scripts/exports-map.js` is
  the ONE table; `switchToSrc`/`switchToDist` only render it. They had drifted
  to 19 vs 4 entries. Bare directory imports need an explicit `<dir>/index`
  entry (the `./*` wildcard resolves them to a file no build emits); the
  regression test derives that requirement from the imports the workspace
  actually contains, so adding a new bare directory import fails the test.
- **The audit sink** — `server/api/utils/audit.ts` (DB-backed) is the only one.
  A second stdout-only `server/utils/audit.ts` existed, orphaned, waiting for an
  `auditLog` table that already exists.
- **`trpc-openapi`** — vendored at `pkg/platform/src/vendor/trpc-openapi`
  (MIT, upstream `dokploy/trpc-openapi` @ 0.0.17) and reached ONLY through
  `@hanzo/platform/openapi`. The `@dokploy/*` npm dependency is gone.

## Still dual: tRPC routers vs ZAP caps (the big one, NOT finished)
`app/platform/server/api/routers/*` (49 files, ~19.1k lines) and
`app/platform/server/zap/*-cap.ts` (53 files, ~24.3k lines) implement the same
operations twice. **ZAP is live** — `server/server.ts` registers 53 `serve()`
mounts on the same HTTP server as Next, and 44 UI files call `@/utils/zap-*`
clients — so `server/zap/` cannot be deleted. Nine caps have no router at all
(ai, cluster, destination, digitalocean, dns, doks, gateway, registry, k8s);
five routers have no cap (build-job, dedicated-cluster, libsql, server, tag).
**44 surfaces are dual-implemented right now.**

The duplication is in the request shell, not the domain logic: both sides call
the same `@hanzo/platform` service barrel. But ~40% of each file reaches past
the services straight to drizzle, and it is exactly that inline code that got
copy-pasted, which is why caps run 20-100% longer than their routers.

Two REGRESSIONS in the cap layer, to fix before deleting any router:
- caps decode input with `decodeArgs<any>` — the routers' zod `.input()`
  validation is simply gone.
- several caps record audit events as `console.info("[audit] …")` instead of
  calling `audit()`, so those actions write no `auditLog` row.

Convergence order that does not break anything: (1) push the inline `db.*` work
in each pair down into `pkg/platform/src/services/`, (2) restore zod validation
and real `audit()` calls in the caps, (3) only then retire the router and
repoint its UI call sites. `openapi.zap.json` (581 paths) replaces
`openapi.json` (407) when the last router goes.

## Docker/Swarm → cloud `/v1/platform` — SCOPED, deliberately not started

The Docker execution model (dockerode + ssh2 + `docker` CLI) is upstream's, and
the Go-native replacement is real and live. **The Go path is
`~/work/hanzo/cloud/apps/platform`** — NOT `clients/platform`, which was
renamed by `f873d1a18` and is still mis-cited in cloud's own Goa design file.

Measured, not estimated:

| | |
|---|---|
| Platform's Docker/SSH layer | 71 files, 22,508 lines, feeding 406 tRPC procedures + 55 caps |
| Cloud `/v1/platform` | 27 files, 11,750 lines of Go, **32 operations**, K8s-only (zero docker, zero ssh) |
| Capability parity | **6 equivalent / 7 partial / 12 absent** |
| Net-new Go to close the gap | ~10-17k lines — about the size of cloud's platform app again |

**The load-bearing fact: most of the Docker layer is already dead in
production.** The pod has no `/var/run/docker.sock` (`k8s/platform-statefulset.yaml`
mounts only `/app/data`), so those paths `ENOENT` in-cluster. Apps deploy by
`services/ci/deploy-executor.ts` patching an operator CR — the same CR, in the
same cluster, that cloud's `k8s.go` writes. That duplication is the one worth
collapsing first. Databases, backups, volume backups, terminals and compose
still route through Docker code that cannot run in the pod.

Order, if this is picked up:
1. Re-point `deploy-executor.ts` at `POST /v1/platform/projects/{p}/apps/{a}/deploy`
   behind a per-org flag. Both sides patch the same CR, so a mistake is a
   routing bug, not data loss. This is the only capability at full parity today.
2. Move the fleet/app READ surface onto `GET /v1/platform/fleet`.
3. Env + domains — cloud's env is KMS-sealed, which is a security upgrade over
   platform's plaintext-in-DB.

**Do NOT attempt yet**, each for its own reason:
- the SSH remote-server fleet (`setup/server-setup.ts` + friends, ~1,040 lines)
  manages VMs, not containers. Decide if that product survives before porting.
- managed databases — cloud has literally zero (`postgres|mysql|mongo|redis|mariadb`
  matches 0 files). ~9k lines here have no target. Platform's own
  `provisionDatastore`/`cr-builder.ts` already builds correct operator CRs and
  has NO production callers; wire that first.
- compose/stack — Swarm stacks have no faithful K8s translation. Product
  decision, not a port.
- removing `dockerode` from package.json — still the local-dev and
  SSH-attached-server path. Gate it, don't delete it.
- the WS terminals — the one thing that genuinely works over SSH, and
  `/v1/platform` has no streaming plane to receive them.

Note `USE_K8S_OPERATOR` appears only in COMMENTS — `process.env.USE_K8S_OPERATOR`
is read nowhere. It is not a feature flag; don't treat it as one.

Blocker to fix before coding against the contract: cloud's Goa design declares
17 methods while the implementation serves 32 (rollback, promote, preview, env,
domains, fleet are undeclared), and `design/gen/http/openapi3.json` is 0 bytes.

## Versioning — ONE line, `v4.x` (HIP-0111)
There is exactly one version line: **`v4.x`**. `app/platform/package.json`,
git tags, and the published `ghcr.io/hanzoai/platform` image tag are the SAME
string. Current: `v4.4.17`.

`v0.28.x` is DEAD. It was the upstream Dokploy app-string (author Mauricio Siu)
that the fork kept bumping out of habit; `v0.28.9` (#31) was the last one and is
an ancestor of `main`. Do not cut, tag, or publish `v0.28.x` again. The `v4.2.0`
/ `v4.2.1` tags were a short auth-branch snapshot taken before the
Postgres→SQLite merge (#29); their 7 auth commits (Better Auth on `/v1/auth`,
`signIn.oauth2`) are fully superseded by `main`'s IAM-PKCE flow (see Auth
section) — `main` is strictly ahead, nothing to back-merge.

Release = bump `app/platform/package.json` version and tag `main` HEAD with the
same string. No second numbering scheme, ever.

The workspace root `package.json` has no `version`, deliberately — a version
there would be the second numbering scheme. So anything reading a version reads
`app/platform/package.json` by path, never `./package.json` by working
directory: `node -p` prints the string `undefined` and exits 0 for a missing
field, which reads as success and names things `undefined`. That is where the
`vundefined` tag came from, via a `.github/workflows/deploy.yml` release step
whose `|| echo 0.0.0` fallback guarded the exit status instead of the value.

**One producer, and it is CI.** There are no local build/push scripts. Two of
them used to sit under `app/platform/docker/`, and one published
`hanzoai/platform:latest` — a name that moves, on a registry no rule here reaches,
from a laptop whose architecture is whatever it happens to be. Everything this
repo publishes is built by `.hanzo/workflows/deploy.yml` on the cluster's own
runners, for every architecture, under a name `services/org` judged.

**The IMAGE is not named after that tag, and deliberately so.** `.hanzo/workflows/
deploy.yml` builds `ghcr.io/hanzoai/platform:<full commit sha>` and nothing else:
a semver tag that gets re-pushed puts two digests behind one name, and under
`pullPolicy: IfNotPresent` a node keeps whichever it cached first — which is how
`v4.4.5` and `v4.4.6` each meant two different builds on 2026-07-25. A sha
cannot move. So the git tag is the human's version line and the sha is the
artifact's identity; they are different questions.

**Publishing and rolling are separate, and only publishing is automated.**
`deploy.yml` pushes the image and tells the cluster nothing. The rollout is the
universe pin — `charts/app/values/hanzo/platform-app.yaml`, `tag:` and `digest:`
moving together — which is the same edit `services/ci/pin.ts` performs for every
other service.

**Tags do not reach the build plane on their own.** `sync-from-github.yml` pulls
`refs/heads/main` and only that, so a `v*` tag pushed to GitHub never arrives at
git.hanzo.ai and never fires `cicd.yml`'s `tags: ['v*']` trigger. What builds a
release is the main commit carrying the bump.

The bump is the half that gets forgotten: `v4.4.14`, `v4.4.15` and `v4.4.16`
were all tagged while `package.json` still read `v4.4.12`, so the running app
under-reported itself by three releases. "The SAME string" is checkable — if the
tag and the file disagree, the file is wrong. Repaired at `v4.4.17`.

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
