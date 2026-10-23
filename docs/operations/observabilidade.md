# Runbook de observabilidade — Issue #710 (M2/M3)

Este runbook registra o contrato repository-side para Better Stack e Sentry.
Ele não cria contas, monitores, chaves, DNS, status page ou alertas.

## Estado verificável no repositório

- `src/main.tsx` inicializa a aplicação interna com `initTelemetry('internal')`;
- `src/portal-main.tsx` inicializa o Portal com `initTelemetry('portal')`;
- `src/lib/telemetryContract.ts` centraliza sanitização compartilhada de texto,
  valores aninhados e URLs, usada pelo browser e pelas Edge Functions;
- `src/lib/telemetry.ts` captura erros de browser em builds de produção,
  remove query strings e redige CNPJ, CPF e e-mail;
- catorze Edge Functions têm wrapper repository-side (`instrumentEdgeHandler`) que reporta exceções não
  tratadas e respostas HTTP 5xx apenas se `SENTRY_DSN` estiver configurado;
  erros brutos, corpo/resposta HTTP, usuário e headers não são enviados;
- o helper Edge carrega o SDK Sentry sob demanda e fica em no-op sem `SENTRY_DSN`;
- os projetos Pages `vela-internal` e `vela-portal` publicam, respectivamente,
  `index.html` em `https://vela.app.br` e `portal.html` em
  `https://portalfwlog.com.br`;
- heartbeats repository-side para Edge Functions agendadas foram implementados via
  `supabase/functions/_shared/betterStackHeartbeat.ts` nos runners `alerts-detector`,
  `portal-daily-digest`, `demurrage-dunning`, `customer-communication-auto-runner`,
  `ce-unlock-notify-email` e `portal-email-events-runner`.
  Com a URL do heartbeat nos secrets do Supabase, cada rodada autorizada envia um
  ping: o de sucesso com resposta 2xx sem falha contada, e o de falha (`/fail`) com
  resposta fora de 2xx, com exceção ou com `failed`, `partial` ou `releaseFailures`
  maior que zero (`hasOperationalFailures`, `_shared/betterStackHeartbeat.ts`). Sem
  o secret, operam em no-op sem falhar o job; o `customer-communication-auto-runner`
  conta em `failed` todo destinatário recusado ou com falha na rodada; o
  `portal-daily-digest` conta em `failed` cada destinatário que não recebeu e responde
  500 quando uma consulta falha (endereço suprimido, inclusive o 422
  `all_recipients_suppressed` do provedor, conta em `suppressed`, e a conta de
  integração não recebe o resumo; migration `440`); o `ce-unlock-notify-email` conta em `failed` cada aviso
  que esgotou as tentativas; o `portal-email-events-runner` conta em `failed` cada evento
  que falhou e foi devolvido para nova tentativa; o `alerts-detector` conta em `failed` cada
  detector que falhou numa rodada parcial (migration `351`). Heartbeats diretos de triggers `pg_cron` no Postgres continuam opcionais.

Esta seção combina inspeção estática com verificações de runtime registradas no
plano de migração. O DSN de produção e os alertas foram configurados em
2026-09-24; isso não prova, por si só, a entrega atual de eventos ou execução de
jobs remotos.

## M2 — Better Stack

### Monitores HTTP iniciais

Os HTTP checks públicos e sem autenticação são:

| Monitor | URL | Sucesso mínimo |
|---|---|---|
| Vela interno | `https://vela.app.br/` | HTTP 200 e resposta HTML |
| Portal login | `https://portalfwlog.com.br/portal/login` | HTTP 200 e resposta HTML |

A cadência e o estado dos monitores cadastrados ficam no
[manual de serviços externos](servicos-externos.md#better-stack-site-no-ar-e-rotinas),
dono da configuração remota.

Esses checks provam apenas que o shell público está servido. Não substituem o
teste autenticado de login, faturamento ou `portal_ship_schedule` proposto na
issue; esses fluxos exigem credenciais/monitor sintético e ficam fora deste
slice.

### Heartbeats dos runners

O contrato repository-side implementado (`runWithBetterStackHeartbeat`) lê as URLs
de secrets server-side do Supabase (`BETTERSTACK_HEARTBEAT_*_URL`), nunca expostas
ao bundle nem commitadas no Git:

| Job | Variável de Secret Supabase | Cadência-alvo |
|---|---|---|
| `demurrage-dunning` | `BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL` | horária |
| `alerts-detector` | `BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL` | 15 min |
| `customer-communication-auto-runner` | `BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_AUTO_RUNNER_URL` | 15 min |
| `portal-daily-digest` | `BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL` | diária |
| `ce-unlock-notify-email` | `BETTERSTACK_HEARTBEAT_CE_UNLOCK_NOTIFY_URL` | 5 min |
| `portal-email-events-runner` | `BETTERSTACK_HEARTBEAT_PORTAL_EMAIL_EVENTS_URL` | a cada minuto |

O ping de sucesso só sai depois da conclusão do job com resposta 2xx sem falha
contada; o restante manda `/fail`. Se a URL não estiver configurada no Supabase, a
função executa normalmente e ignora o ping. Só esses seis runners enviam heartbeat: `itau-pix` (job
`itau-pix-queue`) e `import-effects-runner` não enviam; para a fila de efeitos,
a parada é avisada pelo Alerta `import_effects_queue_stalled`. O monitor no
painel do Better Stack deve alertar pela ausência de ping além
da janela acordada (ex.: 70 min para job horário).

**Estado atual:** os seis runners enviam heartbeat e os seis estão cadastrados
no Better Stack, com as URLs nos secrets do Supabase. Os de
`ce-unlock-notify-email` (período 5 min, tolerância 5 min) e
`portal-email-events-runner` (período 1 min, tolerância 5 min), do plano de
correção dos e-mails (2.3), foram cadastrados em 2026-10-19 e ficaram Up. O
`portal-email-events-runner` chama `/fail` quando um evento falha e volta para
nova tentativa (`portalEmailEventsRunner.test.ts`); falha no claim ou ao
devolver o evento responde 500.

### Respostas de erro das rotinas HTTP

O `pg_cron` registra `succeeded` em `cron.job_run_details` quando consegue
enfileirar o POST no `pg_net`, não quando a Edge Function responde bem. A
resposta fica em `net._http_response` por cerca de 6 horas. Desde a migration
`310`, o job SQL `http-job-failures` (a cada 15 min) lê essa tabela e abre o
Alerta crítico `rotina_http_falhou` (Administrativo) quando, na última hora, há
resposta fora de 2xx ou falha sem resposta que não seja tempo esgotado; ele
fecha sozinho quando a hora fica limpa. Desde a migration `316`, tempo esgotado
isolado não abre o Alerta: o `pg_net` desiste aos 30 s, mas a Edge Function
continua a rodada, e o runner dos Comunicados e a Régua de Cobrança passam
disso num lote grande. Abrem o Alerta 10 ou mais tempos esgotados na hora (só
uma rotina de minuto travada chega a isso) e 30 ou mais chamadas paradas em
`net.http_request_queue` (worker do `pg_net` parado). O `pg_net` não guarda a URL nem o job: o Alerta traz
horário, status e id da requisição, e a rotina se acha pelo horário em
`cron.job_run_details`.

A ausência de linha em `net._http_response` (ou de log da Edge Function) não
prova que a chamada não aconteceu: a tabela é expurgada depois de ~6 horas, um
disparo sem Vault (`ops.dispatch_edge_job` com `WARNING`) não gera requisição, e
o log da função não registra a chamada recusada antes do handler. Para afirmar
que uma rodada não rodou, cruze `cron.job_run_details`, `net._http_response`
dentro da janela e os logs da Edge Function.

## M3 — projetos Sentry separados

O código agora aceita DSNs públicos distintos por entrada do build:

| Superfície Pages | Entrada | Variável DSN | `surface` |
|---|---|---|---|
| `vela-internal` | `src/main.tsx` / `index.html` | `VITE_SENTRY_DSN_INTERNAL` | `internal` |
| `vela-portal` | `src/portal-main.tsx` / `portal.html` | `VITE_SENTRY_DSN_PORTAL` | `portal` |

`VITE_SENTRY_ENVIRONMENT` é `production` no workflow de produção do Pages e
`preview` no workflow de Preview (`cloudflare-pages-preview.yml`), que a define
no passo de build. Sem a variável, o padrão é `production`.

Os DSNs separados estão configurados nos builds de produção do Pages. A resolução
mantém o DSN legado como fallback se uma variável por superfície estiver ausente.

As garantias atuais permanecem: `dataCollection` com PII desabilitado, redação de query
strings/tokens e de CNPJ, CPF e e-mail, `sourcemap: 'hidden'` e tags de
superfície. O Portal também aplica `area=portal` depois de hidratar a sessão.

### Erros das Edge Functions

`supabase/functions/_shared/telemetry.ts` usa o SDK oficial `@sentry/deno`
(versão fixada em `supabase/functions/deno.json`) somente quando uma função
falha com exceção não
tratada ou resposta 5xx. O wrapper é aplicado a `portal-invite-send`,
`portal-password-recovery`, `portal-recovery-email-change`,
`send-customer-communication`, `portal-email-webhook`, `demurrage-dunning`,
`ce-unlock-notify-email`, `itau-pix` e seis runners. Em `portal-password-recovery`, o envio roda depois da resposta
(`EdgeRuntime.waitUntil`); a falha desse trabalho em segundo plano é enviada
direto por `captureEdgeException`. Cada evento leva o fingerprint
`['edge', função, status]` (`_shared/telemetryScope.ts`), para o Sentry não
juntar num só issue as falhas de funções diferentes, que têm todas a mesma
mensagem genérica. O SDK 11 coleta usuário, cabeçalhos, cookies e corpos por
padrão; a inicialização desliga tudo em `dataCollection`, como no navegador. Captura apenas classe genérica de erro e tags operacionais
(função, ambiente, status e duração); não envia mensagem original, usuário,
headers, request body nem response body. O flush tem limite de um segundo e a
falha do Sentry não muda o resultado da função.
Na rodada parcial do `alerts-detector` (migration `351`: um detector falhou e os
outros valeram), a resposta continua 2xx e a função envia um evento por detector
que falhou, com status `detector_failed:<detector>` (um issue por detector),
`codigo_erro` com o SQLSTATE e `rpc` `run_alert_detectors`
(`_shared/alertDetectorFailures.ts`). A mensagem do banco não vai ao Sentry: fica
no corpo da resposta (`failures`), gravado em `net._http_response`, e no `WARNING`
do log do Postgres.
A `itau-pix` (job `itau-pix-queue`) entrou no wrapper em 2026-10-23: da v29 à
correção, toda rodada boa respondia 500 sem log nem evento
([manual de serviços externos](servicos-externos.md#itaú--api-pix-recebimentos)).
Cada falha da rotina vira uma linha JSON no log da função, com `function`,
`step` (`charges`, `receipts` ou, quando a chamada inteira falha, a ação pedida:
`routine` no job, `process_charges` no disparo da fila ou a de diagnóstico) e
`error`.
As falhas que a rotina absorve sem mudar o status vão direto por
`captureEdgeException`, um issue por etapa: `runner_release` (devolução da vez),
`charges_renew` (renovação da vez) e `charges_release` (liberação das reservas
não chamadas). `supabase/functions/itau-pix/index.test.ts` confere o status, o
log e o envelope enviado a um Sentry falso.
As catorze entradas em `supabase/config.toml` apontam para o manifesto Deno
compartilhado em `supabase/functions/deno.json`; a configuração não altera
`verify_jwt` nem os contratos HTTP.

O segredo server-side `SENTRY_DSN` e `SENTRY_ENVIRONMENT=production` foram
configurados no Supabase de produção em 2026-09-24. O SDK Deno não faz escopo
automático por requisição; cada evento usa `withScope` para impedir
compartilhamento de tags entre invocações.

Os contratos puros são testados por Vitest e por
`deno test --config supabase/functions/deno.json supabase/functions/_shared/telemetry_test.ts`.
Para rollback, remover `instrumentEdgeHandler` da função afetada mantém seu
handler original; alternativamente, sem `SENTRY_DSN` o helper é no-op. A
captura não é dependência de negócio.

### Evidência de runtime pendente

Em 2026-09-28, a busca no projeto `vela` do Sentry por `surface:edge` e
`function_name:*` não encontrou eventos de Edge Function. Os issues visíveis
eram de erros do frontend. Não foi provocado um 5xx em produção: a função
instrumentada disponível exige um segredo operacional e não havia ambiente de
teste controlado nesta sessão. Para concluir a conferência, observar um erro
real em ambiente controlado ou usar uma rota de teste sem efeitos de negócio.

## Pendências

- Falta observar um evento real de Edge Function chegando ao Sentry (ver
  [Evidência de runtime pendente](#evidência-de-runtime-pendente)); a
  instrumentação Edge depende do runtime e não deve ser provocada por falha em
  fluxo de negócio de produção.
- `.github/dependabot.yml` acompanha também as dependências Deno declaradas no
  manifesto das Edge Functions.
