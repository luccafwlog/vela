# Taxas Locais

> **Status:** ativo · **Atualizado:** 2026-09-17 · **Rotas:** operação em `/taxas-locais`; cadastro em `/taxas-locais/tabelas`; ações operacionais também partem de `/revisao` e `/bls/:blId`

## Propósito e escopo

Este módulo é o dono da configuração de tarifas locais e das operações que
transformam os dados de um B/L em linhas faturáveis. A rota
`/taxas-locais/tabelas` expõe as abas de tabelas e overrides; a rota pai
`/taxas-locais` expõe a operação de validação e invoices. Cálculo, recálculo, revisão,
liberação para faturamento, cobranças manuais e reconciliação de cliente são
operações do mesmo domínio disparadas por outras telas.

- `src/AppInterno.tsx` monta `/taxas-locais` dentro da aplicação interna protegida.
- `src/pages/TaxasLocaisTabelas.tsx` exige as capacidades de interface
  `charge_tables` e `charge_overrides`, definidas em `src/hooks/useAuth.tsx`.
- `src/services/charges/chargeTableService.ts` e
  `src/services/charges/chargeRateService.ts` são donos do CRUD de configuração.
- `src/services/charges/chargeOperationsService.ts` é o dono das operações de
  cálculo e estado; `src/services/charges/chargeReconciliationService.ts` é o
  dono da fila de reconciliação de cliente.
- Imports podem produzir cálculo provisório, sem emitir invoice (ADR 0038).
  CE Mercante confirma/recalcula e dispara emissão elegível (0042, migration
  `051`); revisão de cliente também reavalia a automação, respeitando o CE.
- [Faturamento](faturamento.md) consome B/Ls liberados e o ledger; este documento
  não redefine emissão, pagamento ou saldo de invoices.
- Granito aparece na fila operacional unificada, mas usa
  `src/services/graniteCharges.ts` e `granite_bls`; não compartilha o motor
  `calculate_bl_local_charges`.

## Anatomia das telas

### Aba Tabelas em `/taxas-locais/tabelas`

`src/components/taxasLocais/ChargeTablesTab.tsx` recebe da página os filtros
compartilhados de modo de carga e POD, mantém queries, mutations, validação e
estado local. A renderização é dividida em:

- métricas de tabelas, tabelas ativas, itens e itens somente manuais;
- filtros por `cargo_mode` e POD;
- `src/components/taxasLocais/ChargeTableFormCard.tsx` e
  `src/components/taxasLocais/ChargeTableItemFormCard.tsx`: formulários
  recolhíveis de tabela e item;
- `src/components/taxasLocais/ChargeTablesList.tsx`: lista de
  `charge_tables`, com expansão dos `charge_table_items` e os avisos de
  vigência da ADR 0040 (`chargeTableAlerts`): "Vigência vencida" e "Vigência
  futura" em tabela ativa (o período não filtra o cálculo, então segue sendo
  aplicada) e "Não aplicada" quando outra tabela ativa do mesmo POD e modo de
  carga vence o desempate;
- edição, ativação/inativação, criação e exclusão de item;
- estados de carregamento, erro e vazio produzidos por
  `useLocalChargeTables`.

Os formulários e defaults vivem em
`src/components/taxasLocais/chargeForms.ts`; validação e normalização vivem em
`src/pages/taxasLocaisHelpers.ts`.

### Aba Overrides em `/taxas-locais/tabelas`

`src/components/taxasLocais/ChargeOverridesTab.tsx` contém:

- busca de cliente por nome ou documento;
- filtros por modo de carga e POD;
- consulta separada de clientes e itens elegíveis;
- formulário de criação/edição com vigência e observação;
- lista de `customer_rate_overrides`, valor base, valor substituto e estado de
  vigência calculado na interface;
- confirmação antes da exclusão e estados de carregamento, erro e vazio.

### Superfícies operacionais fora da rota

- `src/components/bl/BlCobrancasTab.tsx`, em `/bls/:blId`, lista linhas,
  calcula/recalcula um B/L, mantém cobranças manuais e promove os estados
  `reviewed` e `ready_for_billing`.
- `src/pages/Revisao.tsx` e
  `src/services/reviewBillingAutomation.ts` recalculam após a revisão.
- `src/components/billing/ValidacaoTab.tsx`, em `/taxas-locais`, lista a fila
  operacional, executa ações em lote, exibe o estado das reconciliações e aponta
  para a Revisão, além de emitir invoices.
  O passo "Em revisão" do funil conta todo B/L já conciliado que ainda não é
  faturável (`isPendingBillingReview` em `validacaoPipeline.ts`), incluindo os
  presos no gate de revisão (`review_status = pending_review`), e o motivo de
  bloqueio expõe a pendência canônica (ex.: cliente sem e-mail cadastrado) via
  `extractReviewReasons`. Prontidão de Portal integra a guarda manual de emissão; a retirada
  histórica na migration `188` foi revertida. A automação CE tem exceção
  interna controlada na `051`. **Etapa 6 do plano de faturamento (ADR 0038, decisão 8):** o painel
  ganhou duas métricas antes do funil de revisão — "Provisório" (`charge_status
  = 'calculated'`, agora um estado real desde que a migration `263` desligou a
  promoção automática) e "Aguardando CE" (`isAwaitingCeMercante` em
  `validacaoPipeline.ts`: container reconciliado e não faturado sem
  `ce_mercante`) — para a tela responder "o que está calculado e ainda não
  faturado, e por quê" como o plano pede. O nome da aba ("Validação") foi
  mantido: a etapa 12 do mesmo plano já dá a ela o papel de tela das duas
  fases, então o motivo original para renomear deixou de existir.
- **Etapa 12 do mesmo plano** removeu a aba Pendências (`PendenciasFaturamentoTab.tsx`)
  por ser subconjunto literal da Validação — mesma fonte, mesmo limite, só
  `chargeStatus=review_required` fixo. O botão "Recalcular todas em revisão"
  no passo 2 do funil (`ValidacaoControls.tsx`) cobre o mesmo recalculo em
  massa sem seleção manual que a aba antiga oferecia.
- Após a vinculação do CE Mercante, a automação avalia a prontidão de
  comunicação por cliente/viagem e dispara o resumo financeiro em background
  quando todos os B/Ls ativos estão prontos. A coluna de comunicação mostra o
  bloqueio, o último envio e o reenvio assistido em
  `src/components/billing/InvoiceCommunicationStatusCell.tsx`.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/taxas-locais/tabelas` · filtrar/listar tabelas | Capacidade `charge_tables`; filtros opcionais | `TaxasLocaisTabelas` → `ChargeTablesTab` → `ChargeTablesList` | `useLocalChargeTables` → `listLocalChargeTables` | `SELECT charge_tables` com `charge_table_items` | Query `queryKeys.charges.tables(filters)`; itens são ordenados por `sort_order` e nome | Erro Supabase vira estado de erro da lista | **Código:** `src/pages/TaxasLocaisTabelas.tsx`, `src/components/taxasLocais/ChargeTablesTab.tsx`, `src/components/taxasLocais/ChargeTablesList.tsx`, `src/services/charges/chargeTableService.ts` |
| `/taxas-locais/tabelas` · criar/editar tabela | Nome, POD e `valid_from`; vigência final não anterior à inicial (a vigência é informativa — ADR 0040 — e o formulário diz isso; a lista sinaliza vigência vencida/futura e tabela ativa não aplicada por outra do mesmo escopo) | `ChargeTableFormCard` → `handleSaveTable` | `validateTableInput` → `useSaveChargeTable` → `saveChargeTable` | `INSERT` ou `UPDATE charge_tables` | Invalida `queryKeys.charges.tables()` | Toast “Falha ao salvar tabela”; erro de constraint/RLS é propagado | **Código:** `src/components/taxasLocais/ChargeTableFormCard.tsx`, `src/components/taxasLocais/ChargeTablesTab.tsx`, `src/pages/taxasLocaisHelpers.ts`, `src/hooks/useLocalCharges.ts` · **Teste:** `src/pages/__tests__/taxasLocaisHelpers.test.ts` |
| `/taxas-locais/tabelas` · ativar/inativar tabela | Tabela existente | `ChargeTablesList` → `handleToggleTableActive` | `useSetChargeTableActive` → `setChargeTableActive` | `UPDATE charge_tables.active` | Invalida `queryKeys.charges.tables()` | Toast de falha; não recalcula B/Ls já existentes | **Código:** `src/components/taxasLocais/ChargeTablesList.tsx`, `src/components/taxasLocais/ChargeTablesTab.tsx`, `src/services/charges/chargeTableService.ts` |
| `/taxas-locais/tabelas` · adicionar/editar item | Tabela, nome, valor não negativo e `sort_order` inteiro não negativo | `ChargeTableItemFormCard` → `handleSaveTableItem` | `validateTableItemInput` → `useSaveChargeTableItem` → `saveChargeTableItem` | `INSERT` ou `UPDATE charge_table_items` | Invalida `charges.tables()`, `bls.manualChargeItems('')` e `charges.overrideItems()` | Toast de falha; constraints de moeda/base/perfil podem rejeitar | **Código:** `src/components/taxasLocais/ChargeTableItemFormCard.tsx`, `src/components/taxasLocais/ChargeTablesTab.tsx`, `src/services/charges/chargeTableService.ts` · **Teste:** `src/pages/__tests__/taxasLocaisHelpers.test.ts` |
| `/taxas-locais/tabelas` · excluir item | Confirmação; item sem bloqueio referencial | `ChargeTablesList` → `handleDeleteTableItem` | `useDeleteChargeTableItem` → `deleteChargeTableItem` | `DELETE charge_table_items` | Mesmas invalidações do save de item | Mensagem informa possível vínculo com cálculos | **Código:** `src/components/taxasLocais/ChargeTablesList.tsx`, `src/components/taxasLocais/ChargeTablesTab.tsx`, `src/hooks/useLocalCharges.ts` |
| `/taxas-locais/tabelas` · filtrar/listar overrides | Capacidade `charge_overrides`; limite entre 20 e 500 | `ChargeOverridesTab` | `useCustomerRateOverrides` → `listCustomerRateOverrides` | `SELECT customer_rate_overrides` com `customers`, itens e tabelas | Query `queryKeys.charges.overrides(filters)`; filtros de cliente/modo/POD são aplicados no cliente após a leitura limitada | Erro Supabase vira erro da lista | **Código:** `src/components/taxasLocais/ChargeOverridesTab.tsx`, `src/services/charges/chargeRateService.ts` |
| `/taxas-locais/tabelas` · buscar cliente/item de override | Busca de cliente vazia ou com pelo menos dois caracteres para filtro remoto; itens ativos e não manuais | Selects do formulário | `useOverrideCustomers` / `useOverrideChargeItems` | `SELECT customers`; `SELECT charge_table_items` + `charge_tables` | Queries `charges.overrideCustomers(search)` e `charges.overrideItems()` | Erro da query impede opções; a tela não cria opção livre | **Código:** `src/components/taxasLocais/ChargeOverridesTab.tsx`, `src/services/charges/chargeRateService.ts` |
| `/taxas-locais/tabelas` · criar/editar override | Cliente e item válidos; valor maior que zero; vigência coerente; **vigência não pode sobrepor outra condição do mesmo cliente+item** (etapa 10 do plano de faturamento, ADR 0038 decisão 5) | `handleSaveOverride` | `validateOverrideInput` → `useSaveCustomerRateOverride` → `saveCustomerRateOverride` → `findOverlappingCustomerRateOverride` | `INSERT` ou `UPDATE customer_rate_overrides`; restrição de exclusão `customer_rate_overrides_no_overlap` (migration `267`, GiST em `customer_id`/`charge_item_id`/`daterange(valid_from,valid_to,'[]')`) é a autoridade final | Invalida `charges.overrides()` e `bls.localChargeLines('')` | Toast de falha; erro de validação é exibido antes da chamada; conflito de vigência mostra qual condição existente colide e seu período (checagem no app antes de gravar; violação da restrição no banco — código `23P01`, corrida entre duas telas — cai no mesmo texto amigável) | **Código:** `src/components/taxasLocais/ChargeOverridesTab.tsx`, `src/pages/taxasLocaisHelpers.ts`, `src/services/charges/chargeRateService.ts` · **Teste:** `src/pages/__tests__/taxasLocaisHelpers.test.ts`, `src/services/charges/__tests__/chargeRateService.overlap.test.ts`, `src/services/__tests__/customerRateOverridesNoOverlapMigration.test.ts` |
| `/taxas-locais/tabelas` · excluir override | Confirmação | `handleDeleteOverride` | `useDeleteCustomerRateOverride` → `deleteCustomerRateOverride` | `DELETE customer_rate_overrides` | Mesmas invalidações do save de override | Toast de falha | **Código:** `src/components/taxasLocais/ChargeOverridesTab.tsx`, `src/hooks/useLocalCharges.ts` |
| B/L/revisão · calcular ou recalcular um B/L | B/L existente; usuário ativo; `recalculate` define limpeza/reuso; CE Mercante exigido para emitir (não mais para calcular) em `cargo_mode=container`; **B/L com `financial_status IN ('invoiced','partially_paid','paid')` é recusado** (etapa 2 do plano de faturamento, ADR 0038 achado 6) | `BlCobrancasTab`, `Revisao`, `reviewBillingAutomation`, `ceMercanteImport` | `useCalculateBlLocalCharges` ou chamada direta → `calculateBlLocalCharges`; `maybeAutoBillAfterCeMercante` tenta cálculo+emissão após CE para B/L container reconciliado por documento | RPC `calculate_bl_local_charges` → `charge_calculations`, estado e auditoria do B/L; automação pode emitir invoice | Invalida linhas do B/L, detalhe, lista de B/Ls, `charges.operations()`/`pendencies()` e viagens | RPC propaga ausência de tabela, dados inválidos e demais regras; automação sempre calcula (etapa 4, ADR 0038 achado 11) e só bloqueia a **emissão** enquanto o CE estiver vazio; UI mostra toast no cálculo manual. `calculateBlLocalCharges` consulta `bls.financial_status` antes de chamar a RPC e recusa localmente com mensagem clara se o B/L já foi faturado; a migration `262` replica a mesma trava dentro da própria RPC, cobrindo chamada direta fora do app. `charge_status` não é mais promovido automaticamente de `calculated` para `ready_for_billing` (migration `263` remove `trg_promote_calculated_bl_ready`, etapa 3, ADR 0038 decisão 8) — a promoção só acontece via `mark_bl_ready_for_billing` (clique explícito) ou `mark_bl_ready_and_create_invoice` (caminho do CE). Falha **inesperada** da automação pós-CE é registrada no Histórico do B/L (`bl_auto_billing_failed`) e, na edição da ficha, também num toast; reimport de CE de B/L já faturado é no-op benigno registrado como info (`ce_reimport_already_invoiced`). | **Código:** `src/components/bl/BlCobrancasTab.tsx`, `src/pages/Revisao.tsx`, `src/services/reviewBillingAutomation.ts`, `src/services/ceMercanteImport.ts`, `src/services/operationalEvents.ts`, `src/services/charges/chargeOperationsService.ts` · **Teste:** `src/services/__tests__/localCharges.test.ts`, `src/services/__tests__/reviewBillingAutomation.test.ts`, `src/services/__tests__/ceMercanteImport.test.ts` |
| B/L importado · cálculo provisório recuperável | Import confirmado; actor válido; flags físicas precedem cálculo quando aplicável | RPC de importação e `ImportResultPanel` | `import_pending_effects` → `import-effects-runner` → `process_import_effect` | Consumidor `_run_import_effect_local_charges`; `charge_calculations` e estado do B/L | Estado do efeito consultável; cálculo fora da transação original | Retry, lease e bloqueio investigável; runner depende de ativação | **Código:** `src/services/importEffects.ts`, migrations `017`/`031`/`056`; **Teste de contrato SQL:** `importEffectConsumersMigration.test.ts` |
| `/taxas-locais` · calcular/recalcular selecionados | Seleção não vazia; IDs locais separados de Granito | `ValidacaoTab.runBatchOperation` | `useBatchCalculateLocalCharges` → `calculateLocalChargesBatch`; Granito chama `calculateGraniteBlCharges` | Uma RPC `calculate_bl_local_charges` por B/L local; persistência própria para Granito | Invalida `charges.operations()`/`pendencies()`, B/Ls, `bls.detail('')` e viagens; a tela também invalida invoices e resumo de B/Ls | Lote continua após erro e retorna contagem/primeiro erro. B/Ls já faturados são retirados da seleção antes de chamar a RPC e reportados à parte ("X recalculado(s), Y ignorado(s) — já faturados"), em vez de contarem como erro (`isBlLockedForRecalc`/`isBlFinanciallyLocked`) | **Código:** `src/components/billing/ValidacaoTab.tsx`, `src/components/billing/validacaoPipeline.ts`, `src/lib/chargeStatus.ts`, `src/hooks/useLocalCharges.ts` · **Teste:** `src/components/billing/__tests__/validacaoFunnel.test.ts` |
| `/taxas-locais` (Validação) · exportar planilha de conferência | Filtro/seleção com ao menos um B/L com linha calculada | `ValidacaoControls` → `ValidacaoTab.handleExportConference` | `buildLocalChargeConferenceRows` → CSV via `exportLocalChargeConferenceCsv`/`downloadCsv` (`src/lib/csv.ts`) | `SELECT` em `bls`, `charge_calculations` (join `charge_table_items`) e `bl_containers` para os B/Ls do escopo | Nenhuma (leitura, download local) | Toast informa quando não há B/Ls/linhas no escopo; erro de query cai em toast genérico. **Etapa 5 do plano de faturamento** (docs/archive/plans/2026-08-06-faturamento-ajuste-completo.md): conferência do cálculo provisório por B/L e por item, com origem do preço (tabela padrão vs Condição de Cliente) e marcação de container compartilhado (`share_count`). **Gap conhecido:** o plano também pede o mesmo botão na tela de Viagem; `/viagens/:voyageId` não tem hoje uma aba financeira onde encaixar isso sem uma mudança de UI maior, então essa parte não foi entregue. | **Código:** `src/components/billing/ValidacaoTab.tsx`, `src/components/billing/ValidacaoControls.tsx`, `src/services/charges/chargeOperationsService.ts`, `src/services/exports.ts` · **Teste:** `src/services/__tests__/localChargeConference.test.ts` |
| B/L · adicionar cobrança manual | Item elegível, quantidade válida e B/L não faturado conforme RPC | `BlCobrancasTab` → `ManualChargeFormFields` | `useAddManualBlCharge` → `addManualBlCharge` | RPC `add_manual_bl_charge` → `charge_calculations` e auditoria | Invalida linhas/detalhe/lista do B/L, pendências e viagens | RPC/validação bloqueia item ou estado inválido | **Código:** `src/components/bl/BlCobrancasTab.tsx`, `src/services/charges/chargeOperationsService.ts` · **Teste:** `src/services/__tests__/localCharges.test.ts`, `src/components/billing/__tests__/ManualChargeFormFields.test.tsx` |
| B/L · editar cobrança manual | Linha manual existente e B/L elegível | `BlCobrancasTab` | `useUpdateManualBlCharge` → `updateManualBlCharge` | RPC `update_manual_bl_charge` | Invalida linhas/detalhe/lista do B/L e pendências | RPC rejeita linha automática, ausente ou invoice protegida | **Código:** `src/components/bl/BlCobrancasTab.tsx`, `src/hooks/useLocalCharges.ts`, `supabase/migrations_archive/108_guard_manual_charges_and_clear_pix_on_reversal.sql` |
| B/L · excluir cobrança manual | Linha manual existente e confirmação da tela | `BlCobrancasTab` | `useDeleteManualBlCharge` → `deleteManualBlCharge` | RPC `delete_manual_bl_charge` | Mesmas invalidações da edição | RPC rejeita linha automática, ausente ou invoice protegida | **Código:** `src/components/bl/BlCobrancasTab.tsx`, `src/services/charges/chargeOperationsService.ts`, `supabase/migrations_archive/108_guard_manual_charges_and_clear_pix_on_reversal.sql` |
| B/L ou lote · marcar revisado | Sem regra de seleção além dos IDs; a RPC valida linhas | `BlCobrancasTab` ou `ValidacaoTab` | `markBlChargesReviewed` / `markLocalChargesReviewedBatch` | RPC `mark_bl_charges_reviewed` → status das linhas/B/L e auditoria | Individual invalida linhas, detalhe, B/Ls, pendências e viagens; lote invalida operações, pendências, B/Ls e `bls.detail('')` | Erros do lote são agregados por B/L; Granito trata “review” como sucesso sem escrita | **Código:** `src/hooks/useLocalCharges.ts`, `src/components/billing/ValidacaoTab.tsx`, `src/services/charges/chargeOperationsService.ts` |
| B/L ou lote · marcar pronto para faturar | Cliente vinculado/reconciliado, gate canônico sem pendências, nenhuma linha pendente, valor faturável (BRL ou USD) positivo e tabela vigente | `BlCobrancasTab` ou `ValidacaoTab` | `markBlReadyForBilling` / `markLocalChargesReadyBatch` | RPC `mark_bl_ready_for_billing`; `charge_calculations`, `bls`, `audit_logs`, `bl_receivables` (via `sync_local_charge_receivable`) | Individual também invalida invoices; lote invalida operações, pendências, B/Ls, `bls.detail('')` e viagens | RPC define `billing_hold_reason` e rejeita cada gate | **Código atual:** `src/services/charges/chargeOperationsService.ts`, `supabase/migrations_archive/129_review_gate_hardening.sql` + `supabase/migrations_archive/268_local_charges_usd_conversion_at_emission.sql` · **Teste de contrato SQL:** `src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts` sobre `supabase/migrations_archive/127_guard_invoiceable_ready_state.sql`, `src/services/__tests__/localChargesUsdConversionMigration.test.ts` |
| `/taxas-locais` · acompanhar e reenviar comunicado financeiro | Invoice local do cliente; prontidão completa para envio inicial ou comunicado anterior para reenvio | `InvoiceCommunicationStatusCell` | `useCustomerVoyageCommunicationStatus` → `fetchCustomerVoyageCommunicationStatus`; reenvio confirmado → `dispatchCeMercanteTaxasCommunication({ forceRetry: true })` | `customer_local_charges_communication_readiness()`; trilha `customer_communications`/tentativas | Mostra “Enviado automaticamente”, “Reenviado manualmente” ou motivo de bloqueio; invalida status após reenvio | Falha de leitura mostra status indisponível; confirmação pode ser cancelada; contato/supressão/chave global bloqueia ou simula | **Código:** `src/components/billing/InvoiceCommunicationStatusCell.tsx`, `src/services/customerFinanceCommunications.ts`, `supabase/migrations_archive/376_customer_local_charges_communication_readiness.sql` · **Teste:** `src/services/__tests__/customerFinanceCommunications.test.ts`, `src/components/billing/__tests__/InvoiceCommunicationStatusCell.test.tsx` |
| `/taxas-locais` · apontar a conciliação para a Revisão | B/L com conciliação pendente | `ValidacaoOperationsTable` (expansão) | Nenhuma mutação: a tela exibe cliente do manifesto, CNPJ, sugestão e detecção inline no bloco "Detalhes", sem caixa separada | O callout do bloqueio concentra o único link `/revisao?bl=` — a decisão é da Revisão (ADR 0061) | — | Sem item na fila, a expansão exibe a mensagem inline no bloco "Detalhes" | **Código:** `src/components/billing/ValidacaoOperationsTable.tsx`; **Teste:** `src/components/billing/__tests__/ValidacaoOperationsTable.test.tsx` |

## Estado e dados

### Famílias canônicas de query keys

Definidas em `src/services/queryKeys.ts`:

| Família | Forma exata | Conteúdo |
|---|---|---|
| `queryKeys.charges.tables(filters)` | `['local-charge-tables', filters]` | Tabelas e itens |
| `queryKeys.charges.operations(filters?)` | sem filtro: `['local-charge-operations']`; com filtro: `['local-charge-operations', filters]` | Fila operacional local + Granito |
| `queryKeys.charges.overrides(filters)` | `['local-charge-overrides', filters]` | Overrides por cliente |
| `queryKeys.charges.overrideItems()` | `['local-charge-override-items']` | Itens automáticos ativos elegíveis |
| `queryKeys.charges.overrideCustomers(search)` | `['local-charge-override-customers', search]` | Clientes do seletor |
| `queryKeys.charges.pendencies()` | `['local-charge-pendencies']` | Pendências de cálculo |
| `queryKeys.bls.localChargeLines(blId)` | `['bl-local-charge-lines', blId]` | Linhas calculadas/manuais do B/L |
| `queryKeys.bls.manualChargeItems(blId)` | `['manual-charge-items', blId]` | Itens manuais disponíveis para o B/L |
| `queryKeys.billingRuns.list(limit)` | `['billing-runs', limit]` | Runs exibidos após reconciliação |
| `queryKeys.billingRuns.detail(id)` | `['billing-run-detail', id]` | Detalhe de run |
| `queryKeys.reconciliation.queue(status, limit)` | `['customer-reconciliation-queue', status, limit]` | Fila de reconciliação de cliente |

### Invalidações reais das mutations

| Mutation | Invalidações executadas |
|---|---|
| salvar/ativar tabela | `charges.tables()` |
| salvar/excluir item | `charges.tables()`, `bls.manualChargeItems('')`, `charges.overrideItems()` |
| salvar/excluir override | `charges.overrides()`, `bls.localChargeLines('')` |
| adicionar cobrança manual | `bls.localChargeLines(blId)`, `bls.detail(blId)`, `bls.all()`, `charges.pendencies()`, `voyages.all()` |
| editar/excluir cobrança manual | linhas, detalhe e lista do B/L; `charges.pendencies()` |
| revisar um B/L | linhas, detalhe e lista do B/L; pendências e viagens |
| liberar um B/L | linhas, detalhe e lista do B/L; pendências, viagens e `invoices.all()` |
| calcular um B/L | linhas, detalhe e lista do B/L; `charges.operations()`, pendências e viagens |
| calcular/revisar/liberar lote | `charges.operations()`, pendências, B/Ls e `bls.detail('')`; cálculo/liberação também invalidam viagens |
| aprovar/rejeitar reconciliação | `reconciliation.queue()`, `charges.operations()`, `billingRuns.list(50)`, B/Ls e `bls.detail('')` |

### Persistência e ownership

- `charge_tables` possui escopo, vigência e ativação da tabela. A vigência é
  informativa (ADR 0040): `resolve_local_charge_table_id` (migration `274`)
  resolve por `cargo_mode` + POD normalizado + `active`, e desempata entre
  ativas por `valid_from DESC, id DESC`. Inativar é a única forma de tirar uma
  tabela do cálculo.
- `charge_table_items` possui categoria, base de aplicação, perfil, moeda e
  valor unitário; `manual_only` separa itens automáticos dos adicionáveis.
- `customer_rate_overrides` possui a substituição por cliente/item/vigência.
- `charge_calculations` possui as linhas efetivamente calculadas ou manuais.
- `bls.charge_status`, timestamps e `billing_hold_reason` resumem o workflow,
  mas as linhas e seus motivos continuam em `charge_calculations`.
- `customer_reconciliation_queue` possui a decisão pendente; o B/L possui o
  estado resumido usado pelos gates.
- `audit_logs` registra transições e operações relevantes; a fila operacional
  lê o último evento quando a policy permite.

## Fluxos e invariantes

B/L misto consome as tabelas container e carga solta através de
`resolve_bl_local_charge_table_ids` (`056`). A taxa com `application_basis = 'bl'`
incide só do lado container; falta parcial de tabela gera pendência específica.
`059` estende o mesmo resolvedor ao catálogo/lançamento manual e `062` corrige
quantidades BB. Terminal não seleciona preço. O catálogo de tabelas continua
com `container`, `carga_solta` e `granito`, sem cadastro separado de `misto`.


```mermaid
flowchart LR
    Config["Tabela ativa + itens + overrides"] --> Calc["calculate_bl_local_charges"]
    Calc --> Lines["charge_calculations"]
    Lines --> Review{"Há review_required?"}
    Review -->|sim| Hold["B/L bloqueado para revisão"]
    Review -->|não| Reviewed["mark_bl_charges_reviewed"]
    Reviewed --> Ready["mark_bl_ready_for_billing"]
    Ready --> Billing["Faturamento / ledger"]
    Manual["Cobrança manual"] --> Lines
    Reconcile["Reconciliação de cliente"] --> Ready
```

- A tabela aplicável é resolvida por modo, POD normalizado e data; overrides
  vigentes substituem o valor do item.
- `calculate_bl_local_charges` é a fronteira de cálculo. Recálculo preserva
  linhas manuais conforme o contrato SQL vigente.
- `mark_bl_ready_for_billing` é a fronteira de promoção: cliente precisa estar
  vinculado e em estado aceito, o gate canônico
  `compute_bl_review_pendencies` precisa estar vazio, não pode haver linha de
  taxa pendente e deve existir ao menos uma linha faturável (BRL ou USD) e uma
  tabela vigente. A definição vigente de `mark_bl_ready_for_billing` está em
  `supabase/migrations_archive/129_review_gate_hardening.sql` +
  `supabase/migrations_archive/268_local_charges_usd_conversion_at_emission.sql`; a de
  `compute_bl_review_pendencies` está em
  `supabase/migrations_archive/188_review_gate_remove_portal.sql`, que reduziu o gate a
  cliente vinculado, e-mail cadastrado e peso BB — prontidão do Portal deixou de
  bloquear faturamento.
- **Taxa local em USD (ADR 0038 decisão 6, achado 7, migration 268):** linha
  em USD deixou de bloquear `mark_bl_ready_for_billing`. Converte para BRL na
  emissão da fatura (`create_invoice_from_bls_core` /
  `create_local_consolidated_invoice_core`), pelo ROE vigente em
  `exchange_rate_reference`, congelado com o resto da fatura — sem o
  Recálculo Diário que o Demurrage usa. `mark_bl_ready_for_billing` chama
  `sync_local_charge_receivable` diretamente para manter o saldo do ledger
  atualizado (inclusive convertendo linhas USD), no lugar do trigger
  `trg_emit_invoice_on_bl_ready` removido na mesma migration (ver
  `docs/RASTREABILIDADE.md` para o motivo da remoção).
- **Arredondamento do rateio (ADR 0038 achado 9, migration 269):** itens
  `application_basis='container_distinct_voyage'` (containers compartilhados
  por vários B/Ls) somavam `1/share_count` de cada container do B/L numa
  quantidade agregada e arredondavam o total independentemente por B/L — um
  item de R$ 100 dividido em 3 B/Ls dava R$ 33,33 em cada um, R$ 99,99 no
  total. Agora o cálculo soma por container, e o último B/L do grupo (maior
  `bl_id`) absorve a diferença de arredondamento, em BRL e em USD, então a
  soma das partes sempre fecha o valor cheio do item por container. A
  quantidade fracionária gravada em `charge_calculations.quantity` continua
  sendo a soma informativa de `1/share_count` — só o total em dinheiro mudou
  de fórmula, então o produto visual "unitário × quantidade" pode não bater
  exatamente com o total exibido para o B/L que absorveu o resto (a soma do
  grupo inteiro é que fecha, não cada linha isolada).
- O estado aceito na migration atual é `matched_document` ou `reconciled`;
  `ValidacaoTab` usa o mesmo helper canônico e mantém `matched_name` como
  pendente até aprovação manual.
- Operações em lote são sequenciais e não atômicas entre B/Ls: cada ID pode
  concluir ou falhar independentemente.
- `listLocalChargeOperationalRows` combina `bls` e `granite_bls`, mas os motores
  e transições de Granito permanecem separados.
- A UI de `/taxas-locais/tabelas` não exibe a fila operacional. Esse limite é
  sustentado por `src/pages/__tests__/TaxasLocaisTabelas.test.ts`.

## Testes e validação

O lote comportamental de 2026-06-23 executou 9 arquivos e 37 testes com sucesso.
Além dos contratos existentes, a rota e os componentes foram exercidos para
criação, edição, ativação/inativação, exclusão confirmada, seleção da primeira
aba autorizada e paginação completa antes dos filtros de overrides.

| Arquivo | Evidência coberta |
|---|---|
| `src/pages/__tests__/TaxasLocaisTabelas.test.ts` | Rota contém somente tabelas e overrides |
| `src/pages/__tests__/taxasLocaisHelpers.test.ts` | Validação de tabela, item e override |
| `src/services/__tests__/localCharges.test.ts` | Cálculo, linhas, itens manuais, fila paginada e promoção para faturamento |
| `src/services/__tests__/financialValidation.test.ts` | Validações financeiras reutilizadas nas superfícies relacionadas |
| `src/components/billing/__tests__/ManualChargeFormFields.test.tsx` | Estados de criação/edição da cobrança manual |
| `src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts` | **Teste de contrato SQL** do gate de valor BRL faturável |
| `src/services/__tests__/guardManualChargesMigration.test.ts` | **Teste de contrato SQL** dos bloqueios de cobranças manuais |
| `src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx` | CRUD comportamental de tabelas, itens e overrides |
| `src/services/__tests__/chargeRateService.test.ts` | Pagina toda a fonte antes de filtrar e limitar overrides |

Comando focado:
`npm test -- --run src/components/taxasLocais/__tests__/TaxasLocais.behavior.test.tsx src/pages/__tests__/TaxasLocais.test.ts src/pages/__tests__/taxasLocaisHelpers.test.ts src/services/__tests__/chargeRateService.test.ts src/services/__tests__/localCharges.test.ts src/services/__tests__/queryKeysPrefix.test.ts src/components/billing/__tests__/ManualChargeFormFields.test.tsx src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts src/services/__tests__/guardManualChargesMigration.test.ts`.

## Notas e divergências

- **Invalidação por prefixo validada.** As factories de tabelas, overrides,
  reconciliação e detalhes agora retornam uma chave-base real quando chamadas
  sem argumento. `src/services/__tests__/queryKeysPrefix.test.ts` protege esse
  contrato.
- **Gate de reconciliação alinhado.** A interface considera resolvidos somente
  `matched_document` e `reconciled`, os mesmos estados aceitos por
  `mark_bl_ready_for_billing`.
- **Overrides são filtrados no cliente após paginação completa.** A consulta
  percorre a fonte em páginas de 500 registros, aplica nome/documento, modo e
  POD e somente então limita a visão. Isso preserva correção sem depender da
  posição do override no histórico.
- **Granito é uma agregação visual, não um único domínio de cobrança.** Revisão
  em lote de Granito retorna sucesso sem escrita, e a liberação usa update
  direto de `granite_bls`.
- `pricing_rule_versions` não participa deste caminho atual; cálculo e
  transições registram evidência principalmente em `audit_logs`.
