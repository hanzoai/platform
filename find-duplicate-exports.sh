#!/bin/bash
echo "Finding all duplicate exports in pkg/core/src..."

# Find all export const/function declarations
find /home/z/platform/pkg/core/src -name "*.ts" -type f -exec grep -H "^export \(const\|function\|async function\) \w\+" {} \; | \
  sed 's/.*export \(const\|function\|async function\) \(\w\+\).*/\2/' | \
  sort | uniq -d | while read func; do
    echo ""
    echo "Duplicate export found: $func"
    grep -r "export.*$func" /home/z/platform/pkg/core/src --include="*.ts" | grep -E "(export const $func|export function $func|export async function $func)"
done
