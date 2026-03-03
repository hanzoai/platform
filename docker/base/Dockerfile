FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install latest pnpm globally
RUN npm uninstall -g pnpm || true && npm install -g pnpm@10.5.2

# Enable Corepack and prepare the desired pnpm version
RUN corepack enable && \
    corepack prepare pnpm@10.5.2 --activate

# Install essential system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      unzip \
      apache2-utils \
      python3 \
      python3-pip \
      git \
      make \
      g++ \
      pkg-config \
      libsecret-1-dev \
      iproute2 && \
    rm -rf /var/lib/apt/lists/*

# Install Docker and Rclone
RUN curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh && rm get-docker.sh && \
    curl https://rclone.org/install.sh | bash

# Install Nixpacks and tsx
ARG NIXPACKS_VERSION=1.29.1
RUN curl -sSL https://nixpacks.com/install.sh -o install.sh && \
    chmod +x install.sh && \
    ./install.sh && \
    pnpm install -g tsx

# Install buildpacks
COPY --from=buildpacksio/pack:0.35.0 /usr/local/bin/pack /usr/local/bin/pack

# Verify versions
RUN node --version && pnpm --version && python3 --version
