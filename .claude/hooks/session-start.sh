#!/bin/bash
set -euo pipefail

# Project root: prefer the harness-provided var, fall back to this script's path.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Synchronize Vela-owned skills from the repository. The Node wrapper records
# ownership per destination and prunes only names present in those manifests.
# A sync failure must not abort session start, but it must remain visible.
if command -v node >/dev/null 2>&1; then
  if ! node "$PROJECT_DIR/scripts/skills/install-skills.mjs"; then
    printf '[vela] Falha ao sincronizar as skills; a sessão continuará com o estado local atual.\n' >&2
  fi
fi
