FROM node:22-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install latest pnpm globally
RUN npm uninstall -g pnpm || true && npm install -g pnpm@10.5.2

# Enable Corepack and prepare the desired pnpm version
RUN corepack enable && \
    corepack prepare pnpm@10.5.2 --activate

# Install system dependencies, including Python, pip, git, and common build tools
RUN apt-get update && \
    apt-get install -y \
      curl \
      unzip \
      apache2-utils \
      python3 \
      python3-pip \
      git \
      make \
      g++ \
      pkg-config \
      libsecret-1-dev && \
      docker.io && \
    rm -rf /var/lib/apt/lists/*

# Install global tools
RUN curl -fsSL https://rclone.org/install.sh | bash && \
    pnpm install -g tsx

# Verify versions
RUN node --version && pnpm --version && python3 --version
