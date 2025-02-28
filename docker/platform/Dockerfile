FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && \
    corepack prepare pnpm@10.5.2 --activate

# Dependencies stage – only files that affect dependency resolution
FROM base AS deps
WORKDIR /usr/src/app

# Copy the root manifest and lockfiles, plus workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY pkg/platform/package.json pkg/platform/
COPY app/cloud/package.json app/cloud/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build stage – copy the remainder and perform your build tasks
FROM deps AS build
WORKDIR /usr/src/app
COPY . .
RUN apt-get update && \
    apt-get install -y python3 make g++ git python3-pip pkg-config libsecret-1-dev && \
    rm -rf /var/lib/apt/lists/*

# Build each workspace as needed
RUN pnpm --filter=@hanzo/platform build
RUN pnpm --filter=./app/cloud run build
RUN pnpm --filter=./app/cloud --legacy --prod deploy /hanzo

# Copy the deployed production assets from the cloud app
RUN cp -R /usr/src/app/app/cloud/.next /hanzo/.next && \
    cp -R /usr/src/app/app/cloud/dist /hanzo/dist

# Final runtime image
FROM base AS hanzo
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && \
    apt-get install -y curl unzip apache2-utils && \
    rm -rf /var/lib/apt/lists/*

# Copy only the built assets from the build stage
COPY --from=build /hanzo/.next ./.next
COPY --from=build /hanzo/dist ./dist
COPY --from=build /hanzo/next.config.mjs ./next.config.mjs
COPY --from=build /hanzo/public ./public
COPY --from=build /hanzo/package.json ./package.json
COPY --from=build /hanzo/drizzle ./drizzle
COPY --from=build /hanzo/components.json ./components.json
COPY --from=build /hanzo/node_modules ./node_modules

RUN curl https://rclone.org/install.sh | bash && \
    pnpm install -g tsx

EXPOSE 3000
CMD ["pnpm", "start"]
