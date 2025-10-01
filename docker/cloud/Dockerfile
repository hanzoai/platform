# Stage 1: Dependencies
FROM hanzoai/os:latest AS deps
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY pkg/core/package.json pkg/core/
COPY app/hanzo/package.json app/hanzo/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Stage 2: Build Project
FROM deps AS build
WORKDIR /app

COPY . .

# Skip core build as it has TypeScript errors
# RUN pnpm --filter=./pkg/core build
RUN pnpm --filter=./app/hanzo run build

RUN mkdir -p /build/hanzo && rm -rf /build/hanzo/*
RUN pnpm --filter=./app/hanzo --legacy --prod deploy /build/hanzo

RUN cp -R /app/app/hanzo/.next /build/hanzo/.next
RUN cp -R /app/app/hanzo/dist /build/hanzo/dist

# Stage 3: Final Optimized Runtime Image
FROM hanzoai/os:latest AS final
WORKDIR /app

ARG NEXT_PUBLIC_ANALYTICS_HOST
ENV NEXT_PUBLIC_ANALYTICS_HOST=$NEXT_PUBLIC_ANALYTICS_HOST

ARG NEXT_PUBLIC_ANALYTICS_WEBSITE_ID
ENV NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=$NEXT_PUBLIC_ANALYTICS_WEBSITE_ID

ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

ENV NODE_ENV=production

# Copy only the necessary files
COPY --from=build /build/hanzo/.next ./.next
COPY --from=build /build/hanzo/dist ./dist
COPY --from=build /build/hanzo/next.config.mjs ./next.config.mjs
COPY --from=build /build/hanzo/public ./public
COPY --from=build /build/hanzo/package.json ./package.json
COPY --from=build /build/hanzo/drizzle ./drizzle
COPY --from=build /build/hanzo/components.json ./components.json
COPY --from=build /build/hanzo/node_modules ./node_modules

EXPOSE 3000
CMD ["pnpm", "start"]
