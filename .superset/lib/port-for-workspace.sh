#!/usr/bin/env bash
set -euo pipefail
echo $(( 20000 + $(printf '%s' "$PWD" | cksum | cut -d' ' -f1) % 10000 ))
