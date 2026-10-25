# 0102 — Desbloqueio de CE: a vigência do anual vale pelo vínculo do CE Mercante

Status: aceito — 2026-10-25 (decisão do responsável, ao rever as perguntas em
aberto da PR luccafwlog/vela#1058). Implementada na migration `456`.

Supersede a decisão 4 da [ADR 0101](./0101-desbloqueio-ce-prazo-e-vigencia-anual.md)
(o anual cobre o B/L importado no Vela dentro da vigência dele, pela data de
importação, e só enquanto está vigente hoje).

## Contexto

A ADR 0101 fez a vigência do termo e da procuração anuais valer pela data de
importação do B/L (`bls.created_at`) e manteve a exigência de o anual estar
vigente no dia do pedido. Na virada do ano, as duas condições se chocavam: o
B/L do ano que acabou perdia a cobertura do anual dele, que tinha vencido, e
não ganhava a do anual novo, que não retroage. Um pedido VIP aberto em
dezembro travava em janeiro ("Aplicar renovação VIP" recusava com "Cobertura
anual incompleta") e o Cliente precisava pedir o B/L de novo numa solicitação
comum.

## Decisão

1. **A referência é o vínculo do CE Mercante ao B/L.** O anual, e cada
   renovação, cobre o B/L cujo CE foi vinculado dentro da vigência dele, no
   calendário de Brasília.
2. **O anual continua cobrindo depois de vencer** os B/Ls cujo CE foi
   vinculado na vigência dele, enquanto estiver aprovado. Anual revogado ou
   recusado não cobre.
3. **Vale o vínculo do CE atual.** Trocar o número do CE muda a data; reformatar
   o mesmo número não muda. O B/L que nasce com o CE tem o vínculo na criação.
4. Continuam valendo da ADR 0101: a vigência não retroage (o B/L com o CE
   vinculado antes segue com termo e procuração anexados) e o pedido é inteiro
   VIP ou inteiro comum (decisão 5, confirmada pelo responsável em 2026-10-25).

## Alternativas rejeitadas

- Data de importação do B/L (ADR 0101, decisão 4): o B/L costuma ser importado
  antes de o CE existir, e o desbloqueio é do CE.
- Exigir também o anual vigente no dia do pedido: era o que travava os pedidos
  em janeiro.
- Data do primeiro CE do B/L: a correção do número é um vínculo novo, e o
  desbloqueio já pede reconferência quando o CE muda.

## Consequências

- O pedido VIP aberto em dezembro não trava na virada do ano; o B/L com o CE
  vinculado em dezembro segue coberto pelo anual daquele ano em janeiro.
- O B/L importado em dezembro com o CE vinculado em janeiro é coberto pelo
  anual do ano novo.
- A situação VIP do Cliente na tela (termo e procuração anuais vigentes hoje)
  não muda: sem o anual do ano novo, o Portal mostra "Falta o termo anual",
  mas a seleção de B/Ls cobertos pelo anual anterior segue VIP, B/L a B/L.
- A data do vínculo sai da auditoria do B/L (a última troca para o CE atual;
  sem troca registrada, a criação do B/L), não de uma coluna própria
  (`ponytail:` na migration `456`).
