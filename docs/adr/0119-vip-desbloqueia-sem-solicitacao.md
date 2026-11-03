# 0119 — Desbloqueio de CE do Cliente VIP sem solicitação

Status: aceito — 2026-11-03 (decisão do dono, depois da abertura do Vela e do
Portal a clientes reais). Implementada nas migrations `581` e `582`.

Supersede parcialmente a [ADR 0110](./0110-vip-cobre-pela-data-da-solicitacao.md)
(decisões 1 e 2): o B/L do Cliente VIP coberto pelos anuais não tem mais
solicitação, e o dia que o anual cobre passa a ser o do pagamento e da entrega.
Estende o caminho sem solicitação da
[ADR 0118](./0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md) ao VIP.

## Contexto

Desde as migrations `161` e `479`, o Cliente VIP só deixava de anexar termo e
procuração: ainda abria a solicitação no Portal, e sem ela o B/L não ia para a
ZPT nem tinha prazo, mesmo com as Taxas Locais pagas e o B/L original entregue
(migration `576`). O dono perguntou se o VIP que entrega o B/L e paga as taxas
ainda precisa pedir e decidiu que não: o pagamento e a entrega bastam para o
desbloqueio. Pediu também que a regra fique clara no Portal para o Cliente com
essa condição.

Como na [ADR 0118](./0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md),
havia duas formas: (a) o Cliente ainda pede, sem anexar nada; (b) não há
solicitação. O dono escolheu (b). Sem solicitação, faltava a data que a
vigência do anual confere (a [ADR 0110](./0110-vip-cobre-pela-data-da-solicitacao.md)
usava o envio) e o aviso "documentação validada", que era da solicitação.

## Decisão

1. **Quem segue sem solicitação.** O B/L de Cliente com a condição VIP cujo
   termo de devolução e procuração anuais aprovados, de ano inteiro, cobrem o
   intervalo da decisão 2. Só um dos anuais cobrindo não basta: o B/L segue o fluxo
   comum, com solicitação e os dois documentos anexados (o pedido é inteiro VIP
   ou inteiro comum, [ADR 0101](./0101-desbloqueio-ce-prazo-e-vigencia-anual.md),
   decisão 5).
2. **Quando o anual cobre.** O intervalo começa no último ato do Cliente que
   deixa o B/L pronto (a entrega do B/L original, a baixa das Taxas Locais ou
   o pagamento da fatura avulsa, no calendário de Brasília; depois da
   exportação, só os fatos até ela; antes de pago e entregue, hoje) e vai até
   a exportação (antes dela, hoje). Basta o termo e a procuração anuais
   estarem vigentes num mesmo dia dentro dele. Exemplos: pago e entregue em
   20/12 com o anual daquele ano e exportado em 02/01, o B/L segue coberto sem
   o anual do ano novo; pago e entregue antes de o Cliente virar VIP, ou antes
   do início da vigência do anual, é coberto quando o anual é aprovado.
   (Decisões do dono de 2026-11-03: primeiro o dia do pagamento e da entrega,
   entre ele e "hoje, até a exportação", na migration `581`; depois o
   intervalo até a exportação, na `582`, para o B/L pago antes da aprovação do
   anual não precisar de solicitação.)
3. **O que basta.** Fica apto com o CE Mercante, as Taxas Locais pagas (com o
   restante do requisito financeiro: avulsa, troca de Cliente) e o B/L
   original entregue. O desk exporta como os demais; a planilha leva as quatro
   colunas "Sim" e o envio fica no próprio B/L, como na
   [ADR 0118](./0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md).
4. **Validação e aviso por B/L** (decisão do dono de 2026-11-03, entre esta e
   nenhum aviso). Na primeira vez que o B/L fica apto, o sistema registra a
   validação e avisa o Cliente no sino do Portal e por e-mail aos contatos de
   Documentação e Operação: "documentação validada", com o B/L, o CE e o prazo.
   Uma vez por B/L e Cliente: desmarcar e marcar de novo não repete. A
   validação acontece na entrega do original e, para a baixa feita fora do
   Desbloqueio, a aprovação do anual ou a habilitação do VIP, na varredura de
   5 minutos.
5. **Prazo.** Começa na validação e parte do último fato: entrega, baixa,
   avulsa, aprovação dos anuais, habilitação do VIP ou a própria validação, até
   a exportação, com a janela de [Prazo (SLA)](../modules/desbloqueio-ce.md#prazo-sla).
6. **Portal.** O B/L coberto não pode ser selecionado; o rascunho e o envio de
   rascunho antigo o recusam com a explicação. A tela diz que o Cliente VIP não
   precisa pedir, mostra em cada B/L o que falta (pagar, entregar) ou a
   documentação validada com o prazo, e tem o cartão "Não precisam de
   solicitação".
7. **Solicitação já enviada.** A solicitação VIP enviada antes da `581`
   continua sendo o caminho do B/L (Aplicar renovação VIP, conclusão e aviso
   dela). Rascunho e solicitação cancelada não seguram o B/L.
8. **Perda da cobertura.** Revogado o VIP ou um anual antes da exportação, o
   B/L volta ao fluxo comum. Depois da exportação, o envio fica e o B/L não
   passa a pedir solicitação.

## Alternativas rejeitadas

- O VIP ainda pede, sem anexar nada: o dono quer que pagar e entregar baste.
- Vigência pelo dia da exportação: o B/L pago e entregue em dezembro e
  exportado em janeiro perderia a cobertura por um ato da agência.
- Vigência só no dia do pagamento e da entrega (migration `581`): o B/L pago
  antes de o Cliente virar VIP, ou antes do início do anual, pediria
  solicitação comum mesmo com os anuais aprovados.
- Sem aviso, como o veículo LCL: o Cliente VIP já recebia o aviso de
  documentação validada e perderia a referência do prazo.

## Consequências

- O Cliente VIP não abre mais solicitação para o B/L coberto. O caminho de
  envio da solicitação VIP fica só para as abertas antes da `581`.
- A fila de e-mails do Desbloqueio aceita aviso sem solicitação
  (`ce_unlock_email_outbox.bl_id`).
- A varredura de 5 minutos passa a ler os B/Ls VIP entregues e ainda não
  validados (ponytail na migration `581`).
- Regra vigente: [Desbloqueio de CE § B/L dispensado de solicitação](../modules/desbloqueio-ce.md#bl-dispensado-de-solicitação-veículo-lcl-isento-e-vip).
