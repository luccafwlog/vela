#!/usr/bin/env bash
# Recria o banco de demonstração do Manual do Operador (manual_demo) a partir
# do banco local com todas as migrations (vela_test), com o seed da auditoria
# visual e o cenário. Nunca toca o Supabase de produção.
#
# Uso: scripts/manual/cenario/preparar.sh   (depois: sb-shim e Vela, ver README)
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'manual_demo' and pid <> pg_backend_pid()" >/dev/null
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS manual_demo" -c "CREATE DATABASE manual_demo TEMPLATE vela_test"
# O shim de login do seed precisa das colunas do GoTrue em auth.users.
"${PSQL[@]}" -d manual_demo -c "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid, ADD COLUMN IF NOT EXISTS encrypted_password varchar(255), ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb, ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()"
"${PSQL[@]}" -d manual_demo -f scripts/design-audit/seed_audit.sql >/dev/null
"${PSQL[@]}" -d manual_demo -f scripts/manual/cenario/cenario.sql
node scripts/manual/cenario/gerar-arquivos.mjs
echo "Cenário pronto em manual_demo."
