#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${1:?Usage: $0 <project-name>}"
PROJECT_DIR="$SCRIPT_DIR/$PROJECT"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "Error: project '$PROJECT' not found in $SCRIPT_DIR" >&2
    exit 1
fi

if [ -z "${PICO_SDK_PATH:-}" ]; then
    echo "Error: PICO_SDK_PATH is not set" >&2
    exit 1
fi

BUILD_DIR="$PROJECT_DIR/build"
rm -rf "$BUILD_DIR"
mkdir "$BUILD_DIR"
cd "$BUILD_DIR"

cmake ..
make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

UF2="$BUILD_DIR/${PROJECT//-/_}.uf2"
if [ -f "$UF2" ]; then
    echo ""
    echo "Build complete: $UF2"
else
    echo "Build complete, but expected UF2 not found at $UF2" >&2
    echo "Check build output for the actual filename." >&2
fi
