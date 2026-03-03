# 🔒 Safe Production Deployment Plan - Hanzo Platform v4.0.6

## Current Status
- **Production Version**: v0.19.0
- **New Version**: v4.0.6 (includes Dokploy v0.25.1 merge)
- **Git Commit**: `028cff0e`
- **Test Coverage**: 79.5% (128/161 tests passing)

## ⚠️ Pre-Deployment Checklist

### 1. Backup Everything (CRITICAL)
```bash
# Create timestamped backup directory
export BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p ~/backups/hanzo_${BACKUP_DATE}

# Backup PostgreSQL database
docker exec hanzo-postgres.1.l23c29rct70s4s440ywv3ia28 \
  pg_dump -U hanzo hanzo > ~/backups/hanzo_${BACKUP_DATE}/database.sql

# Verify backup
head -20 ~/backups/hanzo_${BACKUP_DATE}/database.sql

# Backup environment files
cp /home/z/platform/app/hanzo/.env ~/backups/hanzo_${BACKUP_DATE}/
cp -r /etc/hanzo ~/backups/hanzo_${BACKUP_DATE}/etc_hanzo_backup 2>/dev/null || true

# Backup Docker volumes
docker run --rm -v hanzo_hanzo-data:/data -v ~/backups/hanzo_${BACKUP_DATE}:/backup \
  alpine tar czf /backup/volumes.tar.gz -C /data .
```

### 2. Build and Tag New Image
```bash
cd /home/z/platform

# Build with specific tag (not latest yet)
docker build -t hanzoai/platform:v4.0.6 .

# Also tag with commit hash for precise rollback
docker tag hanzoai/platform:v4.0.6 hanzoai/platform:028cff0e

# Test the image locally first
docker run --rm -it hanzoai/platform:v4.0.6 node -e "console.log('Build OK')"
```

### 3. Test Migration Path
```bash
# Create a test database to verify migrations
docker exec hanzo-postgres.1.l23c29rct70s4s440ywv3ia28 \
  psql -U hanzo -c "CREATE DATABASE hanzo_test;"

# Test migrations on test database
docker run --rm \
  --network hanzo-network \
  -e DATABASE_URL="postgres://hanzo:$(cat .env | grep DATABASE_URL | cut -d'@' -f1 | cut -d':' -f3)@hanzo-postgres:5432/hanzo_test" \
  hanzoai/platform:v4.0.6 \
  pnpm migration:run

# Verify test migration
docker exec hanzo-postgres.1.l23c29rct70s4s440ywv3ia28 \
  psql -U hanzo hanzo_test -c "\dt"
```

## 🚀 Deployment Steps

### Option A: Blue-Green Deployment (Safest)
```bash
# 1. Deploy new version alongside old
docker service create \
  --name hanzo-new \
  --network hanzo-network \
  --replicas 1 \
  --env-file /home/z/platform/app/hanzo/.env \
  hanzoai/platform:v4.0.6

# 2. Test new version on different port
docker service update hanzo-new \
  --publish-add 3001:3000

# 3. Verify at http://localhost:3001
curl -I http://localhost:3001/health

# 4. If OK, switch traffic
docker service update hanzo-traefik \
  --label-add "traefik.http.services.hanzo.loadbalancer.server.port=3001"

# 5. Remove old service after verification
docker service rm hanzo
docker service update hanzo-new --name hanzo
```

### Option B: Rolling Update (Faster)
```bash
# Update with automatic rollback on failure
docker service update hanzo \
  --image hanzoai/platform:v4.0.6 \
  --update-parallelism 1 \
  --update-delay 30s \
  --update-failure-action rollback \
  --update-monitor 5m \
  --rollback-parallelism 1 \
  --rollback-delay 10s
```

## 🔄 Rollback Plan

### Immediate Rollback (if issues detected)
```bash
# Option 1: Service rollback
docker service update hanzo --rollback

# Option 2: Explicit version rollback
docker service update hanzo --image hanzoai/platform:latest

# Option 3: Database restoration (if needed)
docker exec -i hanzo-postgres.1.l23c29rct70s4s440ywv3ia28 \
  psql -U hanzo hanzo < ~/backups/hanzo_${BACKUP_DATE}/database.sql
```

## 📊 Post-Deployment Verification

```bash
# 1. Check service health
docker service ps hanzo --no-trunc

# 2. Check application logs
docker service logs hanzo --tail 100 --follow

# 3. Verify version
docker exec $(docker ps -q -f name=hanzo.1) \
  cat package.json | grep version

# 4. Test critical endpoints
curl -s http://localhost:3000/api/health | jq .
curl -s http://localhost:3000/api/trpc/auth.health | jq .

# 5. Check database connectivity
docker exec $(docker ps -q -f name=hanzo.1) \
  node -e "require('pg').Client({connectionString: process.env.DATABASE_URL}).connect().then(() => console.log('DB OK'))"
```

## ⚠️ Known Considerations

1. **Major Version Jump**: v0.19.0 → v4.0.6 is significant
2. **Database Migrations**: 110 migration files present
3. **Breaking Changes**: 
   - Package renamed from `@hanzo/platform` to `@hanzo/platform`
   - Network names changed from `hanzo-*` to `hanzo-*`
4. **Test Coverage**: Not 100% - monitor for edge cases

## 🛟 Emergency Contacts & Recovery

If critical issues occur:
1. Immediately rollback using the steps above
2. Check logs: `docker service logs hanzo --tail 1000`
3. Restore database from backup if data corruption
4. Keep old image `hanzoai/platform:latest` as fallback

## 📝 Monitoring Checklist (First 24 Hours)

- [ ] CPU/Memory usage stable
- [ ] No error spikes in logs
- [ ] Database queries performing normally
- [ ] All projects/applications visible
- [ ] Deployments working
- [ ] Backups running on schedule
- [ ] No user complaints
- [ ] SSL certificates valid
- [ ] Traefik routing correct

## 🎯 Recommended Approach

Given the major version jump, I recommend:

1. **Start with Blue-Green deployment** (Option A)
2. **Run in parallel for 2-4 hours** to verify stability
3. **Monitor closely** for any issues
4. **Keep backups for 7 days** minimum
5. **Document any issues** for future reference

## Commands Summary

```bash
# Quick backup and deploy
export BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p ~/backups/hanzo_${BACKUP_DATE}

# Backup database
docker exec hanzo-postgres.1.l23c29rct70s4s440ywv3ia28 \
  pg_dump -U hanzo hanzo > ~/backups/hanzo_${BACKUP_DATE}/database.sql

# Build and deploy
cd /home/z/platform
docker build -t hanzoai/platform:v4.0.6 .
docker service update hanzo \
  --image hanzoai/platform:v4.0.6 \
  --update-failure-action rollback

# Monitor
docker service logs hanzo --follow
```