# Hanzo to Hanzo Platform Merge Checklist

## Pre-Merge Verification

- [ ] Backup current Hanzo Platform state
- [ ] Ensure all tests pass on current main branch
- [ ] Document current version (v4.0.4)

## Critical Security Fixes to Apply

### 1. ⚠️ Deployment Log Directory Removal Fix (HIGH PRIORITY)
- **Commit**: `2f6f1b19`
- **File**: `packages/server/src/services/deployment.ts` → `pkg/core/src/services/deployment.ts`
- **Issue**: Prevents accidental deletion of current directory during log cleanup
- [ ] Apply fix to Hanzo's deployment service
- [ ] Test log cleanup doesn't delete working directories

### 2. Kill Process Functionality
- **Commit**: `64293fce`
- **Files**: Multiple including deployment components and services
- **Feature**: Allows killing stuck deployment processes
- [ ] Add PID field to deployment schema
- [ ] Implement kill process mutation
- [ ] Update UI components for kill button
- [ ] Test process termination

### 3. Docker Config Path Fix
- **Commit**: `e004d8bd`
- **Issue**: Changes DOCKER_CONFIG to directory instead of file
- [ ] Update Docker config handling
- [ ] Test private registry authentication

### 4. Registry Tag Construction Fix
- **Commit**: `5c270924`
- **Issue**: Fixes image uploads to ghcr.io
- [ ] Update registry tag logic
- [ ] Test ghcr.io deployments

### 5. Database Backup Enhancements
- **Commit**: `c05edb31`
- **Feature**: Better database type handling in compose backups
- [ ] Update backup service
- [ ] Add database name to notifications
- [ ] Test backup functionality

## Path Translation Required

### Directory Mappings
- [ ] `apps/hanzo/` → `app/hanzo/`
- [ ] `apps/server/` → `app/api/`
- [ ] `packages/server/` → `pkg/core/`
- [ ] `packages/` → `pkg/`

### Files to Preserve (DO NOT MODIFY)
- [ ] `app/hanzo/components/shared/logo.tsx` - Hanzo branding
- [ ] `package.json` - Keep Hanzo naming and scripts
- [ ] Docker configurations - Keep hanzoai image names
- [ ] All test files with Hanzo references

## Testing Checklist

### Deployment Tests
- [ ] Create new application deployment
- [ ] Verify logs are generated correctly
- [ ] Test log cleanup (ensure no directory deletion)
- [ ] Test kill process on running deployment
- [ ] Deploy from private Docker registry

### Database Tests
- [ ] Create database backup
- [ ] Verify backup notifications include database name
- [ ] Test compose service backups
- [ ] Restore from backup

### UI/UX Tests
- [ ] Verify Hanzo logo displays correctly
- [ ] Check all branding remains intact
- [ ] Test new kill process UI
- [ ] Verify improved Node.js app readability

### Integration Tests
- [ ] GitHub deployments
- [ ] Docker registry authentication
- [ ] Preview deployments with correct URLs
- [ ] Schedule functionality

## Post-Merge Tasks

- [ ] Update version to indicate merge (e.g., v4.1.0)
- [ ] Update CHANGELOG.md with merged features
- [ ] Run full test suite
- [ ] Deploy to staging environment
- [ ] Monitor for any issues
- [ ] Update documentation if needed

## Rollback Plan

If issues arise:
1. [ ] Revert to pre-merge branch
2. [ ] Document specific issues encountered
3. [ ] Create targeted fixes instead of full merge

## Sign-off

- [ ] Development testing complete
- [ ] Code review completed
- [ ] Staging deployment successful
- [ ] Production deployment approved

---

**Note**: This merge includes critical security fixes, especially the deployment log directory removal prevention. Prioritize testing of deployment-related changes.