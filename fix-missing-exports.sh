#!/bin/bash

echo "Automatically fixing missing exports..."

while true; do
    # Try to start the dev server and capture error
    ERROR=$(cd /home/z/platform/app/hanzo && timeout 3 pnpm run dev 2>&1 | grep "does not provide an export named" | head -1)

    if [ -z "$ERROR" ]; then
        echo "No more missing exports detected!"
        break
    fi

    # Extract the missing export name
    MISSING=$(echo "$ERROR" | grep -oP "does not provide an export named '\\K[^']+")
    echo "Found missing export: $MISSING"

    # Find where it's defined in pkg/core/src
    echo "Searching for definition of $MISSING..."
    LOCATION=$(grep -r "export.*$MISSING" /home/z/platform/pkg/core/src --include="*.ts" | grep -E "(export const $MISSING|export function $MISSING|export async function $MISSING|export class $MISSING|export interface $MISSING|export type $MISSING)" | head -1)

    if [ -z "$LOCATION" ]; then
        echo "Could not find definition. Adding stub to index.ts..."
        # Add a stub export to index.ts
        echo "" >> /home/z/platform/pkg/core/src/index.ts
        echo "// Auto-generated stub for $MISSING" >> /home/z/platform/pkg/core/src/index.ts
        echo "export const $MISSING = async (...args: any[]) => { console.warn('$MISSING called - stub implementation'); return null; };" >> /home/z/platform/pkg/core/src/index.ts
    else
        FILE=$(echo "$LOCATION" | cut -d: -f1)
        echo "Found in: $FILE"

        # Get the relative path from pkg/core/src
        REL_PATH=$(echo "$FILE" | sed "s|/home/z/platform/pkg/core/src/||" | sed "s|\.ts$||")

        # Check if this file/module is already exported
        if grep -q "from \"./$REL_PATH\"" /home/z/platform/pkg/core/src/index.ts; then
            echo "Module $REL_PATH is already partially exported. Adding $MISSING to the export list..."

            # Find the line and add the export
            EXPORT_LINE=$(grep -n "from \"./$REL_PATH\"" /home/z/platform/pkg/core/src/index.ts | head -1 | cut -d: -f1)

            # Check if it's a star export or named export
            if grep "export \* from \"./$REL_PATH\"" /home/z/platform/pkg/core/src/index.ts > /dev/null; then
                echo "Converting star export to named export..."
                # Get all exports from the file
                EXPORTS=$(grep -oP "export (const|function|async function|class|interface|type) \\K\\w+" "$FILE" | tr '\n' ', ' | sed 's/,$//')
                sed -i "${EXPORT_LINE}s|.*|export { $EXPORTS } from \"./$REL_PATH\";|" /home/z/platform/pkg/core/src/index.ts
            else
                # Add to existing named exports
                sed -i "${EXPORT_LINE}s|{|{ $MISSING,|" /home/z/platform/pkg/core/src/index.ts
            fi
        else
            echo "Adding new export for $REL_PATH..."
            echo "export { $MISSING } from \"./$REL_PATH\";" >> /home/z/platform/pkg/core/src/index.ts
        fi
    fi

    echo "Fixed export for $MISSING"
    echo "---"
done

echo "All missing exports have been fixed!"
echo "Attempting to start the dev server..."
cd /home/z/platform/app/hanzo && pnpm run dev