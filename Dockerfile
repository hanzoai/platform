# syntax=docker/dockerfile:1
#
# Platform — uses pre-built base image for sub-2-minute builds.
# System tools are in ghcr.io/hanzoai/platform:base (see Dockerfile.base).
#
ARG PLATFORM_BASE_IMAGE=ghcr.io/hanzoai/platform:base

FROM node:24.4.0-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@10.22.0 --activate

# ── Build stage ───────────────────────────────────────────────
FROM base AS build
WORKDIR /usr/src/app

# System deps for native modules (cached unless base image changes)
RUN apt-get update && apt-get install -y python3 make g++ git python3-pip pkg-config libsecret-1-dev && rm -rf /var/lib/apt/lists/*

# Copy only package manifests first (cached unless deps change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY app/api/package.json ./app/api/
COPY app/platform/package.json ./app/platform/
COPY app/schedules/package.json ./app/schedules/
COPY pkg/platform/package.json ./pkg/platform/
COPY pkg/mcp/package.json ./pkg/mcp/

# Install dependencies (cached unless package.json or lockfile changes).
# --frozen-lockfile pins the exact, tested dependency graph from pnpm-lock.yaml.
# Without it (--no-frozen-lockfile), pnpm floats caret ranges to the latest
# matching release at build time: that silently bumped next ^16.1.6 -> 16.2.9,
# whose setupFsCheck reads routesManifest.onMatchHeaders.map() and crashes the
# custom server when the build omits that manifest field. Honor the lockfile.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Now copy source code (this layer rebuilds on any source change)
COPY . .

# Build platform
ENV NODE_ENV=production
RUN pnpm --filter=@hanzo/platform build
RUN pnpm --filter=./app/platform run build

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter=./app/platform --prod deploy --legacy /prod/platform

RUN cp -R /usr/src/app/app/platform/.next /prod/platform/.next
RUN cp -R /usr/src/app/app/platform/dist /prod/platform/dist

# ── Production (pre-built base with all system tools) ─────────
FROM ${PLATFORM_BASE_IMAGE} AS platform
WORKDIR /app

# Copy only the necessary files
COPY --from=build /prod/platform/.next ./.next
COPY --from=build /prod/platform/dist ./dist
COPY --from=build /prod/platform/next.config.mjs ./next.config.mjs
COPY --from=build /prod/platform/public ./public
COPY --from=build /prod/platform/package.json ./package.json
COPY --from=build /prod/platform/drizzle ./drizzle
COPY .env.production ./.env
COPY --from=build /prod/platform/components.json ./components.json
COPY --from=build /prod/platform/node_modules ./node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fs http://localhost:3000/api/trpc/settings.health || exit 1

CMD ["sh", "-c", "exec pnpm start"]
