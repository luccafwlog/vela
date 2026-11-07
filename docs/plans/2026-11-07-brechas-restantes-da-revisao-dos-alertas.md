# Brechas restantes da revisão dos alertas — plano de implementação

Plano vivo. Executa as decisões do dono de 2026-11-07 registradas na
[ADR 0132](../adr/0132-brechas-restantes-da-revisao-dos-alertas.md). Cada lote
leva migration, testes e documentação viva na mesma mudança. Ao terminar o
último lote, este plano vai para `docs/archive/plans/`.

## Lotes

| Lote | Decisão | Entrega | Situação |
|---|---|---|---|
| A | 1, 3 | Prazo do desbloqueio sem limite de idade; alerta Crítico **B/L divergente na ZPT** | feito: migration `613`, `alertasDoDesbloqueioDeCe.local-pg.test.ts` |
| B | 4 | Sino do documento anual do VIP enviado | feito: migration `614`, `sinoAvisosDeAcontecimento.local-pg.test.ts` |
| C | 6 | Alertas da fatura e da Invoice de Demurrage canceladas sem nova emissão | a fazer |
| D | 7 | Reenviar Comunicado de CE e Taxas quando um B/L fica pronto depois do envio | a fazer |
| E | 9 | Liberação de faturamento vencendo | a fazer |
| F | 11 | Trava de veículos na Viagem concluída; recusa abre a Declaração de veículos pendente | a fazer |
| G | 8 | Rotina interna sem rodar e sinal externo | a fazer |
