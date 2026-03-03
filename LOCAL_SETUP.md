# Hanzo Platform - Local Setup Guide

## Prerequisites

- Node.js 20.9.0+ (check with `node -v`)
- pnpm 10.0.0+ (install with `npm install -g pnpm@10.0.0`)
- Docker (for PostgreSQL and Redis)
- Git

## Quick Start

### 1. Start Dependencies

```bash
# Start PostgreSQL and Redis
docker compose -f docker-compose.simple.yml up -d
```

### 2. Run Platform

```bash
# Use the automated script
./run-local.sh
```

Or manually:

```bash
# Install dependencies
pnpm install

# Build core package
pnpm core:build

# Setup database
cd app/hanzo
pnpm run migration:generate
pnpm run migration:run

# Start dev server
pnpm run dev
```

### 3. Access Platform

- URL: http://localhost:3000
- Default admin: `admin@localhost` / `admin123`

## Testing Platform MCP

### 1. Build platform-mcp

```bash
cd ../platform-mcp
npm install
npm run build
```

### 2. Get API Key

1. Login to platform at http://localhost:3000
2. Go to Settings → API Keys
3. Create a new API key
4. Copy the key

### 3. Test Connection

```bash
# Set your API key
export PLATFORM_API_KEY=your-api-key-here

# Run test script
node test-local.js
```

Or test manually:

```bash
# Run MCP server
PLATFORM_URL=http://localhost:3000 \
PLATFORM_API_KEY=your-key \
node build/index.js
```

### 4. Configure Claude Desktop

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "hanzo-platform": {
      "command": "node",
      "args": ["/Users/z/work/hanzo/platform-mcp/build/index.js"],
      "env": {
        "PLATFORM_URL": "http://localhost:3000",
        "PLATFORM_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Troubleshooting

### Platform won't start

1. Check Node version: `node -v` (should be 20.9.0+)
2. Check if ports are in use: `lsof -i :3000` and `lsof -i :5432`
3. Check Docker containers: `docker ps`
4. Clear and reinstall: `rm -rf node_modules pnpm-lock.yaml && pnpm install`

### Database errors

```bash
# Reset database
docker compose -f docker-compose.simple.yml down -v
docker compose -f docker-compose.simple.yml up -d
cd app/hanzo
pnpm run migration:run
```

### MCP connection fails

1. Verify platform is running: `curl http://localhost:3000/api/health`
2. Check API key is valid
3. Test with curl:
   ```bash
   curl -H "Authorization: Bearer your-api-key" \
        http://localhost:3000/api/v1/projects
   ```

## Environment Variables

Create `app/hanzo/.env`:

```env
# Database
DATABASE_URL=postgresql://hanzo:hanzo123@localhost:5432/hanzo
REDIS_URL=redis://localhost:6379

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

# Admin
ADMIN_EMAIL=admin@localhost
ADMIN_PASSWORD=admin123

# Features
DISABLE_SIGNUP=false
NODE_ENV=development
```

## Development Tips

### Watch logs

```bash
# Platform logs
pnpm hanzo:dev

# Database logs
docker compose -f docker-compose.simple.yml logs -f postgres

# MCP logs
PLATFORM_URL=http://localhost:3000 \
PLATFORM_API_KEY=your-key \
node build/index.js
```

### Reset everything

```bash
# Stop all services
docker compose -f docker-compose.simple.yml down -v

# Clean build artifacts
rm -rf app/hanzo/.next
rm -rf pkg/core/dist

# Reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## Next Steps

1. Create projects in the platform UI
2. Test deployments with platform-mcp
3. Configure your preferred MCP client (Claude Desktop, VS Code, etc.)
4. Start building!

## API Documentation

The platform exposes a REST API at `/api/v1/`:

- `/api/v1/projects` - Project management
- `/api/v1/applications` - Application deployments
- `/api/v1/postgres` - PostgreSQL databases
- `/api/v1/redis` - Redis instances
- `/api/v1/mysql` - MySQL databases
- `/api/v1/mariadb` - MariaDB databases
- `/api/v1/mongodb` - MongoDB databases

All endpoints require authentication via Bearer token.