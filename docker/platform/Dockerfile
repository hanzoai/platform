# Stage 1: Dependencies
FROM hanzoai/os:latest AS deps
WORKDIR /app
ENV NODE_ENV=production

# Copy only the files that affect dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY pkg/platform/package.json pkg/platform/
COPY app/cloud/package.json app/cloud/

# Install dependencies with caching enabled
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Stage 2: Build Project
FROM deps AS build
WORKDIR /app
# Copy the rest of your source code
COPY . .

# Run your build commands
RUN pnpm --filter=@hanzo/platform build
RUN pnpm --filter=./app/cloud run build
RUN pnpm --filter=./app/cloud --legacy --prod deploy /app

# Stage 3: Final Runtime Image
FROM hanzoai/os:latest AS final
WORKDIR /app
ENV NODE_ENV=production

# Copy built production assets from the build stage
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/components.json ./components.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD ["pnpm", "start"]
