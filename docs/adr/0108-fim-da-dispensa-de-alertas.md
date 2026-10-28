# 0108 — Fim da dispensa de alertas

Status: aceito — 2026-10-27 (decisão do dono, ponto 3 de
[Pontos do dono](../manual/decisoes/pontos-do-dono.md); lote 8 do
[plano de correções](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `476`; o prazo de 24 horas e a outra causa da
rotina (item 3) vêm da `485`.

Supersede parcialmente a [ADR 0053](./0053-ciclo-de-vida-alerta-dispensa-temporaria.md)
(dispensa temporária) e a [ADR 0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md)
(Eco de Tratamento da dispensa). Estende o item 23 da
[ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (Resolver com
justificativa).

## Contexto

A ADR 0053 deu à fila de Alertas uma ação manual: dispensar o item por até 30
dias, com motivo e data de revisão. O time concordou que dispensar não é útil
e pode ser prejudicial: tira da vista uma pendência que continua existindo.

Alguns alertas, porém, têm origem que a equipe não corrige pela tela (a
consulta de Pix do Itaú, o retorno do provedor de e-mail, as rotinas por
horário, a fila de efeitos de importação). Sem dispensa, eles ficariam abertos
sem saída enquanto a causa externa continua.

## Decisão

1. A dispensa sai do sistema: `dismiss_alert_item` é removida; somem o botão e
   a janela Dispensar, o cartão e a lente Dispensados, a coluna "Dispensado
   até", o Eco de Tratamento da dispensa e o "N dispensados" do Painel. A fila,
   a contagem e o resumo por setor deixam de olhar a dispensa; o filtro
   `dismissed` deixa de existir.
2. As dispensas vigentes acabaram na hora. O histórico
   (`alert_item_dismissals`) fica guardado.
3. Os tipos de origem externa — Consulta de Pix do Itaú parada
   (`itau_pix_consulta_parada`), Provedor de e-mail sem retorno
   (`email_retorno_provedor_silencioso`), Rotina agendada com resposta de erro
   (`rotina_http_falhou`) e Fila de efeitos de importação parada
   (`import_effects_queue_stalled`) — ganham **Resolver com justificativa**.
   Resolvido assim, o alerta não reabre pela mesma causa por **24 horas**
   (decisão do dono de 2026-10-27, revisão da PR #1070); reabre antes quando a
   causa some (a varredura registra o fim pela origem) e volta, e, depois das
   24 horas, se a causa ainda estiver lá. Na Rotina agendada com resposta de
   erro, que junta todas as rotinas num registro só, um tipo de falha que não
   estava na justificativa (outro código HTTP, tempo esgotado, fila parada)
   reabre na hora (`_alert_cause_within_justified`, migration `485`).
4. A resolução com justificativa grava também uma linha no Histórico de ações
   (assunto Alerta), com autor e justificativa.

## Consequências

- As ações manuais da fila são só "Resolver com justificativa", nos tipos
  listados na regra de [Operação e Suporte](../modules/operacao-suporte.md#alertas-e-notificações-internas).
- As fichas ALE-D07 (motivo curto na dispensa) e a parte de dispensa da
  ALE-D18 deixam de valer.
- A frase de dispensa saiu das regras de Regras de alertas.
