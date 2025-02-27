#!/bin/bash
set -e

# Force working directory to repository root, regardless of where the script is called from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

# Determine build type from first argument (default is production)
BUILD_TYPE=${1:-production}
if [ "$BUILD_TYPE" == "canary" ]; then
  TAG="canary"
else
  VERSION=$(node -p "require('./package.json').version")
  TAG="$VERSION"
fi

# Create and use a new builder instance
BUILDER=$(docker buildx create --use)

# Build and push the image using the Dockerfile in docker/platform/Dockerfile
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --pull \
  --rm \
  --push \
  -t "hanzoai/platform:${TAG}" \
  -f "docker/platform/Dockerfile" \
  .

docker buildx rm $BUILDER
