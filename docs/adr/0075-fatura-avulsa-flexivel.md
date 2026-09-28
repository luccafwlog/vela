# 0075 — Fatura avulsa flexível no modelo de invoices

Status: aceito — 2026-09-26. Implementada localmente nas migrations `097`, `098` e `099`;
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
