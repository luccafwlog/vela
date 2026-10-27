# 0105 — B/L misto cobra as taxas por B/L da carga solta quando o container não tem

Status: aceito — 2026-10-27 (decisão do dono, ficha TAX-D14, opção B; lote 2
do [plano de correções](../plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `470`.

Supersede parcialmente a [ADR 0069](./0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md)
(decisão 4: a taxa por B/L vinha só da tabela de container).

## Contexto

No B/L misto (container e carga solta) o cálculo usa as duas tabelas do POD. A
ADR 0069 decidiu que a taxa por B/L (base "por B/L", a documental) incide uma
vez, vinda da tabela de container, e é suprimida na de carga solta.

O código fazia outra coisa: quando a tabela de container não tinha taxa por
B/L, cobrava só a **primeira** taxa por B/L da carga solta, na Ordem de
exibição, e as demais saíam sem aviso. A própria taxa da carga solta ligava a
marca "já cobrou taxa por B/L" (ficha TAX-D14 do mapeamento do Manual do
Operador). A ajuda do formulário dizia "No B/L misto, só do lado container".

## Decisão

1. Com taxa por B/L na tabela de container, ela vale e as taxas por B/L da
   carga solta não são cobradas (como na ADR 0069).
2. Sem nenhuma taxa por B/L na tabela de container, **todas** as taxas por B/L
   da carga solta são cobradas.
3. A ajuda do item no formulário diz a regra: "No B/L misto vale a do
   container; sem ela, cobram-se todas as da carga solta."

## Consequências

- Nada some sem aviso e a cobrança não depende da Ordem de exibição.
- B/L misto não faturado cuja tabela de carga solta tem mais de uma taxa por
  B/L muda de valor no próximo recálculo; fatura já emitida segue a correção
  após emissão ([Faturamento](../modules/faturamento.md)).
- Teste: `src/integration/taxasLocaisLote2.local-pg.test.ts`.

Regra vigente: [Taxas Locais § B/L misto](../modules/taxas-locais.md).
