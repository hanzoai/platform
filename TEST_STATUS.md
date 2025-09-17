# Test Status Report - Hanzo Platform

## Summary
After merging Dokploy v0.25.1, we have test failures that need addressing. This document tracks the current status and provides guidance for fixing them.

## Current Test Results
- **Total Tests**: 40
- **Passing**: 30 (75%)
- **Failing**: 10 (25%)
- **Test Files**: 35 (3 passing, 32 failing)

## Categories of Failures

### 1. Import Path Issues (FIXED in PR #1)
**Status**: ✅ Fixed - Awaiting merge
**Branch**: `fix/test-import-paths`
**Issue**: Tests importing `@dokploy/server` instead of `@hanzo/core`
**Fix**: Updated all test imports to use `@hanzo/core`

### 2. Merge Conflict Markers (FIXED in PR #1)
**Status**: ✅ Fixed - Awaiting merge
**Files**:
- `__test__/drop/drop.test.ts`
- `__test__/drop/drop.test.test.ts`
**Fix**: Resolved conflict markers in test files

### 3. Environment Variable Self-References (PARTIAL FIX in PR #2)
**Status**: ⚠️ Partially Fixed - Needs more work
**Branch**: `fix/env-self-reference`
**Failing Tests**: 5 in `__test__/env/shared.test.ts`
**Issue**: Self-references like `${{ENVIRONMENT}}` not resolving correctly
**What's needed**: Recursive resolution of variable references

### 4. Domain Label Middleware (NOT FIXED)
**Status**: ❌ Needs fixing
**Branch**: `fix/domain-label-tests`
**Failing Tests**: 5 in `__test__/compose/domain/labels.test.ts`
**Issue**: Middlewares for stripPath and internalPath not being generated
**What's needed**: Update createDomainLabels function to add middleware labels

### 5. Missing Module Errors (NEEDS INVESTIGATION)
**Status**: ❌ Needs investigation
**Affected Files**:
- Tests looking for `@dokploy/server` modules that don't exist
- Tests importing from wrong paths after merge
**What's needed**: Map old Dokploy paths to new Hanzo structure

## How to Run Tests

```bash
# Run all tests
cd app/hanzo && pnpm vitest run

# Run specific test file
cd app/hanzo && pnpm vitest run __test__/env/shared.test.ts

# Run in watch mode
cd app/hanzo && pnpm vitest watch
```

## Priority Order for Fixes

1. **High Priority**: Environment variable self-references (affects runtime)
2. **High Priority**: Domain label middleware (affects Traefik routing)
3. **Medium Priority**: Remaining import path issues
4. **Low Priority**: Test structure cleanup

## Branches Created

1. `fix/test-import-paths` - Import fixes (PR ready)
2. `fix/env-self-reference` - Environment variable fixes (PR ready, needs more work)
3. `fix/domain-label-tests` - Domain label fixes (in progress)

## Next Steps for Developers

1. **Merge existing PRs** to get basic fixes in
2. **Fix environment variable resolution** - Need recursive resolution logic
3. **Fix domain label generation** - Add middleware label generation
4. **Clean up remaining import issues** - Map Dokploy paths to Hanzo paths
5. **Run full regression test** after all fixes merged

## Notes

- The merge from Dokploy v0.25.1 brought in many new features but broke some tests
- Most failures are path/import related due to different project structures
- Core functionality should still work, tests need updating to match new structure
- Consider adding CI/CD pipeline to catch these issues earlier

## Commands for Quick Fixes

```bash
# Fix remaining @dokploy/server imports
find app/hanzo/__test__ -type f -name "*.ts" -exec sed -i 's/@dokploy\/server/@hanzo\/core/g' {} \;

# Find files with merge conflicts
grep -r "<<<<<<" app/hanzo/__test__

# Check for undefined imports
grep -r "from.*@dokploy" app/hanzo/
```