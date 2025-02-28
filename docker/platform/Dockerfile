# Stage 1: Dependencies
FROM hanzoai/os:latest AS deps
WORKDIR /usr/src/app
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
WORKDIR /usr/src/app

# Copy the rest of your source code
COPY . .

# Run your build commands
RUN pnpm --filter=@hanzo/platform build
RUN pnpm --filter=./app/cloud run build
RUN pnpm --filter=./app/cloud --legacy --prod deploy /hanzo

# Copy deployed production assets to a known location (/hanzo)
RUN cp -R /usr/src/app/app/cloud/.next /hanzo/.next && \
    cp -R /usr/src/app/app/cloud/dist /hanzo/dist

# Stage 3: Final Runtime Image
FROM hanzoai/os:latest AS final
WORKDIR /app
ENV NODE_ENV=production

# Copy only the built assets from the build stage
COPY --from=build /hanzo/.next ./.next
COPY --from=build /hanzo/dist ./dist
COPY --from=build /hanzo/next.config.mjs ./next.config.mjs
COPY --from=build /hanzo/public ./public
COPY --from=build /hanzo/package.json ./package.json
COPY --from=build /hanzo/drizzle ./drizzle
COPY --from=build /hanzo/components.json ./components.json
COPY --from=build /hanzo/node_modules ./node_modules

EXPOSE 3000

CMD ["pnpm", "start"]
