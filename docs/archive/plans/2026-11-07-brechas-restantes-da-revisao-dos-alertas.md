# Brechas restantes da revisão dos alertas — plano de implementação

Plano executado em 2026-11-07 (arquivado). Executou as decisões do dono de 2026-11-07 registradas na
[ADR 0132](../../adr/0132-brechas-restantes-da-revisao-dos-alertas.md). Cada lote
levou migration, testes e documentação viva na mesma mudança. Pendente fora do
repositório: cadastrar o heartbeat das rotinas internas no Better Stack e a URL no
cofre ([segredos-cron.md](../../operations/segredos-cron.md#ligar-o-sinal-das-rotinas-internas)).

## Lotes

| Lote | Decisão | Entrega | Situação |
|---|---|---|---|
| A | 1, 3 | Prazo do desbloqueio sem limite de idade; alerta Crítico **B/L divergente na ZPT** | feito: migration `613`, `alertasDoDesbloqueioDeCe.local-pg.test.ts` |
| B | 4 | Sino do documento anual do VIP enviado | feito: migration `614`, `sinoAvisosDeAcontecimento.local-pg.test.ts` |
| C | 6 | Alertas da fatura e da Invoice de Demurrage canceladas sem nova emissão | feito: migration `615`, `faturaCanceladaSemReemissao.local-pg.test.ts` |
| D | 7 | Reenviar Comunicado de CE e Taxas quando um B/L fica pronto depois do envio | feito: migration `616`, `reenvioCeTaxasBlTardio.local-pg.test.ts` |
| E | 9 | Liberação de faturamento vencendo | feito: migration `617`, `liberacaoVencendo.local-pg.test.ts` |
| F | 11 | Trava de veículos na Viagem concluída; recusa abre a Declaração de veículos pendente | feito: migration `618`, `travaCeMercanteVeiculos.local-pg.test.ts` |
| G | 8 | Rotina interna sem rodar e sinal externo | feito: migration `619`, `rotinaInternaSemRodar.local-pg.test.ts`; cadastrar o heartbeat e a URL no cofre em produção |
