# Hanzo Platform v4.0.6 Deployment Checklist

## Pre-Deployment Verification ✅

### 1. Code Status
- [x] Successfully merged Dokploy v0.25.1 upstream
- [x] All "hanzo" references replaced with "hanzo"
- [x] Setup scripts verified and working
- [x] Package dependencies updated to workspace versions
- [ ] All TypeScript compilation errors fixed
- [ ] Test suite passing (Current: 79.5% - 128/161 tests)

### 2. Infrastructure Check
- [x] Docker containers running:
  - hanzo-postgres ✅
  - hanzo-redis ✅
  - hanzo-traefik ✅
  - hanzo (main app) ✅
- [x] Network configuration:
  - hanzo-network (overlay/swarm) ✅
- [x] Database:
  - PostgreSQL database: "hanzo" ✅
  - User: "hanzo" ✅

### 3. Configuration Files
- [x] `.env` configured with hanzo database
- [x] Dockerfiles updated with hanzo paths
- [x] package.json scripts:
  - `pnpm run hanzo:setup` ✅
  - `pnpm run hanzo:dev` ✅
  - `pnpm run hanzo:build` ✅
  - `pnpm run hanzo:start` ✅

### 4. Critical Changes from Merge
- Network: `hanzo-network` → `hanzo-network`
- Database: `hanzo` → `hanzo`
- Containers: `hanzo-*` → `hanzo-*`
- Paths: `/etc/hanzo` → `/etc/hanzo`
- Package: `@hanzo/server` → `@hanzo/platform`
- Docker images: `hanzo/*` → `hanzoai/*`

## Local Testing Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Build core package
cd pkg/core && pnpm run build

# 3. Run tests
cd app/hanzo && pnpm vitest run

# 4. Start development server
pnpm run hanzo:dev

# 5. Build production
pnpm run hanzo:build

# 6. Test production build
pnpm run hanzo:start
```

## Deployment Steps

### Option 1: Rolling Update (Recommended)
```bash
# 1. Build new Docker image
pnpm run docker:build:platform

# 2. Update service with new image
docker service update hanzo --image hanzoai/platform:latest

# 3. Monitor rollout
docker service ps hanzo
```

### Option 2: Fresh Deployment
```bash
# 1. Backup database
docker exec hanzo-postgres pg_dump -U hanzo hanzo > backup.sql

# 2. Build and push new image
pnpm run docker:build:platform

# 3. Deploy stack
docker stack deploy -c docker-compose.yml hanzo

# 4. Verify services
docker service ls
```

## Post-Deployment Verification

- [ ] Application accessible at configured domain
- [ ] Can login with existing credentials
- [ ] Projects and applications are visible
- [ ] Can create new applications
- [ ] Docker deployments work
- [ ] Traefik routing works
- [ ] Database connections stable
- [ ] Redis caching functional
- [ ] Monitoring dashboard shows metrics

## Rollback Plan

If issues occur:
```bash
# 1. Rollback to previous version
docker service update hanzo --rollback

# 2. Or redeploy v0.19.0
docker service update hanzo --image hanzoai/platform:v0.19.0

# 3. Restore database if needed
docker exec -i hanzo-postgres psql -U hanzo hanzo < backup.sql
```

## Important Notes

1. **Database Migrations**: New version includes migrations up to 0110. Ensure migrations run on startup.

2. **Breaking Changes**: None identified, but monitor for:
   - Authentication issues (Better Auth updates)
   - Docker API compatibility
   - Traefik configuration changes

3. **Environment Variables**: No new required variables, existing .env should work.

4. **Current Live Version**: v0.19.0 → v4.0.6 (major version jump)

5. **Test Coverage**: Currently at 79.5% (128/161 tests passing)
   - Environment variable tests need fixing
   - Backup utility tests need attention
   - Template tests have import issues

## Recommended Actions Before Production

1. Fix remaining test failures to achieve 100% pass rate
2. Test full deployment flow locally
3. Verify backup/restore functionality
4. Test preview deployments feature
5. Validate GitHub/GitLab integrations still work
6. Check monitoring and notifications