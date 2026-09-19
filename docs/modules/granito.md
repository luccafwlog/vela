# Granito

> **Status:** ativo · **Atualizado:** 2026-09-11 · **Rotas:** `/granito`, `/granito/taxas`

## Propósito e escopo

Granito é o pipeline especializado para planilhas COSCO de blocos: seleciona
uma viagem, parseia o relatório de cargas/booking, reconcilia o shipper com
clientes, persiste manifesto e B/Ls próprios e calcula snapshots quantitativos
por peso/B/L. O módulo não promove B/Ls a uma etapa financeira nem emite invoices.

As rotas são internas e ficam sob `ProtectedRoute` em
[`src/AppInterno.tsx`](../../src/AppInterno.tsx). A UI de tarifas reserva mutações para admin;
as tabelas operacionais aceitam leitura/inserção/update de usuário ativo e
DELETE de admin após
[`supabase/migrations_archive/042_rls_module_hardening.sql`](../../supabase/migrations_archive/042_rls_module_hardening.sql).
A emissão usa RPC administrativa.

O ownership é separado:

- `granite_bls` não é uma extensão de `bls`;
- `granite_bl_charges` é o snapshot das taxas calculadas;
- `invoice_granite_bls` preserva vínculos financeiros históricos entre invoices
  compartilhadas e B/Ls de Granito;
- `charge_tables.cargo_mode='granito'` amplia a visão de Taxas Locais, mas não
  move nem duplica a persistência `granite_*`.

Fontes executáveis principais:

- [`src/pages/Granite.tsx`](../../src/pages/Granite.tsx) e
  [`src/pages/GraniteRates.tsx`](../../src/pages/GraniteRates.tsx);
- [`src/services/graniteImport.ts`](../../src/services/graniteImport.ts) e
  [`src/services/graniteCharges.ts`](../../src/services/graniteCharges.ts);
- entrada por viagem em
  [`src/components/shared/VoyageImportActions.tsx`](../../src/components/shared/VoyageImportActions.tsx);
- integração financeira em
  [`src/components/billing/ValidacaoTab.tsx`](../../src/components/billing/ValidacaoTab.tsx),
  [`src/services/charges/chargeOperationsService.ts`](../../src/services/charges/chargeOperationsService.ts)
  e [`src/services/billing.ts`](../../src/services/billing.ts).

## Anatomia das telas

### `/granito`

[`src/pages/Granite.tsx`](../../src/pages/Granite.tsx) combina importação e
operação:

- lê `?voyage=` como viagem inicial;
- filtra por texto, viagem, porto de descarga e tamanho da página;
- lista `granite_bls` com booking, shipper/CNPJ, navio/viagem, peso real, CBM,
  fase, `charge_status` e ação `Calcular taxas`;
- o modal COSCO exige viagem e arquivo `.xls/.xlsx`, mostra B/Ls válidos, peso
  total, erros de parser e reconciliação `matched|missing_cnpj|not_found`; peso
  e quantidades usam a gramática pt-BR sem expoente/texto residual, datas de
  prontidão precisam ser calendários válidos e POL/POD são normalizados pelo
  catálogo de LOCODEs; o relatório completo de erros pode ser exportado sem o
  payload bruto;
- CNPJ ausente pode ser preenchido inline e reconciliado novamente;
- a leitura do upload customizado informa arquivo atual/progresso e pode ser
  cancelada; respostas tardias são descartadas antes de qualquer RPC;
- confirmar com pendências importa B/Ls sem `client_id`, que permanecem com
  reconciliação pendente até a revisão;
- o cálculo abre um modal com as linhas snapshot. Mesmo com cliente resolvido,
  a página recalcula apenas os dados operacionais.

### `/granito/taxas`

[`src/pages/GraniteRates.tsx`](../../src/pages/GraniteRates.tsx) lista descrição,
tipo (`per_kg`, `per_ton`, `per_bl`, `fixed`), valor unitário, moeda, vigência e
estado ativo de `granite_rates`. Admin pode criar, editar, ativar/desativar e
excluir.

### Entrada por `/viagens/:voyageId`

[`VoyageImportActions`](../../src/components/shared/VoyageImportActions.tsx)
abre um [`FileImportModal`](../../src/components/shared/FileImportModal.tsx)
genérico já associado à viagem. Para Granito, ele usa o mesmo parser e
importador, mostra os totais de B/Ls/erros e permite aceitar erros de linha com
`allowRowErrors` somente após a decisão explícita do operador. `allowPending`
continua sendo o parâmetro independente que permite persistir B/Ls ainda sem
cliente reconciliado e permanece `true` por padrão; o override de erros não o
altera.

### Superfícies downstream

- `/revisao` agrega `granite_bls.client_id IS NULL`; vincular cliente chama
  `saveGraniteBlReview`, audita e orienta refazer o cálculo em `/granito`.
- `/taxas-locais` → `Validação` agrega B/Ls de Granito como apoio operacional e
  oferece somente recálculo quantitativo. CE Mercante e invoices não são gates
  nem ações do fluxo atual de Granito.
- `/taxas-locais` → `Faturas` pode preservar e exibir vínculos históricos, mas
  não recebe novas invoices a partir do pipeline de Granito.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/granito` · abrir import e selecionar viagem | Sessão interna exceto papel Equipamentos; viagem existente para confirmar | `Granite`; estado `uploadOpen`, `voyageId`; `VoyageCombobox` | A seleção só prepara os argumentos do parser/importador | Leitura de viagens pelo hook compartilhado | Estado local; após sucesso invalida `['granite-bls']` e `['voyages']` | Sem viagem, arquivo ou usuário o botão permanece desabilitado | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`VoyageCombobox.tsx`](../../src/components/shared/VoyageCombobox.tsx) |
| `/viagens/:voyageId` · importar Granito | Viagem e usuário já definidos; papel diferente de Equipamentos; arquivo com B/Ls válidos | `VoyageImportActions`; `FileImportModal` | `parseGraniteManifestFile` → `importGraniteManifest` | `granite_manifests`, `granite_bls` | Invalida `['voyages']` e `['granite-manifests']` | Erro de parse por arquivo; falha de persistência interrompe o lote | **Código:** [`VoyageImportActions.tsx`](../../src/components/shared/VoyageImportActions.tsx), [`FileImportModal.tsx`](../../src/components/shared/FileImportModal.tsx) |
| Parsear planilha COSCO | Arquivo dentro do limite; primeira aba não vazia | `handleFile` ou parser do modal genérico | `assertUploadSize` → `readFirstSheetRows` → `createHeaderMapper`; exige B/L único e `real_weight_kg > 0` | Carrega clientes para reconciliação, sem escrita | Retorna `ParsedGraniteManifest` com `bls` e `rowErrors` | B/L ausente/duplicado, peso ausente/zero, data de prontidão impossível ou POL/POD não reconhecido viram erro de linha; planilha vazia lança erro; a confirmação fica bloqueada por padrão e só aceita linhas válidas com `allowRowErrors` explícito | **Código:** [`graniteImport.ts`](../../src/services/graniteImport.ts), [`importCore.ts`](../../src/services/importCore.ts), [`importValidation.ts`](../../src/services/importValidation.ts) · **Teste:** [`graniteParse.test.ts`](../../src/services/__tests__/graniteParse.test.ts), `graniteImportAtomic.test.ts` |
| Preview · reconciliar cliente/CNPJ | Manifesto parseado; CNPJ do shipper opcional | `handleCnpjOverride`; tabela de preview | `loadCustomerMaps` + `findMatchedCustomer`; normaliza documento com `onlyDigits` | SELECT na base de clientes | Atualiza apenas o manifesto em memória para `matched` | Input inline aparece apenas para `missing_cnpj`; CNPJ curto não dispara busca; `not_found` permanece pendente | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`customerReconciliation.ts`](../../src/services/customerReconciliation.ts) |
| Preview · aceitar ou rejeitar pendentes | B/L sem cliente resolvido | Confirmação dos modais; argumento `allowPending` do service | `importGraniteManifest` filtra `allowPending \|\| clientId !== null` | INSERT/UPSERT em `granite_bls` | Com `true`, mantém B/L sem `client_id`; com `false`, exclui a linha da persistência | `allowPending` continua sem seletor e aceita pendentes por default; o checkbox de erros usa `allowRowErrors` e não muda a reconciliação de cliente | **Código:** [`graniteImport.ts`](../../src/services/graniteImport.ts), [`Granite.tsx`](../../src/pages/Granite.tsx), [`VoyageImportActions.tsx`](../../src/components/shared/VoyageImportActions.tsx) |
| Confirmar importação | Viagem existente; usuário; ao menos um B/L válido | `Granite.handleImport` ou importer de `VoyageImportActions` | `importGraniteManifest` valida a viagem, soma peso e monta linhas | INSERT em `granite_manifests`; UPSERT em `granite_bls` por `(manifest_id, bl_number)` com `charge_status='not_calculated'` | Fecha/reset modal; invalida listas relacionadas; informa `pendingCount` | Viagem ausente ou erro em qualquer write lança; cabeçalho e B/Ls não estão numa RPC atômica | **Código:** [`graniteImport.ts`](../../src/services/graniteImport.ts), [`034_granite_module.sql`](../../supabase/migrations_archive/034_granite_module.sql) |
| `/granito` · filtrar/listar/paginar | Sessão interna | Query `['granite-bls', filters]` | `listGraniteBls` monta filtros e, para viagem, resolve manifest IDs antes | SELECT em `granite_bls`, `granite_manifests`, `voyages`, `vessels`, `customers` | Paginação local por `range`; troca de filtro volta à página 1 | Erro mostra `InlineError`; viagem sem manifest retorna lista vazia | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`graniteCharges.ts`](../../src/services/graniteCharges.ts) |
| `/granito` · importar CE Mercante | Usuário interno; planilha/EDI com BL e CE válidos | `CeMercanteImportModal` com `target='granite'` | `parseCeMercanteFile` → resolução `bl_number → granite_bls.id` na viagem → `apply_granite_ce_mercante_update` | RPC audita e atualiza `granite_bls.ce_mercante`; não dispara faturamento de Granito | Invalida B/Ls e operações inclusive em resultado parcial; CE preenchido é único por B/L | B/L inexistente ou ambíguo aparece por linha; falhas ficam restritas ao lote de importação | **Código:** [`CeMercanteImportModal.tsx`](../../src/components/shared/CeMercanteImportModal.tsx), [`ceMercanteImport.ts`](../../src/services/ceMercanteImport.ts) · **Teste:** `ceMercanteImport.test.ts` |
| `/granito` · calcular taxas | Papel diferente de Equipamentos; B/L existente; peso real disponível | `handleCalculateCharges` | `calculateGraniteBlCharges` chama RPC server-side, que trava o B/L, valida tarifa vigente/valor e só então substitui o snapshot | DELETE/INSERT em `granite_bl_charges`; UPDATE de `granite_bls.charge_status` | Invalida `['granite-bls']` e `['voyages']`; “Ver resultado” reabre os efeitos persistidos | Sem rates falha fechado antes do DELETE e preserva snapshot anterior; peso/tarifa inválidos bloqueiam | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`graniteCharges.ts`](../../src/services/graniteCharges.ts), `supabase/migrations/031_import_effect_consumers.sql` |
| `/granito` · recalcular quantidades | B/L existente; rates ativas/vigentes; peso real disponível | `handleCalculateCharges` ou lote da Validação | `calculateGraniteBlCharges` substitui o snapshot quantitativo pela RPC autoritativa | `granite_bl_charges`; UPDATE de `granite_bls.charge_status='calculated'` | Invalida `['granite-bls']`, operações e `['voyages']`; resultado reabrível no painel | Sem rates falha fechado sem esvaziar o snapshot anterior | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`src/services/graniteCharges.ts`](../../src/services/graniteCharges.ts), `supabase/migrations/031_import_effect_consumers.sql` · **Teste:** `graniteBillingWorkflow.test.ts` |
| `/taxas-locais` · emitir manualmente | Não aplicável a Granito | `ValidacaoTab` | Granito não possui caminho de emissão | Nenhuma escrita financeira nova | Mantém visualização operacional e registros históricos | A linha não oferece botão “Emitir” | **Teste:** `ValidacaoOperationsTable.test.tsx`, `validacaoFunnel.test.ts` |
| `/taxas-locais` · consultar invoice histórica | Vínculo financeiro histórico retornado pela lista genérica | `InvoicesTable` → `InvoiceDetailModal` | `useInvoiceDetail` → `listInvoiceDetails`/RPC `list_invoice_details` | Leitura de `invoices`, `invoice_items`, `payments` e vínculos históricos | Acesso somente leitura ao documento histórico | Não existe link direto em `/granito`; a consulta parte da lista genérica | **Código:** [`TaxasLocais.tsx`](../../src/pages/TaxasLocais.tsx), [`InvoicesTable.tsx`](../../src/components/billing/InvoicesTable.tsx), [`billing.ts`](../../src/services/billing.ts) |
| `/revisao` · vincular cliente pendente | `granite_bls.client_id IS NULL`; cliente selecionado | `Revisao`; `saveGraniteBlReview` | UPDATE direto seguido de tentativa de auditoria | `granite_bls.client_id`; INSERT em `audit_logs` | Invalida revisão, Granite e operação de taxas; solicita recálculo | Falha do UPDATE lança; o retorno da auditoria não é inspecionado e pode falhar silenciosamente | **Código:** [`useReview.ts`](../../src/hooks/useReview.ts), [`review.ts`](../../src/services/review.ts), [`Revisao.tsx`](../../src/pages/Revisao.tsx) |
| `/granito/taxas` · listar | Usuário interno ativo | Query da página | `listGraniteRates` | SELECT em `granite_rates` | Query `['granite-rates']` | Erro mostra `InlineError` | **Código:** [`GraniteRates.tsx`](../../src/pages/GraniteRates.tsx), [`graniteCharges.ts`](../../src/services/graniteCharges.ts) |
| `/granito/taxas` · criar/editar | A UI exige admin; descrição e tipo; valor presente | `handleSave` | `upsertGraniteRate` | UPSERT em `granite_rates` | Invalida `['granite-rates']` | Erro do banco mostra toast; UI não valida vigência cruzada; a policy atual permite INSERT/UPDATE a qualquer usuário ativo | **Código:** [`GraniteRates.tsx`](../../src/pages/GraniteRates.tsx), [`graniteCharges.ts`](../../src/services/graniteCharges.ts), [`042_rls_module_hardening.sql`](../../supabase/migrations_archive/042_rls_module_hardening.sql) |
| `/granito/taxas` · ativar/desativar | A UI exige admin | `handleToggleActive` | `upsertGraniteRate` com `active` invertido | UPSERT em `granite_rates` | Invalida `['granite-rates']` | Erro mostra toast; a policy de UPDATE aceita usuário ativo | **Código:** [`GraniteRates.tsx`](../../src/pages/GraniteRates.tsx), [`042_rls_module_hardening.sql`](../../supabase/migrations_archive/042_rls_module_hardening.sql) |
| `/granito/taxas` · excluir | Admin; confirmação aceita | `handleDelete` | `deleteGraniteRate` | DELETE em `granite_rates`; snapshots mantêm `rate_id` nulo por `ON DELETE SET NULL` | Invalida `['granite-rates']` | Policy bloqueia não-admin; erro mostra toast | **Código:** [`GraniteRates.tsx`](../../src/pages/GraniteRates.tsx), [`034_granite_module.sql`](../../supabase/migrations_archive/034_granite_module.sql) |
| `/taxas-locais` · consultar histórico financeiro | Invoice histórica vinculada a Granito | `InvoicesTable` → `InvoiceDetailModal` | Leitura das superfícies genéricas de invoices | Sem nova promoção de B/L ou emissão de Granito | Mantém o histórico consultável | Regras de cancelamento seguem o documento histórico e suas permissões | **Código:** [`InvoiceDetailModal.tsx`](../../src/components/billing/InvoiceDetailModal.tsx), [`billing.ts`](../../src/services/billing.ts) |

## Estado e dados

- **`granite_manifests`:** cabeçalho por importação, associado à viagem, com
  portos, quantidade de B/Ls, peso total e autor.
- **`granite_bls`:** entidade própria com UUID, dados COSCO, `client_id`,
  `ce_mercante` único quando preenchido, `real_weight_kg`, `final_m3` e
  `charge_status=not_calculated|calculated` no fluxo atual. Valores
  `ready_for_billing` e `invoiced` antigos permanecem consultáveis como legado;
  esta mudança não os remove nem os promove novamente.
  Não possui FK ou identidade compartilhada com `bls`.
- **`granite_rates`:** regras ativas por tipo de cobrança, moeda e vigência.
- **`granite_bl_charges`:** snapshot recalculável. Copia descrição,
  `charge_type`, `unit_value`, quantidade, subtotal e moeda; alterar/excluir a
  rate não reprecifica automaticamente snapshots existentes.
- **`invoice_granite_bls`:** vínculo invoice ↔ `granite_bls`, com subtotal por
  B/L. O trigger
  `prevent_duplicate_active_invoice_granite_bl_link` impede duas invoices
  ativas para o mesmo B/L.
- **Estado de cálculo:** `calculateGraniteBlCharges` chama a RPC server-side,
  que trava o B/L, valida peso, vigência e valor das tarifas antes de substituir
  o snapshot e gravar `calculated`. O workflow compartilhado `runGraniteBatch`
  só chama esse recálculo. Estados financeiros antigos são dados históricos,
  não etapas produzidas pelo código atual.
- **Quantidade:** `per_kg` usa `real_weight_kg`; `per_ton`, peso/1000;
  `per_bl` e `fixed`, quantidade 1. A RPC atual exige total BRL positivo.
- **Queries/cache:** `/granito` usa `['granite-bls', filters]`;
  `/granito/taxas`, `['granite-rates']`; a visão unificada usa
  `queryKeys.charges.operations(filters)`; invoices usam a família
  `queryKeys.invoices`.
- **Revisão:** B/Ls sem `client_id` aparecem na fila `['review-queue']`.
  Vincular cliente não recalcula snapshots; a UI exige voltar a `/granito`.
- **Taxas Locais:** a migration
  [`062_taxas_locais_granito.sql`](../../supabase/migrations_archive/062_taxas_locais_granito.sql)
  permite `charge_tables.cargo_mode='granito'` para filtros/tabelas da visão
  operacional. O cálculo especializado continua em `granite_rates` e
  `granite_bl_charges`.

## Fluxos e invariantes

```mermaid
flowchart LR
    Voyage["Viagem selecionada"] --> Cosco["Planilha COSCO"]
    Cosco --> Parse["Parse + erros por linha"]
    Parse --> Reconcile{"Cliente resolvido?"}
    Reconcile -->|Não, aceitar pendente| Pending["granite_bls<br/>client_id=null"]
    Pending --> Review["Revisão vincula cliente"]
    Reconcile -->|Sim| Persist["granite_manifests<br/>+ granite_bls"]
    Review --> Persist
    Persist --> Calc["calculateGraniteBlCharges<br/>snapshot de granite_rates"]
    Calc --> Calculated["calculated"]
    Calculated --> Quantities["quantidades operacionais<br/>visíveis para conferência"]
    Quantities --> History["vínculos financeiros históricos<br/>somente leitura"]
```

- O parser considera a primeira aba e exige B/L e peso real positivo. B/L
  duplicado na mesma planilha é rejeitado; o banco reforça unicidade por
  `(manifest_id, bl_number)`.
- Pendência de cliente pode ser persistida e permanece visível para
  reconciliação; ela não abre uma etapa financeira de Granito.
- O cálculo substitui o snapshot anterior somente depois de validar as tarifas:
  sem taxa vigente ou com valor inválido a RPC falha antes do DELETE e preserva
  o snapshot anterior. Mudança de tarifa só afeta o próximo recálculo.
- Cada importação de Granito cria efeitos `granite_billing` na mesma transação
  do manifesto. O painel “Ver resultado” reabre o status e o resultado do
  servidor após recarregar; bloqueios podem ser reprocessados com justificativa
  auditada.
- `ready_for_billing` e `invoiced` podem aparecer em registros históricos, mas
  não são produzidos pelo workflow operacional atual. Não há promoção silenciosa
  nem exclusão desses dados.
- `cargo_mode='granito'` unifica filtros e operação visual, não ownership:
  `granite_bls`, `granite_bl_charges` e `invoice_granite_bls` continuam sendo
  as fontes do domínio.

## Testes e validação

- Não existe arquivo dedicado de teste para
  `src/services/graniteImport.ts` nem para
  `src/services/graniteCharges.ts`.
- [`src/services/__tests__/importCore.test.ts`](../../src/services/__tests__/importCore.test.ts)
  cobre helpers genéricos de cabeçalho, primeira aba e coleta de erros; não
  comprova o `HEADER_MAP`, as regras COSCO, reconciliação ou persistência de
  Granito.
- [`src/services/__tests__/uploadLimits.test.ts`](../../src/services/__tests__/uploadLimits.test.ts)
  cobre limite de upload para base de clientes e extrato PIX, não chama
  `parseGraniteManifestFile`.
- [`src/services/__tests__/billing.test.ts`](../../src/services/__tests__/billing.test.ts)
  cobre a superfície genérica de invoices e persistência best-effort do PIX;
  não cria invoices novas para Granito.
- [`src/services/__tests__/graniteBillingWorkflow.test.ts`](../../src/services/__tests__/graniteBillingWorkflow.test.ts)
  garante que o workflow chama somente o recálculo quantitativo e não expõe
  promoção financeira.
- [`src/components/billing/__tests__/ValidacaoOperationsTable.test.tsx`](../../src/components/billing/__tests__/ValidacaoOperationsTable.test.tsx)
  garante que Granito não oferece emissão na fila compartilhada.
- Existem testes de helpers de Viagens com estatísticas de Granito, mas eles não
  cobrem importação ou cálculo.
- A validação automatizada do fluxo inclui os testes de workflow, fila e
  comportamento da tela; não há selo **Runtime** nesta cartografia.

## Notas e divergências

- **Código — fluxo financeiro removido:** Granito não oferece autoemissão,
  emissão manual ou promoção para `ready_for_billing`. A fila compartilha apenas
  o recálculo quantitativo e identifica a linha como apoio operacional.
- **Código — histórico preservado:** linhas financeiras antigas continuam
  consultáveis nas superfícies genéricas; a remoção do workflow não apaga nem
  reclassifica silenciosamente esses vínculos.
- **Código — histórico financeiro fora do fluxo operacional:** `/granito` não
  navega para invoices nem inicia emissão. Vínculos históricos permanecem nas
  superfícies genéricas de faturamento para consulta.
- **Histórico — detalhe genérico perde metadados do B/L Granito:** a lista de
  invoices consulta `invoice_bls` e `invoice_receivable_links`; a RPC
  `list_invoice_details` também monta `bls` apenas por `invoice_bls`.
  `invoice_items` ainda permite abrir o documento, mas a lista pode exibir
  `Sem B/L` e o detalhe não recebe porto/viagem do vínculo Granite.
- **Histórico — `invoice_type` não era informado pelo caminho antigo de Granite:**
  esse caminho inseria em `invoices` sem `invoice_type`; após
  [`066_local_billing_ledger_phase1.sql`](../../supabase/migrations_archive/066_local_billing_ledger_phase1.sql)
  o default é `individual`, embora o enum aceite `granite`.
- **Código — reconciliação e erros de linha são decisões separadas:**
  `allowPending` continua controlando somente B/Ls sem cliente resolvido e as
  telas mantêm o default `true`. Já `rowErrors` bloqueia por padrão; as
  superfícies compartilhadas oferecem `allowRowErrors` para aceitar apenas as
  linhas válidas, sem liberar erro de documento/viagem nem persistir porto
  desconhecido.
- **Código — importação não atômica:** o cabeçalho `granite_manifests` é criado
  antes do UPSERT de `granite_bls`; falha posterior pode deixar manifesto sem
  todos os B/Ls esperados.
