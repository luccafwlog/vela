# 0101 — Desbloqueio de CE: prazo só com os quatro requisitos

Status: aceito — 2026-10-23 (observações do responsável, ponto 10). Implementada
na migration `448`.

Supersede a decisão 15 da
[spec de revisão do fluxo](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md)
("o prazo parte do envio") e a regra "aprovar documento não recomeça o prazo" do
[módulo](../modules/desbloqueio-ce.md#prazo-sla).

## Contexto

O prazo do desbloqueio (SLA) partia do envio da solicitação e recomeçava quando
o Cliente resolvia uma pendência dele. Com o B/L original ainda não entregue e o
termo e a procuração ainda não validados pela equipe, o Portal já mostrava
"Prazo para desbloqueio": o cliente recebia um prazo que a agência não tinha
como cumprir.

## Decisão

1. **O prazo só começa com os quatro requisitos cumpridos**: taxas locais
   liquidadas, termo de devolução aprovado, procuração aprovada e B/L original
   entregue. Parte do último que se cumpriu. Faltando um, não há prazo, nas
   telas do Portal, nos avisos (sino e e-mail) e nas telas internas. A regra
   vale no banco (`ce_unlock_private.item` e `request_sla_start`), não só na
   tela.
2. A solicitação só tem prazo quando todos os B/Ls ativos têm os quatro
   requisitos.
3. Desfazer um requisito tira o prazo; cumpri-lo de novo recomeça a contagem.

## Consequências

- A fila "Solicitações aguardando análise" deixa de ter prazo (ali os
  documentos ainda não foram aprovados) e mostra a hora do envio.
- O aviso "documentação validada" já saía só com os quatro requisitos e não
  muda.
