# Alterar as taxas calculadas de um B/L

Estado: rascunho em entrevista com o dono do Vela (2026-10-28). As decisões
abaixo são registradas à medida que o dono responde; a spec só vale depois da
aprovação dele, e nenhum código é escrito antes disso.

## Pedido

Pedido do dono (2026-10-28): **o operador deve poder alterar as taxas
calculadas de qualquer B/L.** Vem antes de qualquer outra etapa, inclusive da
Etapa 2 do [Manual do Operador](../plans/2026-10-26-manual-do-operador.md).

## Decisões do dono

### D1 — Alcance: só Taxas Locais

A alteração vale para as Taxas Locais do B/L (as linhas do bloco **Taxas
Locais** da ficha). A Demurrage fica como está: ela já tem **Desconto** (em %
ou US$, qualquer setor, com justificativa), free time e diárias P1/P2 por B/L
e reemissão pelas datas. Se faltar algo na Demurrage, é um pedido separado.

### D2 — Forma: alterar o valor cobrado ou excluir a taxa; quantidade fixa

Em cada taxa do B/L o operador pode:

- **alterar o valor cobrado por unidade** da taxa (o valor unitário), na moeda
  da taxa (R$ ou US$), abaixo ou acima da tabela. O total passa a ser a
  quantidade do B/L × o valor alterado;
- **excluir a taxa** da cobrança do B/L.

A **quantidade não se altera**: ela é a quantidade do item de carga do B/L
(containers, peso, rateio do container compartilhado) e mudá-la à mão teria
impacto maior no sistema. Para mudar a quantidade, corrige-se o B/L, que já
recalcula. Valor zero não se digita: para não cobrar, exclui-se a taxa.
