# 0026 — Validação por item na RPC de emissão de Demurrage (autoridade de veto)

> **Situação atual (2026-10-13).** A autoridade de cálculo desta decisão foi supersedida pela [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md): o banco calcula a Invoice de Demurrage (datas, tarifas, acordo e overrides) em `issue_demurrage_invoice_for_bl` e grava foto append-only;
> o navegador não envia itens nem total, e `calculateDemurrage` serve só à previsão na tela. Resta daqui a validação por item em `create_demurrage_invoice_with_items`, hoje restrita ao `service_role` e sem chamador.
> A migration `204` citada abaixo é da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente: [Demurrage](../modules/demurrage.md), emissão da Invoice de Demurrage.

Status: supersedida parcialmente — 2026-07-17

## Contexto

A fórmula de Demurrage (free time, faixas P1/P2) roda no cliente em
`calculateDemurrage` (`src/services/demurrage/demurrageRates.ts`). A RPC
`create_demurrage_invoice_with_items` persistia os itens enviados conferindo
apenas a soma dos subtotais contra `p_total_usd` — o banco confiava na
aritmética do navegador para um documento financeiro.

Foram consideradas três opções: (a) mover o cálculo inteiro para SQL (simetria
com `calculate_bl_local_charges`, ADR 0020); (b) manter o cliente como única
autoridade; (c) validação de autoconsistência por item no banco, com veto.

## Decisão

Adotar (c): a RPC valida, por item, a aritmética do subtotal
(`days_p1*rate_p1 + days_p2*rate_p2`), o `total_days` derivado das datas de
descarga e devolução, contadores e taxas não-negativos e
`days_p1 + days_p2 <= GREATEST(total_days - free_days, 0)` (desigualdade, pois
um gap configurado entre faixas reduz dias cobrados). Migration
`204_demurrage_invoice_item_consistency.sql`.

A RPC **não** re-resolve tarifas contra `demurrage_rates`: o cliente usa cache
com TTL de 5 minutos e a re-resolução tornaria a emissão não-determinística
(falso positivo logo após edição de tarifa). Como a RPC é restrita a
Administrativo, o modelo de ameaça é bug/drift do cálculo TS, não payload
hostil — e isso os invariantes cobrem. A paridade TS×SQL é garantida por
`demurrageInvoiceItemConsistency.test.ts`.

A opção (a) permanece como evolução possível se o cálculo ganhar um segundo
consumidor fora do frontend (ex.: emissão em lote server-side).

## Consequências

- `calculateDemurrage` continua a única implementação da fórmula; o banco vira
  autoridade de veto sobre resultados inconsistentes.
- Payloads legítimos do frontend atual continuam aceitos (mesma assinatura).
- Alterar a fórmula TS exige revisitar os invariantes da migration 204 e o
  teste de paridade.
