#!/bin/bash
set -e

echo "=== AGGRESSIVELY REMOVING ALL AUTHENTICATION ==="
echo "This will make the platform 100% accessible without any auth checks"

# Function to strip auth from a file
strip_auth() {
    local file=$1
    echo "Processing: $file"
    
    # Create a backup
    cp "$file" "$file.bak"
    
    # Remove the entire getServerSideProps function and replace with empty props
    cat > /tmp/auth_remover.js << 'EOF'
const fs = require('fs');
const file = process.argv[2];
let content = fs.readFileSync(file, 'utf8');

// Remove validateRequest import
content = content.replace(/import\s*{\s*validateRequest[^}]*}\s*from\s*["'][^"']+["'];?\n?/g, '');

// Remove getServerSideProps entirely and replace with minimal version
content = content.replace(
    /export\s+async\s+function\s+getServerSideProps[\s\S]*?^}\s*$/gm,
    `export async function getServerSideProps() {
	return {
		props: {},
	};
}`
);

// Remove any auth checks in the component
content = content.replace(/if\s*\(!user\)\s*{[\s\S]*?return[\s\S]*?}/g, '');
content = content.replace(/if\s*\(!session\)\s*{[\s\S]*?return[\s\S]*?}/g, '');

fs.writeFileSync(file, content);
EOF
    
    node /tmp/auth_remover.js "$file"
}

# Process all dashboard files
for file in /home/z/platform/app/platform/pages/dashboard/**/*.tsx; do
    if grep -q "getServerSideProps\|validateRequest" "$file" 2>/dev/null; then
        strip_auth "$file"
    fi
done

# Also handle root level pages
for file in /home/z/platform/app/platform/pages/*.tsx; do
    if grep -q "getServerSideProps\|validateRequest" "$file" 2>/dev/null; then
        echo "Processing root page: $file"
        strip_auth "$file"
    fi
done

echo ""
echo "=== AUTH REMOVAL COMPLETE ==="
echo "All getServerSideProps functions have been replaced with empty props"
echo "All validateRequest imports have been removed"