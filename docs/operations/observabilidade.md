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
- dez Edge Functions têm wrapper repository-side que reporta exceções não
  tratadas e respostas HTTP 5xx apenas se `SENTRY_DSN` estiver configurado;
  erros brutos, corpo/resposta HTTP, usuário e headers não são enviados;
- o helper Edge carrega o SDK Sentry sob demanda e fica em no-op sem `SENTRY_DSN`;
- os projetos Pages `vela-internal` e `vela-portal` publicam, respectivamente,
  `index.html` em `https://vela.app.br` e `portal.html` em
  `https://portalfwlog.com.br`;
- heartbeats repository-side para Edge Functions agendadas foram implementados via
  `supabase/functions/_shared/betterStackHeartbeat.ts` nos runners `alerts-detector`,
  `portal-daily-digest`, `demurrage-dunning` e `customer-communication-auto-runner`.
  Eles emitem ping HTTP apenas em conclusões bem-sucedidas (status < 400) quando a URL
  do heartbeat está configurada nos secrets do Supabase. Sem o secret, operam em no-op
  sem falhar o job. Heartbeats diretos de triggers `pg_cron` no Postgres continuam opcionais.

Esta seção combina inspeção estática com verificações de runtime registradas no
plano de migração. O DSN de produção e os alertas foram configurados em
2026-09-24; isso não prova, por si só, a entrega atual de eventos ou execução de
jobs remotos.

## M2 — Better Stack

### Monitores HTTP iniciais

Quando houver monitores ativos no Better Stack, os HTTP checks públicos e sem
autenticação esperados são:

| Monitor | URL | Sucesso mínimo | Cadência |
|---|---|---|---|
| Vela interno | `https://vela.app.br/` | HTTP 200 e resposta HTML | 5 min |
| Portal login | `https://portalfwlog.com.br/portal/login` | HTTP 200 e resposta HTML | 5 min |

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

O ping de sucesso ocorre estritamente após a conclusão bem-sucedida do job. Se a
URL não estiver configurada no Supabase, a função executa normalmente e ignora o
ping. O monitor no painel do Better Stack deve alertar pela ausência de ping além
da janela acordada (ex.: 70 min para job horário).

**Estado atual:** a instrumentação repository-side dos 4 runners principais está
concluída e testada. Os 4 heartbeats foram cadastrados no Better Stack e suas
URLs estão configuradas nos secrets do Supabase; a execução recorrente continua
sendo acompanhada e não bloqueia o encerramento do plano de migração.

## M3 — projetos Sentry separados

O código agora aceita DSNs públicos distintos por entrada do build:

| Superfície Pages | Entrada | Variável DSN | `surface` |
|---|---|---|---|
| `vela-internal` | `src/main.tsx` / `index.html` | `VITE_SENTRY_DSN_INTERNAL` | `internal` |
| `vela-portal` | `src/portal-main.tsx` / `portal.html` | `VITE_SENTRY_DSN_PORTAL` | `portal` |

`VITE_SENTRY_ENVIRONMENT` deve ser `production` no deploy de produção e
`preview` no Preview. O valor padrão compatível é `production`; portanto, não
se deve habilitar uma regra de alerta baseada nesse ambiente em Previews até a
variável `preview` estar configurada e verificada no environment dos builds Pages.

Os DSNs separados estão configurados nos builds de produção do Pages. A resolução
mantém o DSN legado como fallback se uma variável por superfície estiver ausente.

As garantias atuais permanecem: `dataCollection` com PII desabilitado, redação de query
strings/tokens e de CNPJ, CPF e e-mail, `sourcemap: 'hidden'` e tags de
superfície. O Portal também aplica `area=portal` depois de hidratar a sessão.

### Erros das Edge Functions

`supabase/functions/_shared/telemetry.ts` usa o SDK oficial `@sentry/deno`
(`npm:@sentry/deno@10.73.0`) somente quando uma função falha com exceção não
tratada ou resposta 5xx. O wrapper é aplicado a `portal-invite-send`,
`send-customer-communication`, `portal-email-webhook`, `demurrage-dunning` e
seis runners. Captura apenas classe genérica de erro e tags operacionais
(função, ambiente, status e duração); não envia mensagem original, usuário,
headers, request body nem response body. O flush tem limite de um segundo e a
falha do Sentry não muda o resultado da função.
As dez entradas em `supabase/config.toml` apontam para o manifesto Deno
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

## Fora do escopo e blockers

- A conta Better Stack existe, mas o painel autenticado mostrou zero monitores
  e nenhuma status page em 2026-09-22. Sentry já tem projetos; esta tarefa não
  cria integrações de canal.
- Não foram gerados API keys, heartbeat URLs, DNS records ou alertas.
- Não foram alterados PostHog ou R2. `.github/dependabot.yml` agora também
  acompanha as dependências Deno declaradas no manifesto das Edge Functions.
- A separação dos projetos está configurada. Falta observar um evento real de
  Edge Function chegando ao Sentry; a instrumentação Edge depende do runtime e
  não deve ser provocada por falha em fluxo de negócio de produção.
- Heartbeats de `pg_cron` dependem de uma implementação posterior nos runners
  e da confirmação das cadências reais no ambiente remoto.
