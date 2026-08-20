#!/bin/bash
set -euo pipefail

# Everything resolves from this script's own location, not the caller's working
# directory. The build context and the version line used to be read as './...',
# which only agreed when invoked from the repo root — and the repo root is where
# './package.json' is the workspace root, which carries no version field.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)

BUILD_TYPE=${1:-production}

if [ "$BUILD_TYPE" == "canary" ]; then
    TAG="canary"
else
    # The one version line (HIP-0111) is app/platform/package.json, and it already
    # carries the leading v. `node -p` prints the string "undefined" and exits 0
    # when the field is absent, so the value is what gets checked, not the status.
    TAG=$(node -p "require('$ROOT/app/platform/package.json').version")
    case "$TAG" in
        v[0-9]*) ;;
        *)
            echo "build.sh: version is '$TAG', not a vX.Y.Z line — refusing to tag an image with it" >&2
            exit 1
            ;;
    esac
fi

BUILDER=$(docker buildx create --use)
trap 'docker buildx rm "$BUILDER"' EXIT

docker buildx build --platform linux/amd64,linux/arm64 --pull --rm \
    -t "hanzoai/platform:${TAG}" -f "$ROOT/Dockerfile" "$ROOT"
