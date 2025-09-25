# Hanzo Platform - LLM Context

## Project Overview
Hanzo Platform is a self-hosted PaaS (Platform as a Service) solution for deploying applications, databases, and services. It provides a web interface for managing Docker containers, deployments, and infrastructure.

## Architecture

### Core Components
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS
- **Backend**: tRPC API, Drizzle ORM, PostgreSQL, Redis
- **Infrastructure**: Docker Swarm, Traefik (reverse proxy)
- **Queue System**: BullMQ for background jobs
- **Real-time**: WebSocket for logs and terminal access

### Project Structure
```
/home/z/platform/
├── app/
│   ├── hanzo/          # Main Next.js application
│   ├── api/            # API service
│   └── monitoring/     # Monitoring service
├── pkg/
│   ├── core/           # Core utilities (@hanzo/core)
│   ├── platform/       # Platform exports (@hanzo/platform)
│   ├── server/         # Server package (@hanzo/server)
│   ├── ui/             # UI components (@hanzo/ui)
│   ├── paas/           # PaaS utilities (@hanzo/paas)
│   └── mcp/            # MCP integration
├── docker/
│   ├── hanzo/          # Main Dockerfile
│   └── compose.prod.yml # Production deployment
└── Makefile            # Build and deployment automation
```

## Package Structure

### @hanzo/platform
Re-exports everything from @hanzo/core for consistency. Server files import from @hanzo/platform.

### @hanzo/core
Contains all core utilities, database schemas, Docker management, and shared logic.

### @hanzo/ui
UI components library with React 19 and Radix UI.

## Key Customizations

### Branding
- Logo: Simplified geometric SVG design
- Name: "Hanzo Platform" throughout
- Dark mode: Pure black sidebar (rgba(0,0,0,1))
- Help links: docs.hanzo.com

### Database
- PostgreSQL with database name: hanzo
- Redis service: hanzo-redis
- Network: hanzo-network

## Build & Deployment

### Development
```bash
make install        # Install dependencies
make build-dev      # Build locally
make dev           # Run dev server
make test          # Run tests
```

### Production
```bash
make build         # Build Docker image
make push          # Push to registry
make deploy        # Deploy with docker compose
```

### Docker
Single production Dockerfile at `docker/hanzo/Dockerfile`
Production compose at `docker/compose.prod.yml`

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `NODE_ENV`: production/development
- `SERVER_URL`: https://platform.hanzo.ai

## Services
- **hanzo-postgres**: PostgreSQL database
- **hanzo-redis**: Redis cache/queue
- **hanzo-traefik**: Reverse proxy with SSL
- **platform-hanzo**: Main application

## Network
All services run on `hanzo-network` Docker network.

## Testing
Tests located in `app/hanzo/__test__/`
Run with: `cd app/hanzo && pnpm test`

## Common Commands
```bash
make              # Build and test (default)
make build        # Build Docker image
make deploy       # Deploy to production
make logs         # View service logs
make status       # Check platform status
```

## Import Pattern
All server files should import from `@hanzo/platform` not `@hanzo/core` directly.

## Technologies
- Node.js 22+
- pnpm 10.5.2
- Next.js 15.5.4
- React 19 RC
- TypeScript 5.7
- Docker Swarm
- Traefik 3.0

## Production URL
https://platform.hanzo.ai

## Repository
Main branch for production deployments.

## Notes
- Always use pnpm for package management
- Docker images tagged as hanzoai/platform:latest
- Single way to do everything - avoid duplicating functionality