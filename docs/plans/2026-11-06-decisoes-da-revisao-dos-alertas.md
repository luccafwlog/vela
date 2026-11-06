# Decisões da revisão dos alertas — plano de implementação

Plano vivo. Executa as decisões do dono de 2026-11-06 sobre a
[revisão de cobertura dos alertas](../archive/audits/2026-11-06-cobertura-dos-alertas-no-fluxo-de-trabalho.md),
registradas na [ADR 0131](../adr/0131-decisoes-da-revisao-dos-alertas.md). Cada
lote é uma entrega própria, com migration, testes e documentação viva na mesma
mudança. Ao terminar o último lote, este plano vai para
`docs/archive/plans/`.

## Lotes

| Lote | Decisão | Entrega | Brechas | Situação |
|---|---|---|---|---|
| 1 | D8 | Reforço por tempo: o item de alerta pode ficar Crítico acima da gravidade do tipo e reavisa o sino; "vira Crítico depois de N horas aberto" configurável na tela **Regras de alertas** pelo Administrativo | B23, B24 | feito: migration `604`, `reforcoPorTempoDosAlertas.local-pg.test.ts` |
| 2 | D7, D5, D1 | Roteamento: PTAX a Equipamentos; feriados ao Administrativo com a marca Dev; Tabela de cobrança faltando, Cálculo bloqueado e Portal não provisionado avisam Documentação e Administrativo; Exportação pendente pós-ATD a Equipamentos; aviso de nova solicitação de desbloqueio também ao Administrativo | B19, B20, B21, B22 | feito: migration `605` |
| 3 | D3 | ATA e ATD viram Críticos 16 horas depois do ETA e do ETD (o mesmo alerta, com novo aviso) | B08 | a fazer |
| 4 | D2 | Alerta de descarga ausente por atracação: Normal no ATB, Crítico 24 horas depois, a Equipamentos | B05 | a fazer |
| 5 | D1 | Desbloqueio de CE: solicitação sem análise em 2 horas úteis (8h–17h) abre Crítico; prazo correndo abre Normal 2 horas depois do início e vira Crítico 2 horas antes do vencimento; Documentação e Administrativo | B01, B02 | a fazer |
| 6 | D5 | ADR de Saída recusa **Nada a declarar** e **Fechar ADR** com a exportação declarada e não lançada | B10 | a fazer |
| 7 | D4 | CE Mercante do B/L de container travado sem Baplie conciliado (salvo declaração "Viagem sem Baplie", com motivo), além da trava dos veículos; a prévia mostra as divergências da rota e pede confirmação | B16, B17 | a fazer |
| 8 | D6 | ADR fecha sozinho com as três assinaturas e manda e-mail com resumo e link a todos os usuários internos ativos | B09 | a fazer |

## Regras comuns

- Gravidade que muda com o tempo (lotes 1, 3, 4 e 5) usa a mesma peça do lote
  1: o item guarda a gravidade e o marco no próprio alerta, a troca para
  Crítico abre ocorrência nova e reavisa o sino, e a troca de gravidade do tipo
  pela tela (ADR 0130) não rebaixa item escalado.
- Prazo em horas úteis (lote 5) segue o calendário do Vela (`business_holidays`)
  e a janela das 8h às 17h de Brasília.
- Cada lote atualiza o catálogo da tela (`alertRulesCatalog.ts`), o capítulo 20
  do Manual do Operador e a matriz de cobertura.
