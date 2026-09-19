# Demurrage

> **Status:** ativo · **Atualizado:** 2026-09-11 · **Rotas:** `/demurrage`, `/demurrage/taxas`

## Propósito e escopo

Demurrage acompanha descarga e devolução de containers, resolve free time e
tarifas P1/P2, calcula a sobreestadia em USD e mantém invoices próprias cujo
total BRL **acompanha a PTAX até o pagamento** (USD travado na
emissão; ROE/BRL congelam só no pagamento — ver
[ADR 0014](../adr/0014-demurrage-recalculo-diario-substitui-roe-congelado.md) e
[ADR 0015](../adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md)).
As rotas internas ficam sob
`ProtectedRoute` em [`src/AppInterno.tsx`](../../src/AppInterno.tsx); a interface de tarifas
expõe mutações apenas para admin, enquanto as policies e RPCs continuam sendo a
fronteira efetiva de autorização.

O domínio não pertence ao ledger de taxas locais. Datas vivem em
`bl_containers`; configuração por B/L, em `bls`; tarifas, em
`demurrage_rates`; documentos e itens, em `demurrage_invoices` e
`demurrage_invoice_items`. A operação vive em `/demurrage`, com consultas em
`/reconciliacao` e `/portal/billing`, mas a persistência continua separada,
conforme a [ADR 0008](../adr/0008-demurrage-integrado-sem-unificar-persistencia.md).

Fontes executáveis principais:

- [`src/pages/Demurrage.tsx`](../../src/pages/Demurrage.tsx), composição da
  rota, queries, mutations e estado de tela, e
  [`src/pages/DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx);
- abas da rota em
  [`DemurrageContainersTab.tsx`](../../src/components/demurrage/DemurrageContainersTab.tsx),
  [`DemurrageInvoicesTab.tsx`](../../src/components/demurrage/DemurrageInvoicesTab.tsx)
  e [`DemurrageCustomersTab.tsx`](../../src/components/demurrage/DemurrageCustomersTab.tsx);
- fluxos modais em
  [`PtaxModal.tsx`](../../src/components/demurrage/PtaxModal.tsx),
  [`PaymentModal.tsx`](../../src/components/demurrage/PaymentModal.tsx),
  [`DiscountModal.tsx`](../../src/components/demurrage/DiscountModal.tsx),
  [`DisputeModal.tsx`](../../src/components/demurrage/DisputeModal.tsx) e
  [`CustomerReportModal.tsx`](../../src/components/demurrage/CustomerReportModal.tsx);
- [`src/services/demurrage/demurragePresentation.ts`](../../src/services/demurrage/demurragePresentation.ts)
  concentra formatação e cálculo operacional apresentado na tela principal;
- [`src/components/bl/BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx)
  na aba `faturamento` do B/L;
- serviços em [`src/services/demurrage/`](../../src/services/demurrage/);
- [`src/services/demurrageDunning.ts`](../../src/services/demurrageDunning.ts),
  [`DemurrageDunningStatus.tsx`](../../src/components/demurrage/DemurrageDunningStatus.tsx)
  e a Edge Function [`demurrage-dunning`](../../supabase/functions/demurrage-dunning/index.ts),
  que exibem e executam a Régua de Cobrança;
- importação de datas em
  [`src/services/containerDatesImport.ts`](../../src/services/containerDatesImport.ts);
- documento imprimível em
  [`src/components/demurrage/InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx).

## Anatomia das telas

### `/demurrage`

[`src/pages/Demurrage.tsx`](../../src/pages/Demurrage.tsx) mantém a aba ativa,
filtros, seleção de modais, queries e mutations. As três superfícies de dados
são renderizadas por `DemurrageContainersTab`, `DemurrageInvoicesTab` e
`DemurrageCustomersTab`; os fluxos de PTAX, pagamento, desconto, disputa e
relatório são renderizados pelos modais homônimos. Sob recálculo diário (ADR
0014) não há `draft` nem `overdue`: a fatura nasce `issued`.

- A aba `Containers` é **monitoramento operacional** (ADR 0014): mostra containers
  ainda fora (`overdue`, demurrage correndo até hoje) **e** devolvidos com
  demurrage > 0. Os devolvidos dentro do free time são excluídos no frontend.
  Aceita `?busca=`, agrupa por B/L e deriva free time, dias excedidos, P1/P2 e
  total USD com `calculateDemurrage` (devolução ou hoje, quando ainda fora).
- A barra de KPIs combina contagem de containers em atraso, total USD da lista
  filtrada e total BRL aguardando pagamento.
- `Importar Datas` abre
  [`src/components/shared/ContainerDatesImportModal.tsx`](../../src/components/shared/ContainerDatesImportModal.tsx):
  parseia planilha, mostra preview e erros, exibe progresso/cancelamento da
  leitura, atualiza datas e pode criar/emitir invoice quando todos os containers
  do B/L foram devolvidos.
- O modal `Editar datas do container` altera descarga e devolução, validando
  formato e ordem antes da escrita.
- As abas de invoice consultam um status exato por vez (`issued`, `paid` ou
  `cancelled`). Cada linha abre breakdown, desconto e disputa; em `issued` há
  `Registrar Pgto`, `Fatura` e `Cancelar` (ação explícita e auditada).
- O visualizador de fatura/recibo usa
  [`src/components/demurrage/InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx)
  e o kit compartilhado
  [`src/components/shared/InvoiceDocumentKit.tsx`](../../src/components/shared/InvoiceDocumentKit.tsx);
  `Imprimir` chama `window.print()`.

### `/bls/:blId` → aba `faturamento`

[`src/components/bl/BlFaturamentoTab.tsx`](../../src/components/bl/BlFaturamentoTab.tsx)
inclui [`BlDemurrageSection`](../../src/components/bl/BlDemurrageSection.tsx)
como segunda entrada operacional. A seção permite:

- editar `free_time_override` e overrides P1/P2 do B/L;
- definir ou limpar `return_date` por container;
- visualizar descarga e cálculo derivado antes de salvar;
- voltar à tarifa padrão deixando os campos de override vazios.

### `/demurrage/taxas`

### Acordo de Demurrage do cliente

`customer_demurrage_agreements` (migration `366`) guarda free time e tarifas
P1/P2 negociados por cliente, com vigência (`valid_from`/`valid_to`). Duas
regras de leitura, ambas com uma armadilha já corrigida:

- **A escolha é por data de descarga, não por cliente.** Um cliente pode ter
  mais de um acordo ativo (o vencido e o vigente). Guardar "o acordo do cliente"
  antes de olhar a data fazia o vencido mascarar o vigente e a cobrança cair na
  tabela padrão. A escolha vive em `selectAgreementForDischargeDate`, usada pela
  ficha do B/L e pelo import de datas de container, com a lista ordenada por
  vigência decrescente para que o mais recente vença em sobreposição.
- **Sem cliente vinculado não há acordo.** `listCustomerDemurrageAgreements` só
  filtra por cliente quando recebe um id — "sem `customerId`" significa "todos",
  porque a aba de acordos lista tudo de propósito. Por isso quem pergunta pelos
  acordos **de um** cliente passa `enabled` ao hook: sem esse guard, um B/L sem
  cliente recebia todos os acordos ativos e aplicava, pela data, o acordo
  negociado de outro cliente.

O free time do acordo move o **início** da cobrança; a faixa P1 continua sendo o
intervalo de dias do grupo em `demurrage_rates`. Free time negociado além do fim
da faixa P1 significa, por definição, que não há dias em P1 — a cobrança começa
direto em P2, sem que dias livres virem P2
([`calculateDemurrage.test.ts`](../../src/services/demurrage/__tests__/calculateDemurrage.test.ts)
cobre os dois casos).

[`src/pages/DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) lista
`demurrage_rates` por tipo de equipamento, free days, faixas P1/P2, vigência e
estado ativo. Usuários ativos podem ler; a UI e a policy
`admin_gerencia_demurrage_rates` reservam criar, editar, ativar/desativar e
excluir para admin, conforme
[`supabase/migrations_archive/048_demurrage_rates_table.sql`](../../supabase/migrations_archive/048_demurrage_rates_table.sql).

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/demurrage` · monitorar containers em demurrage | Sessão interna; aba `Containers` | `Demurrage` (estado/queries); `DemurrageContainersTab`; `groupByBl`; `effectiveDemurrage`; filtro local | `listDemurrageContainers` (`demurrage_status IN ('overdue','returned')`); `ensureDemurrageRatesLoaded`; `calculateDemurrage` | SELECT em `bl_containers`, `bls`, `customers`, `voyages`, `vessels`; SELECT em `demurrage_rates` | Query `['demurrage-containers']`, `staleTime=60s`; devolvidos no free time excluídos no cliente; colunas free time / dias excedidos / P1·P2 / USD | Erro de query mostra `InlineError`; falha de tarifas sem cache válido do banco rejeita o cálculo com mensagem explícita | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`DemurrageContainersTab.tsx`](../../src/components/demurrage/DemurrageContainersTab.tsx), [`demurragePresentation.ts`](../../src/services/demurrage/demurragePresentation.ts), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts) |
| `/demurrage` · carregar KPIs | Sessão interna | Query montada pela página | `fetchDemurrageKPIs` executa três consultas paralelas | `bl_containers` e `demurrage_invoices` | Query `['demurrage-kpis']`, `staleTime=60s` | Qualquer consulta com erro rejeita o conjunto; a página mantém placeholders | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageKpis.ts`](../../src/services/demurrage/demurrageKpis.ts) |
| `/demurrage` · importar datas | Arquivo com B/L, container e descarga; devolução opcional | `ContainerDatesImportModal.handleFile/handleImport` | `parseContainerDatesFile` → `importContainerDates` → `resolveStatus`; quando todo o B/L retorna, `createInvoiceForReturnedBL` → `fetchROE` → `issueInvoice` | UPDATE em `bl_containers`; possível INSERT em `demurrage_invoices` e `demurrage_invoice_items` | Invalida `['demurrage-containers']`, `['demurrage-invoices']`, `['bl-detail']`; reporta atualizados, inalterados e ausentes | Colunas/datas inválidas ficam no preview; falha de qualquer escrita interrompe o import | **Código:** [`ContainerDatesImportModal.tsx`](../../src/components/shared/ContainerDatesImportModal.tsx), [`containerDatesImport.ts`](../../src/services/containerDatesImport.ts) |
| `/demurrage` · editar descarga e devolução | Descarga obrigatória; devolução vazia ou não anterior | `openEditContainer`; `containerDatesMutation` | `demurrageDatesSchema` → `updateContainerDates` → cálculo de status | UPDATE direto em `bl_containers` | Invalida `['demurrage-containers']`; fecha modal | Validação local bloqueia formato/ordem; constraint do banco rejeita ordem inválida | **Código/Teste:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts) |
| B/L · definir ou limpar devolução | Container do B/L; data opcional | `BlDemurrageSection.handleSaveReturnDate` | `updateContainerReturnDate` recalcula status e chama auditoria best-effort | UPDATE em `bl_containers`; INSERT best-effort em `audit_logs` com `new_value` data ou `null` | Invalida `bl-detail`, `bls` e `['demurrage-containers']` | Falha principal mostra toast; falha de auditoria vai para telemetria e não desfaz a data | **Código/Teste:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx), [`demurrageContainers.ts`](../../src/services/demurrage/demurrageContainers.ts), [`updateContainerReturnDate.audit.test.ts`](../../src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts) |
| B/L · salvar free time | Usuário autenticado; B/L carregado com `updated_at` esperado | `BlDemurrageSection.handleSaveDemurrageConfig` | RPC auditada `save_bl_review` com payload e linha de auditoria | UPDATE de `bls.free_time_override` e INSERT de auditoria dentro da RPC | Invalida `queryKeys.bls.detail(bl.id)` | `PT409` ou `40001` recarrega detalhe e exige nova revisão; outros erros abortam antes dos overrides P1/P2 | **Código:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx), [`021_save_bl_review_stale_fast_fail.sql`](../../supabase/migrations_archive/021_save_bl_review_stale_fast_fail.sql), [`022_save_bl_review_conflict_code_pt409.sql`](../../supabase/migrations_archive/022_save_bl_review_conflict_code_pt409.sql) |
| B/L · salvar overrides P1/P2 | Free time salvo com sucesso; valores vazios ou numéricos | Mesmo handler, etapa posterior à RPC | UPDATE direto em `bls`; auditoria separada best-effort | `bls.demurrage_rate_override_p1_usd`, `bls.demurrage_rate_override_p2_usd`; `audit_logs` | Invalida detalhe do B/L ao concluir | Valor não numérico é bloqueado; falha do UPDATE aborta; falha da auditoria só gera telemetria | **Código:** [`BlDemurrageSection.tsx`](../../src/components/bl/BlDemurrageSection.tsx) |
| Derivar free time, P1/P2 e status | Tipo, descarga e devolução válidos; tarifas do banco carregadas | Tracking, aba do B/L, import e criação de invoice | `ensureDemurrageRatesLoaded` carrega `demurrage_rates`; `calculateDemurrage` resolve tarifa e calcula dias inclusivos de P1/P2 | Sem escrita; lê cache em memória de tarifas vindas do banco | Resultado `within_free_time` ou `overdue`; usado para UI e persistência subsequente; falha de refresh preserva o último cache válido do banco | String vazia/data inválida, devolução anterior, tipo sem tarifa cadastrada ou ausência de tarifa vigente do banco lança erro | **Código/Teste:** [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts), [`calculateDemurrage.test.ts`](../../src/services/demurrage/__tests__/calculateDemurrage.test.ts) |
| `/demurrage` · criar invoice para B/L (nasce `issued`) | Cliente vinculado; container elegível; sem fatura ativa (`issued`/`paid`) no B/L | Botão `Gerar Fatura`; `generateMutation` | `createInvoiceForBL` resolve ROE (`resolveCurrentRoe`: override manual ou `fetchROE`), recalcula itens e chama a RPC atômica `create_demurrage_invoice_with_items` | RPC: INSERT em `demurrage_invoices` (`status='issued'`, `current_roe`/`current_total_brl`/`pix_payload`), itens e a foto inicial em `demurrage_invoice_history` | Invalida containers, invoices e KPIs | B/L já com fatura ativa lança erro (não duplica); PTAX indisponível sem cache rejeita | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts), [`156_demurrage_create_invoice_issued.sql`](../../supabase/migrations_archive/156_demurrage_create_invoice_issued.sql) |
| `/demurrage` · listar invoices e acompanhar Régua | Aba `Rascunhos`, `Emitidas` ou `Pagas` | Query da página; `DemurrageInvoicesTab` | `listDemurrageInvoices({status})` + `fetchDemurrageDunningStatuses` → `getDemurrageDunningDisplay` | SELECT em `demurrage_invoices`, `customers`, `bls`, `voyages`, `vessels`, claims da régua, contatos, preferências e supressões | Queries `['demurrage-invoices', status]` e `['demurrage-invoices', 'dunning', invoiceIds]`; mostra tentativa seguinte, data, último envio ou pausa | Erro da invoice mostra `InlineError`; falha da régua mostra `Régua indisponível` | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`DemurrageInvoicesTab.tsx`](../../src/components/demurrage/DemurrageInvoicesTab.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts), [`demurrageDunning.ts`](../../src/services/demurrageDunning.ts) · **Teste:** `DemurrageDunningStatus.test.tsx` |
| `/demurrage` · abrir detalhe/breakdown | Invoice selecionada | Botão `Detalhes` ou visualizador | `getInvoiceDetail` carrega cabeçalho e itens em paralelo | SELECT em `demurrage_invoices` e `demurrage_invoice_items` | Query `['demurrage-invoice-detail', id]` | Erro da invoice ou dos itens rejeita a leitura | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · marcar pago manualmente | UI exibe a ação para invoice `issued`; data informada | `PaymentModal`; `payMutation` | Reusa `current_roe` ou busca ROE; `markInvoicePaid` valida status | UPDATE direto em `demurrage_invoices` | Invalida invoices e KPIs | Status incompatível ou ROE indisponível rejeita | **Código/Teste:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`PaymentModal.tsx`](../../src/components/demurrage/PaymentModal.tsx), [`PaymentModal.behavior.test.tsx`](../../src/components/demurrage/__tests__/PaymentModal.behavior.test.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · desmarcar pagamento | UI oferece para `paid`; confirmação aceita | `handleUnmarkInvoicePaid`; `unpayMutation` | `unmarkInvoicePaid` | UPDATE direto para `issued`, `paid_at=null` | Invalida invoices e KPIs | Erro mostra toast; não exige justificativa nem chama o RPC de reversão | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · cancelar invoice | UI oferece no rascunho; confirmação aceita | `handleCancelInvoice`; `cancelMutation` | `cancelDemurrageInvoice` | UPDATE direto de `status='cancelled'` | Invalida invoices e KPIs | Erro mostra toast; o serviço não valida pagamentos/status | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · aplicar ou remover desconto (USD) | Invoice visível; percentual entre 0 e 100 ou valor fixo em USD não negativo | `DiscountModal`; `discountMutation` | `demurrageDiscountSchema` → `updateDemurrageInvoice` → `recomputeDiscountedBrl` | UPDATE dos campos de desconto e recálculo imediato de `current_total_brl`/`pix_payload` (desconto em USD antes da conversão) | Invalida invoices e KPIs | Validação rejeita modo/valor inválido; erro do banco mostra toast | **Código/Teste:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`DiscountModal.tsx`](../../src/components/demurrage/DiscountModal.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts), [`financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts) |
| `/demurrage` · abrir/atualizar disputa | Invoice visível | `DisputeModal`; `disputeMutation` | `updateDemurrageInvoice` | UPDATE direto de `dispute_open`, assunto, motivo, status e notas | Invalida invoices e KPIs | Não há schema local específico; erro do banco mostra toast | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`DisputeModal.tsx`](../../src/components/demurrage/DisputeModal.tsx), [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts) |
| `/demurrage` · imprimir fatura/recibo | Invoice detail carregado; `issued` ou `paid` na UI | Visualizador e botão `Imprimir` | Render React → `window.print()` | Sem escrita | Abre diálogo nativo; abaixo do título, "Valores calculados em DD/MM/AAAA com PTAX de R$ x,xxxx (fonte: BCB / BCB (cache) / Informada manualmente)"; fatura usa QR PIX e recibo usa carimbo `PAGO` | Popup/print dependem do navegador; não há geração de PDF no servidor | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`InvoiceDocument.tsx`](../../src/components/demurrage/InvoiceDocument.tsx), [`InvoiceDocumentKit.tsx`](../../src/components/shared/InvoiceDocumentKit.tsx) |
| `/reconciliacao` · confirmar PIX | Match por TXID sem ambiguidade; data válida; valor na janela das duas PTAX | `Reconciliacao.confirmMutation` | `confirmUnifiedPixReconciliation` → RPC `confirm_unified_pix_matches` → lote `confirm_demurrage_pix_matches` | UPDATE em lote de `demurrage_invoices` para `paid` (congela valor casado, `paid_at`, `pix_txid`, `conciliated_by_extract`) + foto `source='payment'` no histórico | Invalida invoices locais/demurrage, KPIs, B/Ls, clientes e histórico | Wrapper rejeita data, origem, valor fora da janela e contagem parcial | **Código/Teste:** [`reconciliacao.ts`](../../src/services/reconciliacao.ts), [`158_demurrage_pix_window_conciliation.sql`](../../supabase/migrations_archive/158_demurrage_pix_window_conciliation.sql), [`reconciliacao.test.ts`](../../src/services/__tests__/reconciliacao.test.ts) |
| `/reconciliacao` · reverter baixa | Admin ativo; invoice `paid`; justificativa não vazia | `demurrageReversalMutation` | `reverseDemurragePayment` → RPC `reverse_demurrage_payment` | UPDATE para `issued`, limpa `paid_at`/`pix_txid`; INSERT em `audit_logs` | Invalida invoices de demurrage e histórico | `42501`, invoice ausente, status diferente de `paid` ou justificativa vazia | **Código/Teste:** [`Reconciliacao.tsx`](../../src/pages/Reconciliacao.tsx), [`reconciliacao.ts`](../../src/services/reconciliacao.ts), [`113_require_justification_on_payment_reversal.sql`](../../supabase/migrations_archive/113_require_justification_on_payment_reversal.sql), [`reversalJustificationMigration.test.ts`](../../src/services/__tests__/reversalJustificationMigration.test.ts) |
| `/demurrage` · visão por consignatário | Aba `Por Cliente` | `DemurrageCustomersTab` + `fetchCustomerDemurrageSummary`/`fetchCustomerDemurrageDetail` | Agrega faturas `issued` não pagas por cliente (USD estável + BRL do último recálculo) | SELECT em `demurrage_invoices` + `customers` | Queries `['demurrage-customer-summary']` e `['demurrage-customer-detail', id]` | Erro rejeita a leitura; vazio mostra `EmptyState` | **Código:** [`Demurrage.tsx`](../../src/pages/Demurrage.tsx), [`DemurrageCustomersTab.tsx`](../../src/components/demurrage/DemurrageCustomersTab.tsx), [`demurrageKpis.ts`](../../src/services/demurrage/demurrageKpis.ts), [`CustomerSummaryReport.tsx`](../../src/components/demurrage/CustomerSummaryReport.tsx) |
| `/demurrage` · imprimir relatório por cliente | Aba `Por Cliente` com dados | Botão `Imprimir` → `CustomerReportModal` | Render React → `window.print()` | Sem escrita | Relatório imprimível com totais USD/BRL por consignatário | Popup/print dependem do navegador | **Código:** [`CustomerReportModal.tsx`](../../src/components/demurrage/CustomerReportModal.tsx), [`CustomerSummaryReport.tsx`](../../src/components/demurrage/CustomerSummaryReport.tsx) |
| `/demurrage/taxas` · listar | Usuário interno ativo | Query da página | `listDemurrageRates` | SELECT em `demurrage_rates` | Query `['demurrage-rates']` | Erro mostra `InlineError` | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |
| `/demurrage/taxas` · criar/editar | Admin; tipo de container preenchido | `handleSave` | `upsertDemurrageRate` | UPSERT em `demurrage_rates` | Limpa cache em memória e invalida `['demurrage-rates']` | Validação mínima na UI; policy bloqueia não-admin | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx), [`demurrageRates.ts`](../../src/services/demurrage/demurrageRates.ts) |
| `/demurrage/taxas` · ativar/desativar | Admin | `handleToggleActive` | `toggleDemurrageRateActive` | UPDATE de `active` | Limpa cache em memória e invalida `['demurrage-rates']` | Erro mostra toast | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |
| `/demurrage/taxas` · excluir | Admin; confirmação destrutiva aceita | `handleDelete` | `deleteDemurrageRate` | DELETE em `demurrage_rates` | Limpa cache em memória e invalida `['demurrage-rates']` | Erro mostra toast; cancelar a confirmação não escreve | **Código:** [`DemurrageRates.tsx`](../../src/pages/DemurrageRates.tsx) |

## Estado e dados

- **Queries principais:** `['demurrage-containers']`, `['demurrage-kpis']`,
  `['demurrage-invoices', status]`, `['demurrage-invoice-detail', id]` e
  `['demurrage-rates']`. A aba do B/L também invalida `['bl-detail', blId]` e
  `['bls']`.
- **Estado local da página:** aba, busca, B/L em geração, modais de data,
  detalhe, desconto, disputa, pagamento, documento e aviso de ROE offline.
- **Tarifa efetiva:** precedência
  `override do B/L > demurrage_rates vigente`. A tarifa do banco é a única
  fonte de verdade; não existe fallback estático. `ensureDemurrageRatesLoaded`
  mantém cache em memória por cinco minutos e, se um refresh falhar depois de
  um carregamento válido, preserva o último cache vindo do banco. Sem cache
  válido ou sem linha vigente para o tipo de container, o cálculo falha com
  mensagem explícita ao operador.
- **Aliases ISO:** o catálogo pode manter somente as linhas canônicas de
  `main`; `demurrageRates` resolve os aliases históricos (`22G1`, `42G1`,
  `45G1`, `20FT`, `40FT`, `45R1` e equivalentes) para a tarifa canônica, sem
  duplicar essas linhas no banco.
- **Datas:** `bl_containers.discharge_date` e `return_date` são a fonte
  operacional. `demurrage_invoice_items` copia datas, dias, tarifas e subtotal
  no momento de criação da invoice.
- **ROE e recálculo diário:** `fetchROE` consulta a PTAX dos últimos dez dias,
  aplica o markup canônico `DEMURRAGE_ROE_MARKUP` (`1,065`, ADR 0014) e usa
  `localStorage['demurrage_roe_cache']` como fallback. Sob recálculo diário, o
  valor em BRL não é congelado na emissão: a RPC `recalculate_demurrage_invoices`
  (`service_role`) reprecifica toda fatura `issued` e não paga quando a PTAX muda,
  grava `current_roe`/`current_total_brl`/`roe_source`, regenera o `pix_payload` e
  insere a foto em `demurrage_invoice_history`. A Edge Function agendada
  [`recalc-demurrage-ptax`](../../supabase/functions/recalc-demurrage-ptax/index.ts)
  busca a PTAX (política do `demurrage-manager`: `CotacaoDolarPeriodo`, ~10 dias,
  `top 1` desc) e chama a RPC em dias úteis. Quando o BCB está fora, o operador usa
  o botão **Informar PTAX** em `/demurrage` →
  `recalculate_demurrage_invoices_manual` (autenticada). Um banner de staleness
  aparece quando há faturas aguardando pagamento e o último recálculo é anterior ao
  último dia útil.
- **Régua de cobrança:** as migrations `378_demurrage_dunning_communication.sql`,
  `379_demurrage_dunning_claim_recovery.sql` e a correção `041_dunning_partial_claim_recovery.sql`
  agenda `demurrage-dunning` de hora em hora. O primeiro envio usa
  `first_billed_at` e cada tentativa seguinte soma o intervalo configurado em
  `app_settings.demurrage_dunning_interval_days` (padrão de 7 dias), sem teto;
  cada execução reivindica um lote limitado e libera a posição quando a
  cobrança não chega a envio concluído, exceto quando a tentativa termina em
  `parcial`, que é terminal para o scanner de claims órfãos. O handler procura
  tentativas anteriores pela chave nova, pela identidade do destinatário e pela
  chave legada do contato; quando encontra uma tentativa histórica, reutiliza
  a `idempotency_key` persistida em vez de reescrevê-la. A UI lê o contador pela
  RPC `list_demurrage_dunning_claim_statuses`.
  Disputa aberta, bounce sem alternativa ou ausência de contato válido pausam a
  régua; a regularização retoma no próximo discriminador. O comunicado mostra
  USD, BRL informativo com ROE/data e o link do Portal, sem PIX ou anexo.
- **Câmbio de display:** o header interno usa
  [`src/hooks/useRoeHeaderRate.ts`](../../src/hooks/useRoeHeaderRate.ts) e o
  `fetchROE` compartilhado para apresentar PTAX Venda, a fórmula
  `PTAX × 1,065 = ROE`, a data efetiva e uma ação de atualização. Não há CNY nem
  contrato cambial paralelo; a entrada manual permanece exclusiva de
  `/demurrage`.
- **PIX:** o payload é montado por
  [`src/lib/pix.ts`](../../src/lib/pix.ts) com valor BRL e `doc_number` como
  TXID. A baixa de demurrage não cria `bl_receivables`,
  `invoice_receivable_links` nem `ledger_settlements`.
- **Portal (push/armazenado):** [`src/services/portalBilling.ts`](../../src/services/portalBilling.ts)
  chama `portal_list_demurrage_invoices()` e
  `portal_get_demurrage_invoice_detail(bigint)`. O cliente resolve pela sessão,
  limita a invoices `issued|overdue|paid` e exige liberação do B/L. Sob recálculo
  diário (ADR 0014) o portal **não** recalcula on-demand: exibe o **último
  recálculo armazenado** — USD fixo (`total_usd`) + BRL dinâmico
  (`current_total_brl`) com data/fonte de referência (`updated_at`, `roe_source`,
  via [`159_portal_demurrage_reference.sql`](../../supabase/migrations_archive/159_portal_demurrage_reference.sql)).
  Assim o valor exibido == valor do QR == histórico. Sem notificação a cada
  recálculo.

## Fluxos e invariantes

```mermaid
flowchart LR
    Dates["Datas do container<br/>descarga e devolução"] --> Calc["Cálculo<br/>free time + P1/P2"]
    Calc --> Create["Criar (nasce issued)<br/>USD travado + ROE do dia<br/>+ itens + foto inicial"]
    Create --> Issued["issued<br/>BRL recalculado diariamente"]
    Issued --> Manual["paid<br/>baixa manual"]
    Issued --> Pix["paid<br/>conciliação PIX"]
    Issued --> Cancelled["cancelled<br/>ação explícita"]
    Manual --> Reverse["reverse_demurrage_payment<br/>admin + justificativa"]
    Pix --> Reverse
    Reverse --> Issued
```

- `calculateDemurrage` rejeita devolução anterior à descarga; o modal repete a
  validação e
  [`089_demurrage_date_order_constraints.sql`](../../supabase/migrations_archive/089_demurrage_date_order_constraints.sql)
  aplica constraints `NOT VALID` a novas escritas/updates. `total_days` não pode
  ser negativo nos itens.
- O free time override desloca as faixas P1/P2 pelo delta; overrides P1/P2
  substituem apenas o valor diário.
- A criação da invoice recalcula e persiste um snapshot. Alterações posteriores
  de datas ou tarifas não reescrevem os itens existentes.
- Sob recálculo diário, a emissão **não** congela o ROE/BRL: ela trava o USD e
  fixa o `current_total_brl` do dia. O congelamento real ocorre no pagamento
  (`source='payment'` no histórico), quando o recálculo daquela fatura cessa. O
  câmbio do header é apenas informativo.
- Descontos são sempre expressos e aplicados em **USD**, antes da conversão para
  BRL: percentual sobre o total USD; valor fixo em USD subtraído do total USD. A
  RPC de recálculo grava `discount_usd` no histórico; `recomputeDiscountedBrl`
  reflete o desconto no BRL/QR imediatamente após a edição.
- `localStorage` permite continuidade quando o BCB está indisponível, mas não
  impõe expiração máxima ao cache de ROE. A UI avisa a data do cache quando o
  caminho explícito de emissão recebe `offline=true`.
- `mark_overdue_invoices()` foi reduzida em
  [`157_demurrage_drop_overdue.sql`](../../supabase/migrations_archive/157_demurrage_drop_overdue.sql)
  para tratar **apenas** faturas de taxas locais (`public.invoices`). Demurrage não
  tem vencimento sob recálculo diário (ADR 0014); faturas `overdue` legadas foram
  migradas de volta a `issued`.
- `set_container_discharge_date` em
  [`supabase/migrations_archive/028_demurrage_module.sql`](../../supabase/migrations_archive/028_demurrage_module.sql)
  é um trigger `BEFORE INSERT`: copia `voyages.ata` somente quando o container
  nasce sem descarga. Alterar a ATA depois não propaga a data.
- A maior parte do ciclo interno usa writes diretos em tabelas por
  [`demurrageInvoices.ts`](../../src/services/demurrage/demurrageInvoices.ts).
  Conciliação e reversão são as fronteiras RPC: lote base
  `confirm_demurrage_pix_matches`, wrapper transacional
  `confirm_unified_pix_matches` e reversão auditada
  `reverse_demurrage_payment`.
- O wrapper unificado identifica a fatura por `txid = doc_number` e valida o valor
  pago pela **janela das duas PTAX mais recentes** (`get_demurrage_recent_values`,
  ADR 0015) com `event_date <= data do pagamento`, tolerância `0,01` (fallback ao
  `current_total_brl` sem histórico). No pagamento congela o valor casado, grava a
  foto `source='payment'` no histórico e encerra o recálculo (`paid_at`).

## Testes e validação

- [`src/services/demurrage/__tests__/calculateDemurrage.test.ts`](../../src/services/demurrage/__tests__/calculateDemurrage.test.ts)
  cobre free time, P1/P2, tarifas carregadas do banco, falha sem cache válido,
  tipo sem tarifa cadastrada, overrides e ordem de datas.
- [`src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts`](../../src/services/demurrage/__tests__/updateContainerReturnDate.audit.test.ts)
  cobre auditoria ao definir e limpar a devolução.
- [`src/services/__tests__/financialValidation.test.ts`](../../src/services/__tests__/financialValidation.test.ts)
  cobre validação de desconto e ordem descarga/devolução.
- [`src/services/__tests__/reconciliacao.test.ts`](../../src/services/__tests__/reconciliacao.test.ts)
  cobre chamada única ao wrapper, data ausente, erro de valor e divergência de
  contagem; testes de migration cobrem a exigência de admin e justificativa na
  reversão.
- [`src/services/__tests__/demurrageKpis.test.ts`](../../src/services/__tests__/demurrageKpis.test.ts)
  testa parsing de datas do extrato PIX, não `fetchDemurrageKPIs`; portanto os
  KPIs permanecem evidência de **Código**, não de teste específico.
- Por instrução desta execução, nenhum Vitest nem cenário de navegador foi
  rodado. Não há selo **Runtime** nesta cartografia.

## Notas e divergências

- O recálculo automático depende da ativação e configuração do job remoto; o código da Edge Function e seus testes não demonstram execução diária em produção (ADR 0065).

- **Corrigido (2026-06-25) — P2 não conta dias livres do override:** quando o
  `free_time_override` do B/L é maior que o fim da faixa P1 do grupo, a cobrança
  começa em `override+1` (direto em P2), mas
  [`calculateDemurrage`](../../src/services/demurrage/demurrageRates.ts) contava
  P2 a partir do dia fixo da faixa do grupo, incluindo indevidamente os dias
  ainda livres pelo override (sobrecobrança). O início de P2 passou a ser
  `max(p2_day_from, freeUntil+1)`, alinhado ao glossário (P1 começa em
  `override+1`, sem deslocar as faixas; ver `CONTEXT.md`). Caso normal
  (override ≤ fim de P1) permanece inalterado.
- **Suspeita — RPC base de PIX:** a função
  `confirm_demurrage_pix_matches(jsonb)` em
  [`095_confirm_demurrage_pix_matches_batch.sql`](../../supabase/migrations_archive/095_confirm_demurrage_pix_matches_batch.sql)
  atualiza IDs recebidos sem validar valor, status ou TXID. O caminho suportado
  da UI usa `confirm_unified_pix_matches`, que faz a validação. O risco de
  chamada direta permanece **Suspeita** até teste autorizado contra o banco ou
  endurecimento explícito do contrato base.
- **Código — duas reversões diferentes:** `Desmarcar` em `/demurrage` chama
  `unmarkInvoicePaid` por UPDATE direto, sem justificativa/admin; a reversão em
  `/reconciliacao` chama `reverse_demurrage_payment`, exige admin, justificativa
  e auditoria.
- **Código — auditoria desigual de datas:** a devolução editada pela aba do B/L
  grava `audit_logs` best-effort; o modal geral `updateContainerDates` não grava
  auditoria equivalente para descarga/devolução.
- **Código — trigger de descarga limitado ao insert:** o trigger não reage a
  mudanças posteriores de `voyages.ata`; correções exigem import ou edição
  explícita das datas.
