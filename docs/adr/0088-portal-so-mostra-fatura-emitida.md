# 0088 — O Portal só mostra Taxas Locais de fatura emitida e liberada

Status: aceito — 2026-10-18 (decisão do responsável na aprovação do lote 4 da
identidade visual). Implementada na migration `297`, com testes no Postgres
local; ver o [plano da identidade visual](../plans/2026-10-13-identidade-visual-tela-a-tela.md).

## Contexto

Ao desenhar a coluna de Taxas Locais na aba BLs do Portal, a pergunta "o que
mostrar de um B/L que ainda não tem fatura?" levou o responsável à regra: "Só o
que teve fatura emitida e disponibilizada no Portal do cliente. Exibir algo que
não aparece pro cliente é falha grave de segurança".

A conferência do banco achou quatro lugares que já mostravam ao Cliente valor
que ele ainda não tinha recebido como fatura:

1. o **Saldo pendente** de Faturas (`_portal_customer_pending_balance`,
   migration `225`) somava todo recebível de Taxas Locais em aberto, inclusive
   o calculado e ainda não faturado, o retido pela trava do Portal e o de
   fatura cancelada;
2. a janela **Gerar fatura consolidada** listava, com saldo, B/L que nunca teve
   fatura, e `portal_create_consolidation` aceitava consolidá-lo;
3. a fatura em **rascunho** contava como visível na lista e no detalhe;
4. o **Desbloqueio de CE** dizia "Taxas locais sem liquidação integral
   confirmada" de B/L cujo valor o Cliente ainda não recebeu.

## Decisão

1. Valor de Taxas Locais só chega ao Portal por fatura **emitida** (qualquer
   situação exceto rascunho), do Cliente, e **visível** pelas travas que já
   existiam (CE Mercante em todos os B/Ls e trava do Portal; a avulsa continua
   visível sem B/L). Vale para lista, detalhe, impressão e Painel, na sessão do
   Cliente e no Modo Inspeção.
2. O **Saldo pendente do Portal** é o saldo das faturas visíveis em aberto mais
   as Invoices de Demurrage em aberto da lista do Portal. O Saldo pendente
   interno do Vela (ficha e lista de Clientes) continua incluindo o que ainda
   não foi faturado: é leitura operacional, não o que o Cliente vê.
3. A **consolidação pelo Portal** só lista e só aceita B/L com fatura visível
   não cancelada; o servidor recusa a seleção que inclua outro B/L.
4. Onde o Portal precisa dizer algo de um B/L ainda sem fatura visível (aba
   BLs, Desbloqueio de CE), diz só **"Aguardando fatura"**, sem valor nem
   situação de pagamento.

## Alternativas rejeitadas

- Mostrar o valor calculado com o aviso "ainda não faturado": é exatamente o
  que a regra proíbe; o valor pode mudar até a emissão e o Cliente não tem como
  pagá-lo.
- Esconder o B/L sem fatura das telas: o Cliente perde a informação de que a
  fatura ainda vai chegar, que não revela valor.

## Consequências

- O Saldo pendente do Portal e o interno passam a divergir sempre que há Taxa
  Local calculada sem fatura visível. As regras ficam no
  [Portal do Cliente](../modules/portal-cliente.md) e em
  [Clientes § Saldo pendente](../modules/clientes.md#saldo-pendente).
- Um B/L só entra numa consolidada do Portal depois de faturado
  individualmente; a consolidação interna (Vela) não muda.
- Qualquer tela nova do Portal que mostre Taxas Locais deve ler das faturas
  visíveis (`_portal_list_invoices_core`), nunca de `bl_receivables` direto.
