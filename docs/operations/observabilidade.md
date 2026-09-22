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
- o projeto Vercel `vela` publica `index.html` em `https://vela.app.br` e
  `fwlog-portal` publica `portal.html` em `https://portalfwlog.com.br`;
- o helper `supabase/functions/_shared/betterStackHeartbeat.ts` foi implementado
  para quatro crons ativos observados: `alerts-detector`, `demurrage-dunning`,
  `customer-communication-auto-runner` e `portal-daily-digest`. A instrumentação
  está em alteração local e ainda depende de PR, deploy, criação das URLs de
  heartbeat e configuração de Edge Function Secrets.

Essa é inspeção estática do checkout. Não prova disponibilidade dos domínios,
presença do secret `SENTRY_DSN`, entrega de eventos, alertas ou execução de jobs
remotos. O SDK oficial Sentry para Deno está em beta; o runtime do projeto ainda
precisa ser validado em Preview antes de configurar o DSN de produção.

## M2 — Better Stack

### Monitores HTTP iniciais

Os dois monitores HTTP abaixo estavam ativos e `Up` no painel autenticado em
2026-09-22, com verificação a cada 3 minutos. As páginas do monitor e os alertas
são internos; as URLs monitoradas são necessariamente públicas e sem
autenticação:

| Monitor | URL | Sucesso mínimo | Cadência |
|---|---|---|---|
| Vela interno | `https://vela.app.br/` | HTTP 2xx | 3 min |
| Portal login | `https://portalfwlog.com.br/portal/login` | HTTP 2xx | 3 min |

Esses checks provam apenas que o shell público está servido. Não substituem o
teste autenticado de login, faturamento ou `portal_ship_schedule` proposto na
issue; esses fluxos exigem credenciais/monitor sintético e ficam fora deste
slice.

### Heartbeats dos runners

O helper local usa URLs por secret, não as inclui no código e sinaliza sucesso
ou falha sem afetar a resposta do job. A API documentada pelo Better Stack
fornece o ping final e o endpoint `/fail`, não um endpoint `/start`.

| Job ativo | Cadência observada no `pg_cron` |
|---|---|
| `demurrage-dunning` | horária |
| `alerts-detector` | 15 min |
| `customer-communication-auto-runner` | 15 min |
| `portal-daily-digest` | diária, 11:00 UTC |

`portal-email-events-runner` e `import-effects-runner` não constavam como
agendados no `pg_cron` ativo observado; `recalc-demurrage-ptax` também não está
agendado. Não criar heartbeats para eles até que a agenda seja alterada e
revalidada. O ping final confirma a resposta HTTP do job: respostas 2xx são
sucesso quando não há contador de falha positivo; não-2xx, exceções e respostas
2xx com `failed`, `partial` ou `releaseFailures` acima de zero são falha. O
digest diário agora retorna `failed` para falhas parciais de consulta/envio e
HTTP 500 para falhas nas consultas agregadas. O monitor deve alertar pela
ausência de ping além da janela acordada (referência da issue: menos de 70 min
para o job horário). As quatro URLs ainda não foram provisionadas nem gravadas
nos Edge Function Secrets.

**Lacuna atual:** helper e wrappers estão em alteração local, sem deploy ou
runtime. Não há heartbeats criados. O owner decidiu não criar uma página pública
de status nem adicionar link ao Portal; monitores e notificações permanecem
internos. O destinatário de alertas operacionais é o único usuário já aprovado:
`lucca.juliatti@fwlog.com.br`.

## M3 — projetos Sentry separados

O código agora aceita DSNs públicos distintos por entrada do build:

| Projeto Vercel | Entrada | Variável DSN | `surface` |
|---|---|---|---|
| `vela` | `src/main.tsx` / `index.html` | `VITE_SENTRY_DSN_INTERNAL` | `internal` |
| `fwlog-portal` | `src/portal-main.tsx` / `portal.html` | `VITE_SENTRY_DSN_PORTAL` | `portal` |

`VITE_SENTRY_ENVIRONMENT` deve ser `production` no deploy de produção e
`preview` no Preview. O valor padrão compatível é `production`; portanto, não
se deve habilitar uma regra de alerta baseada nesse ambiente em Previews até a
variável `preview` estar configurada e verificada no projeto Vercel.

Se os novos DSNs ainda não forem configurados, ambas as entradas usam o DSN
legado para não interromper a captura existente. Esse fallback é compatibilidade
temporária, não evidência de que a separação de projetos já foi concluída.

As garantias atuais permanecem: `sendDefaultPii: false`, redação de query
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

O segredo server-side esperado é `SENTRY_DSN`; `SENTRY_ENVIRONMENT` e
`SENTRY_RELEASE` são opcionais. Sem DSN, não há envio. Em 2026-09-22, o painel
de secrets do projeto Supabase de produção não listava `SENTRY_DSN`; nenhum DSN
foi adicionado nesta etapa. A configuração Preview e o recebimento de eventos
continuam sem validação.

Na Vercel, `VITE_SENTRY_DSN_INTERNAL` e `VITE_SENTRY_DSN_PORTAL` aparecem como
variáveis de produção nos respectivos projetos; isso, isoladamente, não prova
que o deployment publicado as consumiu ou que eventos chegaram ao projeto
Sentry correspondente.
O SDK Deno do Sentry está em beta e não faz escopo automático por requisição;
cada evento usa `withScope` para impedir compartilhamento de tags entre
invocações. Primeiro valide em Preview antes de gravar o DSN de produção.

Os contratos puros são testados por Vitest e por
`deno test --config supabase/functions/deno.json supabase/functions/_shared/telemetry_test.ts`.
Para rollback, remover `instrumentEdgeHandler` da função afetada mantém seu
handler original; alternativamente, sem `SENTRY_DSN` o helper é no-op. A
captura não é dependência de negócio.

### Procedimento quando houver autorização do provedor

1. Criar/confirmar os projetos Sentry `vela-interno` e `portal` na mesma
   organização e copiar somente os DSNs públicos.
2. Configurar `VITE_SENTRY_DSN_INTERNAL` no projeto Vercel `vela` e
   `VITE_SENTRY_DSN_PORTAL` no projeto `fwlog-portal`, separando Production e
   Preview conforme a política da organização.
3. Configurar `VITE_SENTRY_ENVIRONMENT=production` em Production e
   `preview` em Preview; gerar novo deploy dos dois projetos.
4. Validar em Preview o browser e uma Edge Function, conferindo `release`,
   `environment`, `surface`, status e ausência de PII/token; o runtime Preview
   ainda precisa ser exercitado.
5. Só então configurar a regra de alerta para novos issues em
   `environment=production`, com rate limit e destinatário aprovados.

## M4 — Logs locais sanitizados

`supabase/functions/_shared/logger.ts` permite somente campos fixos
(`function`, `job`, `status`, `error_code`) e valores de unions TypeScript
allowlisted. O helper não aceita objetos de erro, emails, IDs ou propriedades
arbitrárias. Além do `portal-email-events-runner`, foram migrados os logs de
falha de `admin-users`, `alerts-detector`, `customer-communication-auto-runner`,
`demurrage-dunning`, `import-effects-runner`, `portal-email-webhook`,
`portal-invite-activate`, `portal-invite-send`, `portal-login`,
`portal-password-recovery`, `portal-recovery-email-change`,
`recalc-demurrage-ptax` e `send-customer-communication`. Testes Vitest validam
o formato serializado, rejeitam valores fora da allowlist em runtime e proíbem
`console.*` direto na árvore de funções, exceto no logger central.
Os helpers compartilhados também não registram texto de erro do Redis: a
indisponibilidade vira código fixo; o modo dry-run de email não inclui
destinatário nem ID da tentativa.

Esta é uma mudança local nos logs nativos, sem destino externo. O owner recusou
Log Drains e retenção/dashboards pagos para manter custo zero adicional; estes
logs não ficam pesquisáveis por 30 dias. A migração cobre os erros das funções
críticas listadas acima, não todos os módulos nem logs de sucesso; o scrub não
deve ser considerado abrangente para todo o runtime Edge.

## Fora do escopo e blockers

- Better Stack tem dois monitores HTTP privados ativos; heartbeats não foram
  provisionados. Não haverá status page pública por decisão do owner. Sentry
  tem projetos; integração de canal e alert rules ainda requerem validação.
- Não foram gerados API keys, heartbeat URLs, DNS records ou alertas.
- A fundação de PostHog está no código: ambos os entrypoints chamam
  `initFeatureFlags()`, com autocapture, pageviews, gravação de sessão e
  captura automática de exceções desligados. Pela decisão do owner, o SDK usa
  `cookieless_mode: always`, `person_profiles: never` e só permite propriedades
  agregadas allowlisted; não persiste ID de visitante no navegador. No painel,
  “Discard client IP data” está ligado. O modo de hash diário server-side (IP,
  user-agent e hostname) não foi validado; não ativá-lo sem nova decisão. A
  meta atual é volume agregado de eventos, não visitantes únicos. As
  variáveis `VITE_POSTHOG_KEY`
  e `VITE_POSTHOG_HOST` aparecem nos dois projetos Vercel em Production; no
  painel PostHog EU ainda não havia eventos. Presença de configuração não prova
  que deploys enviaram eventos.
- `featureFlags.capture` ainda não tem chamadas de produto em `src/`. Os nomes
  permitidos são `invoice_viewed`, `invoice_paid` e `dispute_opened`; o adapter
  só aceita `surface` e `invoice_type`. Não enviar PII nem IDs ou hashes de
  cliente/viagem.
- `COMMUNICATIONS_ENABLED` é somente uma flag de cliente sem consumidor que
  controle envio server-side; o bloqueio efetivo permanece em
  `app_settings.communications_enabled`. Qualquer rollout de flag deve ser um
  bloqueio adicional no servidor, nunca autorização para enviar.
- Decisão do owner: o Portal não associa ID estável de cliente aos eventos do
  Sentry; a sessão Sentry do Portal fica sem usuário. O Vela interno conserva
  sua associação atual à identidade do usuário interno, que é um contrato
  distinto e não foi alterado.
- R2 permanece sem alteração por este runbook. `.github/dependabot.yml` agora
  também acompanha as dependências Deno declaradas no manifesto das Edge
  Functions.
- A separação efetiva de projetos depende da configuração Vercel/Sentry e de
  deploys; a instrumentação Edge depende ainda de um DSN server-side e validação
  de runtime.
- Heartbeats de `pg_cron` dependem de deploy, criação de URLs secretas e
  validação de runtime no Better Stack.
