#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=$(./.superset/lib/port-for-workspace.sh)
PIDS=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill
  sleep 1
  PIDS=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9
  fi
  echo "✓ Procesos del workspace en el puerto $PORT terminados"
else
  echo "✓ Nada escuchando en el puerto $PORT — nada que limpiar"
fi
