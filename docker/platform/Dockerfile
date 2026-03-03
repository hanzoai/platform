# Stage 1: Dependencies
FROM hanzoai/os:latest AS deps
WORKDIR /app
ENV NODE_ENV=production

# Copy only files that affect dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY pkg/platform/package.json pkg/platform/
COPY app/cloud/package.json app/cloud/

# Install dependencies with caching enabled
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Stage 2: Build Project
FROM deps AS build
WORKDIR /app

# Copy the entire workspace to preserve the original layout
COPY . .

# Run build commands:
# 1. Build the platform package
RUN pnpm --filter=@hanzo/platform build
# 2. Build the cloud (Next.js) app
RUN pnpm --filter=./app/cloud run build

# Deploy production assets for the cloud app:
# Create a dedicated folder inside the cloud app directory for production assets
RUN mkdir -p app/cloud/build && rm -rf app/cloud/build/*
# Deploy production assets into app/cloud/build
RUN pnpm --filter=./app/cloud --legacy --prod deploy app/cloud/build

# Stage 3: Final Runtime Image
FROM hanzoai/os:latest AS final
WORKDIR /app
ENV NODE_ENV=production

# Copy the entire workspace from the build stage, preserving the layout
COPY --from=build /app .

EXPOSE 3000
CMD ["pnpm", "start"]
