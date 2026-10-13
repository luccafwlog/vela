# 0055 — Taxa local não tem vencimento praticado: `due_date` e `overdue` saem do domínio

> **Situação atual (2026-10-13).** Decisão vigente e implementada (migration arquivada `348`). As migrations `024`, `031`, `157`, `327`, `329` e `347` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062; `024`, `031` e `157` também existem na cadeia ativa, com outro conteúdo.
> Regra vigente em [Regras de negócio](../operations/regras-de-negocio.md), seção "Vencimento e inadimplência".

Status: aceito — 2026-08-27

## Contexto

A migration `031_overdue_enforcement.sql` criou três coisas ao mesmo tempo: um job
`pg_cron` diário (`mark-overdue-invoices`), o status `overdue` em
`public.invoices`, e o gatilho `fn_block_invoice_overdue_customer`, que recusa
qualquer nova fatura de um cliente com fatura vencida em aberto. A `024` (depois
`329`) somou um detector que abre o alerta `invoice_overdue`. Todos derivam de
`invoices.due_date`.

A coluna `due_date` sempre existiu na tabela, mas a operação **nunca praticou uma
data de vencimento para taxas locais** — confirmado com o produto durante a
sessão de grilling da #556, ao desenhar a comunicação por e-mail das faturas.
Não existe prazo que a agência cobre do cliente nessa fatura.

O efeito era um estado inventado circulando como se fosse real: a fatura
aparecia "Vencida" em telas internas, na ficha do cliente, no relatório
financeiro e no Portal; alimentava a fila de alertas financeiros; e — o custo
mais alto — **travava a emissão de faturas novas** por um prazo que ninguém
combinou com o cliente.

O Demurrage passou exatamente por isso. O ADR 0014 concluiu que sob recálculo
diário não há vencimento, e a migration `157_demurrage_drop_overdue.sql` removeu
`overdue` de `demurrage_invoices`. O `due_date` do Demurrage vive em tabela
própria, tem significado, e **não está em questão aqui**.

## Decisão

A fatura de taxas locais não tem vencimento. `invoices.due_date` e o status
`overdue` deixam de existir — não viram campo informativo, não viram coluna
morta.

- O job `mark-overdue-invoices` é desagendado e `mark_overdue_invoices()` é
  removida.
- `detect_overdue_invoices()` é removida e sai de `run_alert_detectors()`. O tipo
  `invoice_overdue` é desativado no `alert_type_catalog` e seus itens abertos são
  fechados, no mesmo padrão das migrations `327`/`347`. O rótulo permanece em
  `TYPE_LABELS` para os itens históricos.
- `fn_block_invoice_overdue_customer` e seu gatilho são removidos: a emissão
  deixa de ser bloqueada por vencimento. Bloqueio comercial por cliente continua
  existindo pelo caminho explícito (`billing_block_reason`), que é decisão humana
  registrada, não inferência de data.
- As faturas marcadas `overdue` voltam ao status que o pagamento sustenta
  (`paid`, `partially_paid` ou `issued`), e `overdue` sai do CHECK de
  `invoices.status`.
- `update_invoice_due_date` é removida, junto com o campo de vencimento no
  detalhe da fatura.
- O parâmetro `p_due_date` sai das RPCs de emissão de taxas locais, e a coluna
  sai dos `INSERT`s e das leituras do Portal.
- **O estado autoritativo da fatura de taxas locais passa a ser só o do
  pagamento.** "Em aberto" é saldo positivo, não prazo estourado.

## Consequências

- **Positivas:** some um estado que a operação não reconhecia; a emissão deixa de
  travar por uma regra fantasma; a fila de alertas financeiros para de prometer
  um alerta sem lastro operacional; a comunicação por e-mail (#556) deixa de ter
  um vencimento a exibir, resolvendo a pendência que a spec registrou.
- **Negativas / custos:** a remoção da coluna é irreversível — o `due_date`
  histórico se perde, e não havia valor operacional nele para preservar. A
  alteração toca arquivo protegido (`src/types/database.ts`, autorizada) e ∼25
  arquivos. Assinaturas de RPC mudam: clientes desatualizados que ainda enviarem
  `p_due_date` recebem erro de função inexistente, o que é preferível ao
  parâmetro silenciosamente ignorado.
- **Não muda:** o Demurrage segue com `due_date` próprio em
  `demurrage_invoices`, fora deste recorte. Guardas que listam `'overdue'` em
  cláusulas `IN (...)` foram mantidas como defesa histórica inofensiva — o status
  não pode mais ocorrer.
- **Relação:** aplica às taxas locais o mesmo princípio que a 0014 aplicou ao
  Demurrage; estende a 0007 (ciclo de vida da invoice local), que passa a ser
  regido apenas por emissão e pagamento.
