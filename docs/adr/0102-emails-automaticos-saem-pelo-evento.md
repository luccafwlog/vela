# 0102 — E-mails automáticos saem pelo evento, com o cron como rede de segurança

Status: aceito — 2026-10-24 (pedido do responsável); revista em 2026-10-25 com
as decisões do dono na revisão da PR (itens 2, 4, 7 e 8). Implementada nas
migrations `456` e `457` e nas Edge Functions `ce-unlock-notify-email`,
`customer-communication-auto-runner` e `portal-email-events-runner`.

Estende a [ADR 0063](./0063-configuracao-de-jobs-cron-no-vault.md) e o item 5 da
[ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (exceção ao
cofre): mais três rotinas leem o segredo do Vault a partir da transação de
quem usa a tela.

## Contexto

O provedor de e-mail entrega em cerca de 5 s. A demora dos e-mails automáticos
vinha de esperar o próximo ciclo do `pg_cron` (produção, 2026-10-24):

| E-mail | Mecanismo | Job | Atraso |
|---|---|---|---|
| Recusa de documento e documentação validada do Desbloqueio de CE | fila `ce_unlock_email_outbox` → `ce-unlock-notify-email` | `*/5` (agendado à mão) | até 5 min |
| CE e Taxas e NOA/NOR/NOB | alvos calculados → `customer-communication-auto-runner` → `send-customer-communication` | `4-59/15` | até 15 min |
| Cobrança de Demurrage | `demurrage-dunning` | `7 * * * *` | até 60 min, dentro da janela de dia útil |
| Entrega e devolução (status do envio) | webhook grava em `portal_email_events` → `portal-email-events-runner` | `* * * * *` | até 60 s |

O padrão de disparar a Edge Function pela transação já existia para os efeitos
de importação (migration `218`) e para a fila do Itaú (migration `219`), cada
um com uma função própria. Desde a auditoria run-3 (migration `438`), cada
rotina usa o próprio segredo.

## Decisão

1. **Disparo pelo evento.** Um gatilho no evento que cria trabalho chama
   `ops.kick_edge_job(função, segredo, cabeçalho, prefixo, intervalo)`, que
   chama a Edge Function pelo `ops.dispatch_edge_job` com
   `{"source":"trigger"}`, o segredo dedicado da rotina (nunca o compartilhado
   de transição), uma vez por transação e no máximo uma vez por intervalo
   (`ops.edge_job_kicks`). O `pg_net` só envia depois do COMMIT. Sem o par no
   Vault, não dispara; falha no disparo vira `WARNING` e nunca desfaz a gravação.
2. **Intervalos.** Sem intervalo para os avisos do Desbloqueio de CE e para os
   eventos do provedor (trabalho pequeno, com claim). Comunicados automáticos:
   90 s, de propósito, porque o Comunicado sai uma vez por Cliente e Viagem e os
   efeitos de uma importação não devem virar uma rodada por transação. A Régua
   de Cobrança não tem chamada pelo evento (item 7).
3. **Cron como rede de segurança.** Os jobs continuam, para reenvios, disparos
   perdidos e o que vence pelo relógio (o NOA, cinco dias antes do ETA): avisos
   do Desbloqueio de CE a cada 5 min e eventos a cada minuto, como estavam;
   Comunicados a cada 2 min e Régua a cada 5 min. A janela de dia útil, a régua
   de dias entre cobranças e os recuos depois de recusa ou bounce não mudam.
4. **Sucesso do heartbeat só do cron; falha nos dois modos.** A chamada com
   `{"source":"trigger"}` roda a mesma rodada e manda ao Better Stack só a falha
   (`/fail`). O sucesso dela é extra e esconderia um cron parado; a falha da
   primeira tentativa, que quase sempre é da chamada pelo evento, aparece na hora.
   Na versão de 2026-10-24 a chamada pelo evento não mandava nada, e a falha só
   aparecia quando a nova tentativa do cron falhava de novo (nos Comunicados, 15
   minutos depois da recusa, ou 24 horas na recusa definitiva).
5. **Reserva da fila do Desbloqueio de CE.** Com gatilho e cron juntos, a
   leitura da fila reserva as linhas (`FOR UPDATE SKIP LOCKED` e
   `claimed_until`). As chaves de idempotência por destinatário continuam.
6. **Custo antes do intervalo.** O cron dos Comunicados só desceu para 2 min
   depois de medida a produtora dos alvos, e corrigido o plano que a fazia
   crescer com B/L × Escala (75 s com 3 mil pares Cliente × Viagem; ~1,5 s depois).
7. **Régua de Cobrança só pelo cron (revisão de 2026-10-25).** A versão de
   2026-10-24 chamava a Régua na emissão da Invoice (intervalo de 60 s, só dentro
   da janela). A emissão vem quase sempre da fila de efeitos de importação
   (`demurrage_billing`), que emite as Invoices de uma planilha de devoluções uma
   a uma, cada uma na sua transação. A chamada na primeira cobrava só as já
   gravadas, e o resto saía na rodada seguinte: o lote do mesmo Cliente em dois
   e-mails, divididos ao acaso. A migration `457` tira a chamada; com o job de 5
   minutos, o lote sai junto, em até 5 minutos.
8. **Passos do dono, fora do repositório.** Os monitores do Better Stack da Régua
   e dos Comunicados passam a 5 e 2 minutos, com tolerância de 5 minutos,
   ajustados no painel só depois da promoção das migrations `456` e `457` para a
   produção (antes, acusariam queda falsa). A medição dos tempos de ponta a ponta
   fica para um trabalho à parte; o roteiro está em
   [Segredos dos jobs](../operations/segredos-cron.md#disparo-pelo-evento).

## Consequências

- O aviso do Desbloqueio de CE e o status de entrega saem em segundos; CE e
  Taxas e NOA/NOR/NOB em até ~2 min depois do evento; a primeira cobrança em até
  5 min depois da emissão, se dentro da janela (antes, até 1 h).
- Invoices de Demurrage do mesmo Cliente emitidas no mesmo intervalo de 5
  minutos vão juntas, como o lote de uma importação de devoluções; as emitidas
  em intervalos diferentes saem separadas (antes, as da mesma hora iam juntas).
- O evento de entrega que chega antes do id do provedor estar gravado volta em
  1 minuto (`attempt_unresolved`), como já acontecia.
- A chamada com o segredo passa pela fila do `pg_net` também a cada um desses
  eventos, com a mesma exposição aceita na ADR 0083, item 5.
- Sem o Vault provisionado (Preview e staging hoje), nada dispara; o
  comportamento observável fica igual ao do cron.

## Alternativas rejeitadas

- **Processar o evento dentro do `portal-email-webhook`
  (`EdgeRuntime.waitUntil`).** Exigiria a claim dos eventos dentro do webhook,
  um segundo caminho de processamento, e daria ao webhook as dependências da
  cascata de bounce. O gatilho chama o mesmo runner, com a mesma claim e o
  segredo dele.
- **Só baixar todos os crons para 1 minuto.** A produtora dos Comunicados roda
  inteira a cada chamada, e o aviso ainda esperaria até 60 s.
- **Esperar o fim de uma sequência de eventos antes de disparar.** O `pg_net`
  não agenda para depois; exigiria uma tabela de pedidos consumida pelo job de
  minuto. Fica como caminho de upgrade se a medição mostrar espera.
- **Enviar os destinatários de um mesmo alvo em paralelo.** Eles dividem o
  Comunicado, cujo status é gravado em dois passos; o paralelismo ficou entre
  Clientes.
- **Chamar a Régua na emissão da Invoice** (versão de 2026-10-24, migration
  `456`): dividia ao acaso o lote de uma importação (item 7).
- **Agrupar a Régua com espera** (mandar depois de alguns minutos sem nova
  emissão do mesmo Cliente): agrupa também cliques espaçados, mas muda a regra
  de que a primeira cobrança vence na emissão e exige uma tabela de pedidos; o
  job de 5 minutos já junta o lote de uma importação.
- **Nada ao Better Stack na chamada pelo evento** (versão de 2026-10-24):
  escondia a falha da primeira tentativa (item 4).
