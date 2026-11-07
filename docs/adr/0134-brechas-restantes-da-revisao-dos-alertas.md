# 0134 — Brechas restantes da revisão dos alertas

Status: aceito — 2026-11-07 (decisões do dono, uma a uma). Implementação no
[plano](../archive/plans/2026-11-07-brechas-restantes-da-revisao-dos-alertas.md).

## Contexto

A [ADR 0133](./0133-decisoes-da-revisao-dos-alertas.md) tratou oito decisões da
[revisão de cobertura dos alertas](../archive/audits/2026-11-06-cobertura-dos-alertas-no-fluxo-de-trabalho.md).
Ficaram duas pendências da implementação e dez brechas sem decisão. O dono
decidiu cada uma em 2026-11-07, antes da PR para `staging`.

## Decisão

1. **Prazo do desbloqueio sem limite de idade.** O alerta **Prazo do
   desbloqueio vencendo** abre para todo B/L com prazo e sem desbloqueio
   conferido pela ZPT, sem o corte de 30 dias da migration `621`.
2. **E-mail ADR fechado:** continua indo a todos os usuários internos ativos.
3. **B03 — Divergente na ZPT.** Alerta Crítico na hora da conciliação, para a
   Documentação e o Administrativo, com o motivo da ZPT. Fecha quando uma
   conciliação seguinte traz o B/L desbloqueado no CE atual.
4. **B04 — Anual do VIP.** Aviso no sino à Documentação e ao Administrativo
   quando o Cliente envia o documento anual. Sem alerta de vencimento.
5. **B06 — Devolução não registrada.** Fica como está.
6. **B07 — Fatura cancelada à mão.** Alerta Normal 1 dia útil depois do
   cancelamento sem nova emissão: na fatura de Taxas Locais, à Documentação; na
   Invoice de Demurrage, a Equipamentos. Fecha na nova emissão ou no
   cancelamento do B/L.
7. **B13 — B/L pronto depois do CE e Taxas.** Abre o alerta **Reenviar
   Comunicado de CE e Taxas** quando um B/L do Cliente fica pronto depois do
   envio. A pessoa decide o reenvio.
8. **B14 — Rotina interna sem rodar.** Alerta Crítico ao Administrativo quando
   uma rotina do agendador falha ou não roda no horário, e um sinal externo ao
   Better Stack para o caso de o próprio vigia parar.
9. **B15 — Liberação de faturamento vencendo.** Alerta Normal ao
   Administrativo 2 dias úteis antes do vencimento, se o Cliente ainda não tem
   o Portal pronto.
10. **B17, B/L faltando em container já coberto.** Fica como está.
11. **B18 — Trava de veículos.** O CE de container nasce travado e só destrava
    com "não terá veículos" ou com a planilha de Veículos: a trava vale também
    na Viagem concluída (a cancelada fica fora). A recusa pela trava abre na
    hora a **Declaração de veículos pendente** para Equipamentos, mesmo antes do
    D−7.
12. **B25 e B26** (escala sem terminal nas escalas seguintes; programação que
    muda depois do NOA): ficam como estão.

## Consequências

- O primeiro dia em produção abre o alerta do prazo para os B/Ls antigos
  nunca conciliados (decisão 1).
- A 11 estende a [ADR 0128](./0128-ce-mercante-travado-ate-resposta-de-veiculos.md),
  que deixava a Viagem concluída fora da trava.
