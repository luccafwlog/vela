#!/bin/bash
# Antes de git commit ou git push, roda o gate local. Bloqueia o comando (exit 2)
# se algum passo falhar. Diff só de Markdown/docs roda o gate documental.
# Diff que mexe em supabase/ ou nas suítes local-pg também roda o replay.
# Pular só com pedido explícito: CLAUDE_SKIP_LOCAL_GATE=1.
set -euo pipefail

if [[ "${CLAUDE_SKIP_LOCAL_GATE:-0}" == "1" ]]; then
  echo "Gate local pulado (CLAUDE_SKIP_LOCAL_GATE=1)." >&2
  exit 0
fi

input="$(cat)"
cd "${CLAUDE_PROJECT_DIR:-.}"

# O heredoc é o stdin do Python; o JSON do hook vai por variável, não pelo pipe.
kind="$(GATE_INPUT="$input" python3 - <<'PY'
import json, os, sys, shlex, re

try:
    data = json.loads(os.environ.get("GATE_INPUT") or "")
except Exception:
    sys.exit(0)

cmd = data.get("tool_input", {}).get("command", "")
if not cmd:
    sys.exit(0)

statements = re.split(r'\s*(?:&&|\|\||;|\|)\s*', cmd)

def tokens_of(stmt):
    try:
        return shlex.split(stmt, comments=False, posix=True)
    except ValueError:
        return stmt.split()

def git_action(toks):
    if not toks or toks[0] != "git":
        return None
    i = 1
    while i < len(toks):
        token = toks[i]
        if token in ("-c", "-C"):
            i += 2
            continue
        if token.startswith("-"):
            i += 1
            continue
        return token
    return None

for stmt in statements:
    toks = tokens_of(stmt.strip())
    # descarta atribuições FOO=bar
    i = 0
    while i < len(toks) and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', toks[i]):
        i += 1
    action = git_action(toks[i:])
    if action not in ("commit", "push"):
        continue
    if any(flag in ("--help", "--dry-run") for flag in toks):
        continue
    print(action)
    sys.exit(0)
PY
)"

if [[ -z "$kind" ]]; then
  exit 0
fi

stamp="${CLAUDE_PROJECT_DIR:-$PWD}/.git/claude-local-gate"
if [[ "$kind" == "push" && -f "$stamp" ]]; then
  tree="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || true)"
  stamped=""
  when=0
  read -r stamped when < "$stamp" || true
  now="$(date +%s)"
  if [[ -n "$tree" && "$stamped" == "$tree" && "${when:-0}" =~ ^[0-9]+$ && $((now - when)) -lt 21600 ]]; then
    echo "Gate local já passou para esta árvore; o push segue." >&2
    exit 0
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "Gate local: rode npm ci --legacy-peer-deps antes de commitar ou enviar." >&2
  exit 2
fi

# Sem origin/main não dá para saber se a branch já tem código: roda o gate cheio.
if git rev-parse --verify --quiet origin/main >/dev/null; then
  files="$(
    git diff --name-only HEAD
    git diff --cached --name-only
    git diff --name-only origin/main...HEAD
  )"
  class="$(printf '%s\n' "$files" | node scripts/ci-path-filter.mjs)"
  code="$(printf '%s\n' "$class" | awk -F= '/^code=/{print $2}')"
  migrations="$(printf '%s\n' "$class" | awk -F= '/^migrations=/{print $2}')"
else
  code=true
  migrations=true
fi

run_step() {
  echo "Gate local: $*" >&2
  if ! "$@"; then
    echo "Gate local falhou: $*" >&2
    exit 2
  fi
}

if [[ "$code" == "false" ]]; then
  run_step npm run docs:check
  run_step git diff --check
else
  run_step npm run lint
  run_step npm test
  run_step npm run build
  run_step python3 -B -m unittest discover -s scripts/security -p 'test_*.py'
  run_step python3 -B scripts/security/verificar_guardas.py --ci
fi

# Replay só quando o diff mexe em supabase/, suítes local-pg ou nos scripts
# desse replay. Sem PostgreSQL 16 o script explica o pré-requisito e falha.
if [[ "$migrations" == "true" ]]; then
  run_step scripts/replay-local-pg.sh
fi

tree=""
if git diff --quiet && git diff --cached --quiet; then
  tree="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || true)"
else
  tree="$(git write-tree 2>/dev/null || true)"
fi
if [[ -n "$tree" ]]; then
  mkdir -p "$(dirname "$stamp")"
  printf '%s %s\n' "$tree" "$(date +%s)" > "$stamp"
fi
echo "Gate local passou ($kind)." >&2
exit 0
