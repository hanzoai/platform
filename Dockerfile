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
RUN pnpm --filter=./app/platform run build \
    && pnpm --filter=./app/platform --prod deploy --legacy /prod/out \
    && cp -R app/platform/.next /prod/out/.next \
    && cp -R app/platform/dist /prod/out/dist

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
