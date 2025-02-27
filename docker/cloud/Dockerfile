FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /usr/src/app
COPY . .

RUN apt-get update && \
    apt-get install -y python3 make g++ git python3-pip pkg-config libsecret-1-dev && \
    rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter=@hanzo/platform --filter=./app/cloud install --frozen-lockfile

ARG NEXT_PUBLIC_ANALYTICS_HOST
ENV NEXT_PUBLIC_ANALYTICS_HOST=$NEXT_PUBLIC_ANALYTICS_HOST
ARG NEXT_PUBLIC_ANALYTICS_WEBSITE_ID
ENV NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=$NEXT_PUBLIC_ANALYTICS_WEBSITE_ID
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

ENV NODE_ENV=production
RUN pnpm --filter=@hanzo/platform build
RUN pnpm --filter=./app/cloud run build
RUN pnpm --filter=./app/cloud --prod deploy /hanzo

FROM base AS hanzo
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && \
    apt-get install -y curl unzip apache2-utils && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /hanzo/.next ./.next
COPY --from=build /hanzo/dist ./dist
COPY --from=build /hanzo/next.config.mjs ./next.config.mjs
COPY --from=build /hanzo/public ./public
COPY --from=build /hanzo/package.json ./package.json
COPY --from=build /hanzo/drizzle ./drizzle
COPY --from=build /hanzo/components.json ./components.json
COPY --from=build /hanzo/node_modules ./node_modules

RUN curl https://rclone.org/install.sh | bash
RUN pnpm install -g tsx

EXPOSE 3000
CMD ["pnpm", "start"]
