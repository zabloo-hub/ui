#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
PORT=$(./.superset/lib/port-for-workspace.sh)
echo "Preview: http://localhost:$PORT"
exec pnpm --filter hello-button-example dev --preview-port "$PORT"
