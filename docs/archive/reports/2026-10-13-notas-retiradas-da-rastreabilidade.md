# 2026-10-13 — Notas retiradas da rastreabilidade

> **Registro histórico.** Trechos retirados de `docs/RASTREABILIDADE.md` na
> [revisão geral da documentação de 2026-10-13](../plans/2026-10-13-revisao-geral-documentacao.md)
> (achado R-19), preservados como estavam no documento vivo naquela data. Eles
> narram entregas e verificações datadas; não descrevem o estado atual. Os
> números de migration seguem a convenção da época: sem qualificação, e em boa
> parte da cadeia arquivada (`supabase/migrations_archive/`, anterior à
> consolidação da ADR 0062). A rastreabilidade vigente está em
> [`docs/RASTREABILIDADE.md`](../../RASTREABILIDADE.md). As notas cronológicas
> mais antigas estão em
> [2026-09-19-notas-historicas-rastreabilidade.md](2026-09-19-notas-historicas-rastreabilidade.md).

## Notas de entrega

### Entrega PR 714 — revisão de B/L, CNPJ e frete (2026-09-21)

- `/bls`: o menu de ações mantém Copiar número, Abrir detalhes e Excluir para
  os perfis aplicáveis, abre no primeiro item acionável, navega por teclado e
  limita sua posição ao viewport; a cópia confirma sucesso somente depois do
  `clipboard.writeText` e exibe erro quando a área de transferência falha.
- Importação de B/L: `blParser.ts` e `073_purge_bogus_freight_lines.sql` usam
  critérios restritos e alinhados para descartar apenas cabeçalhos/cláusulas
  documentais sem valor numérico; linhas legítimas com descrição longa,
  percentuais, quantidades ou cobranças `RATE/PER/PREPAID/COLLECT` permanecem.
- CNPJ: campos de entrada aceitam o valor formatado completo (18 caracteres)
  antes da normalização canônica para 14 dígitos.

### Entrega PR 579 — Escala e Atracação por terminal (2026-08-24)

Esta entrega separa os donos das datas sem criar uma tabela `port_calls`:

- `/viagens` e `/viagens/:voyageId`: `VoyageScheduleModals.tsx`,
  `VoyageVisaoTab.tsx`, `VoyageCreateModal.tsx`, `Viagens.tsx`,
  `voyageRouteSchedules.ts`, `escalaTerminalAllocation.ts`, `voyageForm.ts` e
  `voyageFromSchedule.ts` projetam e gravam ETA/ATA na Escala e ETB/ATB/ETD/
  ATD/Restow nas Atracações, inclusive a linha TBC.
  `listVoyageTerminalScaleStatesByVoyageIds` resolve `terminal_id` em
  `depots.code`: o código é o rótulo da Atracação no planejamento e o critério
  de desempate da ordem derivada.
- `/painel` e `/line-up-tv/display`: `lineup.ts` e `escalaState.ts` consomem a
  mesma ordenação `COALESCE(ATB, ETB)` por terminal e derivam as datas do
  primeiro terminal de cada sentido. O ATD da linha é o das Atracações daquele
  sentido — só existe quando todas desatracaram — e recai no ATD derivado da
  Escala quando o sentido não tem terminal atribuído.
- `/viagens/:voyageId?tab=adr&escala=...`: `agencyDepartureReport.ts`,
  `VoyageAgencyReportTab.tsx`, `AgencyReportDocument.tsx` e
  `AgencyReportTimeline.tsx` usam ATB/ATD/Restow da Atracação escolhida, com
  ATA da Escala; os alertas passam a usar esse ATD como T0.
- Banco: `341_atracacao_datas_por_terminal.sql` adiciona as colunas,
  unicidade TBC e a RPC v2; `342_atracacao_alertas.sql` atualiza status,
  alertas de datas, alertas do ADR e encerra produtores legados. Evidência:
  `atracacaoMigration.test.ts`, testes focados de projeção/modal/formulário e
  typecheck; runtime Supabase não foi executado nesta sessão.


## Histórico supersedido relevante

| Contrato | Definição antiga | Definição vigente | Mudança segurança/comportamento |
|---|---|---|---|
| RLS base | `002_rls.sql`: CRUD para qualquer `authenticated` por `auth.role()` | `010_rls_by_role.sql` + `014_lock_down_financial_reads_and_audit_writes.sql` | Introduz `is_active_user()`/`is_admin()`, restringe deletes/financeiro e torna auditoria append-oriented. |
| RLS Demurrage/Granito/Vazios | `028`, `034`–`036`: policies `true` ou apenas `auth.role()` | `042_rls_module_hardening.sql`, `050_alignment_granite_portal_demurrage.sql`, `20260610163251` | Alinha a ativo/admin e remove policies antigas de Vazios que sobreviveram por nome incorreto. |
| RLS Baplie/export | Policies permissivas ou ausentes | `091_harden_remaining_permissive_rls.sql` | Ativo para leitura/escrita operacional; delete admin. |
| RLS `demurrage_invoice_history` | `153_demurrage_invoice_history.sql`: SELECT `TO authenticated USING (true)` (mais permissivo que a tabela-pai) | `160_demurrage_invoice_history_rls_active.sql` | Restringe leitura a `is_active_user()`; fecha exposição do histórico financeiro a sessões do Portal (Broken Access Control, OWASP A01). |
| `anon` em definers | Grants históricos amplos, inclusive Portal e funções internas | `20260530102907` e `20260609225321` revogam `PUBLIC`/`anon` de todos os definers; migrations novas devem revogar no mesmo arquivo | Default-deny da ADR 0011; trigger functions também perdem execute de `authenticated`. |
| RPCs de dados do Portal | Fluxo legado por `p_session_token`, grants `anon` | Funções sem token usam `current_portal_customer_id()` | Sessão passa a ser exclusivamente Supabase Auth (`authenticated`). Grants de `anon` foram revogados pelo default-deny (ADR 0011/ADR 0047); `auth.uid()` nulo é rejeitado (`28000`). |
| `portal_resolve_login` | Exceção pré-auth direta no cliente (ADR 0013) | Migrations `002` e `047` revogam `PUBLIC`, `anon` e `authenticated` (ADR 0047) | Função agora é restrita a `service_role` e chamada exclusivamente pela Edge Function server-side `portal-login`. |
| Imports Baplie/veículos | `20260612153000`: novos `SECURITY DEFINER` sem guard interno e com grant default a `anon` | `109_fix_anon_executable_import_rpcs.sql` | Adiciona ativo/admin conforme operação e revoga `PUBLIC`/`anon`. |
| Reversões de pagamento | Definições iniciais sem revogação explícita de `anon`; motivo opcional | `20260614140808`, `20260614180000`, `20260615010000` | Revoga `anon`, exige admin/justificativa e corrige status financeiro do B/L. |
| Breakdown consolidado | `20260608174131`: ativo podia ler | `090_restrict_consolidated_invoice_breakdown.sql` | Restringe a admin ativo e controla `search_path`. |
| `save_bl_review` / gate | Retornava timestamp e aceitava `review_status` do payload | `20260619120000` + `20260619130000` | Retorna JSONB, recomputa pendências, preserva lock, audita estado real, sincroniza fila e endurece definer/ACL. |
| Promoção para billing | Regras distribuídas e trigger anterior sem gate canônico completo | `20260618163840` + `20260619130000` | Exige linha BRL positiva, cliente/portal/email/peso BB e bloqueia faturamento com pendências. |
| Manual charges e reversão PIX | Permitiram mutação de taxa após faturamento e PIX podia permanecer após reversão | `108_guard_manual_charges_and_clear_pix_on_reversal.sql` | Guards de invoice ativa e limpeza de estado PIX. |
| Ledger e lifecycle | Invoice/B/L e pagamentos sem fonte única de saldo | Migrations `20260529100000`–`20260614170000` | Introduz recebíveis, links, settlements, lifecycle, parciais, TXID único, reemissão e restituições. |
| Snapshot de schedule | `046`: `to_jsonb(NULL)` podia transformar snapshot em SQL `NULL` | `052_fix_voyage_snapshot_null_new_value.sql` | Persiste JSON `null` sem violar `NOT NULL`. |
| `bl_timeline` | O filename supersedido `20260619190023_bl_timeline_rpc.sql` não existe no checkout atual | Somente `130_bl_timeline_rpc.sql` | PR `#258` alinhou a versão da migration local à já aplicada remotamente; não alterou assinatura, SQL ou segurança do PR `#257`. |

## Evidência automatizada de banco (lista de testes de contrato SQL)

Os arquivos `src/services/__tests__/*Migration.test.ts` são classificados como
**Testes de contrato SQL** e fazem parte da suíte `npm test -- --run`; os testes
que dependem de um Postgres descartável também são executados pela bateria de
integração local. Eles cobrem:

- RLS remanescente, breakdown consolidado e gate de review/billing:
  `rlsHardeningMigration`, `consolidatedInvoiceBreakdownMigration`,
  `guardInvoiceableReadyStateMigration`, `reviewGateCanonicalMigration` e
  `reviewGateHardeningMigration`;
- guards de cobranças, reversões e restituições:
  `guardManualChargesMigration`, `reversalJustificationMigration`,
  `reversalBlsFinancialStatusMigration`, `pixExactAndRefundsMigration` e
  `settleInvoiceRefundsMigration`;
- ledger, lifecycle, parciais, PIX e reemissão:
  `ledgerBackfillExceptionReportMigration`,
  `ledgerConsolidatedReissueMigration`, `ledgerIndividualRpcMigration`,
  `ledgerObsoleteConsolidatedLinksMigration`,
  `ledgerPartialPaymentsMigration`, `ledgerPhase4dMigration`,
  `ledgerPixPayloadMigration`, `ledgerPixSettlementTxidMigration` e
  `ledgerSettlementGuardsMigration`;
- import/review e Portal:
  `blFreightLinesMigration`, `blImportCustomerReviewGateMigration`,
  `manifestImportBillingReasonMigration`, `portalCeMercanteGateMigration`,
  `portalCreateConsolidationJsonbMigration`,
  `portalInvoiceConsolidatedBreakdownMigration`,
  `portalInvoiceHistoryLinksMigration`, `portalOperationMigration`,
  `portalResolveLoginHardeningMigration`, `blDocumentFieldsMigration`,
  `portalNotificationsBlIdMigration` e
  `localChargesAutoCalculationMigration`.

### Verificação local em runtime (2026-06-26)

Executada contra um Postgres descartável com todas as migrations aplicadas, via
um emulador parcial de PostgREST/GoTrue (`scripts/design-audit/sb-shim.cjs`) com
`SUPABASE_RUN_INTEGRATION=1`:

- **Runtime (local):** o *hardening gate* passou — `import_manifest_transactional`
  rejeita hash duplicado (`23505`) e aciona rate limit (`P0429`); `save_bl_review`
  retorna `PT409` em timestamp stale; `apply_ce_mercante_update` retorna
  `unchanged`; e o operador (não-admin) **lê** `invoices` mas é bloqueado
  (`42501`) ao chamar `cancel_invoice`. Os testes de fluxo de ledger/billing
  permaneceram *gated* (fixtures), mas esse fluxo tem evidência **Runtime (local)**
  pela UV de browser (emitir consolidada → pagar → reverter; emitir demurrage).
- **Suspeitas reavaliadas:** os `SECURITY DEFINER` marcados anteriormente como "guard interno
  ausente" (`list_bl_local_charge_lines`, `list_customer_reconciliation_queue`,
  `calculate_bl_local_charges`) **bloqueiam usuário
  autenticado inativo** com `42501`; as leituras do Portal com grant `anon` histórico são
  inócuas porque rejeitam `auth.uid()` nulo (`28000`) e tiveram `anon` revogado. No schema aplicado, essas
  Suspeitas **não se reproduzem**.

**Limite da evidência:** o emulador é parcial e o Postgres é local. Isto valida o
**contrato definido pelas migrations**, não o projeto **remoto**. Grants/RLS/jobs
de produção, webhook de email, deploy das Edge Functions e alinhamento remoto da
migration `20260619190144` permanecem para inspeção controlada (ADR 0011/0013).

## Provisionamento do Portal (seção do documento vivo até 2026-10-13)

O gate pré-piloto adiciona a entrada no cabeçalho de Clientes, a expansão inline e o deep link `?cliente={id}`. A fila usa `portal_list_provisioning_console` (migrations `196`, `197` e `198`); a `198` executa `portal_repair_missing_accounts()` antes da leitura. Eventos usam RPC dedicada e a planilha é produzida por `exportPortalProvisioningWorkbook`.

| Rota/ação | Serviço/hook | Contrato de dados | Teste/evidência |
|---|---|---|---|
| Fila de provisionamento | `listPortalProvisioningQueue`, `usePortalProvisioning` | `customer_portal_accounts`, `portal_invites` | `src/services/__tests__/portalProvisioning.test.ts` |
| Pendência geral/exceção crítica do Portal | triggers `portal_refresh_general_pendencies`, `portal_invoice_exception_on_issue/close` | `alerts`, `bls`, `invoices`, `customer_portal_accounts` | migrations 188–190; `reviewGatePortalDecouplingMigration.test.ts` |
| Exceção e retorno à análise | `useSetProvisioningException`, `useReturnToAnalysis` | `portal_set_exception`, `portal_return_to_analysis` | migrations `179`/`180` |
| Expiração | job SQL | `portal_mark_expired_invites`, `alerts` | migration `181` |

O recorte RBAC usa `roleHasPermission`/`can()` em `ClienteFicha`, `Clientes` e
`Revisao`, com `customers_edit` e `portal_provisioning`. Usos de `isAdmin` fora
dessas telas permanecem deliberadamente fora deste plano e devem ser tratados
na auditoria global.

A migration `215_rbac_voyages_customers_writes.sql` fechou a lacuna encontrada
na auditoria pós-merge dos PRs #405/#406: até então o guard de `voyages_edit`
(COD/transbordo em `BlDetalhe`) e de `customers_edit` (escrita de
clientes/contatos) só existia no frontend — as RPCs `set_bl_cod`/
`set_bl_transshipment`/`update_customer_with_audit` e as policies RLS de
`customers`/`customer_contacts` aceitavam qualquer usuário ativo. A migration
adiciona `public.can_edit_voyages()`/`public.can_edit_customers()` (espelhando
`roleHasPermission`, com o mapeamento legado `admin=administrativo`,
`operator=documentacao`) e reforça ambas as camadas. Outros usos de `isAdmin`
sem correspondente no banco continuam fora deste recorte.

Email transacional: `supabase/functions/_shared/email.ts` é dono da mecânica
comum de idempotência e retry; `sendPortalEmail` adapta tentativas e supressão
do Portal; `portal-email-webhook` autentica o provedor e grava a inbox, enquanto
`portal-email-events-runner` atualiza entrega, deduplica eventos e processa as
duas trilhas; e `portal-daily-digest` consolida a atividade diária.
A fundação de Comunicados está em `372_comunicados_fundacao.sql` e nasce com o
envio global desligado. Evidência: **Código** e **Teste de contrato SQL**;
runtime remoto ainda requer secrets e domínio verificado.

## Central de Informações — revisão e decisão de 2026-10-04/06

A revisão inicial de 2026-10-04 e a decisão de negócio de 2026-10-06 simplificam o fluxo:
a indicação específica por container e planilha foi removida antes de ir para produção,
mantendo a devolução orientada por porto e os depósitos publicados do Vela.
Evidências e achados: [revisão extensa](2026-10-04-revisao-portal-informacoes.md).

## Selos de runtime citados no índice até 2026-10-13

Os selos abaixo estavam em linhas do índice vivo, sem data própria; foram
retirados porque registram execuções passadas, não o estado atual.

- `/demurrage` e `/demurrage/taxas`: "**Runtime local** (etapa 11)".
- `/reconciliacao?tab=extrato`, aba Pendências e `/reconciliacao?tab=historico`:
  "**Runtime local** (etapa 12)".
- Edge Function `itau-pix`: "**Runtime:** v8 ACTIVE em 2026-10-08, ciclos HTTP
  200". O ramo `process_charges` e a vez única do runner entraram no código em
  2026-10-13, depois dessa versão (achado D8-06 da revisão).
