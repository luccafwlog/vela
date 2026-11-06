# 0125 — THD por tonelada da carga solta de Vitória com mínimo de R$ 380 por B/L

Status: aceito — 2026-11-05 (decisão do dono). Implementada na migration `594`.

> **Situação atual (2026-11-05).** Pedido do dono depois da `594`: o item da fatura cobrado pelo mínimo mostra **Valor mínimo aplicado** no detalhe da fatura do Vela, no Portal e no documento impresso. A emissão marca `minimum_value` no `snapshot_payload` do item (gatilho `mark_minimum_invoice_item`, com `_invoice_item_minimum_value_brl` reconhecendo a linha calculada sem taxa alterada à mão cujo total é o mínimo), e a migration `602` marcou os itens já emitidos com o mínimo. Isso substitui a primeira consequência abaixo: o total continua não sendo quantidade × unitário, mas a linha agora explica.

## Contexto

A tabela de Taxas Locais de carga solta de Vitória (BRVIX) cobra o THD por
tonelada (R$ 62,50/t em "Vitoria Carga Solta 2026"). O motor multiplicava o
peso da carga solta pelo valor unitário, sem piso: o B/L de 2 t pagava
R$ 125,00. Em 2026-11-05 o dono decidiu, com urgência, que o THD dessa tabela
não fica abaixo de R$ 380,00 por B/L; dois B/Ls em produção já tinham fatura
emitida com o valor menor.

Perguntado, o dono escolheu:

- a regra fixa no motor de cálculo, sem campo novo no cadastro do item (mais
  rápido; mudar o valor pede nova migration);
- o mínimo vale também quando o Cliente tem Condição do Cliente no THD;
- só os cálculos a partir da publicação: nenhuma linha existente é reescrita;
  o B/L já calculado muda no próximo recálculo.

## Decisão

1. **Escopo.** Item cujo nome começa com "THD", em R$, com base "por tonelada"
   (`weight_ton`), de tabela de carga solta cujo porto, pela régua do sistema
   (`normalize_port_code`), é BRVIX. Vale no B/L de carga solta e na parte de
   carga solta do B/L misto. Outros itens por tonelada, THD em US$ e tabelas
   de outros portos não mudam.
2. **Valor.** O total da linha é o maior entre toneladas × valor unitário (da
   tabela, do preço fixado ou da Condição do Cliente) e R$ 380,00. Exemplo:
   2 t × R$ 62,50 = R$ 125,00 → R$ 380,00; 10 t × R$ 62,50 = R$ 625,00.
3. **Linha.** Quantidade e unitário continuam os da tabela; só o total sobe.
   A chave da linha continua `auto:item:<id>`, e a taxa alterada à mão
   ([0111](./0111-alterar-excluir-e-isentar-taxas-locais-do-bl.md)) vale sobre ela
   como sobre qualquer outra: o valor alterado substitui o mínimo.
4. **Dono.** `_thd_weight_ton_minimum_brl(cargo_mode, pod_key)` guarda o valor
   e o escopo; `_resolve_bl_local_charge_items_table` aplica. Todo leitor do
   cálculo (cálculo do B/L, cotação da correção da fatura, COD, Desbloqueio de
   CE) passa por ali.

## Consequências

- A fatura e a Conferência mostram "2 t × R$ 62,50 = R$ 380,00": o total não é
  o produto. A nota "THD com valor mínimo de R$ 380,00 por B/L" sai do motor,
  mas, como a do THD IMO e OOG, não é gravada na linha calculada.
- Fatura emitida não muda. Para corrigir a fatura emitida antes da `594`, sem
  pagamento: **Cancelar fatura**, **Recalcular** o B/L e então **Emitir**.
  Cancelar e emitir sem recalcular reemite o cálculo gravado, com o valor
  antigo (comprovado no Postgres local em 2026-11-05).
- O preço fixado no CE ([0093](./0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md))
  guarda o unitário, não o mínimo: o B/L com CE recalculado depois da `594`
  passa a ter o mínimo.
- ponytail: valor e porto fixos em função. Mudar o valor ou estender a outro
  porto pede nova migration. O caminho de evolução é um campo "valor mínimo
  por B/L" no item da tabela, com o congelamento no preço do CE.
