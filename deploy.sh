#!/usr/bin/env bash
# Deploy STREET ROD '86 to a static web root.
# Copies ONLY the runtime files (index.html, lib/, src/) — no dev tooling,
# notes, or git history. The game is fully self-contained; no build step.
set -euo pipefail

DEST="${1:-/var/www/html}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Deploying from $SRC"
echo "             to $DEST"

mkdir -p "$DEST"
cp "$SRC/index.html" "$DEST/"
cp -r "$SRC/lib" "$DEST/"
cp -r "$SRC/src" "$DEST/"

echo "Done. Deployed files:"
cd "$DEST" && find index.html lib src -type f | sort
