# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Initial Setup
```bash
cp app/hanzo/.env.example app/hanzo/.env
pnpm install
pnpm run hanzo:setup  # Sets up directories, Docker networks, Traefik, Redis, PostgreSQL
pnpm run core:script  # Switch core package to development mode
pnpm run hanzo:dev    # Start development server on http://localhost:3000
```

### Development
- `pnpm run hanzo:dev` - Start development server on http://localhost:3000
- `pnpm run hanzo:dev:turbopack` - Start development server with Turbopack
- `pnpm run core:dev` - Build core package for development
- `pnpm run core:script` - Switch core package between src/dist modes

### Build & Production
- `pnpm run hanzo:build` - Build server and Next.js application
- `pnpm run hanzo:start` - Start production server
- `pnpm run build` - Build all workspace packages
- `pnpm run docker:build:production` - Build production Docker image
- `pnpm run docker:build:canary` - Build canary Docker image
- `pnpm run docker:build:platform` - Build and push platform image

### Code Quality
- `pnpm run check` - Run Biome linter and formatter (auto-fix)
- `pnpm run typecheck` - Run TypeScript type checking across all packages
- `pnpm run test` - Run Vitest tests in app/hanzo/__test__/

### Database Management
- `pnpm run migration:generate` - Generate new Drizzle migration
- `pnpm run migration:run` - Run pending migrations
- `pnpm run db:studio` - Open Drizzle Studio GUI at http://localhost:4983
- `pnpm run db:seed` - Seed database with test data
- `pnpm run db:clean` - Truncate all tables
- `pnpm run db:push` - Push schema changes directly (dev only)
- `pnpm run reset-password` - Reset user password via CLI

### Testing
- Run all tests: `cd app/hanzo && pnpm vitest run`
- Run specific test: `cd app/hanzo && pnpm vitest run compose.test.ts`
- Watch mode: `cd app/hanzo && pnpm vitest watch`
- Test files are in `app/hanzo/__test__/`

## Architecture

### Project Structure
Hanzo Platform is a monorepo using pnpm workspaces with the following structure:

- **app/** - Applications
  - **hanzo/** - Main Next.js application with tRPC API
  - **api/** - API service
  - **monitoring/** - Monitoring service
  - **schedules/** - Scheduled tasks service
- **pkg/** - Shared packages
  - **core/** - Core utilities, database schemas, and shared logic
- **docker/** - Docker configurations for different environments

### Tech Stack
- **Frontend**: Next.js 15, React 18, Tailwind CSS, Radix UI components
- **Backend**: tRPC, Drizzle ORM, PostgreSQL, BullMQ for job queues
- **Infrastructure**: Docker, Traefik for routing, support for various deployment methods
- **Authentication**: Better Auth with Lucia adapter
- **Real-time**: WebSockets using ws library, terminal emulation with xterm.js

### Key Architectural Decisions

1. **Database Layer**: Uses Drizzle ORM with PostgreSQL. Schema definitions are in `pkg/core/src/db/` and migrations in `app/hanzo/drizzle/`. The core package exports schemas that are shared across services.

2. **API Structure**: tRPC routers in `app/hanzo/server/api/routers/` provide type-safe APIs. Main router aggregation happens in `app/hanzo/server/api/root.ts`. Available routers include: application, docker, deployment, database services (postgres, mysql, mongo, redis, mariadb), domains, backups, certificates, notifications, and more.

3. **Component Organization**: 
   - UI primitives in `app/hanzo/components/ui/` (Radix UI + Tailwind)
   - Dashboard components in `app/hanzo/components/dashboard/`
   - Shared components in `app/hanzo/components/shared/`
   - Icons in `app/hanzo/components/icons/`

4. **Docker Management**: Core Docker operations handled through Dockerode library with custom compose file generation in `pkg/core/src/utils/builders/`. The platform manages Docker containers, networks, and volumes programmatically.

5. **Queue System**: BullMQ manages background jobs for deployments, backups, and monitoring. Queue definitions in `app/hanzo/server/queues/`. Redis is required for queue operations.

6. **Real-time Communication**: WebSocket server in `app/hanzo/server/wss/` handles terminal sessions, logs streaming, and deployment status updates using xterm.js for terminal emulation.

7. **Multi-tenancy**: Supports multiple projects/applications per user with proper isolation at database and Docker network levels. Each project gets its own Docker network and Traefik routing configuration.

8. **Template System**: Pre-configured application templates in `app/hanzo/templates/` with Docker Compose configurations for one-click deployments.

### Environment Configuration
- Development environment uses `.env` file in `app/hanzo/` (copy from `.env.example`)
- Required services: PostgreSQL (port 5432), Redis (port 6379)
- Docker socket access required for container management (`/var/run/docker.sock`)
- Default development URL: http://localhost:3000

### Testing Strategy
- Unit tests using Vitest located in `app/hanzo/__test__/`
- Test configuration in `app/hanzo/__test__/vitest.config.ts`
- Tests cover: compose file generation, environment variables, domain routing, API endpoints, templates
- Test directories mirror the source structure for easy navigation

### Development Workflow
1. **Branch Strategy**: Work on `canary` branch (not `main`)
2. **Commit Convention**: Follow Conventional Commits (feat:, fix:, docs:, etc.)
3. **Pre-commit Hooks**: Configured in `lefthook.yml` (currently disabled, can be enabled)
4. **CI/CD**: GitHub Actions workflows in `.github/workflows/`

### Code Style
- Biome for linting and formatting (configuration in `biome.json`)
- TypeScript strict mode enabled
- Avoid adding comments unless specifically requested
- Follow existing patterns in the codebase
- Use absolute imports with `@/` prefix for app/hanzo paths

### Docker Development
- Local development compose: `docker-compose.local.yml`
- Simple deployment: `docker-compose.simple.yml`
- Development compose: `docker-compose.dev.yml`
- Platform supports multiple deployment methods: Docker, Nixpacks, Buildpacks, Static sites

### Important Directories
- `app/hanzo/server/` - Backend server code, API routes, WebSocket handlers
- `pkg/core/src/utils/` - Shared utilities for Docker, Traefik, deployment builders
- `app/hanzo/templates/` - One-click deployment templates
- `app/hanzo/drizzle/` - Database migrations