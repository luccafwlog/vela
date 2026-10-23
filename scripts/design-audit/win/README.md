# Local stack (Windows)

Roda a app contra um Supabase local (sem credenciais `*.supabase.co`), usando
Postgres nativo + um stub de `pg_cron` + o emulador `sb-shim`. É a versão
Windows do playbook em `scripts/design-audit/` (que assume Linux/Docker).

## Uso

```powershell
# Primeira vez (ou para resetar os dados): cria o banco, aplica todas as
# migrations de supabase/migrations/, faz o seed. Instala o stub pg_cron
# (pede UAC uma vez).
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1 -Rebuild

# Nas próximas vezes: só religa o shim (o banco já existe, o serviço
# Postgres sobe sozinho no boot).
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1

# Em outro terminal:
npm run dev
```

Abra <http://localhost:5173> e entre com **auditor@local.test** / **audit-local**
(admin) ou **operador@local.test** / **audit-local**.

## Pré-requisitos

- **PostgreSQL 16** em `C:\Program Files\PostgreSQL\16`
  (`winget install -e --id PostgreSQL.PostgreSQL.16`), superusuário
  `postgres`/`postgres`, serviço `postgresql-x64-16`.
- **Node** (já usado pelo projeto). O driver `pg` do shim é instalado
  automaticamente com `--no-save`.

## Peças

- `pg_cron.control` + `pg_cron--1.0.sql` — extensão **stub** de `pg_cron`
  (sem binário no Windows). Faz `create extension pg_cron`,
  `cron.schedule/unschedule` e a tabela `cron.job` virarem no-ops. Nenhum job
  roda; a app não depende do scheduler para a UI. O script copia esses dois
  arquivos para `...\PostgreSQL\16\share\extension` (requer UAC).
- `local-stack.ps1` — orquestra tudo (serviço, banco, migrations, seed, shim).
- O shim é `scripts/design-audit/sb-shim.cjs`; o proxy `/sb-proxy` em
  `vite.config.ts` encaminha para ele.
- O shim só atende o Host `localhost:54321`, `127.0.0.1:54321` ou
  `[::1]:54321` e responde 403 a qualquer outro, contra DNS rebinding. O proxy
  do Vite chega como `127.0.0.1:54321` (`changeOrigin`).

## Notas

- O `.env` **precisa** apontar para `http://localhost:5173/sb-proxy` (mesma
  origem do dev server — `localhost`, **não** `127.0.0.1`, senão o browser
  bloqueia por CORS). O script escreve isso se faltar.
- Se a tela de login mostrar "serviço de autenticação indisponível", é bundle
  em cache do Vite: **Ctrl+Shift+R** (hard refresh).
- Não persiste dados reais de produção — só o seed sintético.
