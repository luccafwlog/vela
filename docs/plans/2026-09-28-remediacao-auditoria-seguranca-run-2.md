# Plano — Remediação da auditoria de segurança run-2

Data: 2026-09-28. Estado: em execução desde 2026-09-29; decisões D1–D4 tomadas
(ver "Decisões").

| Parte | Situação |
|---|---|
| Fase 1 — configuração de terceiros | secrets cadastrados nos environments; validação, remoção das cópias de Repository secrets, deploy key e ruleset pendentes; o dono recusou restringir Preview à `main` |
| Fase 2 — migration `106` e item 4.5 | migrations até `159` em produção; Dispute/Storage e próxima ação validados com Equipamentos; falta importação com e-mail de consignatário novo e tentativa direta de Storage em sessão Financeiro |
| Fase 3 — Edge Functions | código entregue pela luccafwlog/vela#812 (migration `108`, aplicada em produção); Comunicado validado em simulação em produção em 2026-10-06; envio real a destinatário controlado continua opcional |
| Fase 4 — front-end (exceto 4.5) | código entregue pela luccafwlog/vela#813; troca de e-mail com PKCE ainda sem validação numa Preview publicada |
| Fase 5 — CI e hospedagem | código dos workflows entregue pela luccafwlog/vela#814; cleanup real listou zero deployments antigos; provisionamento Cloudflare falhou com HTTP 400; ajuste de paginação local aguarda merge e reexecução; Preview publicada pendente |
| Reforços adicionais (D4 = b) | banco, Edge Functions e front-end entregues em código pelas PRs #815 e posteriores; segredos de cron e execução agendada do backup seguem pendentes; recálculo só de `issued` confirmado como regra de negócio |

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

## Estado em 2026-09-29 (fim da sessão)

Feito pelo dono, em produção: `PORTAL_PASSWORD_PEPPER` criado, `TURNSTILE_SECRET_KEY`
conferido, as 18 Edge Functions publicadas e a Etapa 2 do roteiro testada com
sucesso (login e relogin do Portal, senha errada, recuperação, convite e
ativação, desativação de usuário interno derrubando a sessão, botão Informar
PTAX para Equipamentos). Migrations `106`, `108`, `109` e `110` aplicadas.

Falta, nesta ordem:

1. **Comunicado (teste 2.7):** enviar um Comunicado em simulação (chave de envio
   desligada) e pedir a conferência no banco de `rendered_subject`,
   `rendered_text`, `rendered_html_sha256` e navio/viagem vindos dos B/Ls; testar
   a recusa de `.txt` renomeado para `.pdf`. O institucional só alcança Cliente
   Comunicável (regra mantida pelo dono): o Cliente de teste precisa de B/L com
   ETA nos últimos 12 meses, ou usar o tipo livre num Cliente com B/L. Repetir
   com envio real quando a chave for ligada.
2. **Fase 1 / Etapa 3 do roteiro:** environments `cloudflare-pages`,
   `supabase-branches` e `cloudflare-production` e secrets cadastrados. Validar
   os workflows; só então apagar os Repository secrets (inclusive o legado
   `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`), revogar os tokens antigos,
   criar o ruleset de `.github/workflows/**` e revisar quem tem push. A
   restrição de Preview à branch `main` foi recusada pelo dono em 2026-10-06.
   Anotar se o captcha do Auth está desligado (item 5).
3. **Etapa 4 (Preview):** troca de e-mail com PKCE no mesmo navegador e em
   outro; Dispute (Equipamentos anexa, Financeiro é recusado); importação com
   e-mail novo de consignatário; header `connect-src` sem `*.supabase.co`.
4. **Etapa 5 (operação):** rotacionar os segredos de cron do Vault
   (`docs/operations/segredos-cron.md`); PR fixando versões em `.mcp.json` e
   `opencode.json`; backup em bucket/chave R2 dedicados.
5. Com 1–4 feitos: registrar as evidências aqui, mover o plano para
   `docs/archive/plans/`, tirar a linha de `docs/plans/README.md` e registrar no
   `docs/CHANGELOG.md`.

A mensagem da conferência vazia no modo Institucional passou a explicar a regra
de Cliente Comunicável em vez de falar em "carga".

## Retomada em 2026-10-06

Plano permanece em execução; não arquivar enquanto os itens abaixo estiverem
pendentes. Produção observada com frontend `085520e7eb16`, projeto Supabase
`fgmkhbzhaeebrsizwccx`. A sessão do Vela é Administrativo; a do Portal usa um
Cliente de teste. Evidência detalhada em
[relatório da retomada](../archive/reports/2026-10-06-remediacao-run-2-retomada.md).

- **Runtime confirmado:** migrations `106`, `108`, `109`, `110` presentes;
  `connect-src` dos dois domínios restringe Supabase ao projeto, sem wildcard.
- **Comunicado parcialmente validado:** conferência institucional chegou ao
  Cliente de teste; primeiro disparo falhou porque o catálogo estrutural estava
  vazio. Dono autorizou reposição, executada em produção por INSERT idempotente
  (dez pares da migration `002`), sem ligar envio real. Migration local `157`
  registra a correção para replay e deploy pelo fluxo normal. Novo disparo
  persistiu assunto, texto e hash do HTML, com navio/viagem nulos como exige o
  institucional; porém a tentativa ficou `falha_permanente` em modo simulado.
  Correção publicada com autorização do dono em 2026-10-06 (22:19 de Brasília):
  `send-customer-communication` v169 e `demurrage-dunning` v166. Repetição
  institucional confirmou comunicado `id=2`, status `simulado`, duas tentativas
  `aceito`, sem erro/ID do provedor, e chave global desligada. Assunto, texto e
  hash persistidos; navio/viagem nulos. Livre validado em produção (`id=3`): navio GREEN TAICANG, viagem 4 derivados
  do B/L `CSC45370901400`, assunto/texto/hash persistidos, duas tentativas
  aceitas em simulação. Texto simples com extensão `.pdf` recusado pela
  Function antes da criação do comunicado/anexo. Falta envio real a
  destinatário controlado. O registro anterior de falha permanece como
  evidência; o runner Demurrage foi publicado, mas não executado neste teste.
- **GitHub pendente:** environments `cloudflare-pages` e `supabase-branches`
  existem, mas sem secrets e sem restrição de deployment branch. As três
  credenciais e o secret legado continuam em Repository secrets. Repositório
  agora privado (drift do plano); rulesets recusados com HTTP 403 por limitação
  da conta. Dono precisa decidir/habilitar plano compatível; não tornar público
  como alternativa automática. Único colaborador retornado pela API: dono,
  com admin; deploy keys e aplicativos ainda precisam de revisão.
- **Acessos revisados em 2026-10-06:** 12 GitHub Apps instalados e uma deploy
  key `Codex workspace - Transhipping Desk` com `read/write`, usada nos últimos
  três meses. Nada removido; revisão/remoção da chave fica para o dono. A
  limpeza de Preview da PR #872 falhou com HTTP 400 no primeiro GET; script
  ajustado para `per_page=25` e quatro testes passam. Execução real futura ainda
  necessária.
- **Operação:** backup já possui bucket/chave dedicados, conforme evidência de
  2026-10-05 no manual; sucesso da tarefa agendada seguinte ainda não observado.
  Versões fixadas em `.mcp.json` e `opencode.json` na retomada. Vault mostra os
  segredos antigos sem atualização; rotação em par com as Edge Functions ainda
  pendente. `IMPORT_EFFECTS_CRON_SECRET` e `RECALC_CRON_SECRET` ausentes no Vault;
  verificar procedimento/estado de ativação antes de provisionar ou agendar.
- **Validação por identidade pendente:** PKCE no mesmo/outro navegador, Storage
  e modal de Dispute com Equipamentos/Financeiro, importação com e-mail novo,
  testes dos workflows com secrets nos environments. Captcha Auth conferido desligado no painel em 2026-10-06; sem alteração.
- **Storage — teste de Equipamentos em 2026-10-06:** dono autorizou fixture ABF
  sem cobrança/e-mail/pagamento. Invoice `id=1`, rascunho, USD 0, sem TXID;
  Dispute `id=1`, documento `TEST-RUN2-DISPUTE-20261007`. Sessão real do André
  (frontend `2159842`) gravou mensagem `id=1`, mas upload TXT retornou HTTP 500.
  Log do banco: sessão Portal inválida (`28000`). Reproduzido localmente na
  leitura RLS de Disputes; migration `158` troca a composição booleana por
  `CASE`, preservando setores/autoria/estado/escopo. Treze testes SQL locais
  passam, incluindo upload próprio permitido e Financeiro/outra autoria/
  disputa fechada recusados. Aplicação autorizada em produção concluída em 2026-10-06 (22:45–22:46 de Brasília); reteste pela sessão do André gravou objeto TXT de 94 bytes e metadados de anexo `id=1`, mensagem `id=2`, com autoria correta. Sessão real de Financeiro (Thuani) conferida: fila/resposta/anexo ausentes; recusa direta no Storage com essa sessão ainda não executada (restrição SQL local aprovada).
  Também observado: trigger de lifecycle devolve próximo responsável para
  Equipamentos após resposta destinada ao Cliente; reproduzido localmente; migration `159` preparada para sincronizar somente mudanças reais de estado da Invoice, sem sobrescrever a próxima ação da conversa. Migration `159` aplicada em produção com autorização do dono; reteste pela sessão de Equipamentos confirmou `next_responder=cliente` na tela e no banco (mensagem `id=3`).

Auth Hooks conferido no painel em 2026-10-06: organização Pro, sem hooks
configurados; Password Verification Attempt exige Team/Enterprise. Confirma
fallback D1(a), já implementado com HMAC/pepper. URL Configuration ainda usa
Site URL `https://transhippingdesk.com.br` e oito redirects legados Vercel;
registrado como drift a resolver antes de comprovar redirecionamentos Auth/PKCE.
Nenhuma configuração alterada nesta conferência.

## Pendências consolidadas em 2026-10-07

As pendências executáveis restantes são:

1. **GitHub e credenciais:** os secrets foram cadastrados nos environments
   `cloudflare-pages`, `supabase-branches` e `cloudflare-production`. Validar
   os workflows; depois remover as cópias antigas dos Repository secrets,
   inclusive
   `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`, e rotacionar os tokens. Isso
   exige ação do dono sem compartilhar valores no chat.
2. **Acessos e proteção:** revisar/remover a deploy key
   `Codex workspace - Transhipping Desk` (`read/write`) e criar o ruleset para
   `.github/workflows/**`. A conta atual recebeu HTTP 403 ao tentar criar
   rulesets; não tornar o repositório público como atalho.
3. **Preview:** publicar uma Preview válida após validar as credenciais e
   testar troca de e-mail com PKCE no mesmo e em outro navegador. O workflow de
   limpeza já executou em 2026-10-07 após o ajuste `per_page=25`; terminou com
   sucesso e não encontrou deployments antigos para remover, então o endpoint
   DELETE não foi exercitado.
4. **Importação:** executar importação real com e-mail novo de consignatário.
5. **Operação:** rotacionar secrets dos jobs no Vault, decidir o procedimento
   para `IMPORT_EFFECTS_CRON_SECRET` e `RECALC_CRON_SECRET`, e observar o
   próximo backup agendado com sucesso.
6. **Comunicado:** opcionalmente executar um envio real para destinatário
   controlado; as validações em simulação e a rejeição de PDF falso já estão
   concluídas.
7. **Dispute:** a interface do Financeiro foi conferida e não oferece ações;
   falta apenas a tentativa direta de upload sob essa sessão para fechar a
   evidência runtime. Storage e próxima ação foram validados com Equipamentos.

O dono recusou restringir os environments à branch `main`; essa proteção fica
como risco aceito e não será aplicada. O plano permanece em `docs/plans/` até
as pendências acima serem concluídas ou formalmente assumidas.

## Conferência adicional em 2026-10-07

Consultas somente de leitura, sem alterar produção ou exibir valores de
segredos:

- **Supabase:** projeto `fgmkhbzhaeebrsizwccx`, PostgreSQL `17.6.1.104`, com
  migrations até `159` registradas. Os seis jobs do manual que chamam Edge
  Functions estão ativos e usam `ops.dispatch_edge_job`;
  `recalc-demurrage-ptax` não está
  agendado. O Vault contém os nomes `SUPABASE_URL`, `PORTAL_DIGEST_SECRET`,
  `ALERTS_DETECTOR_SECRET`, `DEMURRAGE_DUNNING_SECRET`,
  `CUSTOMER_COMMUNICATION_AUTOMATION_SECRET` e
  `PORTAL_EMAIL_EVENTS_CRON_SECRET`; `IMPORT_EFFECTS_CRON_SECRET` e
  `RECALC_CRON_SECRET` não existem nele. Os detalhes recentes de
  `portal-email-events-runner` e `import-effects-runner` registram sucesso do
  wrapper `pg_cron`. Os 12 status HTTP mais recentes de `net._http_response`
  são 200, mas não foram correlacionados a um job individual. Sem
  `IMPORT_EFFECTS_CRON_SECRET` no Vault, o dispatcher avisa e não chama a Edge
  Function; o sucesso do wrapper não comprova processamento de importações.
  Também não há prova de execução de `recalc-demurrage-ptax` nem de rotação
  dos pares de segredos.
- **GitHub:** todos os três environments têm os secrets esperados: o token
  Pages em `cloudflare-pages` e `cloudflare-production`, e o PAT Supabase e a
  senha de Preview em `supabase-branches`. O PAT foi criado com escopo de um
  projeto, `Development Branches: Read` e prazo de um ano. `cloudflare-production`
  tem política para `main`; os dois environments de Preview não têm restrição
  de branch, conforme decisão do dono. As cópias Repository-level de
  `CLOUDFLARE_PAGES_API_TOKEN`, `SUPABASE_ACCESS_TOKEN` e
  `PREVIEW_ADMIN_PASSWORD` continuam presentes até a validação. Também
  permanecem `SUPABASE_PROJECT_REF` (usado pelos workflows) e o legado
  `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`.
  A API lista somente o dono como colaborador e confirma a deploy key
  `Codex workspace - Transhipping Desk` com escrita. A consulta de rulesets
  continua retornando HTTP 403 para o repositório privado; não foi tentada
  alteração de visibilidade nem de plano.
- **Workflows:** o cleanup da PR #876 concluiu com sucesso em 2026-10-07
  02:21 UTC após o ajuste de paginação; o log encontrou zero deployments
  antigos nos dois projetos Pages e não executou DELETE. A listagem/paginação
  real passou, mas a exclusão não foi exercitada. O workflow de Preview
  correspondente não publicou: o job `prepare` recusou prosseguir quando a
  verificação Supabase Preview terminou como `skipped`, e `build`/`publish`
  foram ignorados. Uma Preview válida ainda é necessária para PKCE, importação
  e teste com as identidades autorizadas.
- **Cloudflare Pages:** o dono conferiu que o token novo está no escopo da
  conta correta, com `Cloudflare Pages: Edit`, sem filtro de IP nem expiração.
  A execução de provisionamento `37608023373` em 2026-10-07 recebeu o secret
  mascarado e o ID de conta correto, mas a listagem de projetos respondeu
  HTTP 400. O script informa só o status e omite o corpo de erro da API. Uma
  hipótese em teste é o parâmetro `per_page=100`; localmente ele foi reduzido
  para `25`, como no cleanup, com regressão reproduzida no teste. Ainda falta
  executar o código atualizado em `main`; portanto a causa do HTTP 400 e a
  validade operacional do token seguem sem confirmação.
- **Validação local:** `npm test` em macOS, Node 24.16.0, terminou com 3.975
  testes aprovados e 404 ignorados. Nenhuma alteração de produção foi feita
  nesta conferência.

O backup seguinte ao ajuste de `consumeArchive` ainda depende da tarefa
agendada no computador Windows descrito em [serviços externos](../operations/servicos-externos.md#backup);
esta máquina de execução macOS não permite confirmar seu `LastTaskResult`.
O plano continua aberto.

## Decisões

Em 2026-10-06, o dono recusou restringir os environments GitHub à branch
`main`. Não aplicar essa restrição. O controle fica fora da execução por
decisão do dono, com risco aceito; não marcar como corrigido. A recusa não
cancela as demais pendências, inclusive credenciais e validação de workflows.

Respondidas pelo dono em 2026-09-29: **D1 = (b)** (cai para (a) se o plano
do Supabase não oferecer o hook), **D2 = (c)** (manter como hoje; o item 2.8
só remove o INSERT duplicado), **D3 = (a)**, **D4 = (b)** (todos os reforços
da auditoria; ver "Reforços adicionais (D4 = b)").

Drift mecânico: as migrations `100`–`105` já existem em `main`; a migration
desta fase é `106_remediacao_auditoria_run_2.sql` (a `105` foi ocupada pela
fatura avulsa enquanto esta PR estava aberta).

| # | Pergunta | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| D1 | Como fechar o teste de senha direto no GoTrue (#7)? | (a) guardar no GoTrue `HMAC(pepper, senha)` e migrar no próximo login; (b) *Password Verification Hook* com o balde por CNPJ; (c) aceitar o risco e só reduzir o limite por IP do Auth | (b), se o plano do Supabase oferecer o hook; senão (a). (c) não fecha o caminho | Fase 3, item 3.4 |
| D2 | Contato capturado do e-mail do consignatário (#13/#13b) | (a) nasce **inativo** e sem caixa até a equipe confirmar na Revisão; (b) nasce ativo só na caixa `documentacao_operacao`, sem virar principal; (c) manter como hoje (ativo e principal quando não houver outro) | (a). Depende de o negócio confirmar quem escreve esse e-mail no documento de origem | Fase 2, item 2.8 |
| D3 | Troca de e-mail do usuário interno com PKCE (#12) | (a) `flowType: 'pkce'`: o link de confirmação só funciona no mesmo navegador que pediu a troca; (b) manter `implicit` e só limpar o fragmento na telemetria | (a); a troca de e-mail é rara e a restrição é aceitável | Fase 4, item 4.1 |
| D4 | Escopo dos reforços | (a) só os reforços listados neste plano; (b) todos os reforços da auditoria | (a); os demais ficam no anexo da auditoria como referência | Fases 2–5 (itens marcados "reforço") |

## Fase 1 — Configuração de terceiros (dono, sem código)

Registrar cada mudança em [serviços externos](../operations/servicos-externos.md)
na mesma PR que a documenta; nomes e locais de secrets, nunca valores.

1. **#14 (média).** Environments `cloudflare-pages`, `supabase-branches` e
   `cloudflare-production` configurados; secrets registrados neles em
   2026-10-07. O novo PAT Supabase é escopado ao projeto com
   `Development Branches: Read`; a credencial Cloudflare recebeu
   `Cloudflare Pages: Edit`. Validar os workflows; só então apagar as cópias
   Repository-level e revogar os tokens antigos. Para jobs que declaram um
   environment, o GitHub usa o secret do environment quando há outro de mesmo
   nome no repositório. Não restringir os environments de Preview à branch
   `main`, conforme decisão do dono em 2026-10-06. Os workflows da Fase 5 já
   declaram `environment:`; a correção local da paginação de provisionamento
   ainda precisa chegar a `main` e ser validada.
2. **#14.** Conferir quem tem push no repositório (inclusive as credenciais dos
   agentes) e criar um ruleset que exija revisão para `.github/workflows/**`.
3. Reforço: apagar o secret legado `FIREBASE_SERVICE_ACCOUNT_TRANSHIPPING_DESK`.
4. **#13b, fato que falta.** No banco de produção, só leitura: confirmar se o
   gatilho `trg_seed_customer_contact_box_links` existe. Se existir, a
   importação com e-mail de consignatário novo está falhando hoje.
   **Resposta (2026-09-29, leitura em produção):** o gatilho existe. Até a
   `106`, essas importações falhavam por inteiro; a `106` corrigiu o caminho.
5. **#7, fato conferido em 2026-10-06.** Captcha desligado no painel de produção. Anotar em Authentication → Attack Protection se o
   captcha está desligado; não ligar sem a Fase 3 (o `portal-login` não envia
   `captchaToken` e passaria a falhar para todos).
6. Reforço: confirmar que `TURNSTILE_SECRET_KEY` existe nos secrets das Edge
   Functions de produção (sem ele o Turnstile libera tudo).

Verificação: capturas do painel anexadas à PR de documentação; nenhum workflow
de Preview ou produção quebrado no primeiro push após a mudança.

## Fase 2 — Migration `106` (banco)

Uma migration nova, `supabase/migrations/106_remediacao_auditoria_run_2.sql`,
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

Execução (2026-09-29): os 10 casos falharam antes da `106` e passam depois,
em Postgres 16 local (Windows, replay equivalente ao `setup-local-pg.sh`).
Diferenças do desenho: 2.4 virou envelope das definições vigentes renomeadas
para `_*_impl_106` com a checagem `_assert_actor_is_caller`; a política
`app_settings_administrativo_update` foi removida (não há grant de UPDATE em
`app_settings` para `authenticated`); o gatilho de 2.5 só age quando
`current_user = 'authenticated'` (INSERT direto), preservando o que funções
SECURITY DEFINER gravam. Nenhuma tela interna lê `demurrage_disputes` direto,
então a política dessa tabela ficou como está. A política de storage de 2.2
não roda localmente (sem `storage.objects`): só verificada em Preview.

Verificação: gates de schema do [WORKFLOW.md](../../WORKFLOW.md) §11
(`migrations:check`, `rpc:check`, suíte `local-pg` nova e as existentes de
Demurrage, importação e exclusão). Aplicação em produção só depois do merge,
pelo procedimento normal; registrar a confirmação em `schema_migrations`.

Produção (2026-09-29, leitura no projeto `fgmkhbzhaeebrsizwccx`): a integração
GitHub do Supabase aplicou a `106` após o merge da luccafwlog/vela#799;
`schema_migrations` registra `106 remediacao_auditoria_run_2`,
`internal_revoke_sessions` existe e `authenticated` não tem UPDATE em
`demurrage_invoices.dispute_open`. Não observado em produção: fluxo de tela,
Storage e importação real.

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

Execução (2026-09-29): a organização Supabase está no plano **Pro**, e o
*Password Verification Hook* só existe em Teams/Enterprise; D1 caiu para (a).
O GoTrue passa a guardar `HMAC(PORTAL_PASSWORD_PEPPER, senha)`
(`_shared/portalPasswordSecret.ts`); conta com senha pura entra pelo
`portal-login` e migra nesse login. Drift mecânico: a coluna do item 3 entrou
na migration `108_customer_communication_rendered_copy.sql` (a `100` já
existia); o registro guarda assunto, texto e SHA-256 do HTML enviados. Na
reativação, o usuário técnico antigo é banido (não apagado: há registros que o
referenciam). `deno.lock` gerado com Deno 2.9.6; `deno check` das funções
tocadas não acrescenta erros aos que `main` já tinha.
Evidência: `src/services/__tests__/edgeFunctionsRun2.test.ts` e
`portalLoginIdentity.test.ts` (unitário + contrato no fonte); gates do
`WORKFLOW.md` §11 verdes, `rpc:check` em Postgres 16 local. Não observado:
GoTrue real, Turnstile real, publicação das Functions (manual, depois do
secret).

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

Execução (2026-09-29): itens 1–4 feitos; `formatIssuesAsCsv` e
`downloadIssuesCsv` passam por `formatCsv`/`downloadCsv` de `src/lib/csv.ts`.
Entraram junto os dois reforços de front-end da lista D4 = b: CNPJ no caminho
de `event.request.url` sai pelo `scrubPii` (drift mecânico:
`VERCEL_DYNAMIC_ROUTE_REDACTIONS` não existe mais no repositório após a saída
da Vercel) e `FORMULA_INJECTION_PREFIX` cobre espaço à esquerda e `＝＋－＠`.
Evidência: `src/lib/__tests__/run2FrontendHardening.test.ts` e o caso novo de
`useAuthHydrationFailure.test.tsx`. Não observado: link de troca de e-mail com
PKCE num navegador real.

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

Execução (2026-09-29): `environment:` em `prepare` (`supabase-branches`) e
`publish` (`cloudflare-pages`) da preview, na limpeza, em
`provision-preview-admin.yml` (secrets movidos para o `env` dos steps) e, por
drift mecânico, também em `cloudflare-pages-provision.yml`, que usa o mesmo
token. O workflow de produção já usa `cloudflare-production`: ao mover o token
para environments, ele precisa de uma cópia lá (registrado em serviços
externos). O `publish` recusa `_worker.js`, `_routes.json` e `functions/` nos
artefatos; `load-branch-env.mjs` emite `::add-mask::`. Evidência:
`scripts/cloudflare-pages-workflow.test.mjs` e `load-branch-env.test.mjs`.
Não observado: execução dos workflows com os environments configurados
(depende da Fase 1).

Item 3 (2026-09-29, Vercel já desligada, confirmado pelo dono): a allowlist
de `_shared/cors.ts` não tinha mais origem da Vercel e `vercel.json` não existe
(drift mecânico). O `connect-src` gerado por `cloudflare-pages-stage.mjs` passa
a liberar só o projeto Supabase de `VITE_SUPABASE_URL` do build (produção ou
branch de Preview), não `*.supabase.co`; o CI usa um projeto fictício quando a
PR não tem acesso a secrets. Evidência: `cloudflare-pages-stage.test.mjs`.

## Reforços adicionais (D4 = b)

Com D4 = (b), entram também os reforços do anexo da auditoria que não estavam
listados acima. Cada um segue a regra do plano: reproduzir antes de corrigir.
Os que dependem de regra de negócio ficam anotados, não implementados.

- Banco (migration própria depois da `106`): `recalculate_demurrage_invoices_manual`
  restrita a Financeiro e Administrativo; `portal_add_dispute_message` e
  `portal_invoice_details` com a trava de liberação do Portal; mensagens de
  Dispute sem `author_id`/`uploaded_by` para o Portal; bounce temporário não
  vira `bounce_permanente`; DELETE direto de viagem vazia exige motivo; ordem
  de travas entre baixa e estorno de fatura local; `portal_obsolete_consolidation`
  recusa com PIX pendente; contagem deduplicada na notificação de consolidada.
- Edge Functions: anexos de Comunicado com checagem de assinatura e extensão;
  campos cosméticos do histórico de cobrança derivados do banco; cliente
  desativado ignorado em recuperação, convite, Comunicados e resumo diário;
  reativar a conta do Portal apaga ou bane o usuário antigo do Auth;
  `portal-recovery-email-change` com cota e conta ativa; `portal-login` checa
  `active`; `portal-invite-activate:41` com `.eq('status','consumido')`;
  limpeza de anexos órfãos de Dispute; cota e sessão checadas antes do upload
  de 10 MB.
- Front-end: `beforeSend` do Sentry reaproveita `VERCEL_DYNAMIC_ROUTE_REDACTIONS`;
  `FORMULA_INJECTION_PREFIX` cobre espaço à esquerda e caracteres de largura total.
- Operação (dono): rotacionar os segredos de cron do Vault; `.mcp.json` e
  `opencode.json` com versões fixas; backup em conta ou pasta dedicada.
- ~~Precisa de regra de negócio antes: `recalculate_demurrage_invoices` também
  para `overdue`.~~ Decisão do dono (2026-09-29): o recálculo diário atualiza
  só as faturas `issued`, para que elas nunca vençam; `overdue` fica fora de
  propósito. Nada a implementar.

Execução (2026-09-29): banco na migration `109_reforcos_auditoria_run_2.sql`
com a suíte `src/integration/auditoriaRun2Reforcos.local-pg.test.ts` (7 casos
falham sem a `109` e passam com ela, Postgres 16 local; lista serializada do
CI atualizada). Diferenças do desenho: as mensagens e anexos de Dispute já
saíam do `portal_list_disputes` sem `author_id`/`uploaded_by`; o que expunha o
UUID era o SELECT direto, e as políticas `*_portal_read` dessas duas tabelas
foram removidas. A viagem vazia deixou de ter DELETE direto (sai só por
`delete_records`, com motivo). O estorno de baixa local virou envelope que
pega o advisory por B/L e trava os recebíveis antes da implementação
renomeada `_reverse_invoice_payment_impl_109`. "PIX em trânsito" é exceção
PIX ativa com o TXID da fatura. O botão **Informar PTAX** em `/demurrage` só
aparece para Financeiro e Administrativo. Correção do dono (2026-09-29):
Equipamentos também informa PTAX; a migration `110_ptax_manual_equipamentos.sql`
e a tela incluem o setor. Edge Functions: helper
`_shared/fileSignature.ts` (anexos de Comunicado e de Dispute); navio e viagem
do histórico de Comunicado vêm dos B/Ls; Cliente desativado fica fora de
recuperação, convite, Comunicados e resumo diário; troca do Email de
Recuperação exige conta ativa e aceita 5 pedidos por dia; `portal-login` exige
`active`; anexo de Dispute confere `Content-Length`, sessão e cota antes de ler
o arquivo; `alerts-detector` remove até 100 anexos órfãos por execução. Os
dois reforços de front-end entraram na luccafwlog/vela#813. Não observado:
Functions publicadas, Storage real e e-mails reais.

## Encerramento

- Cada fase em PR própria; a Fase 2 leva junto o item 4.5.
- Ao concluir, mover este plano para `docs/archive/plans/`, tirar a linha de
  `docs/plans/README.md` e registrar no `docs/CHANGELOG.md`.
- Fica fora deste plano: verificação independente dos candidatos que não
  forem tocados, histórico git (segredos antigos) e os críticos de cobertura
  que a run-2 não rodou; uma run-3 cobre isso.
