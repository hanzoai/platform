# Hanzo Platform vs Hanzo Merge Analysis

## Current Versions
- **Hanzo Platform**: v4.0.4 (based on Hanzo fork)
- **Hanzo**: v0.23.6 (latest as of analysis)

## 1. Repository Structure Changes

### Hanzo Changes (Package Restructuring)
The main structural change in Hanzo is the reorganization from Hanzo's structure:
- `apps/hanzo/` → `app/hanzo/`
- `apps/server/` → `app/api/`
- `packages/` → `pkg/`
- Added new apps: `console`, `monitoring`, `schedules`

### Key Differences
```
Hanzo Structure:          Hanzo Structure:
apps/                       app/
  hanzo/                    hanzo/
  server/                     api/
                              console/
                              monitoring/
                              schedules/
packages/                   pkg/
```

## 2. Branding Changes in Hanzo

### Visual Changes
- Custom logo implementation in `app/hanzo/components/shared/logo.tsx`
- Updated SVG icon with Hanzo branding
- Changed package name from "hanzo" to "hanzo-platform"

### Package.json Changes
- Scripts renamed: `hanzo:*` → `hanzo:*`
- Docker image names: `hanzo/*` → `hanzoai/*`
- Repository references updated

### Key Branding Files Modified
1. `app/hanzo/components/shared/logo.tsx` - Custom Hanzo logo
2. `package.json` - Package name and scripts
3. Docker configurations - Image names
4. Various test files - Updated references

## 3. Recent Hanzo Updates (Since Hanzo Fork)

### Critical Fixes
1. **v0.23.6** - Fix: Prevent removal of current directory in deployment logs
2. **v0.23.5** - Feat: Add kill process functionality to deployments
3. **v0.23.4** - Fix: Database backup notifications with database name
4. **Multiple fixes** for:
   - Docker config path handling
   - Preview deployment URLs with protocol
   - Registry tag construction for ghcr.io
   - Compose backup process enhancements
   - Schedule cancellation improvements

### New Features
1. Kill process functionality for deployments
2. Enhanced database backup notifications
3. Hanzo cloud endpoints support
4. Better UI readability for Node applications
5. Improved error handling in various components

## 4. Merge Strategy

### Recommended Approach

1. **Create a feature branch**
   ```bash
   git checkout -b merge-hanzo-v0.23.6
   ```

2. **Merge upstream changes selectively**
   ```bash
   # Fetch latest upstream
   git fetch upstream
   
   # Create a temporary merge to analyze conflicts
   git merge upstream/canary --no-commit --no-ff
   ```

3. **Preserve Hanzo-specific changes**
   - Keep all branding files (logo, package names, etc.)
   - Maintain directory structure (app/ vs apps/, pkg/ vs packages/)
   - Preserve custom scripts and Docker configurations

4. **Apply critical fixes manually**
   Since the directory structure is different, cherry-pick or manually apply:
   - Deployment log fix (prevent directory removal)
   - Kill process functionality
   - Database backup improvements
   - Docker config path fixes

### Conflict Resolution Strategy

1. **For structural conflicts**:
   - Keep Hanzo's directory structure
   - Manually port code changes to the new locations

2. **For branding conflicts**:
   - Always keep Hanzo branding
   - Update only the functional code

3. **For new features**:
   - Evaluate each feature for compatibility
   - Port features that don't conflict with Hanzo's architecture

## 5. Specific Files to Watch

### High Priority Updates (Apply These)
```
- Deployment log safety fix
- Kill process functionality
- Database backup enhancements
- Docker registry fixes
```

### Keep Hanzo Version (Don't Update)
```
- Logo and branding files
- Package.json (except dependencies)
- Docker image names
- Directory structure
```

## 6. Testing Plan After Merge

1. **Deployment Tests**
   - Test application deployments
   - Verify log handling doesn't delete directories
   - Check kill process functionality

2. **Database Operations**
   - Test backup functionality with notifications
   - Verify compose backups work correctly

3. **Docker Registry**
   - Test ghcr.io deployments
   - Verify registry tag construction

4. **UI/UX**
   - Ensure Hanzo branding remains intact
   - Check that UI improvements are applied

## 7. Implementation Steps

1. **Phase 1: Analysis**
   - Review each commit from Hanzo
   - Identify which changes apply to Hanzo's structure

2. **Phase 2: Selective Merge**
   - Create patches for critical fixes
   - Apply patches to Hanzo's file structure

3. **Phase 3: Testing**
   - Run comprehensive test suite
   - Manual testing of critical features

4. **Phase 4: Documentation**
   - Update changelog with merged features
   - Document any API changes

## Conclusion

The merge should focus on incorporating Hanzo's bug fixes and improvements while maintaining Hanzo's branding and architectural changes. The directory restructuring means a standard merge won't work - instead, changes need to be selectively ported to the new structure.

Priority should be given to critical bug fixes (especially the deployment log directory removal fix) and useful features like the kill process functionality, while carefully preserving all Hanzo-specific customizations.