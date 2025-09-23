#!/bin/bash

# Merge Hanzo Updates into Hanzo Platform
# This script helps selectively merge Hanzo updates while preserving Hanzo customizations

set -e

echo "🔄 Starting Hanzo merge process..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure we're on the main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo -e "${RED}Error: Not on main branch. Current branch: $current_branch${NC}"
    exit 1
fi

# Create merge branch
merge_branch="merge-hanzo-v0.23.6"
echo -e "${GREEN}Creating merge branch: $merge_branch${NC}"
git checkout -b $merge_branch || {
    echo -e "${YELLOW}Branch already exists, checking out...${NC}"
    git checkout $merge_branch
}

# Fetch latest upstream
echo -e "${GREEN}Fetching upstream changes...${NC}"
git fetch upstream

# List of critical fixes to cherry-pick or manually apply
echo -e "${YELLOW}Critical fixes to apply:${NC}"
echo "1. Prevent removal of current directory in deployment logs (2f6f1b19)"
echo "2. Kill process functionality (64293fce)"
echo "3. Database backup enhancements (c05edb31)"
echo "4. Docker config path fix (e004d8bd)"
echo "5. Registry tag construction fix (5c270924)"

# Create patches directory
mkdir -p patches

# Generate patches for critical fixes
echo -e "${GREEN}Generating patches for critical fixes...${NC}"

# Critical fix commits
fixes=(
    "2f6f1b19" # Prevent directory removal
    "64293fce" # Kill process functionality  
    "c05edb31" # Database backup enhancements
    "e004d8bd" # Docker config path fix
    "5c270924" # Registry tag fix
)

for commit in "${fixes[@]}"; do
    echo "Generating patch for $commit..."
    git format-patch -1 $commit -o patches/ || echo -e "${YELLOW}Could not generate patch for $commit${NC}"
done

echo -e "${GREEN}Patches generated in ./patches directory${NC}"

# Files that need manual path translation
echo -e "${YELLOW}Files that need path translation:${NC}"
echo "- apps/hanzo/* → app/hanzo/*"
echo "- apps/server/* → app/api/*"
echo "- packages/* → pkg/*"

# Create mapping file
cat > path-mappings.txt << 'EOF'
# Path mappings from Hanzo to Hanzo structure
apps/hanzo/ → app/hanzo/
apps/server/ → app/api/
packages/ → pkg/
EOF

echo -e "${GREEN}Path mappings saved to path-mappings.txt${NC}"

# Script to apply a patch with path translation
cat > apply-patch-translated.sh << 'EOF'
#!/bin/bash
# Apply a patch with path translation

patch_file=$1
if [ -z "$patch_file" ]; then
    echo "Usage: $0 <patch-file>"
    exit 1
fi

# Create a temporary translated patch
temp_patch="/tmp/translated_$(basename $patch_file)"

# Translate paths
sed -e 's|apps/hanzo/|app/hanzo/|g' \
    -e 's|apps/server/|app/api/|g' \
    -e 's|packages/|pkg/|g' \
    "$patch_file" > "$temp_patch"

# Apply the translated patch
echo "Applying translated patch: $patch_file"
git apply --3way "$temp_patch" || {
    echo "Failed to apply patch automatically. Manual intervention needed."
    echo "Translated patch saved at: $temp_patch"
    exit 1
}

echo "Patch applied successfully!"
EOF

chmod +x apply-patch-translated.sh

echo -e "${GREEN}Created apply-patch-translated.sh helper script${NC}"

# List files to preserve during merge
cat > preserve-hanzo.txt << 'EOF'
# Files to preserve Hanzo branding/structure
app/hanzo/components/shared/logo.tsx
app/hanzo/pages/index.tsx
package.json (scripts and name)
docker/build.sh
docker/hanzo/Dockerfile
.github/workflows/
README.md
LICENSE.MD
EOF

echo -e "${GREEN}Created preserve-hanzo.txt with files to keep Hanzo version${NC}"

# Summary
echo -e "\n${GREEN}=== Merge Process Summary ===${NC}"
echo "1. Created branch: $merge_branch"
echo "2. Generated patches in ./patches/"
echo "3. Created helper script: ./apply-patch-translated.sh"
echo "4. Created path mappings: ./path-mappings.txt"
echo "5. Listed files to preserve: ./preserve-hanzo.txt"

echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Review patches in ./patches/"
echo "2. Apply patches using: ./apply-patch-translated.sh patches/<patch-file>"
echo "3. Manually verify and test each change"
echo "4. Run tests after applying all patches"
echo "5. Commit changes and create PR"

echo -e "\n${YELLOW}Example usage:${NC}"
echo "./apply-patch-translated.sh patches/0001-*.patch"

echo -e "\n${GREEN}Merge preparation complete!${NC}"