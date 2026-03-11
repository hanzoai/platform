# LLM.md - Hanzo Platform

## Overview
Hanzo platform service

## Tech Stack
- **Language**: TypeScript/JavaScript

## Build & Run
```bash
pnpm install && pnpm build
pnpm test
```

## Structure
```
platform/
  CONTRIBUTING.md
  DEPLOYMENT.md
  Dockerfile
  Dockerfile.base
  Dockerfile.bypass
  Dockerfile.cloud
  Dockerfile.fix
  Dockerfile.monitoring
  Dockerfile.prod
  Dockerfile.schedule
  Dockerfile.server
  Dockerfile.simple
  HANZO_CLOUD_INTEGRATION.md
  INTEGRATE_BILLING.md
  LICENSE.MD
```

## Key Files
- `README.md` -- Project documentation
- `package.json` -- Dependencies and scripts
- `Dockerfile` -- Container build
