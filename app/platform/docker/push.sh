#!/bin/bash
set -euo pipefail

# Everything resolves from this script's own location, not the caller's working
# directory. The build context and the version line used to be read as './...',
# which only agreed when invoked from the repo root — and the repo root is where
# './package.json' is the workspace root, which carries no version field.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)

BUILD_TYPE=${1:-production}

if [ "$BUILD_TYPE" == "canary" ]; then
    TAGS=(-t "hanzoai/platform:canary")
    echo "PUSHING CANARY"
else
    # The one version line (HIP-0111) is app/platform/package.json, and it already
    # carries the leading v. `node -p` prints the string "undefined" and exits 0
    # when the field is absent, so the value is what gets checked, not the status.
    VERSION=$(node -p "require('$ROOT/app/platform/package.json').version")
    case "$VERSION" in
        v[0-9]*) ;;
        *)
            echo "push.sh: version is '$VERSION', not a vX.Y.Z line — refusing to publish under it" >&2
            exit 1
            ;;
    esac
    TAGS=(-t "hanzoai/platform:latest" -t "hanzoai/platform:${VERSION}")
    echo "PUSHING PRODUCTION ${VERSION}"
fi

BUILDER=$(docker buildx create --use)
trap 'docker buildx rm "$BUILDER"' EXIT

docker buildx build --platform linux/amd64,linux/arm64 --pull --rm \
    "${TAGS[@]}" -f "$ROOT/Dockerfile" --push "$ROOT"
