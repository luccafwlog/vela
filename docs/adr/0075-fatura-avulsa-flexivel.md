# 0075 — Fatura avulsa flexível no modelo de invoices

> **Situação atual (2026-10-21).** Estendida pela [ADR 0093](./0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md): a avulsa aberta entra no saldo do Vela numa linha própria (decisão 11), e o "Cancelamento com devolução integral" suspende a cobrança na autorização (decisão 19). Ainda não implementado ([plano](../plans/2026-10-21-correcoes-frente-financeira.md)). O restante desta faixa vale desde 2026-10-14: A avulsa como `invoice_type = 'manual'`, sem ledger local e com o Portal escopado ao Cliente, vale (migrations `097` a `099`).
> A [ADR 0077](./0077-fatura-emitida-nao-muda-de-valor.md) a estendeu: o Tipo de cobrança "item da tabela" exige B/L do Cliente e preço resolvido no servidor, com Condição do Cliente e ROE (migration `123`); "Outra" mantém o item livre e o B/L e a Viagem opcionais do item 2; e o Administrativo pode autorizar a restituição excepcional de avulsa recebida (migration `136`).
> "Deploy remoto não verificado" ficou superado: a emissão de avulsa e o saldo no Portal foram conferidos em produção em 2026-09-29, e uma avulsa já foi baixada pelo Itaú com recibo no Portal.
> Pela [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 9), não vale mais a emissão restrita a um setor: todo usuário interno ativo pode gerar fatura avulsa, com motivo e rastro; o "Item da tabela" escolhe a tabela e a Condição de Cliente pela vigência do cálculo automático (item 10). A emissão por qualquer usuário interno ativo vale desde a migration `246`, e o "Item da tabela" segue essa vigência desde a `248`.
> Regra vigente em [Faturamento](../modules/faturamento.md), seções "Propósito e escopo" e "Catálogo de ações", e no [Manual financeiro](../operations/manual-financeiro.md).

Status: supersedida parcialmente — 2026-09-26. Implementada localmente nas migrations `097`, `098` e `099`;
deploy remoto não verificado.

## Contexto

O faturamento existente emitia documentos ligados a Taxas Locais de B/Ls ou a
Demurrage, com seus modelos de item e regras próprias. O Financeiro precisa
cobrar também um serviço ou encargo eventual, definindo o nome e a descrição,
sem exigir tabela de taxas, B/L, navio ou viagem. O documento deve manter os
recursos comuns de invoice, como número, pagamento, PIX, histórico, impressão e
consulta do Cliente no Portal.

## Decisão

1. Reutilizar `invoices` com o tipo explícito `invoice_type = 'manual'` e
   `invoice_items` para congelar o item nomeado, quantidade, valor unitário e
   descrição. A RPC `create_manual_invoice` calcula o total no servidor e cria
   o documento e o item na mesma transação.
2. B/L e Viagem são opcionais. A invoice guarda `bl_id` e `voyage_id` como
   contexto; se houver B/L, ele deve pertencer ao Cliente informado e a Viagem
   informada deve ser compatível. Sem B/L e Viagem, a invoice permanece válida.
3. Não criar vínculos em `invoice_bls` ou `invoice_receivable_links`, nem
   recebíveis em `bl_receivables` ou liquidações em `ledger_settlements`. O
   pagamento segue `register_invoice_payment`; o estado do ledger local não é
   alterado.
4. Manter PIX e conciliação unificada para a invoice. O Portal inclui o tipo
   apenas nas leituras seguras já escopadas por
   `current_portal_customer_id()`; não aceita `customer_id` fornecido pelo
   navegador para ampliar o escopo. A descrição em `notes` só é exposta para
   invoices `manual`; notas internas de faturas locais permanecem privadas.
5. A emissão é um ato interno protegido pela RPC, sem exigir os gates próprios
   da emissão de Taxas Locais (tabela, cálculo, CE Mercante e liberação local
   do Portal). Isso não altera os gates dos tipos existentes.

## Alternativas rejeitadas

- Reutilizar `individual`: esse tipo significa uma invoice local vinculada a
  B/L/recebível e é usado para decidir ledger, gates, relatórios e ciclo local.
  Dar a ele semântica genérica tornaria essas decisões ambíguas.
- Criar tabela/documento paralelo: duplicaria pagamento, PIX, impressão,
  histórico, exportação e leitura no Portal, além de abrir um segundo ciclo de
  vida financeira.

## Consequências

- O novo tipo atravessa as leituras internas, detalhe, impressão, exportações,
  Portal e conciliação, mas não participa da liquidação por recebível local.
- `invoices.voyage_id` é nullable e indexado; `notes` registra a descrição da
  cobrança e só é exibido ao Cliente para invoices `manual`. A referência
  direta a B/L/Viagem é contextual e não cria saldo no B/L.
- O código e os testes locais estão descritos em
  [Faturamento](../modules/faturamento.md), [Portal do Cliente](../modules/portal-cliente.md)
  e [Reconciliação PIX](../modules/reconciliacao-pix.md). A migration e o
  contrato são evidência local; não comprovam aplicação em produção.

## Nota editorial — 2026-10-01

A [ADR 0077](0077-fatura-emitida-nao-muda-de-valor.md) estende a avulsa com
**Tipo de cobrança**: itens manuais da tabela exigem B/L do Cliente e preço
resolvido no servidor, incluindo Condição do Cliente e ROE. A opção **Outra**
preserva o item livre e B/L/Viagem opcionais da decisão original.
