# Hanzo PaaS - Architecture Guide

## Overview
Hanzo PaaS is a platform-as-a-service built on Kubernetes. It provides per-org DOKS (DigitalOcean Kubernetes Service) clusters with fleet management, unified IAM via hanzo.id, KMS-managed secrets via kms.hanzo.ai, and a React-based management UI.

## Repository Structure
```
paas/
├── platform/          # Node.js/Express API backend
│   ├── server.js      # Entry point, route wiring
│   ├── routes/        # Express routers
│   │   ├── provisioner.js  # DOKS cluster lifecycle API
│   │   ├── organization.js # Org CRUD
│   │   └── ...
│   ├── handlers/      # Business logic
│   │   ├── provisioner.js  # DigitalOcean API wrapper
│   │   └── ...
│   ├── controllers/   # MongoDB model controllers (BaseController pattern)
│   ├── schemas/       # Mongoose schemas (organization.js has `doks` embedded doc)
│   └── config/        # JSON config (node-config)
├── platform-ui/       # React/Vite frontend (was "studio")
│   ├── src/
│   │   ├── pages/organization/  # Org pages including cluster management
│   │   ├── services/ClusterService.ts  # DOKS API client
│   │   ├── router/router.tsx    # React Router config
│   │   └── store/               # Zustand stores
│   └── index.html
├── hanzo-values.yaml  # Helm values override for K8s deployment
└── .github/workflows/deploy.yml  # CI: multi-arch Docker build + K8s deploy
```

## Key Architecture Decisions

### Per-Org DOKS Clusters
Each IAM organization gets its own isolated DOKS cluster (5 max per DO account):
- **hanzo-k8s** (1a153000): 9 nodes s-4vcpu-8gb - control plane cluster
- **lux-k8s** (04c46df5): 3 nodes s-8vcpu-16gb-amd
- **pars-k8s** (968f8325): 2 nodes s-2vcpu-4gb
- **bootnode-k8s** (2ae8f8bb): 2 nodes s-2vcpu-4gb
- **adnexus-k8s** (cc108040): 2 nodes s-2vcpu-4gb

Zoo was merged into Lux (no separate cluster needed).

### KMS Secret Management
All secrets are managed via kms.hanzo.ai (Infisical fork):
- **KMS Operator** (`ghcr.io/hanzoai/kms-operator`): Deployed in every DOKS cluster
  - CRD API group: `secrets.lux.network/v1alpha1`
  - CRDs: KMSSecret, KMSPushSecret, KMSDynamicSecret
  - Source: github.com/hanzoai/kms-operator
- **Per-cluster KMS projects**: Each cluster has its own project in KMS
  - hanzo-k8s: `hanzo-k8s-epiq` (72 secrets)
  - lux-k8s: `lux-k8s-5iao` (24 secrets)
  - pars-k8s: `pars-k8s` (3 secrets)
  - bootnode-k8s: `bootnode-k8s` (3 secrets)
  - adnexus-k8s: `adnexus-k8s` (3 secrets)
- **Shared credentials**: `credentials-7xgf` project synced to all clusters (14 secrets)
- **Auth**: universalAuth with clientId/clientSecret stored in `universal-auth-credentials` K8s secret
- **K8s secrets synced**:
  - `platform-secrets` in `hanzo` namespace (per-cluster config)
  - `shared-credentials` in `hanzo` namespace (shared across fleet)
- **KMS Admin**: z@hanzo.ai

### Authentication
- Unified IAM via hanzo.id (Casdoor fork)
- OAuth2 flow: platform → hanzo.id/login/oauth/authorize → callback → token exchange
- Client ID: `hanzo-platform-client-id`
- Landing page at `/` for unauthenticated users

### Database
- MongoDB at `mongodb.hanzo.svc.cluster.local:27017`
- Database: `test`, auth: `root` / from CLUSTER_DB_PWD secret
- Organization schema has embedded `doks` document for cluster state

### API Routes
- `/v1/cluster/doks/fleet` - Fleet overview (all org clusters)
- `/v1/cluster/doks/options` - Available regions and node sizes
- `/v1/cluster/doks/pricing/:sizeSlug` - Droplet pricing
- `/v1/cluster/doks/provision` - Create new DOKS cluster
- `/v1/cluster/doks/:orgId/status` - Cluster status (polls DO API)
- `/v1/cluster/doks/:orgId/kubeconfig` - Download kubeconfig
- `/v1/cluster/doks/:orgId/node-pools` - Node pool CRUD
- `/v1/cluster/doks/:orgId/upgrade-ha` - HA upgrade ($40/mo)
- `/v1/cluster/doks/:orgId` DELETE - Destroy cluster (requires ?confirm=true)

### Environment Variables (platform deployment)
- `DO_API_TOKEN` - DigitalOcean API token (in platform-secrets)
- `OAUTH_URL`, `IAM_ENDPOINT` - hanzo.id endpoints
- `CLUSTER_DB_URI`, `CLUSTER_DB_USER`, `CLUSTER_DB_PWD` - MongoDB

### CI/CD
- GitHub Actions: builds multi-arch Docker images (linux/amd64,linux/arm64)
- Pushes to GHCR: `ghcr.io/hanzoai/paas-api`, `ghcr.io/hanzoai/paas-ui`
- Deploys to hanzo-k8s via kubectl

### K8s Deployment Names
- `platform` - API backend
- `studio` - UI frontend (kept for K8s compat, dir is platform-ui)
- `sync`, `monitor`, `hanzo-webhook` - supporting services

## Common Patterns
- Controllers extend BaseController with `getOneById`, `updateOneById`, `getManyByQuery`
- Routes use `authSession` middleware for auth
- Frontend uses `@loadable/component` for code splitting
- Zustand for state management, React Query for data fetching
- Tailwind CSS with custom design tokens (text-default, text-subtle, bg-base-800, etc.)
- White-label ready: no hardcoded branding, use env vars for brand/colors/logo

## PaaS v2 Job Workers (packages/jobs/)

### Queue Architecture
- BullMQ (to be replaced with @hanzo/mq) connected to Valkey via KV_URL env var
- Four queues defined in `queues.ts`: build, deploy, provision, monitor
- Connection parsed from KV_URL (redis-compatible)

### Workers
- **build** (`workers/build.ts`): Full build->push->deploy pipeline. Resolves cluster type from DB, delegates to orchestrator.triggerBuild(), polls until terminal, then updateContainer() with the new image. Status lifecycle: queued->building->pushing->deploying->running/failed. Logs streamed to deployment.buildLogs.
- **deploy** (`workers/deploy.ts`): Standalone create/update container. Constructs ContainerSpec from DB record, calls orchestrator.createContainer() or updateContainer(). Updates container.pipelineStatus.
- **monitor** (`workers/monitor.ts`): Repeatable every 30s via upsertJobScheduler. Polls getContainerStatus() for all active containers grouped by cluster. Caches orchestrator instances. Writes status JSONB to containers table.

### Entry Point
`startWorkers()` in `index.ts` creates all three workers and registers the monitor schedule. Returns `{ close() }` for graceful shutdown.

## MongoDB -> PostgreSQL Migration (scripts/migrate-mongo-to-pg.ts)

### Prerequisites
`pnpm add -w mongodb @paralleldrive/cuid2 postgres`

### Design
- Standalone tsx script, no Mongoose dependency (uses raw mongodb driver)
- Maps ObjectId -> cuid2 via in-memory idMap (preserves referential integrity)
- Migrates 14 entity types in dependency order: users, organizations, org_members, projects, project_members, environments, clusters, registries, git_providers, containers, deployments, domains, audit_logs, invitations
- Embedded arrays extracted: project.team -> project_members, org/project invitations -> unified invitations table
- Container sub-docs (networking, podConfig, probes, etc.) transformed and normalized (e.g., cpu cores->millicores, memory gibibyte->mebibyte)
- Registry provider-specific fields (ecr, acr, gcp, generic) merged into single credentials JSONB
- Wrapped in a single PG transaction with rollback on error
- --dry-run flag skips all PG writes
- Progress bars per table

## ZeroTrust Tunnel Infrastructure (hanzo-zt namespace on hanzo-k8s)

### Components
- **hanzo-zt-controller**: OpenZiti controller at `zt-api.hanzo.ai:443` (edge mgmt API, ctrl on port 1280)
- **hanzo-zt-router**: OpenZiti edge router (port 3022)
- **hanzo-zt-console**: ZiTi admin console at `ztc.hanzo.ai`
- **zrok-controller**: zrok v2 overlay at `zrok.hanzo.ai` (port 18080, admin secret: `zrok-hanzo-admin-7f3a9c2e1b4d`)
- **hanzo-zt-mcp-gateway**: MCP tool gateway over ZT mesh (uses zrok enable token `vHeXX2fewUw7`)
- Custom `zrok2` binary: `ghcr.io/hanzoai/zrok:latest` (linux/amd64 only, runs as `zrok2`)

### Tunnel Scripts (scripts/)
- `zt-tunnel.sh dev`: Port-forwards hanzo-k8s ZT services locally
- `zt-tunnel.sh expose`: Creates cloudflared quick-tunnel for local PaaS
- `zt-tunnel.sh full`: Both port-forward and cloudflared

### E2E Testing (scripts/)
- `seed.ts`: Inserts test user, org, project, env, session into PostgreSQL
- `e2e-test.sh`: Full E2E test suite (infra check, compose up, db push, seed, build, start, API tests, cluster registration, container deployment on k3d + Docker Swarm, cleanup)
- `test-orchestrators.ts`: Low-level orchestrator adapter tests (k3d + Docker Swarm)

## Build Notes
- `lib/trpc.tsx` (renamed from .ts) contains JSX, must have .tsx extension
- `next.config.ts` needs `outputFileTracingRoot` for pnpm workspace, and `asset/resource` rule for `.node` binaries
- `DATABASE_URL` must be set for build (Next.js evaluates auth routes at build time)
- `serverExternalPackages` includes: @kubernetes/client-node, dockerode, docker-modem, ssh2, cpu-features, @octokit/core
- `@paas/db` depends on `@paas/shared` (workspace dep for shared types)
- `@paas/api` depends on `@paralleldrive/cuid2` (direct dep for container ID generation)

## Known Issues
- K8s deployment name still "studio" (intentionally kept to avoid disruption)
- DO cluster limit is 5 per account (request increase via DO support ticket)
- ghcr.io/hanzoai/kms-operator package is private (needs visibility change via GitHub UI)
- KMS operator CRD API group is `secrets.lux.network` (Lux white-label of Hanzo KMS)
- zrok2 binary is linux/amd64 only; on macOS ARM use cloudflared quick-tunnel instead
- DockerOrchestrator: `TaskSpec.ContainerSpec` needs `as any` cast (dockerode union type)
- K8s Log API: 4th param is Writable stream, not options object (use PassThrough + options in 5th param)
