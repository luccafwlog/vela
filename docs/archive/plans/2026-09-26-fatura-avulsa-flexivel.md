# Fatura avulsa flexível — Plano de implementação

> **Para agentes de implementação:** use obrigatoriamente `superpowers:executing-plans` (execução nativa) ou `superpowers:subagent-driven-development` (execução por subagentes) para executar este plano tarefa a tarefa. Marque cada etapa com checkbox (`- [ ]`).

**Objetivo:** permitir a emissão atômica de uma fatura avulsa contra qualquer
cliente, com item e descrição livres e com BL/viagem opcionais, reutilizando o
modelo financeiro e o Portal existentes.

**Arquitetura:** adicionar o tipo explícito `manual` em `invoices`, com uma
referência opcional direta a `voyage_id` e o `bl_id` já existente. A emissão
será uma RPC `SECURITY DEFINER` que cria a fatura e uma linha em
`invoice_items`, sem ledger local, sem `invoice_bls` e sem
`invoice_receivable_links`. As leituras, PIX, pagamento, conciliação,
impressão e Portal reconhecerão o tipo explicitamente, preservando os gates
dos tipos locais.

**Stack:** PostgreSQL/Supabase migrations e RPCs, React 19, TypeScript,
TanStack Query, Zod, Vitest, React Testing Library e impressão React existente.

**Spec:**
[`docs/archive/specs/2026-09-26-fatura-avulsa-flexivel-design.md`](../specs/2026-09-26-fatura-avulsa-flexivel-design.md)

## Restrições globais

- A migration nova será `supabase/migrations/097_fatura_avulsa.sql`; migrations existentes e `supabase/migrations_archive/` não serão editadas.
- `manual` não cria nem altera `bl_receivables`, `invoice_bls` ou `invoice_receivable_links`.
- O servidor calcula `total_brl`; o cliente nunca envia um total confiável nem um ator diferente de `auth.uid()`.
- BL e viagem são opcionais; BL informado deve pertencer ao cliente e, se viagem também for informada, deve haver coerência entre os dois.
- A emissão avulsa não depende de tabela de taxas, cálculo local, CE Mercante ou liberação local do Portal.
- O Portal continua escopado ao cliente autenticado; uma fatura `manual` sem BL também é elegível para listagem e detalhe.
- A confirmação visível precede a emissão; mutações invalidam as famílias de queries existentes.
- Tipos gerados não serão editados à mão. Se o contrato exigir atualização de `src/types/database.ts`, usar somente o gerador oficial e preservar os complementos; se o hook exigir autorização adicional, parar e solicitar essa autorização em vez de contorná-lo.
- Não serão adicionadas dependências nem um segundo modelo de documento/PDF.

## Mapa de arquivos e responsabilidades

| Área | Arquivos | Responsabilidade nesta mudança |
|---|---|---|
| Banco | `supabase/migrations/097_fatura_avulsa.sql` | Coluna de viagem, tipo `manual`, RPC de emissão, gates, PIX, conciliação e Portal |
| Contrato SQL | `src/services/__tests__/manualInvoiceMigration.test.ts`, `src/integration/manualInvoice.local-pg.test.ts` | Forma da migration e execução em PostgreSQL descartável |
| Domínio | `src/services/billing.ts`, `src/services/financialValidation.ts`, `src/hooks/useBilling.ts`, `src/services/queryKeys.ts` | Input/output da emissão, listagem, validação e invalidação |
| Emissão interna | `src/components/billing/ManualInvoiceModal.tsx`, `src/pages/TaxasLocais.tsx` | Formulário, confirmação, feedback e ação da tela |
| Faturamento interno | `InvoiceFiltersBar.tsx`, `InvoicesTable.tsx`, `InvoiceDetailModal.tsx`, `InvoiceDocumentLocal.tsx` | Filtro, tipo, contexto, descrição e documento impresso |
| Derivados financeiros | `src/services/exports.ts`, `src/services/reconciliacao.ts`, `src/services/blRails.ts`, `ReconciliationHistoryTable.tsx` | Rótulos, PIX, histórico, exportações e trilha do BL |
| Portal | `src/services/portalBilling.ts`, `PortalBillingTabs.tsx`, `PortalInvoiceDetailModal.tsx`, testes do Portal | Consulta, rótulo e detalhe seguro da fatura avulsa |
| Documentação | `CONTEXT.md`, `docs/modules/faturamento.md`, `docs/modules/portal-cliente.md`, `docs/modules/reconciliacao-pix.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, ADR 0075 e índices | Regra de negócio, fluxo, segurança e evidências vivas |

## Foco de revisão

Estes são os casos mais propensos a quebrar e o teste que deve fixá-los na
tarefa responsável:

1. **Fatura sem BL e sem viagem:** deve ser emitida, listada e exibida no Portal sem um BL inventado — teste local do RPC e regressão do Portal (Tarefas 1 e 5).
2. **BL de outro cliente ou viagem incompatível:** deve falhar atomicamente e não deixar invoice/item parcial — teste de integração do RPC (Tarefa 1).
3. **Quantidade/valor inválidos ou com arredondamento:** devem ser rejeitados no formulário e recalculados em BRL pelo banco — testes de schema, RPC e total (Tarefas 1 e 2).
4. **Tipo `manual` atravessando regras locais:** não pode criar recebível, passar pelo ledger ou ser bloqueado por CE/Portal local; os tipos locais continuam protegidos — contrato SQL e teste local (Tarefa 1).
5. **Escopo do Portal e pagamento PIX:** um cliente não acessa a fatura de outro e o pagamento avulso não gera settlement local — teste local de identidade, detalhe Portal e conciliação (Tarefas 1 e 5).

---

### Tarefa 1: Modelo SQL, RPC de emissão e contratos financeiros

**Arquivos:**

- Criar: `supabase/migrations/097_fatura_avulsa.sql`
- Criar: `src/services/__tests__/manualInvoiceMigration.test.ts`
- Criar: `src/integration/manualInvoice.local-pg.test.ts`
- Consultar sem editar: `supabase/migrations/019_local_billing_integrity.sql`, `047_bl_documental_gates.sql`, `068_portal_security_boundary_remediation.sql`, `074_ledger_invoice_pix_payload.sql`, `083_portal_trava_universal_liberacao_faturamento.sql`

**Interfaces produzidas:**

- `public.create_manual_invoice(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL, p_bl_id text DEFAULT NULL, p_voyage_id bigint DEFAULT NULL, p_actor uuid DEFAULT NULL) RETURNS jsonb`.
- O JSON de sucesso contém `invoice_id`, `invoice_number`, `invoice_type: "manual"`, `status: "issued"`, `total_brl`, `balance_brl`, `bl_id` e `voyage_id`.
- A RPC exige o mesmo usuário interno ativo e autorizado da emissão financeira existente, calcula o total no servidor, gera número pelo trigger, cria um item `source = 'manual'`, registra lifecycle/auditoria e concede execução somente ao papel já usado pelos RPCs financeiros.

- [x] **Passo 1: escrever o teste de contrato SQL que deve falhar** em `src/services/__tests__/manualInvoiceMigration.test.ts`.

  O teste lê `supabase/migrations/097_fatura_avulsa.sql` e fixa: `voyage_id` com FK/index; check de `invoice_type` com `manual`; assinatura e grant da RPC; cálculo/insert de uma linha; ausência de insert em `invoice_bls`/`invoice_receivable_links`; validação de cliente/BL/viagem; bypass explícito dos gates locais somente para `manual`; geração PIX; caminho de pagamento genérico; e inclusão de `manual` nos núcleos seguros de listagem/detalhe do Portal e conciliação.

- [x] **Passo 2: executar o teste focado para confirmar a falha inicial**.

  Rodar:

  ```bash
  npx vitest run src/services/__tests__/manualInvoiceMigration.test.ts
  ```

  Resultado esperado: `FAIL`, pois a migration ainda não existe.

- [x] **Passo 3: implementar `097_fatura_avulsa.sql`**.

  Adicionar `invoices.voyage_id bigint REFERENCES public.voyages(id) ON DELETE RESTRICT`, índice e o valor `manual` no check. Implementar a RPC com lock/validações transacionais: cliente existente, item não vazio, números positivos, BL pertencente ao cliente, viagem existente, derivação da viagem pelo BL quando omitida e rejeição de combinação incoerente. Inserir invoice `issued` e `invoice_items` com BRL, `source = 'manual'`, `charge_calculation_id/charge_table_id/charge_item_id = NULL`; deixar o trigger existente gerar PIX e registrar lifecycle/auditoria.

  Recriar no mesmo arquivo, sempre com `CREATE OR REPLACE`, os owners que precisam conhecer o novo tipo: `list_invoice_details`, `populate_local_invoice_pix_payload`, `list_pix_reconciliation_candidates`, `reconcile_invoice_payment_by_txid`, `confirm_unified_pix_matches`, `enforce_invoice_ce_on_issue`, `enforce_portal_invoice_gate` e o guard de `invoice_bls` se ele for alcançado pelo novo caminho. O tipo `manual` deve usar `register_invoice_payment`/pagamento genérico, nunca settlement ou recebível local.

  Atualizar `_portal_list_invoices_core`, `_portal_list_invoices_page_core` e o wrapper seguro de detalhe para incluir `manual` sem BL e com BL/viagem direta, preservando o escopo por `current_portal_customer_id()` e a allowlist de campos. A fatura avulsa com BL não deve ser bloqueada pelas travas de emissão local; isso não altera a leitura autorizada do Portal.

  Confirmar no caminho existente de `cancel_invoice` que uma fatura `manual` pode ser cancelada antes do pagamento e que o cancelamento não tenta atualizar o status financeiro do BL direto, pois a referência é contextual e não um recebível local.

  Fechar `PUBLIC`/`anon`, manter `search_path = public, pg_temp`, conceder apenas os papéis necessários e incluir comentário de rollback. Não haverá backfill nem `UPDATE`/`DELETE` de dados fora dos corpos das funções.

- [x] **Passo 4: executar o contrato SQL**.

  Rodar novamente `npx vitest run src/services/__tests__/manualInvoiceMigration.test.ts`; resultado esperado: `PASS`.

- [x] **Passo 5: escrever o teste PostgreSQL descartável** em `src/integration/manualInvoice.local-pg.test.ts`.

  Seguir o padrão `describe.skip` quando `LOCAL_PG_INTEGRATION` não estiver habilitado, com IDs próprios e limpeza em `beforeAll/afterAll`. Criar dois clientes, usuário interno, viagem e BLs. Exercitar: emissão sem contexto; emissão só com viagem; emissão com BL; rejeição de BL de outro cliente; rejeição de viagem incompatível; rejeição por usuário sem autorização; assertions de `invoice_type/status/total/balance`, item, PIX, lifecycle, ausência de links/recebíveis e manutenção do status financeiro do BL. Cancelar uma fatura avulsa antes do pagamento e confirmar que o status da invoice muda sem alterar o BL direto. Registrar um pagamento manual e uma conciliação por TXID, confirmando `payments`/saldo e zero linhas em `ledger_settlements`. Consultar listagem/detalhe Portal com o cliente correto e confirmar rejeição para o cliente errado.

- [x] **Passo 6: executar a suíte local de banco**.

  Com PostgreSQL descartável replayado, rodar:

  ```bash
  LOCAL_PG_INTEGRATION=1 npx vitest run --no-file-parallelism src/integration/manualInvoice.local-pg.test.ts
  ```

  Resultado esperado: todos os casos passam; sem banco local, manter o teste skipped e registrar a limitação, sem tratá-lo como prova de runtime.

- [x] **Passo 7: commitar o contrato de banco**.

  ```bash
  git add supabase/migrations/097_fatura_avulsa.sql src/services/__tests__/manualInvoiceMigration.test.ts src/integration/manualInvoice.local-pg.test.ts
  git commit -m "feat(db): adicionar fatura avulsa flexivel"
  ```

### Tarefa 2: Contrato TypeScript, serviço, validação e mutation

**Arquivos:**

- Modificar: `src/services/billing.ts`
- Modificar: `src/services/financialValidation.ts`
- Modificar: `src/hooks/useBilling.ts`
- Modificar: `src/services/queryKeys.ts`
- Regenerar pelo processo oficial, se necessário: `src/types/database.ts`
- Modificar: `src/services/__tests__/billing.test.ts`
- Modificar: `src/services/__tests__/financialValidation.test.ts`
- Criar: `src/hooks/__tests__/useBillingManualInvoice.test.ts`

**Interfaces consumidas:** `create_manual_invoice` e o JSON definidos na
Tarefa 1.

**Interfaces produzidas:**

```ts
export type ManualInvoiceInput = {
  customerId: number
  itemName: string
  description?: string | null
  quantity: number
  unitValueBrl: number
  blId?: string | null
  voyageId?: number | null
  actorId?: string | null
}

export type ManualInvoiceResult = {
  invoice_id: number
  invoice_number: string
  invoice_type: 'manual'
  status: 'issued'
  total_brl: number
  balance_brl: number
  bl_id: string | null
  voyage_id: number | null
}

export function createManualInvoice(input: ManualInvoiceInput): Promise<ManualInvoiceResult>
export function invoiceTypeLabel(invoiceType: string | null | undefined): string
export function isManualInvoice(row: { invoice_type?: string | null }): boolean
```

- [x] **Passo 1: escrever testes focados que falhem**.

  Em `financialValidation.test.ts`, cobrir nome vazio, descrição opcional,
  quantidade/valor inválidos e normalização de BL/viagem. Em `billing.test.ts`,
  fixar o payload exato de `createManualInvoice`, parse do retorno, erro da
  RPC, rótulo **Avulsa**, filtro `invoiceType = 'manual'` e fallback de
  `getInvoiceBls`/contexto para o BL direto da invoice. Em
  `useBillingManualInvoice.test.ts`, mockar `useMutation` e confirmar que o
  sucesso invalida `queryKeys.invoices.all()`, o detalhe criado e
  `queryKeys.reconciliation.history()`.

- [x] **Passo 2: executar os testes focados para observar as falhas**.

  ```bash
  npx vitest run src/services/__tests__/financialValidation.test.ts src/services/__tests__/billing.test.ts src/hooks/__tests__/useBillingManualInvoice.test.ts
  ```

  Resultado esperado: `FAIL` nos novos símbolos/casos.

- [x] **Passo 3: implementar o contrato no serviço**.

  Adicionar `manual` a `InvoiceTypeFilter`, incluir `notes`, `voyage_id`,
  `voyage` e o relacionamento direto `bl` no select de lista com tipos locais
  ou tipos regenerados. Fazer o filtro, busca de BL e busca de viagem
  considerarem tanto links tradicionais quanto o contexto direto da fatura.
  `getInvoiceBls` deve continuar priorizando links locais/consolidados e usar
  o BL direto somente quando não houver links. O detalhe deve carregar
  `notes`, `voyage_id`, número/nome da viagem e o BL direto sem afetar a
  hidratação de Granite/consolidada.

  Implementar `createManualInvoice` com `supabase.rpc('create_manual_invoice' as never, ... as never)` ou wrapper tipado equivalente, sem fabricar PIX no cliente. O schema novo deve devolver números normalizados e rejeitar valores não finitos.

  Adicionar `queryKeys.reconciliation.history()` como `['reconciliation-history']` e `useCreateManualInvoice` com mutation, tratamento de erro pelo padrão existente e invalidação de invoices, detalhe, histórico de conciliação e contexto do BL/cliente quando aplicável.

- [x] **Passo 4: avaliar regeneração oficial dos tipos**.

  Executar o gerador oficial contra o schema correto, preservar complementos e confirmar `voyage_id`/RPCs. Não editar o arquivo protegido manualmente; se a proteção solicitar uma autorização que não esteja coberta pela aprovação da feature, pausar e solicitar autorização específica.

  Neste checkout não há script local de geração nem ferramenta Supabase disponível
  para regenerar os tipos contra o schema da migration. `src/types/database.ts`
  permaneceu intacto; o RPC novo usa cast localizado e os campos novos da lista
  usam tipos locais, seguindo o padrão já adotado para contratos pós-geração.

- [x] **Passo 5: executar testes focados após a implementação**.

  Rodar o comando do Passo 2; resultado esperado: `PASS`.

- [x] **Passo 6: commitar o domínio TypeScript**.

  ```bash
  git add src/services/billing.ts src/services/financialValidation.ts src/hooks/useBilling.ts src/services/queryKeys.ts src/services/__tests__/billing.test.ts src/services/__tests__/financialValidation.test.ts src/hooks/__tests__/useBillingManualInvoice.test.ts
  git add src/types/database.ts  # somente se regenerado oficialmente
  git commit -m "feat(billing): adicionar contrato de fatura avulsa"
  ```

### Tarefa 3: Formulário interno de emissão

**Arquivos:**

- Criar: `src/components/billing/ManualInvoiceModal.tsx`
- Criar: `src/components/billing/__tests__/ManualInvoiceModal.test.tsx`
- Modificar: `src/pages/TaxasLocais.tsx`

**Interfaces consumidas:** `ManualInvoiceInput`, `ManualInvoiceResult`,
`useCreateManualInvoice`, `useBillingCustomers`, `VoyageCombobox`,
`listBlSuggestions`, `useConfirm` e `useToast`.

**Interfaces produzidas:** a ação **Gerar fatura avulsa** em `/taxas-locais` e
um modal acessível com os campos de emissão.

- [x] **Passo 1: escrever o teste de componente que falhe**.

  Mockar hooks de cliente, viagem, mutation, toast e confirmação. Cobrir: ação
  abre o modal; cliente é obrigatório; item/quantidade/valor inválidos não
  chamam a mutation; uma emissão sem BL/viagem envia somente os campos
  obrigatórios; uma emissão com BL, viagem e descrição envia os três contextos;
  confirmação recusada não emite; sucesso mostra o número/valor e fecha o
  modal.

- [x] **Passo 2: executar `npx vitest run src/components/billing/__tests__/ManualInvoiceModal.test.tsx`** e confirmar falha por arquivo/componente ausente.

- [x] **Passo 3: implementar `ManualInvoiceModal`**.

  Reusar o picker de cliente de `ConsolidatedInvoiceModal`, `Combobox` para
  B/L opcional com `listBlSuggestions` e `VoyageCombobox clearable`. Validar o
  estado com `manualInvoiceCreationSchema`, confirmar com consequência clara,
  chamar a mutation somente depois da confirmação e resetar o formulário ao
  fechar. Os labels devem ser **Cliente**, **Nome do item**, **Descrição da
  cobrança**, **Quantidade**, **Valor unitário (BRL)**, **B/L (opcional)** e
  **Navio / Viagem (opcional)**.

- [x] **Passo 4: integrar a ação em `TaxasLocais.tsx`**.

  Adicionar estado `manualOpen`, botão **Gerar fatura avulsa** ao lado da
  ação consolidada e montar o modal. Não remover a ação consolidada nem mudar
  a rota; o feedback de sucesso deve deixar a lista atualizada pela
  invalidação da mutation.

- [x] **Passo 5: executar o teste focado e o teste de página**.

  ```bash
  npx vitest run src/components/billing/__tests__/ManualInvoiceModal.test.tsx src/pages/__tests__/TaxasLocais.test.ts
  ```

  Resultado esperado: `PASS`, com os testes antigos ajustados para exigir as
  duas ações de emissão.

- [x] **Passo 6: commitar a emissão interna**.

  ```bash
  git add src/components/billing/ManualInvoiceModal.tsx src/components/billing/__tests__/ManualInvoiceModal.test.tsx src/pages/TaxasLocais.tsx src/pages/__tests__/TaxasLocais.test.ts
  git commit -m "feat(billing): adicionar emissao de fatura avulsa"
  ```

### Tarefa 4: Listagem, detalhe, impressão e derivados internos

**Arquivos:**

- Modificar: `src/components/billing/InvoiceFiltersBar.tsx`
- Modificar: `src/components/billing/InvoicesTable.tsx`
- Modificar: `src/components/billing/InvoiceDetailModal.tsx`
- Modificar: `src/components/billing/InvoiceDocumentLocal.tsx`
- Modificar: `src/components/shared/invoiceFormat.ts`
- Modificar: `src/services/exports.ts`
- Modificar: `src/services/reconciliacao.ts`
- Modificar: `src/components/billing/ReconciliationHistoryTable.tsx`
- Modificar: `src/services/blRails.ts`
- Modificar: testes correspondentes em `src/components/billing/__tests__/`, `src/components/shared/__tests__/invoiceFormat.test.ts`, `src/services/__tests__/billing.test.ts`, `src/services/__tests__/exports.test.ts`, `src/services/__tests__/reconciliationInvoiceType.test.ts`, `src/services/__tests__/reconciliationHistoryPagination.test.ts` e `src/services/__tests__/blRails.test.ts`

**Interfaces consumidas:** `invoiceTypeLabel`, `isManualInvoice`, contexto
direto de `InvoiceListRow`/`InvoiceDetail`, e a mutation da Tarefa 2.

- [x] **Passo 1: escrever regressões que falhem**.

  Fixar filtro **Avulsa**, tabela com **Sem B/L** e navio/viagem direta, detalhe
  com descrição, documento com título **FATURA AVULSA** e sem categorias
  artificiais, nome de arquivo `FATURA AVULSA`, exportação/histórico com
  **Avulsa**, reconciliação selecionando `manual` e `isLedgerInvoicePayable`
  permanecendo `false` para `manual`.

- [x] **Passo 2: executar os testes focados e confirmar as falhas**.

  ```bash
  npx vitest run src/components/billing/__tests__/InvoicesTable.test.tsx src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx src/components/shared/__tests__/invoiceFormat.test.ts src/services/__tests__/billing.test.ts src/services/__tests__/exports.test.ts src/services/__tests__/reconciliationInvoiceType.test.ts src/services/__tests__/reconciliationHistoryPagination.test.ts src/services/__tests__/blRails.test.ts src/pages/__tests__/faturamentoLedgerPayment.test.ts
  ```

- [x] **Passo 3: implementar o rótulo e as superfícies de lista**.

  Adicionar `manual` ao select de `InvoiceFiltersBar`, usar `invoiceTypeLabel`
  em `InvoicesTable`, `ReconciliationHistoryTable`, `exports.ts` e `blRails.ts`,
  e renderizar o contexto direto quando a fatura não possui links. A busca por
  BL/viagem deve localizar a fatura avulsa sem transformar a referência direta
  em link de recebível.

- [x] **Passo 4: implementar detalhe e impressão**.

  Mostrar tipo, `invoice.notes`, BL/viagem/navio opcionais e a linha de item.
  Em `InvoiceDocumentLocal`, selecionar título/metadata avulsa por
  `invoice.invoice_type === 'manual'`; usar uma tabela simples de itens para
  esse tipo e manter intacta a classificação por carga dos tipos locais.
  Atualizar `buildInvoiceFileBaseName` sem alterar o nome de demurrage.

- [x] **Passo 5: implementar PIX, histórico e caminho de pagamento no cliente**.

  Incluir `manual` na seleção de `matchUnifiedPixTransactions`, preservar a
  fonte unificada como fatura local, exibir contexto direto em
  `flattenBls`, aceitar filtro **Avulsa** no histórico e exportar o rótulo
  correto. Não adicionar a fatura avulsa ao caminho ledger de
  `faturamentoLedgerPayment`/`reports`.

- [x] **Passo 6: executar os testes focados e ajustar regressões**.

  Rodar novamente o comando do Passo 2; resultado esperado: `PASS` sem mudar
  os títulos ou rótulos de taxas locais, consolidadas e demurrage.

- [x] **Passo 7: commitar as superfícies internas**.

  ```bash
  git add src/components/billing src/components/shared/invoiceFormat.ts src/services/exports.ts src/services/reconciliacao.ts src/services/blRails.ts src/pages/faturamentoLedgerPayment.ts
  git commit -m "feat(billing): exibir faturas avulsas nas superficies internas"
  ```

### Tarefa 5: Listagem, detalhe e impressão no Portal

**Arquivos:**

- Modificar: `src/services/portalBilling.ts`
- Modificar: `src/components/portal/PortalBillingTabs.tsx`
- Modificar: `src/components/portal/PortalInvoiceDetailModal.tsx`
- Modificar: `src/pages/PortalBilling.tsx` somente se o texto/telemetria do
  tipo precisar distinguir a nova modalidade
- Criar ou modificar: `src/components/portal/__tests__/PortalInvoiceDetailModal.test.tsx`
- Modificar: `src/pages/__tests__/PortalBilling.test.tsx`
- Modificar: `src/services/__tests__/exports.test.ts` para exportação Portal

**Interfaces consumidas:** os payloads seguros de Portal produzidos pela
Tarefa 1 e `InvoiceDocumentLocal`/`invoiceTypeLabel` das Tarefas 2 e 4.

- [x] **Passo 1: escrever regressões de Portal que falhem**.

  Cobrir resumo com `invoice_type = 'manual'` sem BL, rótulo **Avulsa** em
  desktop/mobile, detalhe com item/descrição/contexto opcional, detalhe sem
  seção vazia de B/L e manutenção de PIX/impressão. Confirmar que o botão de
  reconsolidação só aparece para `consolidated`.

- [x] **Passo 2: executar os testes focados e confirmar as falhas**.

  ```bash
  npx vitest run src/components/portal/__tests__/PortalInvoiceDetailModal.test.tsx src/pages/__tests__/PortalBilling.test.tsx src/services/__tests__/exports.test.ts
  ```

- [x] **Passo 3: implementar os tipos/normalização do serviço Portal**.

  Preservar arrays vazios para `bls`, `vessels`, `voyages`, `vessel_voyages` e
  `pods`; carregar `notes`, `voyage_id`, número/nome de viagem e o BL direto
  no detalhe, sem permitir que o Portal envie customer ID. O serviço continua
  usando `callPortalRpc` e `clientPortalScope`.

- [x] **Passo 4: implementar as superfícies Portal**.

  Renomear a apresentação da aba local para deixar claro que ela inclui taxas
  locais e faturas avulsas, renderizar **Avulsa**, mostrar item/descrição e
  contexto somente quando informado. Manter o fluxo de PIX e recibo; não
  expor ação interna de emissão ao cliente.

- [x] **Passo 5: executar os testes focados**.

  Rodar o comando do Passo 2; resultado esperado: `PASS`.

- [x] **Passo 6: commitar a experiência Portal**.

  ```bash
  git add src/services/portalBilling.ts src/components/portal/PortalBillingTabs.tsx src/components/portal/PortalInvoiceDetailModal.tsx src/pages/PortalBilling.tsx src/components/portal/__tests__/PortalInvoiceDetailModal.test.tsx src/pages/__tests__/PortalBilling.test.tsx
  git commit -m "feat(portal): exibir faturas avulsas ao cliente"
  ```

### Tarefa 6: Documentação viva, ADR e rastreabilidade

**Arquivos:**

- Criar: `docs/adr/0075-fatura-avulsa-flexivel.md`
- Modificar: `docs/adr/README.md`
- Modificar: `CONTEXT.md`
- Modificar: `docs/modules/faturamento.md`
- Modificar: `docs/modules/portal-cliente.md`
- Modificar: `docs/modules/reconciliacao-pix.md`
- Modificar: `docs/ARCHITECTURE.md`
- Modificar: `docs/RASTREABILIDADE.md`
- Modificar: `docs/spec/README.md` apenas para manter o estado da spec até o
  arquivamento no fim do plano

- [x] **Passo 1: registrar ADR 0075** explicando a escolha de `invoices` +
  `invoice_type = manual`, a não utilização do ledger e a visibilidade
  escopada no Portal; listar como alternativas rejeitadas o reaproveitamento
  de `individual` e uma tabela paralela.

- [x] **Passo 2: atualizar o glossário e módulos** com efeito implementado,
  pré-condições, telas, RPC, cache, Portal, conciliação e limites. Manter a
  estrutura de sete seções dos módulos; não afirmar emissão remota ou runtime
  se apenas o teste local existir.

- [x] **Passo 3: atualizar arquitetura e rastreabilidade** com `097`,
  `create_manual_invoice`, `voyage_id`, list/detail Portal, impressão e
  evidências. Registrar labels **Código**, **Teste**, **Teste de contrato SQL**
  e **Runtime** conforme a prova efetivamente obtida.

- [x] **Passo 4: executar `npm run docs:check` e `git diff --check`**; resultado
  esperado: ambos aprovados.

- [x] **Passo 5: commitar a documentação**.

  ```bash
  git add CONTEXT.md docs/adr/0075-fatura-avulsa-flexivel.md docs/adr/README.md docs/modules/faturamento.md docs/modules/portal-cliente.md docs/modules/reconciliacao-pix.md docs/ARCHITECTURE.md docs/RASTREABILIDADE.md docs/spec/README.md
  git commit -m "docs: registrar fatura avulsa no sistema"
  ```

### Tarefa 7: Validação final e encerramento do plano

- [x] **Passo 1: executar os contratos de banco** no PostgreSQL descartável,
  quando disponível: `npm run migrations:check`, `npm run rpc:check` e a
  suíte local da Tarefa 1. `rpc:check` só será considerado evidência se tiver
  banco preparado; o resultado skipped/indisponível será reportado como
  limitação. **Resultado:** migrations:check passou; teste local-pg passou
  (4/4); `rpc:check` não validou o catálogo porque faltam 15 funções
  históricas no banco local.

- [x] **Passo 2: executar os gates completos da SPA**.

  ```bash
  npm run docs:check
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

  Resultado esperado: todos passam. Reexecutar somente o gate afetado depois
  de cada correção, mantendo os resultados válidos do ambiente inalterado.
  **Resultado:** docs, typecheck, lint, testes (3.595 aprovados/207 ignorados)
  e build passaram.

- [x] **Passo 3: revisar o diff final** com `git status --short`, `git diff
  --check` e leitura dos diffs contra a spec. Confirmar que `main` não foi
  alterado, que nenhuma migration histórica foi editada e que os tipos
  protegidos só foram regenerados pelo processo oficial.

- [x] **Passo 4: arquivar a spec e o plano na mesma mudança de conclusão**.

  Mover `docs/spec/2026-09-26-fatura-avulsa-flexivel-design.md` para
  `docs/archive/specs/` e este plano para `docs/archive/plans/`, remover as
  linhas correspondentes dos índices vivos e registrar a entrega em
  `docs/CHANGELOG.md`, somente depois de todos os critérios da spec e gates
  estarem comprovados.

- [x] **Passo 5: commit final de documentação/histórico**.

  ```bash
  git add docs/spec docs/plans docs/archive/specs docs/archive/plans docs/CHANGELOG.md
  git commit -m "docs: arquivar plano da fatura avulsa"
  ```
