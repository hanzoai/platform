FROM node:18-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app


RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build only the hanzo app
RUN pnpm run hanzo:build 

# Deploy only the hanzo app
RUN pnpm deploy --filter=hanzo --prod /prod/hanzo

FROM base AS hanzo
COPY --from=build /prod/hanzo /prod/hanzo
WORKDIR /prod/hanzo
EXPOSE 3000
CMD [ "pnpm", "start" ]