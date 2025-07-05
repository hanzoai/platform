# Hanzo Platform Analysis & Setup Guide

## Overview

Hanzo Platform is a fork/customization of Dokploy (an open-source PaaS alternative to Vercel/Heroku/Netlify) with significant branding changes and some functional modifications. The core functionality remains largely the same, but all references to "Dokploy" have been replaced with "Hanzo".

## Key Differences from Dokploy

### 1. Branding Changes
- All "Dokploy" references replaced with "Hanzo" throughout the codebase
- Logo and visual assets updated to Hanzo branding
- Package names changed from `@dokploy/*` to `@hanzo/*`
- Docker images use `hanzoai/*` instead of `dokploy/*`

### 2. Structural Differences
- Main app is in `/app/hanzo` instead of `/apps/dokploy`
- Core functionality extracted to `/pkg/core` package
- Additional packages in `/pkg/*` directory structure
- Different monorepo structure using pnpm workspaces

### 3. Installation Script
- Uses `https://hanzo.sh` instead of Dokploy's installation URL
- Custom setup process via `setup.ts` that initializes:
  - Docker Swarm
  - Traefik (reverse proxy)
  - PostgreSQL database
  - Redis cache
  - Network configuration

### 4. Docker Images
- Base image: `hanzoai/os:latest` (custom base image)
- Platform image: `hanzoai/platform:latest`
- Multi-stage Docker build process

## Local Development Setup

### Prerequisites
- Node.js 22+ 
- pnpm 10+
- Docker and Docker Compose
- PostgreSQL (or use Docker)
- Redis (or use Docker)

### Setup Steps

1. **Clone and Install Dependencies**
   ```bash
   cd /Users/z/work/hanzo/platform
   pnpm install
   ```

2. **Environment Configuration**
   ```bash
   # Copy example environment file
   cp app/hanzo/.env.example app/hanzo/.env
   
   # Update the .env file with your local configuration:
   # DATABASE_URL="postgres://hanzo:password@localhost:5432/hanzo"
   # PORT=3000
   # NODE_ENV=development
   ```

3. **Database Setup**
   
   Option A: Use local PostgreSQL
   ```bash
   # Create database and user
   createdb hanzo
   createuser hanzo
   # Set password for hanzo user
   ```
   
   Option B: Use Docker
   ```bash
   docker run -d \
     --name hanzo-postgres \
     -e POSTGRES_USER=hanzo \
     -e POSTGRES_PASSWORD=amukds4wi9001583845717ad2 \
     -e POSTGRES_DB=hanzo \
     -p 5432:5432 \
     postgres:16
   ```

4. **Redis Setup**
   ```bash
   docker run -d \
     --name hanzo-redis \
     -p 6379:6379 \
     redis:7-alpine
   ```

5. **Run Setup Script**
   ```bash
   # This initializes the platform components
   pnpm hanzo:setup
   ```

6. **Run Database Migrations**
   ```bash
   cd app/hanzo
   pnpm run migration:run
   ```

7. **Start Development Server**
   ```bash
   # From root directory
   pnpm hanzo:dev
   
   # Or with Turbopack (faster)
   pnpm hanzo:dev:turbopack
   ```

   The platform should now be accessible at `http://localhost:3000`

## Docker Deployment

### Build Docker Image
```bash
# Build production image
./docker/build.sh production

# Or build canary image
./docker/build.sh canary
```

### Run with Docker Compose

Create a `docker-compose.yml`:
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: hanzo
      POSTGRES_PASSWORD: your_secure_password
      POSTGRES_DB: hanzo
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - hanzo-network

  redis:
    image: redis:7-alpine
    networks:
      - hanzo-network

  hanzo:
    image: hanzoai/platform:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://hanzo:your_secure_password@postgres:5432/hanzo
      REDIS_URL: redis://redis:6379
      NODE_ENV: production
    depends_on:
      - postgres
      - redis
    networks:
      - hanzo-network
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

volumes:
  postgres_data:

networks:
  hanzo-network:
    external: true
```

Then run:
```bash
# Create network
docker network create hanzo-network

# Start services
docker compose up -d
```

## Key Components

### 1. Core Package (`/pkg/core`)
- Authentication schemas
- Docker utilities
- Setup scripts for infrastructure
- Shared types and utilities

### 2. Main Application (`/app/hanzo`)
- Next.js application
- tRPC API endpoints
- UI components
- Database models (Drizzle ORM)
- Docker management
- Application deployment logic

### 3. Templates (`/app/hanzo/templates`)
- Pre-configured docker-compose templates for popular applications
- Examples: Stirling PDF, GLPI, Penpot, Trilium, etc.

### 4. Infrastructure Services
- **Traefik**: Reverse proxy and load balancer
- **PostgreSQL**: Main database with pgvector support
- **Redis**: Caching and queue management (BullMQ)
- **Docker Swarm**: Container orchestration

## API and CLI

The platform exposes:
- REST API via tRPC OpenAPI
- WebSocket connections for real-time updates
- CLI tool for remote management (similar to Dokploy CLI)

## Development Commands

```bash
# Core package
pnpm core:dev        # Watch mode for core package
pnpm core:build      # Build core package

# Main app
pnpm hanzo:dev       # Start dev server
pnpm hanzo:build     # Build for production
pnpm hanzo:start     # Start production server

# Database
pnpm --filter=hanzo run studio     # Drizzle Studio (DB GUI)
pnpm --filter=hanzo run db:push    # Push schema changes
pnpm --filter=hanzo run db:seed    # Seed database

# Docker
pnpm docker:build:platform  # Build platform image
pnpm docker:build:base      # Build base OS image

# Code quality
pnpm check           # Run Biome checks
pnpm typecheck       # TypeScript type checking
```

## Production Deployment

For production deployment on a VPS:
```bash
curl -sL https://hanzo.sh | sh
```

This script will:
1. Install Docker if not present
2. Set up Docker Swarm
3. Deploy Hanzo Platform
4. Configure Traefik for SSL/routing
5. Set up PostgreSQL and Redis

## Architecture Notes

- Uses Docker Swarm for orchestration (not Kubernetes)
- Traefik handles SSL certificates via Let's Encrypt
- Multi-tenant architecture with project isolation
- Supports multiple deployment types:
  - Static sites
  - Node.js applications  
  - Docker containers
  - Docker Compose stacks
  - Pre-built templates

## Monitoring & Observability

The platform includes monitoring setup for:
- Container metrics
- Application logs
- Resource usage tracking
- Health checks