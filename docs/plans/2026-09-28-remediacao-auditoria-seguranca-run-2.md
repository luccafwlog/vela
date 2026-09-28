# Plano — Remediação da auditoria de segurança run-2

Data: 2026-09-28. Estado: não iniciado; quatro decisões (D1–D4) aguardam o dono.

Origem: [auditoria run-2](../archive/audits/2026-09-28-auditoria-seguranca-run-2.md)
(commit auditado `17da824a`). A auditoria está **incompleta**: nenhum dos 15
candidatos passou por verificação independente. Este plano trata cada candidato
como hipótese a reproduzir: o primeiro passo de cada item é um teste que falha
no código atual; só depois vem a correção. Um item cuja reprodução falhar é
encerrado com essa evidência, sem correção.

Conferência de 2026-09-28 contra `main` (`dc7ea07b`): desde `17da824a` só
entraram as migrations `097`–`099` (fatura avulsa), que não tocam nenhuma das
funções, políticas ou grants citados. `src/services/supabase.ts`,
`admin-users` e os workflows citados estão como foram auditados.

O repositório é público e os candidatos estão abertos. A ordem abaixo segue o
risco: primeiro o que o dono resolve no painel sem código (#14), depois o
defeito que trava a importação (#13b) e as regras de negócio no banco.

## Decisões pendentes

| # | Pergunta | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| D1 | Como fechar o teste de senha direto no GoTrue (#7)? | (a) guardar no GoTrue `HMAC(pepper, senha)` e migrar no próximo login; (b) *Password Verification Hook* com o balde por CNPJ; (c) aceitar o risco e só reduzir o limite por IP do Auth | (b), se o plano do Supabase oferecer o hook; senão (a). (c) não fecha o caminho | Fase 3, item 3.4 |
| D2 | Contato capturado do e-mail do consignatário (#13/#13b) | (a) nasce **inativo** e sem caixa até a equipe confirmar na Revisão; (b) nasce ativo só na caixa `documentacao_operacao`, sem virar principal; (c) manter como hoje (ativo e principal quando não houver outro) | (a). Depende de o negócio confirmar quem escreve esse e-mail no documento de origem | Fase 2, item 2.8 |
| D3 | Troca de e-mail do usuário interno com PKCE (#12) | (a) `flowType: 'pkce'`: o link de confirmação só funciona no mesmo navegador que pediu a troca; (b) manter `implicit` e só limpar o fragmento na telemetria | (a); a troca de e-mail é rara e a restrição é aceitável | Fase 4, item 4.1 |
| D4 | Escopo dos reforços | (a) só os reforços listados neste plano; (b) todos os reforços da auditoria | (a); os demais ficam no anexo da auditoria como referência | Fases 2–5 (itens marcados "reforço") |

## Fase 1 — Configuração de terceiros (dono, sem código)

Registrar cada mudança em [serviços externos](../operations/servicos-externos.md)
na mesma PR que a documenta; nomes e locais de secrets, nunca valores.

1. **#14 (média).** Criar os environments `cloudflare-pages` e
   `supabase-branches` com *deployment branch* = `main`; mover para eles
   `CLOUDFLARE_PAGES_API_TOKEN`, `SUPABASE_ACCESS_TOKEN` e
   `PREVIEW_ADMIN_PASSWORD`; **apagar** as cópias em Repository secrets (uma
   cópia no repositório anula o environment). Depois, rotacionar os dois tokens
   e, se o Supabase oferecer, trocar o token pessoal por um de escopo mínimo.
   A Fase 5 ajusta os workflows (`environment:` nos jobs) na mesma janela.
2. **#14.** Conferir quem tem push no repositório (inclusive as credenciais dos
   agentes) e criar um ruleset que exija revisão para `.github/workflows/**`.
3. Reforço: apagar o secret legado `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`.
4. **#13b, fato que falta.** No banco de produção, só leitura: confirmar se o
   gatilho `trg_seed_customer_contact_box_links` existe. Se existir, a
   importação com e-mail de consignatário novo está falhando hoje.
5. **#7, fato que falta.** Anotar em Authentication → Attack Protection se o
   captcha está desligado; não ligar sem a Fase 3 (o `portal-login` não envia
   `captchaToken` e passaria a falhar para todos).
6. Reforço: confirmar que `TURNSTILE_SECRET_KEY` existe nos secrets das Edge
   Functions de produção (sem ele o Turnstile libera tudo).

Verificação: capturas do painel anexadas à PR de documentação; nenhum workflow
de Preview ou produção quebrado no primeiro push após a mudança.

## Fase 2 — Migration `100` (banco)

Uma migration nova, `supabase/migrations/100_remediacao_auditoria_run_2.sql`,
com um teste `src/integration/auditoriaRun2.local-pg.test.ts` no padrão das
suítes `local-pg`. Cada item abaixo tem um caso que falha antes e passa depois.
Se o item 2.8 inativar contatos já existentes, o cabeçalho da migration declara
que depende da linha "Data status" do [AGENTS.md](../../AGENTS.md).

| Item | Candidato | Correção | Caso do teste |
|---|---|---|---|
| 2.1 | #1 | `REVOKE UPDATE (dispute_open, dispute_status) ON demurrage_invoices FROM authenticated`; o front deixa de gravar esses campos (item 4.5) | Financeiro não encerra nem reabre a Dispute por UPDATE; a RPC oficial continua funcionando para Equipamentos |
| 2.2 | #2 | No ramo interno de `add_demurrage_dispute_attachment` e nas políticas de storage `demurrage_dispute_objects_*`: papel Equipamentos ou Administrativo e Dispute aberta | Financeiro não anexa; Equipamentos não anexa em Dispute resolvida |
| 2.3 | #3 | `REVOKE EXECUTE ON FUNCTION check_portal_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated`; recusar janela ou limite ≤ 0 | usuário do Portal recebe `permission denied`; `portal_create_consolidation` continua limitando a 3 em 10 min |
| 2.4 | #4 (informativo) | Nas RPCs com `p_actor` (`reject_customer_reconciliation`, `add_manual_bl_charge`, `calculate_bl_local_charges`, `run_billing_for_import_batch`): quem não é admin só passa `p_actor = auth.uid()` ou nulo | Financeiro com `p_actor` de outro usuário é recusado |
| 2.5 | #5 | Gatilho `BEFORE INSERT` em `audit_logs` que, para `authenticated`, sobrescreve `actor_role`/`actor_department` com `current_actor_role()` e `changed_at` com `now()` | linha inserida com data e departamento falsos sai com os valores reais |
| 2.6 | #6 | Mover a checagem de sessão, usuário ativo e `p_changed_by = auth.uid()` para o início de `save_bl_review`, antes de qualquer leitura do B/L | usuário do Portal recebe o mesmo erro para B/L de outro Cliente e para B/L inexistente |
| 2.7 | #11 | `DROP POLICY customers_delete_admin, customer_contacts_delete_admin` e `REVOKE DELETE … FROM authenticated`, como a `088` fez com B/L; conferir se algum caminho do front usa DELETE direto nessas tabelas antes de revogar | Administrativo não apaga Cliente com CNPJ nem após `run_retention()`; `delete_records` continua funcionando |
| 2.8 | #13b + #13 (D2) | Tirar o INSERT duplicado em `customer_contact_box_links` de `ensure_customer_contact_email` (o gatilho da `008` já vincula) **e**, no mesmo item, aplicar D2: contato `bl_automatico` sem promoção a principal; a consulta de candidatos a convite expõe a `origin` real | importação com e-mail de consignatário novo passa; o contato criado segue D2 e não aparece em `evaluate_and_dispatch_automatic_communications` antes da confirmação |
| 2.9 | #9 (parte do banco) | RPC `service_role` que apaga `auth.sessions`/`auth.refresh_tokens` de um usuário interno, nos moldes de `portal_revoke_sessions` | sessões do usuário somem; `authenticated` não executa a RPC |

Reforços incluídos (D4 = a): `retry_import_effect` com os nomes de papel
atuais; políticas `app_settings_administrativo_update` e
`exchange_rate_reference_internal_read` sem `_portal_actor_role()`; `REVOKE`
de `import_breakbulk_manifest_transactional_031` para `authenticated`;
`REVOKE` de USAGE/UPDATE em sequências e SELECT em tabelas para `anon`; limite
de tamanho de `p_file_name` em `add_demurrage_dispute_attachment`.

Observação da auditoria a conferir no mesmo teste: um `SELECT` direto de
usuário interno em `demurrage_disputes` lança "Sessao do portal invalida". Se
alguma tela interna lê a tabela direto, corrigir a política para devolver
nulo em vez de lançar.

Verificação: gates de schema do [WORKFLOW.md](../../WORKFLOW.md) §11
(`migrations:check`, `rpc:check`, suíte `local-pg` nova e as existentes de
Demurrage, importação e exclusão). Aplicação em produção só depois do merge,
pelo procedimento normal; registrar a confirmação em `schema_migrations`.

## Fase 3 — Edge Functions

1. **#8.** Em `admin-users` (`update_credentials` e `deactivate`): recusar
   `user_id` sem linha em `user_profiles`, presente em
   `customer_portal_accounts.auth_user_id` ou igual a
   `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`; responder 404 para `user_id` sem perfil.
2. **#9.** Trocar `admin.auth.admin.signOut(userId)` pela RPC do item 2.9, em
   `deactivate` e em toda troca de senha ou e-mail; falha vira erro, não aviso.
   Reforço: tratar o erro de `audit()` como erro.
3. **#10.** Em `send-customer-communication`, re-renderizar `livre` e
   `institucional` no servidor a partir de `subject`/`body` com o renderizador
   compartilhado, e gravar assunto e corpo (ou hash e cópia) no registro do
   comunicado. Se isso pedir coluna nova, ela entra na migration `100`.
4. **#7 (D1).** Implementar a opção escolhida em `portal-login`,
   `portal-invite-activate`, `portal-password-reset` e
   `portal-recovery-email-change`; corrigir `docs/modules/clientes.md` ("o
   navegador nunca conhece o email técnico" é falso: o claim `email` do JWT o
   expõe).
5. Reforços: `escapeHtml` no e-mail de cobrança agrupado
   (`demurrage-dunning`); Turnstile nega por padrão fora do ambiente local;
   `portal-account-suspend` cancela convites pendentes e valida o estado atual;
   `portal-invite-activate` exige `account_situation` pendente e
   `auth_user_id` nulo; imports `esm.sh` com versão exata e `deno.lock`.

Verificação: testes Deno/unitários existentes das funções tocadas mais um caso
por item; o comportamento contra GoTrue real (itens 2 e 4) fica registrado como
não verificado até rodar na Preview.

## Fase 4 — Front-end

1. **#12 (D3).** `flowType: 'pkce'` no cliente interno de
   `src/services/supabase.ts`; conferir a troca de e-mail em `Profile.tsx` na
   Preview e atualizar o contrato de sessão no [WORKFLOW.md](../../WORKFLOW.md).
2. Reforço: `redactTelemetryUrl` (`src/lib/telemetryContract.ts`) remove
   também o fragmento `#…`; teste unitário com `#access_token=`.
3. Reforço: logout interno limpa o cache do TanStack Query.
4. Reforço: `downloadCsv` põe aspas quando houver `\r`; `formatIssuesAsCsv`
   passa a usar `downloadCsv`.
5. **#1, parte do front.** O modal de Disputa em `src/pages/Demurrage.tsx` e
   `updateDemurrageInvoice` (`src/services/demurrage/demurrageInvoices.ts`)
   deixam de enviar `dispute_open`/`dispute_status` e passam pelas RPCs
   `add_demurrage_dispute_message`/`reopen_demurrage_dispute`, com a
   invalidação de cache já usada por elas. Entra na mesma PR da Fase 2.

Verificação: `typecheck`, `lint`, `test`, `build`; fluxo de troca de e-mail e
de Dispute observado na Preview.

## Fase 5 — CI e hospedagem

1. **#14.** Declarar `environment:` nos jobs que usam os tokens
   (`cloudflare-pages-preview.yml`, `cloudflare-pages-preview-cleanup.yml`, `provision-preview-admin.yml`),
   casando com a Fase 1; em `provision-preview-admin.yml`, secrets só no `env`
   dos steps que os usam.
2. Reforços: actions dos jobs com token fixadas por SHA; o job `publish`
   recusa `_worker.js` e `_routes.json` no diretório construído pela PR;
   `::add-mask::` nas credenciais da branch em `load-branch-env.mjs`.
3. Reforços após o desligamento da Vercel (2026-10-01): remover as origens
   legadas do CORS (`_shared/cors.ts`) e restringir `connect-src` ao host do
   projeto Supabase na CSP (`vercel.json` e `cloudflare-pages-stage.mjs`).

Verificação: um push de teste numa branch sem acesso ao environment não recebe
os tokens; Preview e produção publicam normalmente.

## Encerramento

- Cada fase em PR própria; a Fase 2 leva junto o item 4.5.
- Ao concluir, mover este plano para `docs/archive/plans/`, tirar a linha de
  `docs/plans/README.md` e registrar no `docs/CHANGELOG.md`.
- Fica fora deste plano: verificação independente dos candidatos que não
  forem tocados, histórico git (segredos antigos) e os críticos de cobertura
  que a run-2 não rodou; uma run-3 cobre isso.
