#!/bin/bash
# Block edits to files marked as "do not touch" in AGENTS.md unless explicit override.
# Override by setting env CLAUDE_ALLOW_PROTECTED=1 for the session.
set -euo pipefail

if [[ "${CLAUDE_ALLOW_PROTECTED:-0}" == "1" ]]; then
  exit 0
fi

input="$(cat)"
file_path="$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin); ti=d.get("tool_input",{}); print(ti.get("file_path") or ti.get("path") or "")' 2>/dev/null || true)"

if [[ -z "$file_path" ]]; then
  exit 0
fi

block() {
  echo "BLOCKED: $file_path is in AGENTS.md protected list (generated/spec/migrations)." >&2
  echo "If intentional, set CLAUDE_ALLOW_PROTECTED=1 and retry." >&2
  exit 2
}

case "$file_path" in
  */src/types/database.ts|*/src/lib/pix.ts|src/types/database.ts|src/lib/pix.ts)
    block
    ;;
  # ADR 0083, item 4 (A4): só a migration existente é protegida; criar uma
  # migration nova é o caminho normal de mudar o banco.
  */supabase/migrations/*|*/supabase/migrations_archive/*|supabase/migrations/*|supabase/migrations_archive/*)
    if [[ -e "$file_path" ]]; then
      block
    fi
    ;;
esac

exit 0
