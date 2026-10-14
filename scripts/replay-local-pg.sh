#!/usr/bin/env bash
# Replay das migrations num PostgreSQL 16 local e descartável.
# O CI não executa mais este caminho. O hook .claude/hooks/pre-push-gate.sh
# chama este script quando o diff mexe em supabase/ ou nas suítes local-pg.
# Falha (exit 1) bloqueia o commit e o push.
set -euo pipefail

cd "$(dirname "$0")/.."

replay_prereq() {
  cat >&2 <<'EOF'
Replay de migrations bloqueado: falta PostgreSQL 16 nesta máquina.

O script scripts/setup-local-pg.sh administra um cluster local. Não usa a
CLI do Supabase e não sobe contêiner.

- Debian/Ubuntu: instale o pacote postgresql-16. O cluster 16/main precisa
  existir (pg_lsclusters lista a linha 16) e o sudo tem de rodar sem prompt
  (sudo -n), porque o hook não pode esperar senha.
- macOS: brew install postgresql@16, ou aponte PG_BIN para o diretório bin.
  O script cria um cluster em TMPDIR e não usa brew services.
- Windows: use WSL com o mesmo pré-requisito do Linux.

Docker não substitui esse cluster. Um contêiner postgres:16 publicado na
porta 5432 não é o que o script administra. Se o Docker não estiver
instalado, nada muda: o caminho é o PostgreSQL 16 do sistema. Sem ele, o
commit e o push ficam bloqueados.
EOF
}

replay_ready() {
  if command -v pg_lsclusters >/dev/null 2>&1 && pg_lsclusters 2>/dev/null | grep -q '^16'; then
    return 0
  fi
  if [[ -n "${PG_BIN:-}" && -x "${PG_BIN}/psql" ]]; then
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
    if [[ -n "$prefix" && -x "$prefix/bin/psql" ]]; then
      return 0
    fi
  fi
  return 1
}

if ! replay_ready; then
  replay_prereq
  exit 1
fi

if [[ -n "${PG_BIN:-}" ]]; then
  export PATH="${PG_BIN}:$PATH"
elif command -v brew >/dev/null 2>&1; then
  prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
  if [[ -n "$prefix" && -d "$prefix/bin" ]]; then
    export PATH="$prefix/bin:$PATH"
  fi
fi

reset_db() {
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    if ! sudo -n true >/dev/null 2>&1; then
      echo "No Linux o replay precisa de sudo sem prompt (sudo -n)." >&2
      replay_prereq
      exit 1
    fi
    sudo -n scripts/setup-local-pg.sh --reset
  else
    scripts/setup-local-pg.sh --reset
  fi
}

export LOCAL_PG_INTEGRATION=1
export LOCAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${LOCAL_PG_PORT:-5432}/vela_test"
export PGPASSWORD=postgres

psql_file() {
  psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f - < "$1"
}

# Banco limpo, invariantes, suítes nas duas ordens, bateria financeira por
# último, catálogo de RPCs e seed. A passada invertida só vale num banco
# recém-replicado: resíduo da ordem natural esconderia dependência entre suítes.
reset_db
psql_file scripts/check-squash-replay.sql
psql_file scripts/check-comunicados-caixas-nob.sql
npm run test:local-pg
reset_db
npm run test:local-pg -- --reverse
npx vitest run src/integration/financialBattery.local-pg.test.ts
npm run rpc:check
psql_file supabase/seed.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "SELECT (SELECT count(*) FROM public.charge_tables) AS charge_tables, (SELECT count(*) FROM public.charge_table_items) AS charge_table_items, (SELECT count(*) FROM public.demurrage_rates) AS demurrage_rates;"
