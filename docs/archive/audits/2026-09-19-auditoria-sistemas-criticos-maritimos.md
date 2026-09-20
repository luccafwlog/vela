# Auditoria de sistemas críticos marítimos — 2026-09-19

## Resultado executivo

**Veredito: reprovado para entrega sem correções.** A revisão encontrou 2
achados P0, 4 P1 e 2 P2 em fluxos de Demurrage, faturamento local, rateio de
containers, importação, ADR e invalidação de cache.

O escopo foi auditado no commit `b136849a`, branch `main`, em 2026-09-19,
com leitura estática do código, migrations e documentação normativa. Nenhum
arquivo de aplicação foi alterado durante a auditoria.

## Contratos considerados

- O B/L é a autoridade documental dos containers cheios; Baplie fornece estado
  físico, posição e flags. A regra está registrada no ADR 0025.
- Demurrage congela USD na emissão e recalcula BRL pela PTAX × 1,065 até o
  pagamento. Disputas não bloqueiam recálculo ou pagamento (ADR 0014).
- Demurrage não pode ser emitida enquanto qualquer container do B/L estiver sem
  `return_date`.
- A isenção local exige simultaneamente veículo no B/L e movimento de destino
  LCL/CFS.
- Valores ausentes não podem virar zero silenciosamente; toda quantidade deve
  ter unidade explícita.

## Achados priorizados

### [P0] Demurrage pode ser emitida com container irmão ainda não devolvido

- **Arquivo/linhas:** `src/services/demurrage/demurrageInvoices.ts:92`;
  `supabase/migrations/023_demurrage_calculation_snapshot.sql:52` e `:324`.
- **Regra violada:** emissão somente após a devolução de todos os containers do
  B/L; devolução parcial não emite invoice.
- **Código:** o cliente envia somente containers `overdue` ou `returned`. A RPC
  valida que os IDs recebidos pertencem ao B/L, mas não compara o conjunto
  recebido com todos os `bl_containers` do B/L nem procura outro container com
  `return_date IS NULL`.
- **Cenário:** A está devolvido e em sobreestadia; B ainda está no pátio. A
  chamada envia apenas A e a invoice é emitida.
- **Correção:** bloquear na RPC autoritativa quando qualquer container do B/L
  não tiver `return_date`, exigir igualdade entre o conjunto completo e os IDs
  recebidos e, preferencialmente, derivar os IDs no servidor. Adicionar teste
  de devolução parcial e concorrência.

### [P0] Pagamento manual do ledger não é idempotente

- **Arquivo/linhas:** `src/services/billingLedger.ts:109`;
  `src/hooks/useBillingLedger.ts:89`;
  `supabase/migrations/052_financial_battery_guards.sql:175`;
  `supabase/migrations/019_local_billing_integrity.sql:44` e `:105`.
- **Regra violada:** retry de mutação financeira não pode criar uma segunda
  liquidação.
- **Código:** não existe `request_id` no RPC ou no cliente. A deduplicação só
  ocorre quando há TXID PIX; pagamentos manuais sem TXID sempre inserem uma
  nova linha. O `loading` da UI não é uma garantia transacional.
- **Cenário:** uma baixa manual de R$50 em invoice de R$100 sofre timeout; o
  operador repete a ação. Duas baixas de R$50 fazem a invoice parecer paga,
  embora só R$50 tenham sido recebidos.
- **Correção:** adicionar chave de requisição única e tabela/índice de mutação;
  repetir a mesma chave deve devolver o resultado anterior e payload diferente
  deve falhar. Gerar a chave no início da ação e reutilizá-la em retries.

### [P1] Importação tardia de B/L compartilhado pode cobrar 150% da taxa

- **Arquivo/linhas:** `src/services/blFreightImport.ts:330`;
  `src/services/charges/chargeOperationsService.ts:761` e `:819`;
  `supabase/migrations/062_pr698_audit_remediations.sql:104`.
- **Regra violada:** um container físico compartilhado deve gerar uma única taxa
  total, rateada entre todos os B/Ls, inclusive em importações separadas.
- **Código:** o motor calcula `1 / share_count`, mas não recalcula irmãos
  `ready_for_billing` ou financeiramente travados. Para um B/L novo, o preview
  não executa `computeBillingImpact`, pois o caminho exige `existing && billed`.
- **Cenário:** A é calculado/faturado sozinho por 100%. B entra depois com o
  mesmo container e recebe 50%; A permanece com 100%, totalizando 150%.
- **Correção:** detectar o compartilhamento no servidor. Antes da emissão,
  colocar os B/Ls envolvidos em hold e recalcular atomicamente; se já houver
  snapshot emitido, exigir cancelamento/reemissão ou ajuste explícito.

### [P1] Disputa aberta interrompe o recálculo cambial da Demurrage

- **Arquivo/linhas:** `supabase/migrations/052_financial_battery_guards.sql:466`
  e `:500`.
- **Regra violada:** invoice emitida e não paga deve acompanhar a PTAX;
  disputas são ortogonais e não bloqueiam recálculo ou pagamento (ADR 0014).
- **Código:** `recalculate_demurrage_invoices` filtra
  `COALESCE(dispute_open, false) = false`.
- **Cenário:** uma disputa permanece aberta durante uma alta da PTAX; a invoice
  conserva BRL antigo e não registra o snapshot diário esperado.
- **Correção:** remover o filtro de disputa do recálculo. A disputa pode pausar
  dunning, mas não a atualização cambial. Adicionar regressão com disputa aberta
  e nova PTAX.

### [P1] Importador de B/L fabrica peso e CBM zero para veículos

- **Arquivo/linhas:** `src/services/blParser.ts:236`;
  `src/services/blFreightImport.ts:580`;
  `supabase/migrations/001_initial_schema.sql:3534`;
  `supabase/migrations/002_business_logic_and_security.sql:8473`.
- **Regra violada:** ausência não pode virar zero; peso e volume devem ser
  positivos e possuir unidade.
- **Código:** a aba VIN entrega chassis, container e B/L, mas o payload cria
  `weight_kg: 0` e `cbm: 0`. A tabela exige ambos maiores que zero.
- **Cenário:** um B/L com VIN e container resolvido tenta inserir os zeros e a
  transação inteira falha nos `CHECK`.
- **Correção:** não criar veículo incompleto nesse importador. Enriquecer a
  origem com valores positivos ou persistir uma associação pendente em fluxo de
  revisão separado. Não relaxar as restrições para aceitar zero.

### [P1] Tarifa ausente é convertida silenciosamente em zero

- **Arquivo/linhas:** `supabase/migrations/062_pr698_audit_remediations.sql:259`,
  `:264`, `:270` e `:303`;
  `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql:139`.
- **Regra violada:** valor nulo não pode ser tratado como preço zero.
- **Código:** `COALESCE(item.override_value, item.unit_value_brl, 0)` e os
  cálculos USD usam fallback para zero, mas a linha continua com status
  `calculated`. Se outra linha for positiva, o gate de prontidão pode passar.
- **Cenário:** THC tem preço válido e outra taxa ativa não tem preço; a invoice
  sai sem a segunda cobrança e sem pendência visível.
- **Correção:** validar o preço por moeda antes de classificar a linha como
  calculada. Preço ausente deve gerar `review_required`, preservar `NULL` e
  bloquear prontidão/emissão.

### [P2] Cards e ADR mostram boxes, mas não calculam TEU

- **Arquivo/linhas:** `src/components/voyages/VoyageCard.tsx:163` e `:386`;
  `src/components/voyages/VoyageAgencyReportTab.tsx:392` e `:748`.
- **Regra violada:** quantidade física e TEU devem ser métricas distintas;
  20' = 1, 40' = 2 e 45' = 2,25.
- **Código:** os cards exibem apenas `CNTRs distintos`; o ADR usa
  `containers.length` com unidade `unidades`. Não há cálculo de TEU nesses
  caminhos.
- **Cenário:** 1×20', 1×40' e 1×45' aparecem como 3 unidades, sem informar
  5,25 TEU.
- **Correção:** criar helper canônico de TEU por tipo normalizado, manter
  `boxes` e `teu` separados e tratar tipo desconhecido como divergência
  explícita. Persistir ambos no snapshot do ADR.

### [P2] Importação de datas não invalida a tela de Containers

- **Arquivo/linhas:** `src/components/shared/ContainerDatesImportModal.tsx:39`;
  `src/services/queryKeys.ts:1`;
  `src/pages/Containers.tsx:531`.
- **Regra violada:** uma escrita deve invalidar todas as famílias que exibem o
  dado alterado.
- **Código:** o modal invalida `demurrage-containers`, `demurrage-invoices` e
  `bl-detail`, mas não `['containers']`, usada pela própria tela de Containers.
- **Cenário:** o import confirma sucesso, mas a linha continua mostrando datas
  anteriores até refetch ou recarga completa.
- **Correção:** centralizar um efeito de alteração de datas que invalide
  `containers`, `demurrage-containers`, `demurrage-invoices` e `bl-detail`.

## Controles positivos observados

- O ADR deriva containers cheios dos B/Ls, deduplica por número físico e usa
  Baplie para flags e divergências, respeitando o ADR 0025.
- A isenção de veículo exige veículo e movimento de destino LCL/CFS; ausência
  de movimento não isenta.
- O gate de prontidão cobre CE Mercante, cliente, reconciliação, revisão,
  terminal, linhas faturáveis e tabela.
- COD aplica abatimento no saldo antes de criar restituição.
- Wrappers do Portal preservam o escopo por cliente e bloqueiam escrita no modo
  de inspeção.
- A precedência de Demurrage é override do B/L, acordo do cliente e tarifa
  geral; PIX e arredondamento pro-rata têm implementação canônica.

## Verificação e limitações

- **Código:** inspeção estática do commit `b136849a`, migrations e ADRs.
- **Teste de contrato SQL:** leitura das definições mais recentes; isso não prova
  execução, RLS ou concorrência em Postgres.
- `git diff --check` passou e o worktree permaneceu limpo antes da criação da
  branch.
- A suíte focada não executou porque o workspace não possui `node_modules`;
  `npm test` falhou com `vitest: command not found`.
- Não houve execução contra Supabase local ou remoto.
- O arquivo solicitado `src/services/demurrage/calculateDemurrage.ts` não existe;
  o cálculo efetivo foi auditado em `demurrageRates.ts` e nas RPCs SQL.
