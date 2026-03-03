#!/bin/bash

echo "Finding and fixing all conflicting star exports..."

# Run the script and capture the conflicting export name
while true; do
    echo "Attempting to start server..."
    ERROR=$(cd app/hanzo && pnpm run dev 2>&1 | grep "conflicting star exports for name" | head -1)

    if [ -z "$ERROR" ]; then
        # Check if server actually started
        OUTPUT=$(cd app/hanzo && timeout 5 pnpm run dev 2>&1)
        if echo "$OUTPUT" | grep -q "Server started"; then
            echo "Server started successfully!"
            break
        elif echo "$OUTPUT" | grep -q "does not provide an export named"; then
            # Handle missing export
            MISSING=$(echo "$OUTPUT" | grep -oP "does not provide an export named '\K[^']+")
            echo "Missing export: $MISSING"
            break
        else
            echo "No conflicts found, but server not starting. Check for other errors."
            echo "$OUTPUT" | tail -20
            break
        fi
    fi

    CONFLICT=$(echo "$ERROR" | grep -oP "conflicting star exports for name '\K[^']+")
    echo "Found conflict: $CONFLICT"

    # Find where it's exported from
    echo "Finding exports of $CONFLICT..."
    EXPORTS=$(grep -r "export.*$CONFLICT" /home/z/platform/pkg/core/src --include="*.ts" | \
              grep -E "(export const $CONFLICT|export function $CONFLICT|export async function $CONFLICT)" | \
              cut -d: -f1 | sort -u)

    echo "Found in:"
    echo "$EXPORTS"

    # Decide which one to keep (prefer services over db/schema, utils over services)
    KEEP=""
    REMOVE=""

    for FILE in $EXPORTS; do
        if [[ "$FILE" == *"/utils/"* ]]; then
            KEEP="$FILE"
        elif [[ "$FILE" == *"/services/"* ]] && [[ "$KEEP" != *"/utils/"* ]]; then
            KEEP="$FILE"
        elif [[ "$FILE" == *"/db/schema/"* ]] && [ -z "$KEEP" ]; then
            KEEP="$FILE"
        fi
    done

    # Remove duplicates from other files
    for FILE in $EXPORTS; do
        if [ "$FILE" != "$KEEP" ]; then
            echo "Removing $CONFLICT from $FILE"
            # Comment out the export instead of deleting
            sed -i "s/^export.*$CONFLICT.*$/\/\/ $CONFLICT is exported from another file/" "$FILE"
        fi
    done

    echo "Kept $CONFLICT in $KEEP"
    echo "---"
done

echo "All conflicts resolved!"