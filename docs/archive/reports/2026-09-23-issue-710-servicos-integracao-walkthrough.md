# Walkthrough: Consolidação e Integração de Serviços Externos (Issue #710)

Integração direta, pragmática e resiliente de todos os serviços de observabilidade e segurança especificados na **Issue #710**, entregue na **[PR #743](https://github.com/luccafwlog/vela/pull/743)** com 100% dos checks de CI e Vercel verdes.

---

## 1. O que foi Implementado

### 1.1 Sentry (Privacidade do Portal)
- **Local:** [`src/hooks/usePortalAuth.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/hooks/usePortalAuth.tsx) e [`src/hooks/__tests__/usePortalAuth.test.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/hooks/__tests__/usePortalAuth.test.tsx).
- **Mudança:** Eliminado vazamento de dados de identificação do cliente (`customer_id`). O contexto de usuário do Sentry agora chama `Sentry.setUser(null)` com a tag de superfície `Sentry.setTag('area', 'portal')`.

### 1.2 Better Stack (Heartbeats de Runners Agendados)
- **Shared Helper:** [`supabase/functions/_shared/betterStackHeartbeat.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/_shared/betterStackHeartbeat.ts) (`runWithBetterStackHeartbeat`).
- **Edge Functions Instrumentadas:**
  1. [`supabase/functions/alerts-detector/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/alerts-detector/index.ts) (`BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL`)
  2. [`supabase/functions/portal-daily-digest/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/portal-daily-digest/index.ts) (`BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL`)
  3. [`supabase/functions/demurrage-dunning/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/demurrage-dunning/index.ts) (`BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL`)
  4. [`supabase/functions/customer-communication-auto-runner/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/customer-communication-auto-runner/index.ts) (`BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_URL`)
- **Comportamento:** O ping HTTP ocorre apenas após execução com código HTTP < 400. Se a variável de secret não estiver cadastrada no Supabase, a função opera normalmente em no-op transparente.

### 1.3 Cloudflare Turnstile (Proteção Anti-Bot no Portal)
- **Componente e Validação:**
  - [`src/components/security/TurnstileChallenge.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/components/security/TurnstileChallenge.tsx): widget do Turnstile que carrega o script sob demanda.
  - [`supabase/functions/_shared/turnstile.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/_shared/turnstile.ts): validação server-side via `siteverify` da Cloudflare.
  - [`src/lib/turnstileMessages.ts`](file:///c:/Users/Lucca/Downloads/Vela/src/lib/turnstileMessages.ts) e [`src/lib/portalTurnstileError.ts`](file:///c:/Users/Lucca/Downloads/Vela/src/lib/portalTurnstileError.ts): tratamento amigável de erros em português.
- **Páginas Protegidas:**
  - [`src/pages/PortalLogin.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/pages/PortalLogin.tsx) e [`supabase/functions/portal-login/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/portal-login/index.ts).
  - [`src/pages/PortalForgotPassword.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/pages/PortalForgotPassword.tsx) e [`supabase/functions/portal-password-recovery/index.ts`](file:///c:/Users/Lucca/Downloads/Vela/supabase/functions/portal-password-recovery/index.ts).
- **Fail-Open / Bypass:** Se `VITE_TURNSTILE_SITE_KEY` ou `TURNSTILE_SECRET_KEY` não forem configurados, o sistema opera em bypass sem bloquear o usuário nem quebrar testes ou ambientes de Preview.

### 1.4 PostHog EU (Métrica de Faturamento)
- **Local:** [`src/pages/PortalBilling.tsx`](file:///c:/Users/Lucca/Downloads/Vela/src/pages/PortalBilling.tsx).
- **Mudança:** Disparo anônimo e agregado do evento `invoice_viewed` ao abrir o detalhe de uma fatura, respeitando as diretrizes de privacidade.

### 1.5 Documentação e Arquivamento de Planos
- [`docs/operations/observabilidade.md`](file:///c:/Users/Lucca/Downloads/Vela/docs/operations/observabilidade.md): documentado o contrato dos heartbeats e segredos server-side.
- [`docs/setup/deploy.md`](file:///c:/Users/Lucca/Downloads/Vela/docs/setup/deploy.md): adicionada a variável `VITE_TURNSTILE_SITE_KEY`.
- [`docs/CHANGELOG.md`](file:///c:/Users/Lucca/Downloads/Vela/docs/CHANGELOG.md): registrada a entrega da Issue #710.
- Movido [`docs/plans/2026-09-23-issue-710-consolidacao-service-a-service.md`](file:///c:/Users/Lucca/Downloads/Vela/docs/archive/plans/2026-09-23-issue-710-consolidacao-service-a-service.md) para arquivo e atualizado o índice de planos ativos.

---

## 2. Evidências de Validação

### Testes e Gates Locais
| Gate | Comando | Resultado |
|---|---|---|
| Documentação | `npm run docs:check` | Passou (174 Markdown, 55 rotas) |
| Tipagem | `npm run typecheck` (`tsc -b`) | Passou (0 erros) |
| Linter | `npm run lint` (`eslint .`) | Passou (0 erros/avisos) |
| Testes Unitários Afetados | `npx vitest run ...` | 45/45 testes passando |
| Backup R2 | `npm run backup:r2:test` | 4/4 testes passando |
| Build de Produção | `npm run build` | Concluído em 38.26s |

### CI Remoto na [PR #743](https://github.com/luccafwlog/vela/pull/743)
Todos os 11 checks finalizaram com **PASS**:
- `Build + Bundle size`: PASS (50s)
- `Docs + Lint`: PASS (54s)
- `Migration replay (Postgres real)`: PASS (56s)
- `Security guard replay`: PASS (8s)
- `Supabase Preview`: PASS (55s)
- `Test (1/3)`: PASS (1m9s)
- `Test (2/3)`: PASS (57s)
- `Test (3/3)`: PASS (1m9s)
- `Vercel – fwlog-portal`: PASS (Deploy Preview concluído)
- `Vercel – vela`: PASS (Deploy Preview concluído)
- `checks`: PASS (3s)

---

## 3. Checklist de Configuração dos Serviços Externos

Para habilitar a comunicação real nos ambientes de produção, siga as etapas simples abaixo:

### A. Better Stack
1. **HTTP Monitors (Uptime):**
   - Criar monitor para `https://vela.app.br/` (HTTP 200, cadência 5 min).
   - Criar monitor para `https://portalfwlog.com.br/portal/login` (HTTP 200, cadência 5 min).
2. **Heartbeats:**
   - Criar 4 Heartbeats no Better Stack:
     - `alerts-detector` (período: 15 min, grace: 15 min)
     - `customer-communication-auto-runner` (período: 15 min, grace: 15 min)
     - `demurrage-dunning` (período: 1h, grace: 15 min)
     - `portal-daily-digest` (período: 24h, grace: 1h)
   - Copiar as URLs geradas e colar em **Supabase Dashboard → Project Settings → Configuration → Secrets**:
     - `BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL`
     - `BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_URL`
     - `BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL`
     - `BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL`

### B. Cloudflare Turnstile
1. No painel da Cloudflare (Turnstile), adicionar site com os domínios `portalfwlog.com.br` e `localhost`.
2. Adicionar a **Site Key** no Vercel (Production/Preview) do projeto `fwlog-portal`:
   - `VITE_TURNSTILE_SITE_KEY`
3. Adicionar a **Secret Key** no **Supabase Dashboard → Secrets**:
   - `TURNSTILE_SECRET_KEY`

### C. Backup R2 (Rotina de Banco de Dados)
- O script [`scripts/backup-r2.mjs`](file:///c:/Users/Lucca/Downloads/Vela/scripts/backup-r2.mjs) já está validado e pronto.
- Para rodar no host Windows (servidor/máquina local):
  - Certifique-se de que o `pg_dump` está instalado e no PATH do Windows.
  - Agende uma tarefa no Agendador de Tarefas do Windows (Task Scheduler) às 09:00 diariamente executando:
    ```powershell
    node scripts/backup-r2.mjs --execute --allow-production
    ```
  - Com as variáveis configuradas (`SUPABASE_DB_URL`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `BACKUP_ENCRYPTION_KEY_HEX`).
