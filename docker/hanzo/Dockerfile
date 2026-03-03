# Stage 1: Dependencies
FROM hanzoai/os:latest AS deps
WORKDIR /app
ENV NODE_ENV=production

# Copy only files that affect dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY pkg/core/package.json pkg/core/
COPY app/hanzo/package.json app/hanzo/

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
RUN pnpm --filter=@hanzo/core build
# 2. Build the Next.js app
RUN pnpm --filter=./app/hanzo run build

# Deploy production assets for app:
RUN mkdir -p app/hanzo/build && rm -rf app/hanzo/build/*
# Deploy production assets into app/hanzo/build
RUN pnpm --filter=./app/hanzo --legacy --prod deploy app/hanzo/build

# Stage 3: Final Runtime Image
FROM hanzoai/os:latest AS final
WORKDIR /app
ENV NODE_ENV=production

# Copy the entire workspace from the build stage, preserving the layout
COPY --from=build /app .

EXPOSE 3000
CMD ["pnpm", "start"]
