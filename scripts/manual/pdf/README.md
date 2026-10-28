# PDF do Manual do Operador

Gerador do PDF do Manual do Operador (Etapa 2 do
[plano](../../../docs/plans/2026-10-26-manual-do-operador.md)). Por enquanto
gera as **páginas-modelo** que o dono aprova antes do capítulo-piloto.

| Arquivo | O que é |
|---|---|
| `manual.css` | Aparência impressa (A4): cores, letra e estados da [identidade visual](../../../docs/identidade-visual.md), cores das equipes, cabeçalho corrido, aba da parte, blocos, quadros fixos, "Aconteceu…", cartões de mensagem, tabela de referência e guia de bolso. |
| `paginas-modelo.html` | As nove páginas-modelo, com o texto tirado das regras da matriz e dos catálogos de situações. |
| `capturar-modelo.cjs` | Abre o Vela local, faz o procedimento como o operador faria e grava cada tela com a posição real dos elementos marcados. |
| `gerar-modelo.cjs` | Junta fontes, estilo e capturas (com marcações numeradas e destaque do botão) e imprime o PDF pelo Chromium do Playwright. |

## Como gerar

1. Banco local com todas as migrations: `sudo scripts/setup-local-pg.sh`.
2. Cópia de demonstração com os dados fictícios da auditoria visual:

   ```bash
   export PGPASSWORD=postgres
   psql -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS manual_demo" -c "CREATE DATABASE manual_demo TEMPLATE vela_test"
   psql -h 127.0.0.1 -U postgres -d manual_demo -c "ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid, ADD COLUMN IF NOT EXISTS encrypted_password varchar(255), ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz, ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb, ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()"
   psql -h 127.0.0.1 -U postgres -d manual_demo -f scripts/design-audit/seed_audit.sql
   ```

3. Emulador do Supabase e Vela em modo de desenvolvimento, em dois terminais:

   ```bash
   PGDATABASE=manual_demo PGPASSWORD=postgres node scripts/design-audit/sb-shim.cjs
   VITE_SUPABASE_URL=http://127.0.0.1:5173/sb-proxy VITE_SUPABASE_ANON_KEY=local-anon npx vite --port 5173 --strictPort
   ```

4. Capturas e PDF:

   ```bash
   node scripts/manual/pdf/capturar-modelo.cjs
   node scripts/manual/pdf/gerar-modelo.cjs
   ```

   Saem em `artifacts/manual/` (fora do Git): `paginas-modelo.pdf`, uma imagem
   por página em `paginas/` e as capturas em `imagens/`. Se o Chromium da
   versão do Playwright do projeto não estiver baixado, aponte outro com
   `MANUAL_BROWSER_EXECUTABLE_PATH`.

O login padrão é o usuário fictício do `seed_audit.sql` (`VELA_EMAIL` e
`VELA_PASSWORD` trocam). Nada disso toca o Supabase de produção.

## Limites conhecidos

- As páginas-modelo têm tamanho fixo de A4; os números de página e de seção
  fora do capítulo 4 são de exemplo. O gerador do manual inteiro vai paginar o
  texto corrido (Etapa 2, item 4).
- Se a tela mudar (rótulo, campo ou botão), `capturar-modelo.cjs` falha ao
  achar o elemento: é o aviso de que a página envelheceu.
