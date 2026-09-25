# Regras de negócio

> Regras **não óbvias** que atravessam módulos. Regras específicas de cada módulo ficam no doc do módulo. Termos em [CONTEXT.md](../../CONTEXT.md).

---

## Gate de faturamento

A emissão exige cliente reconciliado, cálculo elegível, revisão sem pendências
bloqueantes e CE Mercante. `047_bl_documental_gates.sql` guarda a promoção e a
emissão individual/consolidada; `056` inclui as duas tabelas do B/L misto.
O CE também participa da liberação documental para leitura no Portal.

A prontidão do Portal permanece exigida no caminho manual e do cliente. A
migration `051_ce_mercante_auto_billing.sql` permite à automação de transição
do CE emitir em contexto interno controlado sem depender do provisionamento.
Essa exceção não pode ser assumida por uma chamada comum do navegador.
Cálculo provisório não equivale a emissão. As pendências são derivadas no banco;
a Revisão resolve vínculo e correções, sem uma aprovação em lote obrigatória.

Fontes: ADRs 0038/0042/0054/0069 e [Faturamento](../modules/faturamento.md).

## Numeração de invoices

A numeração sequencial é atômica no banco, via RPC `assign_invoice_number` sobre `invoice_counters`. Nunca gerar número no cliente — garante unicidade fiscal mesmo sob concorrência. Detalhes em [Faturamento](../modules/faturamento.md).

## Ledger local e ciclo de vida

Taxas locais usam um **ledger local** (ADR 0007) como fonte de saldo:

- `bl_receivables` — saldo a receber por B/L.
- `invoice_receivable_links` — liga invoices (individuais e consolidadas) aos receivables.
- `ledger_settlements` — baixas/pagamentos.
- `invoice_lifecycle_events` — trilha de eventos da invoice.

Demurrage **não** entra no ledger local — mantém persistência própria (`demurrage_invoices`), com operação própria em `/demurrage` e consultas em Conciliação PIX e Portal (ADRs 0008/0050).

## Vencimento e inadimplência

**A fatura de taxas locais não tem vencimento praticado** (ADR 0055, migration
`348`). A operação nunca cobrou prazo nessa fatura, então `invoices.due_date` e o
status `overdue` foram removidos, junto com o job `mark-overdue-invoices`, o
detector `detect_overdue_invoices` e o gatilho
`fn_block_invoice_overdue_customer` que bloqueava novas emissões. O estado da
fatura local é regido só por emissão e pagamento: "em aberto" é saldo positivo.

O bloqueio comercial por cliente continua existindo pelo caminho explícito
(`billing_block_reason`), que é decisão humana registrada — ver seção abaixo.

O **Demurrage** tem `due_date` próprio em `demurrage_invoices` e segue fora deste
recorte; sob recálculo diário ele também não tem `overdue` (ADR 0014, migration
`157`). Ver [Faturamento](../modules/faturamento.md).

## Bloqueio de faturamento por cliente (billing block)

O cliente pode ter um motivo de bloqueio de faturamento persistido. A migration `126_preserve_customer_billing_block_reason.sql` deixou de **inferir** um motivo genérico durante a importação — o motivo só é definido por ação explícita, preservando o que já existir. Ver [Clientes](../modules/clientes.md).

## Câmbio (ROE / PTAX)

Cobranças em moeda estrangeira usam o ROE obtido da PTAX Venda do Banco Central (`olinda.bcb.gov.br`) pelo serviço compartilhado `fetchROE`, com markup canônico de `1,065`. O header interno consome esse contrato por `useRoeHeaderRate`; sem ROE/dados fiscais suficientes, a emissão da invoice é bloqueada. Aplica-se a Faturamento e Demurrage.

## Reconciliação de cliente (fuzzy matching)

Na importação documental de container, o consignatário do B/L é casado contra a base de `customers` por documento exato; similaridade de nome produz somente sugestão que exige confirmação humana (ADR 0043). Match incerto entra em `customer_reconciliation_queue` em vez de vincular automaticamente. Ver [Clientes](../modules/clientes.md). Conforme a ADR 0025, o arquivo de B/L é a fonte documental da carga de container; o importador de Manifesto CNTR foi removido do frontend.

## Confirmação de exclusões persistidas

Toda ação que apaga ou remove um registro já persistido exige diálogo explícito
de confirmação, mesmo sem B/Ls ou outras dependências. O diálogo identifica o
objeto, informa consequências conhecidas e usa uma ação nominal como `Excluir`.
Remover linha ainda não salva, limpar filtro, desfazer seleção ou cancelar edição
não pertence a esse contrato.

## Conciliação Baplie ↔ B/L

- Match key: `container_number` + `voyage_id`. `bl_ref` do Baplie é sinal secundário, não critério de bloqueio.
- **Gate de cobertura por rota:** uma rota (POL→POD) de containers cheios prevista pelo Baplie só entra na conciliação quando tem pelo menos um B/L **com containers** naquela rota — B/L sem container não cobre rota. O gate é por rota: uma rota ainda sem B/L fica fora da conciliação, sem silenciar as demais rotas da viagem. Em D-7 do primeiro ETA brasileiro todas as rotas são conciliadas, inclusive as sem B/L.
- Códigos de porto são normalizados antes da comparação (`public.normalize_port_code` no banco, `src/services/portCode.ts` no app). Zhoushan (`CNZOS`/`ZOS`) e Ningbo (`CNNGB`) são o mesmo complexo portuário: o Baplie costuma codificar `CNZOS` onde o B/L declara Ningbo. Variações como `QINDGAO` e `TSINGTAO` resolvem canonicamente para Qingdao (`CNTAO`).
- **Divergência de existência** (container no Baplie sem correspondência nos B/Ls) → aviso, sem bloqueio.
- **Divergência de atributo** (status full/empty, IMO, OOG conflitantes) → aviso, com opção de aceitar valor do Baplie por linha.
- O Baplie pode sobrescrever flags operacionais (`is_imo`, `imo_class`, `un_number`, `is_oog`, `status`); dados documentais e financeiros vêm do B/L e permanecem protegidos.

Detalhes em [Manifestos & EDI](../modules/manifesto-edi.md). Definições em [CONTEXT.md](../../CONTEXT.md).

## Conciliação PIX

- Invoices locais são conciliadas por TXID via `reconcile_invoice_payment_by_txid`, que registra ledger/payment/settlement e marca a invoice com `pix_txid` e `conciliated_by_extract`.
- Demurrage é marcado diretamente em `demurrage_invoices` (`status = paid`, `paid_at`, `pix_txid`, `conciliated_by_extract`).
- **Casos ambíguos** (TXID repetido, valor divergente, múltiplos candidatos) **não** são confirmados automaticamente — ficam para revisão humana. Ver [Conciliação PIX](../modules/reconciliacao-pix.md).

## Gate de CE Mercante no Portal

O Portal do Cliente só expõe dados de B/Ls que tenham `ce_mercante` preenchido (migration `123_portal_ce_mercante_gate.sql`). Evita mostrar carga ainda não declarada no Mercante. Ver [Portal do Cliente](../modules/portal-cliente.md).

## Hard delete controlado

Entidades operacionais permitem **hard delete**, mas exclusões são bloqueadas por vínculos fiscais e registradas em auditoria (ADR 0009). B/L, container, veículo e cliente são excluídos pela RPC `delete_records` (migration `087`): cada item sai por inteiro, com os filhos, ou volta intacto com o motivo, e a mesma RPC em modo prévia alimenta a confirmação. A trilha fica em `audit_logs`, gravada na mesma transação (`src/services/deleteRecords.ts`, `deleteDependencies.ts`). Exclusões de uma linha só (`deleteOneById`) tratam 0 linhas apagadas como erro, em vez de anunciar sucesso.

## Escritas best-effort

Algumas escritas (alertas, eventos operacionais, payload PIX) **logam e seguem** em vez de falhar a operação principal. É proposital para não travar o fluxo financeiro, mas pode mascarar falhas — monitorar via [Sentry](seguranca.md).
