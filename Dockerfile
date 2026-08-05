# No `# syntax=` frontend pragma on purpose: it forces buildx to pull
# docker.io/docker/dockerfile:1 from Docker Hub, which the arcd runners cannot
# reliably resolve (DNS to registry-1.docker.io via 8.8.8.8 times out). buildx
# v0.34 / buildkit buildx-stable-1 supports `RUN --mount=type=cache` with the
# built-in frontend, so the external pull buys nothing and only adds a single
# point of failure. The node base below resolves through the mirror.gcr.io
# docker.io mirror configured in .github/buildkitd.toml.
#
# Platform — ONE Dockerfile. No base image, no variants. Build a target:
#   docker build --target platform  .   # app/platform + full PaaS runtime (docker, nixpacks, railpack, buildpacks, rclone)
#   docker build --target cloud     .   # app/platform, light runtime
#   docker build --target schedules .   # app/schedules cron worker
#   docker build --target api       .   # app/api server
#
FROM node:24.4.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

# ── Shared deps + native toolchain + workspace libs ───────────
FROM base AS deps
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y \
    python3 make g++ git python3-pip pkg-config libsecret-1-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY app/api/package.json ./app/api/
COPY app/platform/package.json ./app/platform/
COPY app/schedules/package.json ./app/schedules/
COPY pkg/platform/package.json ./pkg/platform/
COPY pkg/mcp/package.json ./pkg/mcp/
# --frozen-lockfile: exact tested graph (floating next ^16.1.6 -> 16.2.9 crashes
# the custom server). pnpm override nan:2.27.0 lets ssh2/node-pty compile on Node 24.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
RUN pnpm --filter=@hanzo/platform build && pnpm --filter=@hanzo/platform-server build

# ── Per-app build stages (each deploys a self-contained /prod/out) ──
FROM deps AS build-platform

# Publishable ingest key (pk-…) for @hanzo/event. WITHOUT it every LOGGED-OUT
# pageview, click and error from platform.hanzo.ai is refused by the edge with
# 401 ingest_key_required and dropped. That refusal is SILENT in the page — the
# site looks fine, ingest answers, and the only symptom is platform.hanzo.ai
# missing from the warehouse entirely. The code has always read it
# (app/platform/components/providers/analytics.tsx); it was simply never
# provisioned.
#
# It must be a BUILD ARG: Next inlines NEXT_PUBLIC_* into the client bundle at
# build time, so setting it on the pod (or in the StatefulSet env) is too late.
# Safe to ship in the bundle — pk- is ingest-only by construction, so it can
# write events and cannot read anything.
#
# EVENT_INGEST_KEY is the name in KMS (deploy/EVENT_INGEST_KEY, env prod) and on
# the --build-arg; NEXT_PUBLIC_ is added HERE because that prefix is what makes
# Next inline a var. The prefix is a property of this build, so it is applied in
# this build file and the secret store keeps the ONE plain name.
#
# This stage is the right home for it because it is the only place `next build`
# runs: BOTH shipped targets that serve the app (`platform` and `cloud`) COPY
# --from=build-platform, so one gate covers both and neither can ship unkeyed.
ARG EVENT_INGEST_KEY
ENV NEXT_PUBLIC_EVENT_INGEST_KEY=$EVENT_INGEST_KEY

# Fail closed, BEFORE the expensive build. An empty key builds, serves and looks
# correct while every anonymous event is dropped at the edge. Refuse the artifact
# instead — a missing image is loud, a keyless one is not.
RUN case "$EVENT_INGEST_KEY" in \
      pk-*) : ;; \
      '')   echo "EVENT_INGEST_KEY is empty - pass --build-arg EVENT_INGEST_KEY=<pk-...> (KMS deploy/EVENT_INGEST_KEY, env prod)" >&2; exit 1 ;; \
      *)    echo "EVENT_INGEST_KEY is not a publishable key (expected a pk- prefix)" >&2; exit 1 ;; \
    esac

RUN pnpm --filter=./app/platform run build \
    && pnpm --filter=./app/platform --prod deploy --legacy /prod/out \
    && cp -R app/platform/.next /prod/out/.next \
    && cp -R app/platform/dist /prod/out/dist

# Prove the key reached the CLIENT bundle. The ARG gate above proves it was
# supplied; this proves Next actually inlined it. A value present at build and
# absent from .next/static cannot reach a browser — which is how a fully green
# run ships a bundle that reports nothing. Checked on the COPY that ships
# (/prod/out/.next), so what is verified is what the runtime stages take.
RUN if [ -z "${NEXT_PUBLIC_EVENT_INGEST_KEY}" ]; then \
      echo "ERROR: NEXT_PUBLIC_EVENT_INGEST_KEY is empty after a successful build - the ARG gate should have caught this, so the ENV was cleared between the two." >&2; \
      exit 1; \
    elif grep -rqF "${NEXT_PUBLIC_EVENT_INGEST_KEY}" /prod/out/.next/static; then \
      echo ">> ingest key inlined into .next/static, verified"; \
    else \
      echo "ERROR: NEXT_PUBLIC_EVENT_INGEST_KEY was supplied but is NOT present in /prod/out/.next/static." >&2; \
      echo "       Next inlines NEXT_PUBLIC_* at build; a value absent from the client bundle cannot reach the browser." >&2; \
      echo "       Check that nothing re-declares it as an ARG after the ENV above - a build arg declared after an ENV of the same name shadows it." >&2; \
      exit 1; \
    fi

FROM deps AS build-schedules
RUN pnpm --filter=./app/schedules run build \
    && pnpm --filter=./app/schedules --prod deploy --legacy /prod/out \
    && cp -R app/schedules/dist /prod/out/dist

FROM deps AS build-api
RUN pnpm --filter=./app/api run build \
    && pnpm --filter=./app/api --prod deploy --legacy /prod/out \
    && cp -R app/api/dist /prod/out/dist

# ── Target: platform (full PaaS runtime) ──────────────────────
FROM base AS platform
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y \
    curl unzip zip apache2-utils iproute2 rsync git-lfs \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*
ARG DOCKER_VERSION=28.5.2
RUN ARCH=$(uname -m) && case "$ARCH" in x86_64) DARCH=x86_64;; aarch64) DARCH=aarch64;; *) DARCH=x86_64;; esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${DARCH}/docker-${DOCKER_VERSION}.tgz" \
       | tar xz --strip-components=1 -C /usr/local/bin docker/docker
RUN curl https://rclone.org/install.sh | bash
ARG NIXPACKS_VERSION=1.41.0
RUN curl -sSL https://nixpacks.com/install.sh -o /tmp/install-nixpacks.sh \
    && chmod +x /tmp/install-nixpacks.sh && /tmp/install-nixpacks.sh && rm /tmp/install-nixpacks.sh
RUN pnpm install -g tsx
ARG RAILPACK_VERSION=0.15.4
RUN curl -sSL https://railpack.com/install.sh | bash
COPY --from=buildpacksio/pack:0.39.1 /usr/local/bin/pack /usr/local/bin/pack
COPY --from=build-platform /prod/out ./
COPY .env.production ./.env
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fs http://localhost:3000/v1/trpc/settings.health || exit 1
# SQLite is embedded — no external Postgres to wait for (PR #29).
CMD ["sh", "-c", "exec pnpm start"]

# ── Target: cloud (light runtime) ─────────────────────────────
FROM base AS cloud
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y curl unzip apache2-utils && rm -rf /var/lib/apt/lists/*
RUN curl https://rclone.org/install.sh | bash && pnpm install -g tsx
COPY --from=build-platform /prod/out ./
EXPOSE 3000
CMD ["pnpm", "start"]

# ── Target: schedules ─────────────────────────────────────────
FROM base AS schedules
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build-schedules /prod/out ./
CMD ["pnpm", "start"]

# ── Target: api ───────────────────────────────────────────────
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build-api /prod/out ./
CMD ["pnpm", "start"]
