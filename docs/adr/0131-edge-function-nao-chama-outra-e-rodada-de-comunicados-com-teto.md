# 0131 — Edge Function não chama outra Edge Function; a rodada de Comunicados tem teto

Status: aceito — 2026-11-07 (pedido do dono, depois do incidente do NOA da
GREEN GUANGZHOU / 6). Implementada em `_shared/customerCommunicationDispatch.ts`
e na Edge Function `customer-communication-auto-runner`.

## Contexto

Em 2026-11-07, às 12:00 de Brasília, abriu a janela do NOA da GREEN GUANGZHOU / 6
em BRVIX para 35 Clientes de uma vez: o maior lote automático desde a entrada em
produção (até então, no máximo 4 e-mails num minuto). A régua automática fazia
um POST à Edge Function `send-customer-communication` por destinatário. A
Supabase recusou da 31ª chamada em diante com `RateLimitError: Rate limit
exceeded for trace … Retry after ~50s`, nas rodadas de 12:01 e de 12:17: 30
envios passaram em cada uma, e o resto ficou para a nova tentativa (15 min,
depois 1 h). O heartbeat `customer-communication-auto-runner` abriu dois
incidentes no Better Stack, e o alerta "Comunicado NOA pendente" listou os 19
Clientes sem envio completo. Ninguém recebeu e-mail em dobro.

O limite é da plataforma e vale para chamadas de uma Edge Function a outra do
mesmo projeto, por execução. A documentação da Supabase promete "ao menos 5.000
por minuto", sem configuração por plano; aumentar exige chamado ao suporte. O
corte observado foi em 30 chamadas por execução, nas duas rodadas, cada uma com
o seu trace. A própria Supabase recomenda importar o código compartilhado em
vez de chamar outra função.

## Decisão

1. **Nenhuma Edge Function chama outra por HTTP.** O código comum fica em
   `supabase/functions/_shared/` e cada função o importa. O teste
   `customerCommunicationAutoRunner.test.ts` falha se a régua voltar a chamar
   `/functions/v1/`.
2. **O envio de Comunicado tem um dono só.** `dispatchCustomerCommunication`
   (`_shared/customerCommunicationDispatch.ts`) valida, registra, grava a
   tentativa e chama o provedor. A Edge `send-customer-communication` só
   autentica quem envia pela tela e chama esse módulo; a régua o chama no mesmo
   processo, com a origem `automatico`. As regras de envio não mudaram.
3. **A rodada da régua tem teto: 50 destinatários ou 15 s.** Passado o teto, a
   rodada não começa outro envio. A Edge tem 2 s de CPU por execução e o
   `pg_net` desiste da chamada em 30 s (migration `165`); com o envio no mesmo
   processo, a CPU de cada envio conta para a rodada. O resto sai na rodada
   seguinte, 2 minutos depois: até 1.500 destinatários por hora.
4. **O que a rodada não chegou a enviar não é falha.** Passado o teto, ou com
   uma recusa da própria Supabase (`RateLimitError`), a claim é liberada
   (`release_customer_communication_automation_claim`) e volta na rodada
   seguinte, sem o intervalo de nova tentativa e sem contar falha do provedor.
   O heartbeat não fica vermelho por isso; a resposta da rodada traz
   `nextRound` e `paused` (`teto_da_rodada` ou `limite_da_plataforma`). Falha de
   verdade no mesmo alvo mantém o intervalo de 15 min, 1 h e 6 h.

## Consequências

- Um lote como o de 2026-11-07 (cerca de 67 destinatários) sai em duas rodadas
  seguidas, em vez de esperar 15 min e 1 h, e não abre incidente.
- Os 5xx e as exceções do envio automático continuam no Sentry com o nome
  `send-customer-communication`, agora reportados pela régua.
- A Edge `send-customer-communication` mantém o caminho do segredo da automação
  só para a transição do deploy e para voltar a versão anterior da régua;
  nenhuma rotina o usa.
- O teto é fixo, sem medir a CPU (`ponytail:` em
  `_shared/customerCommunicationAutoRunner.ts`). Caminho de melhoria: medir a
  CPU da rodada e subir o teto, ou levar o envio para uma fila (Supabase
  Queues).

## Alternativas consideradas

- **Pedir à Supabase um limite maior.** Depende do suporte, sem prazo nem
  garantia, e deixa o envio preso a um número que já veio diferente do
  documentado. Fica como pedido paralelo, não como correção.
- **Esperar o `retryAfterMs` dentro da rodada.** Cada espera é de quase um
  minuto; com o `pg_net` desistindo em 30 s, a rodada cairia no meio.
