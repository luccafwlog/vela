# Reconciliação PIX

> **Status:** ativo · **Atualizado:** 2026-08-21 · **Rotas:** `/reconciliacao` (Administrativo/Admin); `/demurrage/reconciliacao` redireciona para esta rota

## Propósito e escopo

Reconciliação PIX recebe a planilha bancária, extrai transações, casa TXIDs com
documentos locais ou de Demurrage, separa resultados seguros de ambiguidades,
confirma o lote, apresenta histórico/exportação e permite cancelar baixas.

- A rota interna está em `src/AppInterno.tsx` e a composição em
  `src/pages/Reconciliacao.tsx`.
- `src/services/demurrage/demurrageKpis.ts` é o dono do parser da planilha.
- `src/services/reconciliacao.ts` é o dono do matching, confirmação, histórico,
  exportação e chamadas de estorno.
- Taxas locais são liquidadas pelo ledger descrito em
  [Faturamento](faturamento.md); Demurrage é atualizado em persistência própria.
- A capacidade visual `reconciliacao_edit` existe em `src/hooks/useAuth.tsx`;
  as RPCs críticas também exigem sessão ativa/admin. A tela bloqueia o acesso
  para os demais perfis antes do upload ou matching; nenhuma pendência PIX
  fica apenas em memória do browser.

## Anatomia das telas

### Upload e matching

`src/pages/Reconciliacao.tsx` começa, para Administrativo/Admin, com uma
dropzone acessível por clique,
teclado ou drag-and-drop. Aceita `.xlsx`/`.xls`, mostra estado “Processando
extrato...” e limpa o resultado anterior antes de processar outro arquivo.

`parsePixExtractFile` valida tamanho antes de `arrayBuffer()`. O parser procura
a linha que contém a coluna `identificador`, exige `valor pago`, tenta localizar
CPF/CNPJ e `pago em`, ignora TXID vazio e valor não positivo e normaliza a data
para `YYYY-MM-DD`.

### Revisão do resultado

Após o matching, a página apresenta:

- resumo de correspondências seguras, ambíguas e total de matches retornados;
- tabela de matches não ambíguos com origem, documento, cliente, valor do PIX,
  valor esperado e TXID;
- painel separado de ambiguidades, com candidato, contagem e motivo;
- painel “Sem documento candidato” para cada transação não conciliável;
- botão de confirmação habilitado somente quando existe match não ambíguo.

Transações sem documento candidato geram um `UnifiedPixMatch` com
`source = unmatched`. Elas permanecem visíveis para conferência, são contadas
separadamente e nunca entram na confirmação.

### Confirmação e resultado por item

Depois da RPC, a página substitui os matches por um cartão de resultado com:

- contagem `local` e `demurrage`;
- uma linha por item retornado, contendo `source`, `invoice_id`, `doc_number` e
  `status`.

### Histórico, filtros e exportação

`src/components/billing/ReconciliationHistoryTable.tsx` combina:

- invoices locais `paid`, `covered` e `partially_paid` com data em `payments`;
- `demurrage_invoices.status = paid`;
- filtros de período, origem, tipo documental, cliente, B/L, navio, viagem e
  POD;
- ordenação, paginação e exportação XLSX;
- abertura do detalhe local ou de Demurrage.

### Detalhe e cancelamento de baixa

- Invoice local abre `src/components/billing/InvoiceDetailModal.tsx` com
  `enablePaymentReversal` e o `paymentId` escolhido no histórico.
- Demurrage abre modal próprio com documento tipo recibo.
- Somente admin vê a ação de cancelamento; justificativa é obrigatória na UI e
  nas RPCs.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/reconciliacao` · selecionar/upload de planilha | Perfil Administrativo/Admin e arquivo `.xlsx`/`.xls` dentro do limite | Dropzone/input → `processFile` | `matchMutation` chama `parsePixExtractFile` e persiste exceções via `upsert_pix_reconciliation_exceptions` | Linhas sem match seguro ficam persistidas por importação/linha e geram `pix_unreconciled`, tratado pelo Administrativo desde a migration `078` | Limpa `matches` e `confirmationResult`; inicia estado de processamento | Perfil não autorizado vê “Acesso restrito”; arquivo grande/formato inválido gera toast | **Código:** `src/pages/Reconciliacao.tsx`, `src/services/reconciliacao.ts`, `supabase/migrations_archive/328_pix_unreconciled_persistence.sql` · **Teste:** `src/pages/__tests__/Reconciliacao.behavior.test.tsx` |
| Parser · extrair linhas bancárias | Cabeçalho `identificador` e coluna `valor pago` | `parsePixExtractFile` | `assertUploadSize` → `parsePixExtract` → import dinâmico de `@e965/xlsx` | Nenhuma persistência | Retorna `{txid, cnpj, date, amount}`; ignora TXID vazio/valor não positivo | Cabeçalho/valor ausente lança erro; data inválida vira string vazia e falhará na confirmação | **Código:** `src/services/demurrage/demurrageKpis.ts` |
| Matching · carregar documentos locais e Demurrage | Transações parseadas | `matchUnifiedPixTransactions` | Duas queries paralelas; normalização alfanumérica maiúscula | `SELECT invoices` locais pagáveis e `SELECT demurrage_invoices` emitidas | Sem cache React Query; monta mapa único de TXID para os dois domínios | Erro de qualquer query aborta o matching | **Código:** `src/services/reconciliacao.ts` · **Teste:** `src/services/__tests__/reconciliacao.test.ts` |
| Matching · classificar sem match | TXID sem candidato aberto | Loop de `matchUnifiedPixTransactions` | `txidMap.get(key)` retorna vazio | Sem persistência | Retorna linha `source = unmatched`, painel dedicado e contagem; nunca entra na confirmação | Nenhum documento é alterado | **Código:** `src/services/reconciliacao.ts`, `src/pages/Reconciliacao.tsx` · **Teste:** `src/services/__tests__/reconciliacao.test.ts`, `src/pages/__tests__/Reconciliacao.behavior.test.tsx` |
| Matching · classificar ambiguidade de documento/TXID | Mais de um documento com TXID normalizado ou TXID repetido no extrato | Mesmo loop | `entries.length > 1` ou `seenTxids` | Sem persistência | `ambiguous = true`, motivo e `candidateCount`; UI move para painel ignorado | Não há seleção manual de candidato nesta tela | **Código:** `src/services/reconciliacao.ts`, `src/pages/Reconciliacao.tsx` · **Teste:** `src/services/__tests__/reconciliacao.test.ts` |
| Matching · classificar divergência de valor | Diferença absoluta maior que `0,01` ou valor esperado não numérico | Mesmo loop | Compara transação com saldo local ou `current_total_brl` | Sem persistência | Marca como ambíguo; local e Demurrage recebem motivos distintos | Não existe pagamento parcial por PIX neste fluxo | **Código:** `src/services/reconciliacao.ts` · **Teste:** `src/services/__tests__/reconciliacao.test.ts` |
| `/reconciliacao` · confirmar somente não ambíguos | Ao menos um match seguro; data parseada | `confirmMutation` | Filtra `!ambiguous`; `confirmUnifiedPixReconciliation` refiltra e monta JSON | RPC `confirm_unified_pix_matches` | Em sucesso invalida Demurrage, invoices, KPIs, B/Ls, detalhe de B/L, cliente e histórico | Data vazia falha antes da RPC; qualquer erro do lote é propagado | **Código:** `src/pages/Reconciliacao.tsx`, `src/services/reconciliacao.ts` · **Teste:** `src/services/__tests__/reconciliacao.test.ts` |
| RPC unificada · conciliar item local | `source = local`, data presente, TXID casa uma invoice pagável e valor quita saldo | `confirm_unified_pix_matches` | `reconcile_invoice_payment_by_txid` → `register_ledger_invoice_payment` | `payments`, `ledger_settlements`, `bl_receivables`, links, invoice, B/Ls e eventos | Item `{source: local, status: ok}`; transação inteira aborta se um item falhar | Sem match, ambíguo no domínio local, já conciliado ou valor inexato gera falha do lote | **Código:** `supabase/migrations_archive/103_confirm_unified_pix_matches.sql`, `supabase/migrations_archive/111_pix_exact_and_manual_overpayment_refunds.sql` |
| RPC unificada · conciliar item Demurrage | `source = demurrage`, invoice existente e valor na janela das duas PTAX (`event_date <= pagamento`, tol. `0,01`) | Mesma RPC | Valida pela janela (`get_demurrage_recent_values`, ADR 0015), congela o valor casado e acumula lote para `confirm_demurrage_pix_matches` | `UPDATE demurrage_invoices`: `paid`, `paid_at`, `pix_txid`, `conciliated_by_extract`, `current_total_brl` casado + foto `source='payment'` no histórico | Item `{source: demurrage, status: ok}` | Documento ausente, valor fora da janela ou contagem atualizada diferente aborta o lote | **Código:** `supabase/migrations_archive/158_demurrage_pix_window_conciliation.sql` |
| Resultado · exibir retorno por fonte/item | Confirmação concluída | `confirmMutation.onSuccess` | Normalização de `UnifiedPixConfirmationResult` | Sem nova persistência | Mostra contagens e itens; limpa matches | Shape sem itens vira array vazio | **Código:** `src/pages/Reconciliacao.tsx`, `src/services/reconciliacao.ts` |
| Histórico · listar/filtrar/ordenar/paginar | Sessão interna | `ReconciliationHistoryTable` | `useQuery` → `listReconciliationHistory` | Pagina completamente os dois domínios em lotes de 1000; filtros/ordenação/paginação no cliente | Query `['reconciliation-history', filters]`, `staleTime` 15 s; data e `paymentId` vêm da mesma baixa mais recente | Erro de qualquer domínio falha a tabela inteira | **Código:** `src/components/billing/ReconciliationHistoryTable.tsx`, `src/services/reconciliacao.ts` · **Teste:** `src/services/__tests__/reconciliationHistoryPagination.test.ts`, `src/services/__tests__/reconciliationInvoiceType.test.ts` |
| Histórico · exportar | Filtros atuais | Botão “Exportar Excel” | `exportReconciliationHistoryExcel` consulta com página única ampla e carrega `@e965/xlsx` | Arquivo local `conciliacao-<timestamp>.xlsx` | Sem invalidação; neutraliza prefixos de fórmula em strings | Falha exibe toast dedicado e encerra o estado de processamento | **Código:** `src/components/billing/ReconciliationHistoryTable.tsx`, `src/services/reconciliacao.ts` |
| Histórico · abrir detalhe local | Linha local; invoice/payment IDs disponíveis | `onSelectLocalInvoice` | `InvoiceDetailModal` → `useInvoiceDetail`/`useInvoiceRefunds` | Leituras do faturamento | Queries de detalhe/refund | `paymentId = null` permite detalhe, mas não cancelamento da baixa | **Código:** `src/pages/Reconciliacao.tsx`, `src/components/billing/ReconciliationHistoryTable.tsx` |
| Histórico · abrir detalhe Demurrage | Linha Demurrage | `onSelectDemurrageInvoice` | Query `getDemurrageDetail` | Leitura de invoice e itens de Demurrage | Query `['demurrage-invoice-detail', 'reconciliacao', id]` | Erro mostra falha no modal | **Código:** `src/pages/Reconciliacao.tsx`, `src/services/demurrage/demurrageInvoices.ts` |
| Detalhe local · cancelar baixa | Admin, `paymentId` e justificativa | `InvoiceDetailModal.handleReversePayment` | `reverseLocalPaymentAndInvalidate` → `reverseLocalInvoicePayment` | RPC `reverse_invoice_payment` restaura ledger/links/status, limpa PIX e exclui `payments` | Invalida ledger, invoices, B/Ls, cliente, detalhe, refunds, alertas e histórico antes de fechar | RPC exige admin/justificativa e rejeita payment/invoice ausente | **Código:** `src/components/billing/InvoiceDetailModal.tsx`, `src/hooks/useBillingLedger.ts`, `src/services/reconciliacao.ts` · **Teste:** `src/hooks/__tests__/billingLedgerInvalidation.test.ts` |
| Detalhe Demurrage · cancelar baixa | Admin, invoice paga e justificativa | `demurrageReversalMutation` | `reverseDemurragePayment` | RPC `reverse_demurrage_payment` volta status a `issued`, limpa data/TXID e audita | Invalida `['demurrage-invoices']` e `['reconciliation-history']`; fecha modal | UI e RPC exigem justificativa; estado diferente de `paid` falha | **Código:** `src/pages/Reconciliacao.tsx`, `src/services/reconciliacao.ts`, `supabase/migrations_archive/113_require_justification_on_payment_reversal.sql` |

## Estado e dados

### Estado local da página

- `matches`: candidatos retornados pelo matcher ou `null` antes/depois do fluxo.
- `confirmationResult`: contagens e itens da última confirmação.
- `dragOver`: feedback da dropzone.
- `selectedInvoice`: invoice local e payment aberto pelo histórico.
- `selectedDemurrageId` e `demurrageReason`: detalhe/justificativa do estorno.

### Dados remotos

| Domínio | Leitura para matching | Escrita de confirmação | TXID persistido |
|---|---|---|---|
| Local | `invoices` em `issued`, `partially_paid`, `overdue`; tipos `individual`/`consolidated`; valor esperado = `balance_brl` ou `total_brl` | Ledger via `reconcile_invoice_payment_by_txid` e `register_ledger_invoice_payment` | `invoices.pix_txid` e uma linha de `ledger_settlements.pix_txid` |
| Demurrage | `demurrage_invoices.status = issued`; valor esperado = `current_total_brl` | Update em lote por `confirm_demurrage_pix_matches` | `demurrage_invoices.pix_txid` |

`supabase/migrations_archive/075_ledger_pix_txid_single_settlement_row.sql`
usa trigger para manter o TXID somente na primeira linha de settlement de um
pagamento PIX com vários receivables. O documento local também guarda
`conciliated_by_extract`; Demurrage possui flag equivalente.

### Histórico

`listReconciliationHistory` não consulta uma view única. Ele carrega os dois
domínios, achata B/Ls, usa a data mais recente de `payments` no local,
`demurrage_invoices.paid_at` no outro domínio, remove linhas sem data e aplica
filtros/ordenação/paginação em memória.

## Fluxos e invariantes

```mermaid
flowchart TD
    Upload["Upload workbook"] --> Parse["parsePixExtractFile"]
    Parse --> Match["matchUnifiedPixTransactions"]
    Match --> Missing{"TXID tem candidato?"}
    Missing -->|não| Omitted["Omitido do resultado"]
    Missing -->|sim| Amb{"Documento único, TXID não repetido<br/>e valor compatível?"}
    Amb -->|não| Review["Ambíguo / ignorado"]
    Amb -->|sim| Submit["confirm_unified_pix_matches"]
    Submit --> Source{"source"}
    Source -->|local| Ledger["reconcile_invoice_payment_by_txid<br/>→ ledger"]
    Source -->|demurrage| Direct["confirm_demurrage_pix_matches<br/>→ update direto"]
    Ledger --> History["Histórico / detalhe / estorno"]
    Direct --> History
```

- Matching é exclusivamente por TXID normalizado; CNPJ e valor não são fallback
  para localizar documento.
- A interface filtra ambiguidades antes da chamada e o serviço repete o filtro.
- A RPC unificada não recebe um campo `ambiguous`. Para local, ela reexecuta o
  matching no banco e exige uma única invoice; para Demurrage, valida ID e
  valor, mas não reexecuta a política de unicidade cruzada entre domínios.
- Local exige que o PIX quite o saldo aberto do ledger, aceitando apenas margem
  numérica de `0,01`. Demurrage compara o valor ao `current_total_brl` com
  tolerância de `0,01`.
- Um TXID repetido no mesmo extrato é marcado ambíguo a partir da segunda linha.
- Quando o mesmo TXID existe em documento local e Demurrage, o mapa contém dois
  candidatos e a UI marca o match como ambíguo.
- `confirm_unified_pix_matches` é a fronteira transacional do lote: falha em um
  item levanta exceção e impede sucesso parcial do comando.
- Local cria `payments` e settlements por recebível. Demurrage não cria
  `payments` nem ledger; marca diretamente o documento como pago.
- Estorno local remove o payment, restaura saldos/links e, por cascade, remove
  refund ligado ao pagamento. Estorno de Demurrage apenas reabre o documento e
  registra auditoria.

## Testes e validação

O lote comportamental de 2026-06-23 executou os serviços, contratos SQL,
componentes e a página completa. A página foi exercitada com upload, separação
entre seguros/ambíguos/sem candidato, confirmação, resultado, detalhes e
estorno de Demurrage.

### Testes de comportamento estático

- `src/services/__tests__/reconciliacao.test.ts`: TXID-only, colisão entre
  domínios, repetição no extrato, divergência de valor, confirmação unificada,
  data obrigatória e lote Demurrage.
- `src/lib/__tests__/pix.test.ts`: payload BRCode, sanitização/limite de TXID e
  CRC-16.
- `src/pages/__tests__/Reconciliacao.behavior.test.tsx`: upload, revisão,
  confirmação, detalhes e estorno.
- `src/components/billing/__tests__/ReconciliationHistoryTable.behavior.test.tsx`:
  filtros, exportação, erro, detalhe e falha de exportação.
- `src/services/__tests__/reconciliationHistoryPagination.test.ts`: paginação
  integral antes dos filtros.

### Teste de contrato SQL

Estes testes verificam texto de migrations, não um banco aplicado:

- `src/services/__tests__/ledgerPixPayloadMigration.test.ts`
- `src/services/__tests__/ledgerPixSettlementTxidMigration.test.ts`
- `src/services/__tests__/reversalBlsFinancialStatusMigration.test.ts`
- `src/services/__tests__/reversalJustificationMigration.test.ts`

## Notas e divergências

- **Unmatched é uma classificação somente de revisão.** Permanece visível na
  página, mas não é persistida e não entra no payload de confirmação.
- **Suspeita sem prova de falha/exploit — ambiguidade é parcialmente
  client-side.** A RPC unificada não recebe a classificação do frontend. Uma
  chamada direta ainda revalida o match local e os valores, mas não demonstra
  a mesma política de ambiguidade cruzada para um item Demurrage.
- **Suspeita sem prova de falha/exploit — mesmo TXID nos dois domínios.** A UI
  bloqueia a colisão porque `txidMap` agrega local e Demurrage. No banco, a
  unicidade de `ledger_settlements` cobre somente o ledger local e
  `demurrage_invoices` é separado; não foi executado um cenário que tentasse
  aplicar a mesma transação aos dois domínios.
- **TXID é denormalizado.** Local mantém `invoices.pix_txid` e
  `ledger_settlements.pix_txid`; Demurrage mantém seu próprio campo. O trigger
  reduz duplicação entre settlements, mas não elimina a necessidade de
  sincronização entre documento e ledger.
- **Estorno de Demurrage limpa a origem do pagamento.** A migration
  `131_clear_demurrage_extract_flag_on_reversal.sql` redefine
  `conciliated_by_extract = false`.
- **Filtro “Único BL” alinhado.** O valor visual `single` é normalizado para
  `individual` antes da comparação.
