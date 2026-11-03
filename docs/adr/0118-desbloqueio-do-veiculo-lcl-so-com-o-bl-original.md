# 0118 — Desbloqueio de CE do veículo LCL isento só com o B/L original

Status: aceito — 2026-11-03 (decisão do dono, depois da abertura do Vela e do
Portal a clientes reais). Implementada na migration `575`.

## Contexto

O B/L com veículo cujo Movement To indica LCL (contém `LCL` ou `CFS`), em B/L de
modalidade container, já tem as Taxas Locais isentas
([Taxas Locais § Movimento e Isenção](../modules/taxas-locais.md#movimento-e-isenção-de-taxas-locais)).
Pela [0087](./0087-desbloqueio-ce-aceite-operacional.md), item 2, esse B/L
ficava sem o requisito de pagamento, mas ainda precisava de solicitação no
Portal, com termo de devolução e procuração aprovados. O dono informou que,
na operação, esses casos não pedem termo nem procuração: basta o B/L original
entregue na agência (BL de Entrega).

Foram oferecidas duas formas: (a) o Cliente ainda pede no Portal, sem anexar
nada; (b) não há solicitação, e a entrega registrada pelo desk deixa o B/L
apto. O dono escolheu (b). Também escolheu que só a isenção pelo veículo LCL
dispensa os documentos; a isenção à mão (**Isentar Taxas Locais**,
[0111](./0111-alterar-excluir-e-isentar-taxas-locais-do-bl.md), D12) continua
dispensando só o pagamento.

## Decisão

1. **Quem é dispensado.** B/L com Taxas Locais isentas (`charge_status =
   'exempt'`), modalidade container, com veículo e Movement To LCL ou CFS,
   lido dos dados atuais do B/L. A isenção à mão de outro B/L não entra.
2. **O que basta.** Termo de devolução e procuração ficam dispensados e o B/L
   não precisa de solicitação. Fica apto com o CE Mercante, o B/L original
   entregue e nada em aberto que o requisito financeiro cobre (fatura avulsa,
   troca de Cliente).
3. **Envio à ZPT.** O desk exporta o B/L como os demais, em
   **Exportar N aptos para a ZPT**; a planilha leva as quatro colunas "Sim".
   O envio fica guardado no próprio B/L com o CE enviado: CE trocado volta a
   "Não exportado". A conciliação com a ZPT conta esse envio.
4. **Prazo.** Começa na entrega do B/L original (ou no pagamento da avulsa, se
   veio depois) e corre até a exportação, com a mesma regra de
   [Prazo (SLA)](../modules/desbloqueio-ce.md#prazo-sla).
5. **Portal.** O B/L não pode ser selecionado para solicitação; a coluna
   Solicitação diz "Não precisa · entregue o B/L original", e o bloco do que o
   desbloqueio pede explica a regra quando o Cliente tem um B/L assim. O
   servidor recusa o rascunho com a mesma explicação.
6. **Solicitação já enviada.** O B/L que já estava em solicitação enviada
   continua nela, com termo e procuração dados como atendidos para ele;
   rascunho e solicitação cancelada não seguram o B/L.

## Consequências

- Supersede parcialmente a [0087](./0087-desbloqueio-ce-aceite-operacional.md),
  item 2, para o veículo LCL isento. O restante da 0087 continua valendo.
- A regra de quem é dispensado repete a condição da isenção no cálculo das
  Taxas Locais (`ce_unlock_private.documents_dispensed`). Mudar a isenção do
  veículo exige mudar as duas.
- O Vela mostra termo e procuração como "dispensado (veículo LCL isento)" e a
  Solicitação como "Dispensada · veículo LCL" no Andamento dos B/Ls e na
  planilha comum.
