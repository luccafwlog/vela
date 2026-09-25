#!/usr/bin/env bash
# Provisiona um Postgres 16 LOCAL e DESCARTÁVEL com o schema completo do
# Transhipping Desk, para validar migrations sem tocar no Supabase de produção
# (WORKFLOW.md §5: "banco descartável"). Idempotente. Nunca conecta em produção.
#
#   Uso:  scripts/setup-local-pg.sh [--reset]
#   Saída: exporta/echo DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vela_test
#
# Requisitos: PostgreSQL 16. Em Debian usa o cluster 16/main; no macOS usa um
# cluster local descartável em TMPDIR (Homebrew). Aplica shims Supabase (auth,
# roles, extensions, pg_cron stub, publicação realtime) que o vanilla PG não
# traz.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/local-pg-platform.sh
source "$SCRIPT_DIR/lib/local-pg-platform.sh"

DB=vela_test
PORT="${LOCAL_PG_PORT:-5432}"
RESET="${1:-}"
LOCAL_SUPERUSER="${PGUSER:-$(id -un)}"

if local_pg_has_debian_cluster; then
  EXTDIR="/usr/share/postgresql/16/extension"
  psql_su() { runuser -u postgres -- psql -p "$PORT" "$@"; }

  # 1. Cluster de pé (Debian)
  if ! pg_lsclusters 2>/dev/null | awk '$1==16 && $2=="main"{print $4}' | grep -q online; then
    pg_ctlcluster 16 main start >/dev/null 2>&1 || true
    sleep 2
  fi
else
  # macOS/Homebrew: não usa brew services nem toca no cluster global. O
  # diretório em TMPDIR é descartável e pode ser sobrescrito apenas por --reset.
  PG_BIN="${PG_BIN:-$(brew --prefix postgresql@16 2>/dev/null)/bin}"
  PGDATA="${LOCAL_PGDATA:-${TMPDIR:-/tmp}/vela-local-pg16}"
  # initdb cria o superusuário com o nome da conta local. Não herde PGUSER
  # aqui: ele pode apontar para "postgres", papel criado apenas mais abaixo.
  LOCAL_SUPERUSER="$(id -un)"
  if [ ! -x "$PG_BIN/psql" ]; then
    echo "PostgreSQL 16 não encontrado; instale postgresql@16 ou defina PG_BIN." >&2
    exit 1
  fi
  EXTDIR="$(local_pg_extension_dir "$PG_BIN")"
  psql_su() { "$PG_BIN/psql" -h 127.0.0.1 -U "$LOCAL_SUPERUSER" -p "$PORT" -d postgres "$@"; }

  if [ "$RESET" = "--reset" ] && [ -d "$PGDATA" ]; then
    if ! local_pg_validate_reset_target "$PGDATA" "${TMPDIR:-/tmp}"; then
      echo "LOCAL_PGDATA deve estar sob TMPDIR para --reset: $PGDATA" >&2
      exit 1
    fi
    if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      "$PG_BIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null
    fi
    rm -rf "$PGDATA"
  fi
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    "$PG_BIN/initdb" -D "$PGDATA" --auth=trust --no-locale >/dev/null
  fi
  if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/postgres.log" -o "-p $PORT" start >/dev/null
    sleep 2
  fi
fi

# 2. Stub do pg_cron (extensão gerida pelo Supabase; não existe no vanilla PG).
#    No-op: o schema/funcs `cron` vêm do shim abaixo.
if [ ! -f "$EXTDIR/pg_cron.control" ]; then
  printf "comment = 'stub pg_cron'\ndefault_version = '1.0'\nrelocatable = true\n" > "$EXTDIR/pg_cron.control"
  printf -- '-- no-op stub; cron schema+funcs vêm do shim\n' > "$EXTDIR/pg_cron--1.0.sql"
fi

# 3. Senha p/ acesso TCP local
if ! local_pg_has_debian_cluster; then
  psql_su -q -tc "DO \$\$ BEGIN CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres'; EXCEPTION WHEN duplicate_object THEN ALTER ROLE postgres PASSWORD 'postgres'; END \$\$;" >/dev/null
fi
psql_su -q -tc "ALTER USER postgres PASSWORD 'postgres';" >/dev/null 2>&1 || true

# 4. Já pronto? (fast-path, salvo --reset)
if [ "$RESET" != "--reset" ] && [ -n "$(psql_su -d "$DB" -tAc "select to_regclass('public.bls')" 2>/dev/null | tr -d '[:space:]')" ]; then
  echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB}"
  echo "# (schema já presente — use --reset para recriar do zero)"
  exit 0
fi

# 5. Recria o banco + shims + replay das migrations
psql_su -q -tc "DROP DATABASE IF EXISTS ${DB};" >/dev/null
psql_su -q -tc "CREATE DATABASE ${DB};" >/dev/null

psql_su -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
-- Colunas e leitura do sub como no Supabase: as suítes que simulam a sessão
-- com request.jwt.claims (JSON) e gravam aud/role em auth.users rodam aqui.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud VARCHAR(255), ADD COLUMN IF NOT EXISTS role VARCHAR(255);
CREATE OR REPLACE FUNCTION auth.uid()  RETURNS UUID LANGUAGE sql STABLE AS $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''), (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $f$;
CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS JSONB LANGUAGE sql STABLE AS $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
GRANT USAGE ON SCHEMA auth, extensions TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid BIGSERIAL PRIMARY KEY,
  jobname TEXT UNIQUE,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
-- Banco criado antes deste shim nao tem a coluna: completar sem recriar.
ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
-- Shim funcional (a 007 verifica linhas em cron.job): schedule insere ou
-- atualiza por jobname e reativa; unschedule remove. O stub anterior era
-- no-op e deixava cron.job sempre vazio.
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE plpgsql AS $f$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job(jobname, schedule, command, active)
  VALUES (job_name, schedule, command, true)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command, active = true
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $f$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint
LANGUAGE plpgsql AS $f$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job(jobname, schedule, command, active)
  VALUES ('job_' || nextval('cron.job_jobid_seq'), schedule, command, true)
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $f$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN true;
END $f$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN true;
END $f$;
-- Shim do Supabase Vault (extensao supabase_vault; ausente no PG vanilla).
-- A 007 exige vault.secrets/vault.decrypted_secrets + vault.create_secret;
-- sem isto o replay aborta em "extensao supabase_vault ausente". Sem cifra
-- real: o shim guarda em claro, suficiente para o contrato (nomes, dispatcher
-- e verificacao de literal). Producao/Preview usam a extensao de verdade.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE,
  description TEXT,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at
  FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT '', new_description text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vault.secrets(name, description, secret)
  VALUES (NULLIF(new_name, ''), new_description, new_secret)
  ON CONFLICT (name) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM vault.secrets WHERE name IS NOT DISTINCT FROM NULLIF(new_name, '');
  END IF;
  RETURN v_id;
END $f$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE vault.secrets
     SET secret = COALESCE(new_secret, secret),
         name = COALESCE(new_name, name),
         description = COALESCE(new_description, description),
         updated_at = now()
   WHERE id = secret_id;
END $f$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
INSERT INTO storage.buckets (id, name, public) VALUES
  ('demurrage-disputes', 'demurrage-disputes', false),
  ('customer-communications', 'customer-communications', false)
ON CONFLICT (id) DO NOTHING;
SQL

for f in $(ls supabase/migrations/*.sql | sort -V); do
  if ! psql_su -d "$DB" -v ON_ERROR_STOP=1 -q < "$f" >/tmp/pg_replay.log 2>&1; then
    echo "❌ FALHOU em $(basename "$f"):" >&2
    tail -8 /tmp/pg_replay.log >&2
    exit 1
  fi
done

echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/${DB}"
echo "# ✅ $(ls supabase/migrations/*.sql | wc -l) migrations aplicadas no Postgres 16 descartável."
