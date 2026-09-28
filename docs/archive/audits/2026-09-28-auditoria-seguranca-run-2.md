# Auditoria de segurança — Vela e Portal Fwlog (execução run-2)

> **Snapshot histórico:** este relatório descreve o commit `17da824a` em 2026-09-28.
> Candidatos podem ter sido corrigidos depois. Para o estado atual, consulte
> [`docs/README.md`](../../README.md), o código e as migrations.


**Situação: incompleta (passagem parcial).** A busca cobriu todas as 34 unidades do plano. Nenhum candidato passou pela verificação independente que a skill exige nas fases 3 e 5. Por essa regra, **o `findings.json` não tem nenhum registro**, e nada abaixo é um achado confirmado. Os 15 candidatos continuam só no plano de cobertura, com a validação que a sessão principal fez sozinha.

Motivo registrado em `run-metadata.json`: a verificação independente exige agentes novos, e o dono decidiu encerrar sem eles, por custo.

## Execução

- **Perfil:** `standard`, com orçamento de agentes reduzido a pedido do dono.
- **Código auditado:** commit `17da824a3d5c0f4d8f178c3d78ccf3e9a9046345`, em cópia somente leitura (`target-src/`).
- **Escopo:** Vela interno, Portal Fwlog, backend Supabase (migrations, RLS, RPCs, Edge Functions), hospedagem, CI e scripts operacionais.
- **Fora de escopo:** `docs/`, `supabase/migrations_archive`, `design/`, `artifacts/` e as skills de agentes.
- **Agentes usados:** 4 de reconhecimento e 21 caçadores na onda 1. Dez caçadores foram interrompidos sem resultado. As 21 unidades que eles deixaram abertas foram revisadas depois pela sessão principal, em 7 blocos, e o fechamento não usou nenhum agente.
- **Execução restrita a código e ambiente local:** leitura do código e um Postgres 16 descartável dentro de sandbox, sem rede, com dados fictícios. Não houve nenhum contato com produção, Supabase, GitHub, Cloudflare ou Vercel.
- **Observações do dono:** duas capturas do painel (secrets do GitHub e limites do Auth). São observações de configuração, não execução.
- **Execução anterior:** a run-1 não deixou plano de cobertura nem achados; nada foi herdado.
- **Críticos de cobertura:** os críticos obrigatórios (pós-onda e final) **não rodaram**. Não há afirmação de cobertura limpa.

## Postura de segurança

A fronteira principal se manteve: um Cliente do Portal não lê nem altera dados de outro Cliente. Isso vale para as RPCs `portal_*`, para as tabelas lidas diretamente e para os arquivos das Disputes.

Também se mantiveram:

- as 562 funções `SECURITY DEFINER` fixam `search_path`, e não há SQL dinâmico injetável;
- `anon` executa uma única função;
- o webhook de e-mail valida a assinatura;
- os segredos das tarefas agendadas ficam no Vault;
- os workflows de Preview isolam o código da PR dos tokens.

Os candidatos restantes são desvios de regras de negócio entre usuários internos, limites contornáveis pelo próprio Cliente e um problema de configuração do CI (tokens de deploy acessíveis por qualquer branch). A validação na sessão também encontrou um defeito que trava a importação de manifestos.

## Achados confirmados

Nenhum. Sem verificação independente, nenhum candidato pode ser registrado como achado.

## Precisam de validação (NEEDS VALIDATION)

Nenhum registro. Pela mesma regra, os candidatos que dependem de fato externo também ficam só no plano de cobertura. Os fatos que faltam estão na tabela abaixo.

## Candidatos não validados de forma independente

Não são achados. A coluna "validação na sessão" traz o que a sessão principal concluiu sozinha, e o detalhe está nas [notas de trabalho](2026-09-28-auditoria-seguranca-run-2-notas.md).

| # | Impressão digital | Unidade | Validação na sessão | Fato que falta |
|---|---|---|---|---|
| 1 | `demurrage_invoices.dispute_status-direct-update-bypasses-dispute-role-guard` | db-rls-direct | reproduzido localmente | — |
| 2 | `supabase/migrations/075_portal_dispute_attachments_review_fixes.sql:add_demurrage_dispute_attachment:staff-branch-missing-dispute-responder-role` | db-storage | reproduzido localmente | — |
| 3 | `check_portal_rate_limit:caller-controlled-window-resets-own-counters` e `vela:check_portal_rate_limit:caller-controlled-window-reset` (mesma causa, duas impressões) | db-staff-misc, db-portal-rpc | reproduzido localmente | — |
| 4 | `supabase/migrations/billing-rpc:p_actor-author-override-non-admin` | db-staff-financial | reproduzido; rebaixado a informativo (a auditoria automática grava o usuário real) | — |
| 5 | `audit_logs.insert-policy-allows-forged-actor-department-and-changed_at` | db-rls-direct | reproduzido localmente | — |
| 6 | `save_bl_review-preguard-bl-existence-oracle` | db-staff-ops-imports | reproduzido localmente | — |
| 7 | `supabase/functions/portal-login:gotrue-direct-password-bypasses-cnpj-rate-limit` | fn-portal-auth | leitura + limite observado pelo dono (30 por 5 min por IP) | nenhuma tentativa real contra o Auth |
| 8 | `supabase/functions/admin-users:update_credentials-accepts-portal-technical-user` | fn-staff-privileged | leitura (sem Deno nem GoTrue locais) | execução da Edge Function |
| 9 | `supabase/functions/admin-users:deactivate-signout-with-user-id-never-revokes-sessions` | fn-staff-privileged | leitura da biblioteca; parcial | se a troca de senha pelo admin revoga sessões no GoTrue |
| 10 | `supabase/functions/send-customer-communication:livre-institucional-raw-html-unpersisted` | fn-communications-injection | leitura | execução da Edge Function |
| 11 | `customers.delete-policy-bypasses-delete_records-cnpj-rule` | db-lifecycle | reproduzido localmente | — |
| 12 | `src/services/supabase.ts:internal-client-implicit-detectSessionInUrl-login-csrf` | fe-session | leitura da biblioteca `auth-js` 2.103.3 | teste em navegador |
| 13 | `ensure_customer_contact_email:bl-consignee-email-becomes-active-contact` | chain-import-pipeline | **rejeitado na sessão**: o contato nunca é criado | — |
| 13b | `ensure_customer_contact_email:duplicate-box-link-aborts-import` | chain-import-pipeline | reproduzido localmente (a importação inteira falha) | se o gatilho `trg_seed_customer_contact_box_links` existe em produção |
| 14 | `github/workflows:repository-level-deploy-secrets-reachable-from-any-branch` | ci-workflows | leitura + secrets de repositório observados pelo dono | rulesets de workflow e alcance do token do Supabase |

## Reforços e padrões positivos

Os reforços dos blocos 1 a 7 estão nas [notas de trabalho](2026-09-28-auditoria-seguranca-run-2-notas.md). Os principais:

- imports das Edge Functions (`esm.sh`) sem versão exata;
- actions fixadas por tag;
- CSV sem aspas para `\r` e sem sanitização no relatório de problemas de importação;
- origens legadas no CORS;
- `connect-src` amplo na CSP;
- Turnstile que falha aberto sem segredo;
- telemetria que mantém o fragmento da URL;
- secret legado do Firebase ainda no GitHub.

Padrões positivos:

- a CSP é igual nas duas hospedagens;
- tokens de 256 bits guardados como hash e consumidos condicionalmente;
- mudanças de estado protegidas por GUC transacional;
- instalador conferido por SHA-256.

## Cobertura

Resumo do `coverage-ledger.json`, validado com `validate-coverage-ledger.cjs`:

| Estado | Unidades |
|---|---|
| coberta | 21 |
| com candidato | 13 |
| bloqueada | 0 |
| adiada | 0 |
| fora de escopo | 5 |

As verificações feitas pela sessão principal estão registradas com método `source`. As reproduções no Postgres local não foram promovidas como artefato pelo procedimento da skill.

Continuam fora de observação:

- configurações do GitHub além dos secrets (environments, rulesets);
- variáveis da Vercel e do Cloudflare;
- o histórico do git;
- qualquer comportamento em execução nos serviços.

## Arquivos

- Este relatório e as [notas de trabalho](2026-09-28-auditoria-seguranca-run-2-notas.md) (blocos 1 a 7, validação e observações do dono) são as únicas partes da execução guardadas no repositório.
- Os artefatos estruturados ficam na pasta da execução, fora do repositório: `findings.json` (vazio, validado com `validate-findings.cjs`), `coverage-ledger.json` (validado com `validate-coverage-ledger.cjs`), `run-metadata.json` (motivo do estado incompleto), `FINDINGS-DETAIL.md` e `NEEDS-VALIDATION.md` (sem registros).
