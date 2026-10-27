# 0110 — Desbloqueio de CE: o anual VIP cobre pela data da solicitação

Status: aceito — 2026-10-27 (decisão do dono, com a diretoria, sobre
`08-desbloqueio-ce:4`, resposta "outra"; lote 11 do
[plano de correções](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `479`.

Supersede a decisão 1 e a decisão 3 da
[ADR 0102](./0102-vigencia-anual-pelo-vinculo-do-ce.md) (a vigência vale pelo
vínculo do CE Mercante ao B/L) e a parte da decisão 4 da
[ADR 0101](./0101-desbloqueio-ce-prazo-e-vigencia-anual.md) que a 0102 ainda
mantinha (a vigência "não retroage" ao CE vinculado antes). Mantém a decisão 2
da ADR 0102 (o anual vencido continua cobrindo; revogado ou recusado não
cobre) e a decisão 5 da ADR 0101 (o pedido é inteiro VIP ou inteiro comum).

## Contexto

Desde as migrations `449` e `456`, o termo e a procuração anuais cobriam o B/L
pela data em que o CE Mercante foi vinculado a ele (antes, pela importação do
B/L). O Cliente VIP não vê essa data: ele vê quando pediu o desbloqueio. Um CE
vinculado dias antes do início da vigência deixava o B/L fora do anual, e o
pedido inteiro virava comum, com termo e procuração anexados, embora o
Cliente tivesse pedido com o anual aprovado. Os textos da ficha do Cliente e
do Portal ("cobrem todos os pedidos até 31/12 do ano aprovado") prometiam
outra regra.

## Decisão

1. **A referência é a data da solicitação.** O anual aprovado, de ano inteiro,
   cobre todo CE cujo desbloqueio foi solicitado dentro da vigência dele, sem
   olhar a importação do B/L nem o vínculo do CE.
2. **O dia que vale é o do primeiro envio** da solicitação ativa mais recente
   do B/L, no calendário de Brasília; antes do envio (rascunho, seleção no
   Portal), vale o dia de hoje (`ce_unlock_private.request_day`).
3. O anual vencido continua cobrindo o que foi solicitado na vigência dele;
   revogado ou recusado não cobre (decisão 2 da ADR 0102).

## Alternativas rejeitadas

- Manter o vínculo do CE (ADR 0102): o Cliente não controla nem vê essa data,
  e o pedido feito com o anual aprovado podia virar comum.
- Data de importação do B/L (ADR 0101): o B/L costuma ser importado antes de o
  CE existir.

## Consequências

- O B/L com o CE vinculado antes da vigência é coberto se o desbloqueio for
  pedido dentro dela; o pedido feito em dezembro continua coberto pelo anual
  daquele ano em janeiro.
- Trocar o número do CE já não muda a cobertura; a reconferência do CE segue
  pela regra própria da troca de CE.
- A limpeza diária usa a mesma cobertura (`ce_unlock_private.covers`): o anual
  vencido fica guardado enquanto cobre B/L não cancelado do Cliente, até um ano
  depois do fim da vigência (migration `457`).
- `ce_unlock_private.ce_link_day` fica no banco sem uso pela cobertura.
- Os textos da ficha do Cliente, do Portal, do motivo "Sua condição VIP não
  cobre esta solicitação" e de **Aplicar renovação VIP** passam a falar em
  desbloqueio solicitado na vigência.

Regra vigente: [Desbloqueio de CE § Requisitos e condição VIP](../modules/desbloqueio-ce.md#requisitos-e-condição-vip).
