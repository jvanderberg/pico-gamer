#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${1:?Usage: $0 <project-name>}"
UF2="$SCRIPT_DIR/$PROJECT/build/${PROJECT//-/_}.uf2"

if [ ! -f "$UF2" ]; then
    echo "Error: $UF2 not found. Run ./build.sh $PROJECT first." >&2
    exit 1
fi

echo "Deploying $(basename "$UF2") via picotool..."
picotool load "$UF2" -f
picotool reboot
echo "Deployed and rebooted."
