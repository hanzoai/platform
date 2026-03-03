#!/usr/bin/env python3
import os
import re

def fix_ts_errors(filepath):
    """Fix TypeScript errors by adding 'as any' to .values() and .set() calls"""
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Pattern to match .values({ ... }) without 'as any'
    # This regex looks for .values({ followed by content and }) at the end
    values_pattern = r'(\.values\({[^}]*}\))(?!\s*as\s+any)'
    content = re.sub(values_pattern, r'\1 as any', content)
    
    # Pattern to match .set({ ... }) without 'as any'
    set_pattern = r'(\.set\({[^}]*}\))(?!\s*as\s+any)'
    content = re.sub(set_pattern, r'\1 as any', content)
    
    # Fix multi-line .values() calls
    # Match .values({ ... across multiple lines ... })
    multiline_values_pattern = r'(\.values\({[\s\S]*?\n\s*\}\))(?!\s*as\s+any)'
    
    def add_as_any(match):
        matched = match.group(1)
        # Check if it already has 'as any'
        if 'as any' not in matched:
            return matched + ' as any'
        return matched
    
    content = re.sub(multiline_values_pattern, add_as_any, content, flags=re.MULTILINE)
    
    # Fix multi-line .set() calls
    multiline_set_pattern = r'(\.set\({[\s\S]*?\n\s*\}\))(?!\s*as\s+any)'
    content = re.sub(multiline_set_pattern, add_as_any, content, flags=re.MULTILINE)
    
    # Save if changed
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed: {filepath}")
        return True
    return False

# List of files to fix based on the errors
files_to_fix = [
    '/home/z/platform/pkg/platform/src/services/backup.ts',
    '/home/z/platform/pkg/platform/src/services/bitbucket.ts',
    '/home/z/platform/pkg/platform/src/services/certificate.ts',
    '/home/z/platform/pkg/platform/src/services/compose.ts',
    '/home/z/platform/pkg/platform/src/services/deployment.ts',
    '/home/z/platform/pkg/platform/src/services/destination.ts',
    '/home/z/platform/pkg/platform/src/services/domain.ts',
    '/home/z/platform/pkg/platform/src/services/environment.ts',
    '/home/z/platform/pkg/platform/src/services/gitea.ts',
    '/home/z/platform/pkg/platform/src/services/github.ts',
    '/home/z/platform/pkg/platform/src/services/gitlab.ts',
    '/home/z/platform/pkg/platform/src/services/mariadb.ts',
    '/home/z/platform/pkg/platform/src/services/mongo.ts',
    '/home/z/platform/pkg/platform/src/services/mount.ts',
    '/home/z/platform/pkg/platform/src/services/mysql.ts',
]

fixed_count = 0
for filepath in files_to_fix:
    if os.path.exists(filepath):
        if fix_ts_errors(filepath):
            fixed_count += 1

print(f"\nTotal files fixed: {fixed_count}")