# 0101 — Desbloqueio de CE: prazo só com os quatro requisitos e vigência anual sem retroagir

> **Situação atual (2026-10-25).** A decisão 4 foi supersedida pela
> [ADR 0102](./0102-vigencia-anual-pelo-vinculo-do-ce.md): a vigência do anual
> vale pela data do vínculo do CE Mercante ao B/L, não pela importação, e o
> anual continua cobrindo esses B/Ls depois de vencer (migration `456`). A
> pergunta em aberto do fim desta ADR ficou respondida assim. O responsável
> confirmou em 2026-10-25 a decisão 5 (com um anual faltando, a solicitação
> pede os dois documentos) e a fila "Solicitações aguardando análise" com
> "Enviada em", sem prazo. As demais decisões valem como escritas.

Status: supersedida parcialmente (decisão 4, pela ADR 0102) — aceita em 2026-10-23 (observações do responsável, pontos 10, 11 e 13).
Implementada nas migrations `448` e `450` (prazo) e `449` (vigência).

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
   entregue. Parte do último que se cumpriu; a validação da solicitação conta
   como fato, para o que a completa fora da lista (B/L pendente que muda de
   solicitação, isenção, troca de Cliente) não fazer o prazo nascer vencido
   (migration `450`). Faltando um, não há prazo, nas
   telas do Portal, nos avisos (sino e e-mail) e nas telas internas. A regra
   vale no banco (`ce_unlock_private.item` e `request_sla_start`), não só na
   tela.
2. A solicitação só tem prazo quando todos os B/Ls ativos têm os quatro
   requisitos.
3. Desfazer um requisito tira o prazo; cumpri-lo de novo recomeça a contagem.
   Depois da exportação o prazo do B/L fica: ele já foi medido.
4. **A vigência do termo e da procuração anuais não retroage.** O anual, e cada
   renovação, cobre só o B/L importado no Vela dentro da vigência dele
   (`bls.created_at`, dia de Brasília), e só enquanto ele próprio está vigente.
   O B/L importado antes segue as regras de quem não tem o anual: termo e
   procuração anexados à solicitação. Exemplo: B/L importado em 20/12, com o
   Cliente VIP a partir da virada do ano, não ganha a condição VIP.
5. **VIP sem anual que cubra os B/Ls pede como os demais.** Com a procuração
   (ou o termo) anual faltando, vencida, recusada ou revogada, a solicitação
   nasce comum, explica ao Cliente o motivo e aceita o termo e a procuração
   comuns. Pede os dois documentos, porque o pedido é inteiro comum ou inteiro
   VIP. O VIP coberto continua sem anexo avulso.

## Consequências

- A fila "Solicitações aguardando análise" deixa de ter prazo (ali os
  documentos ainda não foram aprovados) e mostra a hora do envio.
- O aviso "documentação validada" já saía só com os quatro requisitos; desde a
  `450` usa o prazo da solicitação lido depois da validação, o mesmo do Portal.
- Com o prazo só na solicitação validada, a ficha do Cliente passa a mostrá-lo
  na concluída até a última exportação, como o detalhe.
- O rascunho do Cliente VIP só nasce VIP quando os anuais cobrem todos os B/Ls;
  um B/L sem cobertura faz a solicitação inteira seguir comum. Pedido VIP já
  aberto com B/L importado antes da vigência perde a cobertura desse B/L.
- Pergunta em aberto (PR B): depois de 31/12, o anual vencido deixa de cobrir
  até o B/L importado no ano dele; a implementação mantém essa exigência.
