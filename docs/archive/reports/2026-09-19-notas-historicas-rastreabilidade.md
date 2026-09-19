# Histórico de atualizações da rastreabilidade

Notas de entregas anteriores, retiradas do índice vivo em 2026-09-19.
São evidência dos respectivos snapshots e não comprovam runtime atual.

## Cubagem, formato numérico e linha expansível de B/Ls — 2026-09-18

Remediação dos achados da auditoria de 2026-09-18
(`docs/archive/audits/2026-09-18-auditoria-unificacao-bls-eixos-1-4.md`).

**Cubagem com dono único (migration 064).** `bls.total_cbm` passou a medir
SOMENTE carga conteinerizada e `bls.bb_cbm` (coluna nova) SOMENTE carga solta —
a mesma cirurgia que a `061` fez no peso, aplicada à coluna que ficou de fora.
Antes, `breakbulkImport` gravava a cubagem do manifesto e `blFreightImport`
gravava a soma dos contêineres na MESMA coluna, uma sobrescrevendo a outra em
B/L misto, e a ficha exibia o resultado sob o título "Resumo da carga solta".
Quem precisa da cubagem do documento inteiro usa `blTotalCbm()`, nunca uma das
colunas. `operational_list_bl_summary` devolve `breakbulkCbm` (só carga solta) e
`totalCbm` (soma aditiva). A cubagem de carga solta também entrou no
`ON CONFLICT` do importador: era a única métrica BB que uma reimportação não
atualizava.

**Sinal de carga solta completo (migration 064).** `bb_machine_qty` e `bb_cbm`
passaram a contar como sinal de carga solta em `_recalculate_bl_cargo_mode` e
`trg_sync_bl_weight_cargo_mode`, e o trigger observa as duas colunas no
`UPDATE OF`. Um B/L declarado só com máquinas e cubagem sobrevivia ao INSERT mas
era reclassificado como `container` em silêncio no primeiro UPDATE de
`bb_weight_ton`/`bb_packages_qty`.

**Formato numérico dos imports BB.** O manifesto de carga solta não fixa mais
pt-BR, e também não adivinha. Três camadas, nesta ordem:

1. **Declaração do operador** — o modal de importação tem um seletor
   `Detectar pelo arquivo` / `Vírgula decimal (pt-BR)` / `Ponto decimal (en-US)`
   (`ParseBreakbulkOptions.numberFormat`). Trocar o formato relê os arquivos já
   escolhidos (`FileImportModal.reparseKey`). Formato declarado que o arquivo
   contradiz é **recusado**, não corrigido em silêncio.
2. **Evidência do arquivo** — `inferSeparatorFormat` (`src/lib/importNumber.ts`)
   decide pelo que o próprio arquivo mostra: célula com os dois separadores, ou
   com um separador seguido de um número de dígitos diferente de 3.
3. **Ambiguidade residual** — `isThousandsGroupShape` marca a célula que sobrou
   na forma `259.312` (separador de milhar seguido de exatamente três dígitos).
   Sem declaração do operador ela é **erro bloqueante**; com declaração, aviso
   de conferência, e a mensagem mostra as DUAS leituras possíveis.

`normalizeNumericText` é a normalização única: a mesma leitura vale para a
evidência, para a detecção de ambiguidade e para o parse. Antes, a ambiguidade
era testada no valor cru e o número parseado no valor sem a unidade, então
`"259.312 TON"` escapava das duas checagens e entrava como 259 312 toneladas, na
taxa local de base `weight_ton`. `NUMERIC_CEILINGS` acrescenta um teto de
absurdo por coluna, que não depende de heurística nenhuma. O layout do armador
usa a mesma resolução — lia peso sem formato e cubagem em `en-US` fixo.

`ParsedBreakbulkManifest.rowErrors` ganhou `severity`, e
`rowErrorsToImportIssues` a respeita: só divergência bloqueante impede a
importação.

**Linha expansível em `/bls`.** Cada linha expande contêineres (com tara e data
de descarga) e carga solta (resumo e itens) em `BlRowDetail`, sem query nova — a
RPC `operational_list_bls` já projeta `bl_containers` e `bl_breakbulk_items`
inteiros. O toggle é um botão próprio com `aria-expanded`/`aria-controls`, então
a seleção em massa não é afetada.

**Export e tabela com um filtro só.** `fetchAllBls` pagina a mesma RPC da
tabela. Reimplementava os filtros contra `bls` com busca textual mais estreita,
então buscar por nome de cliente exibia linhas e exportava zero. O teto de
`p_page_size` de `operational_list_bls` subiu de 100 para 1.000 na mesma
migration 064: com 100, exportar uma viagem de 5.000 B/Ls custava 50 idas ao
banco em série, cada uma projetando os filhos inteiros do B/L.

**Fila de reconciliação por modalidade.** `ReviewDrawer` edita
`total_weight_kg`/`total_cbm` para B/L de contêiner e `bb_weight_ton`/`bb_cbm`
para carga solta, pelos mesmos predicados do resto do sistema; um B/L misto
mostra os dois pares. Oferecia só o par de contêiner, então um B/L de carga
solta aparecia na fila com os dois campos vazios — e quem preenchesse criava uma
segunda cubagem, que `blTotalCbm()` somava à que já existia.

**KPIs de `/bls`.** Máquinas, Total de volumes, CBM carga solta e **CBM total**
(a soma aditiva que a 064 criou) são renderizados. Os quatro vinham da RPC,
tipados e mapeados, e eram descartados sem chegar à tela.

**Ficha do B/L.** `Carga` virou aba própria (`?tab=carga`), entre Visão Geral e
Detalhes; era uma seção no fim do formulário de edição. A modalidade aparece
como badge no topo, com rótulo único (`cargoModeLabel`).

## Atualização do detalhe do B/L — trilho Documental — 2026-09-14

`/bls/:blId` mantém o trilho Operacional e agora apresenta o antigo
Financeiro como **Documental**. `BlRailsPipeline` recebe quatro cards centrais
(`Cliente`, `Taxas Locais`, `CE Mercante`, `Fatura`), calcula o contador somente
com os bloqueios desses cards e aponta a próxima ação para o primeiro deles.
Demurrage permanece auxiliar e não altera a emissão da fatura comum.

`listInvoiceLinksByBls` lê `invoice_bls` e `invoice_receivable_links`, preserva
`invoice_type` e a origem do vínculo, e permite que a ficha identifique uma
fatura `Individual` ou `Consolidada`. O CE Mercante é obrigatório para
container e carga solta: `047_bl_documental_gates.sql` protege a prontidão do
B/L, os vínculos de emissão individual/consolidada e a transição da invoice
para `issued`. A disponibilidade do Portal continua sob
`bl_has_portal_release`, que já usa CE como gate universal.

**Evidência:** `BlRailsPipeline.test.tsx`, `blRails.test.ts`,
`billing.test.ts`, `reviewBillingAutomation.test.ts` e
`blDocumentalGatesMigration.test.ts`.

## Atualização da PR #670 — 2026-09-10

O recorte de `009`–`030` foi conferido no replay PostgreSQL local e agora tem
linha de rastreabilidade para as funções que não apareciam no índice anterior.
As funções com prefixo `_` são núcleos privados; os demais nomes são wrappers,
leitores ou workers. **Evidência:** 17 suítes de integração local, 64 testes,
`npm run rpc:check` com 168 nomes chamados e `npm run docs:check` com 428
Markdown/49 rotas. O smoke autenticado do Preview também confirmou importação
de datas, emissão/baixa de Demurrage com desconto e paridade Portal/Inspeção.
Isso não afirma deploy de produção, execução dos jobs, Vault preenchido, BCB ou
Resend reais.

| Família / funções introduzidas ou redefinidas nesta PR | Migração / evidência executável |
|---|---|
| `apply_baplie_physical_flags_atomic`, `apply_container_dates_atomic` | `015_import_dates_and_flags_atomic.sql`; `importAtomicity.local-pg.test.ts`, `baplieParserS03.test.ts` |
| `apply_customer_base_row_atomic`, `import_bl_freight_with_metadata` | `016_import_metadata_and_omission_conflicts.sql` + `048_customer_base_primary_contact.sql`; testes de importação/customer base e contrato da migration 048 |
| `claim_import_effects`, `complete_import_effect`, `enqueue_import_effect`, `list_import_effects`, `retry_import_effect`, `prevent_import_effect_attempt_mutation` | `017_import_effects_outbox.sql`, `025_import_effect_worker.sql`; `importEffects.local-pg.test.ts` |
| `create_customer_dunning_group_atomic`, `demurrage_dunning_candidate_sendable`, `release_demurrage_dunning_claim` | `010_contact_routing_and_dunning_eligibility.sql`, `011_dunning_group_membership.sql`; contratos de dunning |
| `apply_demurrage_discount`, `cancel_demurrage_invoice`, `confirm_demurrage_pix_matches`, `register_demurrage_payment`, `reopen_demurrage_invoice`, `_demurrage_mutation_request` | `012_demurrage_mutation_guards.sql`, `027_demurrage_money_fixes.sql`; `demurrageMoney.local-pg.test.ts` |
| `create_demurrage_invoice_authoritative`, `create_demurrage_invoice_with_items`, `capture_demurrage_calculation_snapshot`, `prevent_demurrage_calculation_snapshot_mutation`, `_calculate_demurrage_invoice_authoritative` | `018_exchange_rate_provenance.sql`, `023_demurrage_calculation_snapshot.sql`, `027_demurrage_money_fixes.sql`; `demurrageAuthority.local-pg.test.ts` |
| `capture_demurrage_calculation_snapshot` (correção da coluna histórica de PTAX) | `030_fix_demurrage_snapshot_ptax_column.sql`; `demurrageAuthorityMigration.test.ts`, smoke autenticado no Preview |
| `recalculate_demurrage_invoices`, `recalculate_demurrage_invoices_manual`, `save_exchange_rate_reference`, `save_exchange_rate_reference_v2`, `_demurrage_roe_from_ptax`, `_demurrage_spread_version` | `018_exchange_rate_provenance.sql`; `exchangeRateIntegrity.local-pg.test.ts` |
| `operational_list_bl_summary`, `operational_list_bls`, `operational_list_containers` | `020_operational_read_pages.sql`; `operationalLists.local-pg.test.ts` |
| `operational_list_voyage_summaries` | `035_operational_voyage_summaries.sql`; `voyageReadModels.test.ts`, `operationalLists.local-pg.test.ts` |
| `operational_list_voyage_summaries` (status nullable) | `037_operational_voyage_summary_null_status.sql`; `voyageReadModels.test.ts`, `operationalLists.local-pg.test.ts` |
| `operational_list_bl_summary` (métricas BB) | `036_operational_breakbulk_summary_metrics.sql`; `voyageReadModels.test.ts`, `operationalLists.local-pg.test.ts` |
| `operational_list_bl_summary` (tolerância a drift de `charge_status`) | `040_operational_breakbulk_drift_tolerance.sql`; `operationalBreakbulkDriftToleranceMigration.test.ts` |
| `portal_list_disputes`, `_portal_list_disputes_core` | `013_portal_disputes_inspection.sql`; `portalInspectionParity.local-pg.test.ts` |
| `portal_list_demurrage_invoices_page`, `portal_list_invoices_page`, `_portal_list_demurrage_invoices_page_core`, `_portal_list_invoices_page_core` | `021_portal_billing_pages.sql`; `portalInspectionParity.local-pg.test.ts` |
| `customer_billing_access_ready` | `019_local_billing_integrity.sql`; `localBillingIntegrity.local-pg.test.ts` |
| `current_portal_customer_id`, `save_voyage_escala_terminal_state_v2` | `009_rpc_entry_security.sql` + `049_terminalized_schedule_persistence.sql`; `auditSecurityBoundaries.local-pg.test.ts`, `terminalizedSchedulePersistenceMigration.test.ts` |
| `portal_list_provisioning_console` (candidatos ativos do cadastro canônico) | `050_portal_provisioning_active_contact_candidates.sql`; `portalProvisioningCandidatesMigration.test.ts` |
| `portal_email_event_attempts_append_only` | `022_email_inbox_and_dispatch_state.sql`; `emailInbox.local-pg.test.ts` |
| `refresh_customer_communication_status`, `mark_customer_communication_dispatch_blocked` | `032_customer_communication_partial_status.sql`, `038_customer_communication_status_recipient_latest.sql`, `039_customer_communication_status_identity.sql`; `customerCommunicationPartialStatusMigration.test.ts`, `customerCommunicationRecipientLatestMigration.test.ts`, `customerCommunicationStatusIdentityMigration.test.ts` |
| `claim_demurrage_dunning_candidates` (recuperação terminal de `parcial`) | `041_dunning_partial_claim_recovery.sql`; `demurrageDunningMigration.test.ts` |

## Atualização da PR #695 — revisão adversarial e bateria financeira — 2026-09-16

A revisão adversarial foi incorporada também nos caminhos não bloqueantes. O CE
Mercante dispara faturamento somente para o B/L que originou a transição; os
demais B/Ls do mesmo container/viagem seguem apenas o cálculo aplicável. A fila
preserva bloqueios operacionais como resultados recuperáveis. O Portal em modo
de inspeção compartilha um predicado de somente leitura, o ledger impede
alocações acima do recebível e o motivo de cancelamento é obrigatório em todas
as camadas. Mensagens de erro exibidas ao usuário passam por classificação sem
expor detalhes crus do banco.

| Família / funções introduzidas ou redefinidas | Migração / evidência executável |
|---|---|
| `auto_bill_bl_after_ce_mercante`, `trg_auto_bill_bl_after_ce_mercante`, `suppress_duplicate_ce_auto_billing_effect`, `_run_import_effect_local_charges`, `_compute_bl_review_pendencies`, `compute_bl_review_pendencies` | `051_ce_mercante_auto_billing.sql`; `ceMercanteAutoBillingMigration.test.ts`, `ceMercanteAutoBilling.local-pg.test.ts` |
| `guard_ledger_settlement_allocation`, `assert_ledger_invoice_payment_allocation`, `register_ledger_invoice_payment` | `052_financial_battery_guards.sql`; `ledgerSettlementGuardsMigration.test.ts`, `financialBattery.local-pg.test.ts` |
| `block521_upsert_alert`, `alert_actor_is_authorized` | `052_financial_battery_guards.sql`; Portal de disputa autenticado e grants do Portal |
| `apply_customer_base_row_atomic` (reativação e backfill de caixas) | `048_customer_base_primary_contact.sql`; `customerBasePrimaryMigration.test.ts` |
| `save_voyage_escala_terminal_state_v2` (renomeação idempotente) | `049_terminalized_schedule_persistence.sql`; `terminalizedSchedulePersistenceMigration.test.ts` |

### Atualização da entrega S12 — read-model de viagens e Line Up

`operational_list_voyage_summaries` (`035_operational_voyage_summaries.sql`)
separa o rail resumido da viagem do detalhe selecionado. A RPC pagina viagens
visíveis e agrega rotas, B/Ls por modalidade, cobertura de CE, containers e
Baplie sob `SECURITY INVOKER`; `useVoyages` consome apenas esse envelope e
`useVoyageDetail` carrega manifests, bookings e B/Ls somente para a viagem
aberta. `Baplie` reutiliza o rail e deixa a leitura completa limitada ao
staging da viagem selecionada.

`lineup.ts` passou a projetar `bl_containers` junto com os B/Ls, eliminando o
waterfall B/L → containers no refresh. `listVoyageRoutePorts` é o read-model
pequeno comum de POL/POD usado por EmbarqueVazios e pelo relatório de agência;
essas mudanças preservam os contratos fechados e os filtros por viagem. A
integração PostgreSQL local cobre os agregados e os testes de comportamento
cobrem a separação resumo/detalhe. **Residual explícito:** Preview autenticado
e roteiro manual de UX continuam provas operacionais pendentes; exportações
explícitas ainda materializam o conjunto solicitado sob demanda e não são
tratadas como leitura de rail.

### Atualização complementar S12/S13 — PR #683, benchmark e contraste

O caminho normal de `useBls`, `useContainers`, `useBlSummary` e `useVoyages`
agora chama diretamente os wrappers/RPCs paginados; os antigos full-scans ficam
restritos a exportações explícitas sob demanda. `Bls` usa os campos
adicionais de `operational_list_bl_summary` (`036`) para máquinas, volumes, peso
e CBM, sem reconstruir métricas no cliente.

O detalhe do Baplie também passou a ficar atrás de `baplieReadModel.ts`: a página
usa `listBaplieStaging` com projeção explícita, paginação por viagem e
`hasBlsForVoyage` para a checagem de existência. O contrato é coberto por
`baplieReadModel.test.ts`; a exportação continua materializando apenas o conjunto
explicitamente solicitado pelo operador.

O harness `scripts/perf/measure-operational-read-model.mjs` executado em
PostgreSQL local vazio, com cinco rodadas, `ANALYZE` das tabelas sintéticas
dentro da transação e rollback por cenário, registrou:

| B/Ls | resumo p95 / bytes | baseline pesado p95 / bytes |
|---:|---:|---:|
| 100 | 3,846 ms / 3.023 B | 7,534 ms / 205.971 B |
| 1.000 | 4,827 ms / 3.085 B | 76,544 ms / 2.055.752 B |
| 10.000 | 16,225 ms / 3.147 B | 614,319 ms / 20.589.687 B |

O `EXPLAIN (ANALYZE, BUFFERS)` do cenário de 10.000 B/Ls mediu 15,462 ms
(`summary`) contra 560,075 ms (baseline). “Requests” no relatório significa
uma instrução SQL local por leitura, não uma contagem HTTP do PostgREST. O
artefato detalhado fica em `artifacts/perf/`, fora do versionamento; os dados
sintéticos não são persistidos.

`npm run a11y:contrast` passou nos temas light e dark para texto normal, texto
suave, links, status e cabeçalho de tabela (20 pares, todos >= 4,5:1). O gate
ajustou os tokens claros de `muted-soft` e `green`, e o token escuro de
`muted-soft`; a verificação manual de componentes, hover/disabled, teclado,
leitor de tela e foco no Preview continua pendente.

Os contratos financeiros passaram a persistir `demurrage_invoice_items.subtotal_brl`
com resíduo determinístico e o documento lê o valor persistido; valores históricos
sem snapshot não são inventados. `src/types/database.ts` foi regenerado pelo
gerador oficial contra o Preview depois do smoke autenticado, preservando os
aliases de domínio do frontend e uma camada separada de compatibilidade para
`null` explícito em inputs/RPCs. A coluna `subtotal_brl`, os campos de procedência
do ROE e a família de `exchange_rate_reference_history` foram conferidos no
schema remoto e no replay PostgreSQL local.

### Inventário S14 — legado e colunas nullable

No replay local de 2026-09-09, as 14 candidatas do plano (`portal_*_legacy`,
`close_legacy_agency_report_alerts_for_scale` e
`reconcile_bl_review_alerts_item`) resolveram para assinaturas existentes, todas
sem dependente em `pg_depend`, sem referência no corpo de outra função e sem job
local cujo comando as chame. As funções `*_legacy` também estão sem `EXECUTE`
para `anon` e `authenticated`. Isso é evidência de não-uso interno, não prova de
ausência de consumidor externo; por isso nenhuma foi removida nesta PR e os sete
elos de import que formam a cadeia `_legacy_205/284/322/357`, `_legacy_165`,
`_legacy_136` e `save_granite_bl_review_legacy_148` continuam preservados.

As colunas `alerts.notified_at`, `bls.consignee_address`,
`charge_calculations.reviewed_at` e `customer_portal_sessions.last_seen_at`
existem e são nullable; no banco descartável todas estavam nulas. Não houve
caller ativo em `src`/Edge Functions para as quatro; `charges_reviewed_at` e
outros campos homônimos usados pela projeção de Taxas Locais não são a coluna
legada `charge_calculations.reviewed_at`. Sem contagem do ambiente real,
telemetria externa e decisão documental, a remoção fica deliberadamente
pendente; qualquer contração futura deve usar migration nova e `DROP ... RESTRICT`.

Testes que apenas inspecionam texto ou regex de migrations são classificados
como **Teste de contrato SQL**. Eles detectam drift no SQL versionado, mas não
provam migration aplicada, grants remotos, RLS em execução ou atomicidade real.

## Atualização da remediação das auditorias #654–#660 — 2026-09-07

Esta revisão focal integra o baseline da PR #669 e acrescenta as migrations
`022`–`026`. A fronteira de email agora é: webhook autenticado recebe e
persiste a inbox; `portal-email-events-runner` faz claim, retry e transições
server-only. Efeitos de importação usam `import_pending_effects` com lease,
histórico de tentativas e `import-effects-runner`, que permanece fail-closed até
ativação explícita no ambiente correto. A emissão de Demurrage recebe IDs e
data opcional no RPC autoritativo, calcula no banco e registra snapshots
append-only; a falha persistente do recálculo PTAX abre o alerta
`demurrage_ptax_recalc_failed`.

**Código/Teste:** migrations `022_email_inbox_and_dispatch_state.sql`,
`023_demurrage_calculation_snapshot.sql`,
`024_demurrage_ptax_alert.sql`, `025_import_effect_worker.sql` e
`026_import_effect_alert.sql`, integrações locais opt-in e testes focados.
Esse bloco não afirma deploy remoto, grants efetivos no Postgres gerenciado,
Vault preenchido, cron executado, Resend/BCB real ou conclusão integral do plano;
os itens pendentes continuam classificados na matriz do plano.

## Atualização da PR 550

O fluxo terminalizado da PR 550 acrescenta `report_id` e `terminalCode` aos
deep-links do ADR, filtra o conteúdo exibido pelas frentes atribuídas, usa as
chaves reais de `useAgencyReport` (`agency-report-terminal-state` incluída) e
registra datas do POD na mesma RPC transacional da escala. O Cadastro de
Terminais consulta `preflight_depots_terminal_port_mapping`; novos terminais
exigem `depots.port_id`, enquanto o legado sem mapeamento permanece preservado.
As evidências desta revisão são os testes de comportamento, o contrato SQL da
migration 306 e a aplicação da migration em Postgres local descartável.

No ADR terminalizado, as escritas por `report_id` usam as RPCs
`set_agency_report_signoff_by_report_id`,
`set_agency_report_department_signoff_by_report_id`,
`set_agency_report_section_observation_by_report_id`,
`close_agency_departure_report_by_report_id` e
`reopen_agency_departure_report_by_report_id`. O snapshot fechado também
congela `header.terminalScope`, distinguindo uma seção sem frente atribuída ao
terminal de uma seção atribuída que recebeu a resolução “Nada a declarar”.

### Fundação de Comunicados ao Cliente — Bloco 1

A migration `372_comunicados_fundacao.sql` criou a fundação sem histórico
retroativo: `customer_communications`, vínculos com B/L, tentativas, catálogo
explícito de `kind`/`nature`, quatro preferências por contato, supressões do
canal e o singleton `app_settings`. As âncoras do comunicado são valores
congelados, sem FK para escala, atracação ou invoice. A chave global nasce
desligada e a RPC `set_communications_enabled(boolean)` exige Administrativo e
registra alterações em `audit_logs`.

`CadastroContatosTab` expõe as quatro naturezas sem alterar
`customer_contacts.purpose`; a gravação usa `source='interno'` e o guard
de permissão `customer_communications` exclui Operações, Financeiro e os
demais papéis não autorizados na tela. O mapeamento e as preferências são
cobertos por testes de
comportamento e de contrato SQL; a aplicação da migration foi reproduzida em
PostgreSQL local descartável. Não há runtime remoto nem envio real afirmado
nesta etapa.

O webhook do Resend procura a tentativa no Portal e, como fallback, em
`customer_communication_attempts`, vinculando cada evento a apenas uma delas.
Complaint de Comunicado grava somente `customer_communication_suppressions`;
`bounce_permanente` usa a supressão compartilhada, escala uma linha de
`complaint` sem rebaixamento posterior e resolve a notificação ao contato
alternativo ou o alerta `cliente_contato_bounced_sem_alternativa`. **Código**;
**Teste:** `portalEmailWebhook.test.ts`, `portalBounceCascade.test.ts` e
`portalEdgeFunctionsOrder.test.ts`.

### Bloco 2 — Disparo manual e alertas de Comunicados

`/clientes/comunicacao` é a superfície protegida pela permissão
`customer_communications`: o modo carga exige filtro operacional e agrupa B/Ls
por cliente; o modo institucional usa Cliente Comunicável, com ETA a partir de
doze meses atrás e sem teto futuro. A aba Disparo é um formulário de três passos
(o que enviar, para quem, mensagem) em que o modo deriva do modelo
(`getCustomerCommunicationDispatchMode`), a lista de modelos vem filtrada pelo
modo (`MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE`), o público segue
`getCustomerCommunicationAudienceRule` e o editor de assunto/mensagem aparece nos
modelos escritos pelo operador (`isUserWrittenCustomerCommunicationKind`) —
inclusive no livre, que continua no modo carga. A conferência mostra elegíveis,
exclusões, bloqueios, preview e confirmação explícita de reenvio para os modelos
ancorados em carga (`requiresResendConfirmation`); institucional e livre trocam a
trava por informação, porque cada lote tem `dispatch_id` próprio. **Código**;
**Teste:** `customerCommunications.test.ts`, `ClientesComunicacao.test.tsx` e
`customerCommunicationTemplates.test.ts`.

A produtora `evaluate_and_dispatch_automatic_communications` (cron de 15 em 15
minutos via `customer-communication-auto-runner`) resolve destinatários por
`customer_contact_box_links`, não mais pelo modelo legado de
`customer_contact_preferences`, e produz NOA, NOR, **NOB** e `ce_mercante_taxas`.
O NOB é por Atracação (`voyage_escala_terminal_state.id` como
`anchor_atracacao_id`) e restrito à carga cuja Frente de Operação está atribuída
àquele terminal em `voyage_escala_operation_fronts`. A migration `045` corrige o
roteamento — a `008` havia aplicado a correção de caixas em
`find_due_customer_communication_automations`, que não tem chamador. **Código**;
**Teste:** `comunicadosCaixasNobAutomaticoMigration.test.ts`,
`escalaOperationFrontKind.test.ts`, `customerCommunicationAutoRunner.test.ts`;
**Teste de contrato SQL:** `scripts/check-comunicados-caixas-nob.sql`, executado
no CI contra o Postgres real após o replay das migrations.

`customerCommunicationDispatches.ts` chama `send-customer-communication`, que
confere contato, preferência, complaint/bounce e natureza, registra a operação
por RPC atômica e mantém o dry-run quando
`app_settings.communications_enabled=false`. A migration
`373_comunicados_anexos.sql` cria templates e bucket privado; a migration
`375_comunicados_bloco2_correcoes.sql` fecha a escrita direta do Storage e cria
modelos institucionais reutilizáveis; anexos são
limitados a três arquivos e 10 MB e não são aceitos em cobrança local ou
demurrage. Em erro HTTP da Edge Function, o service lê o corpo JSON retornado
(`error`/`message`) antes de repassar a falha à tela, preservando a causa para
diagnóstico (BUG-10). **Código**; **Teste de contrato SQL:**
`comunicadosAnexosMigration.test.ts` e
`sendCustomerCommunicationFunction.test.ts`.

O status parcial usa `recipient_key` como SHA-256 do e-mail normalizado, sem
agrupar destinatários pela máscara visual; tentativas anteriores à coluna são
marcadas como `legado` até uma nova execução confirmar o modo real ou simulado.
Um bloqueio de prontidão depois da criação passa por
`mark_customer_communication_dispatch_blocked`, que grava `falha` ou `parcial`
e preserva o resultado por destinatário. No dunning, a migration
`041_dunning_partial_claim_recovery.sql` trata `parcial` como terminal para o
scanner de claims órfãos e a Edge reutiliza a chave histórica da tentativa.
**Código**; **Teste de contrato SQL:**
`customerCommunicationStatusIdentityMigration.test.ts` e integração local de
`customerCommunicationPartial.local-pg.test.ts`.

O Histórico de Comunicados aparece na própria rota, na Ficha do Cliente e no
Histórico do B/L vinculado. A migration `374_comunicados_alertas.sql` cataloga
NOA/NOR/NOB pendentes e bounce sem alternativa no runner server-only; somente
`status='enviado'` resolve os avisos operacionais. **Código**;
**Teste de contrato SQL:** `comunicadosAlertasMigration.test.ts`.

