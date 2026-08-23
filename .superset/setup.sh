#!/usr/bin/env bash
# Superset workspace setup (runs inside each isolated worktree).
#
# Installs dependencies. Nothing else is needed: this repo's Claude context
# (CLAUDE.md + docs/internal/) is committed, so it travels with the worktree.
set -euo pipefail

# Doble install: la 1ª trae deps, `pnpm build` genera dist/cli.js, la 2ª
# repara el symlink del bin `zabloo` (pnpm no lo crea si dist/ aún no existe).
pnpm install --prefer-offline
pnpm build
pnpm install --prefer-offline
