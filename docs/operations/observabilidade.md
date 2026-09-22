# Runbook de observabilidade — Issue #710 (M2/M3)

Este runbook registra o contrato repository-side para Better Stack e Sentry.
Ele não cria contas, monitores, chaves, DNS, status page ou alertas.

## Estado verificável no repositório

- `src/main.tsx` inicializa a aplicação interna com `initTelemetry('internal')`;
- `src/portal-main.tsx` inicializa o Portal com `initTelemetry('portal')`;
- `src/lib/telemetry.ts` captura somente telemetria de browser em builds de
  produção, remove query strings e redige CNPJ, CPF e e-mail;
- o projeto Vercel `vela` publica `index.html` em `https://vela.app.br` e
  `fwlog-portal` publica `portal.html` em `https://portalfwlog.com.br`;
- Edge Functions, `pg_cron` e Supabase ainda não enviam eventos ao Sentry nem
  pings de heartbeat ao Better Stack.

Essa é inspeção estática do checkout. Não prova disponibilidade dos domínios,
entrega de eventos ou execução de jobs remotos.

## M2 — Better Stack

### Monitores HTTP iniciais

Ao provisionar o Better Stack, criar monitores HTTP públicos e sem autenticação:

| Monitor | URL | Sucesso mínimo | Cadência |
|---|---|---|---|
| Vela interno | `https://vela.app.br/` | HTTP 200 e resposta HTML | 5 min |
| Portal login | `https://portalfwlog.com.br/portal/login` | HTTP 200 e resposta HTML | 5 min |

Esses checks provam apenas que o shell público está servido. Não substituem o
teste autenticado de login, faturamento ou `portal_ship_schedule` proposto na
issue; esses fluxos exigem credenciais/monitor sintético e ficam fora deste
slice.

### Heartbeats dos runners

O contrato de heartbeat deve ser criado junto da instrumentação de cada runner,
sem URL no código e sem segredo no Git:

| Job | Cadência-alvo a confirmar no `pg_cron` |
|---|---|
| `demurrage-dunning` | horária |
| `alerts-detector` | 15 min |
| `customer-communication-auto-runner` | 15 min |
| `portal-email-events-runner` | confirmar antes do cadastro |
| `import-effects-runner` | confirmar antes do cadastro |
| `recalc-demurrage-ptax` | confirmar antes do cadastro |

O ping de sucesso deve ocorrer somente depois da execução bem-sucedida do job.
O monitor deve alertar pela ausência de um ping além da janela acordada
(referência da issue: menos de 70 min para o job horário). A URL do heartbeat,
quando existir, deve ser um secret server-side do runner/Supabase Vault; nunca
uma variável `VITE_*`, fixture, migration ou valor versionado.

**Lacuna atual:** não há código repository-side que emita esses pings. A
instrumentação dos seis runners, a confirmação das cadências e a configuração
do destinatário do alerta são uma mudança posterior e separada.

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

### Procedimento quando houver autorização do provedor

1. Criar/confirmar os projetos Sentry `vela-interno` e `portal` na mesma
   organização e copiar somente os DSNs públicos.
2. Configurar `VITE_SENTRY_DSN_INTERNAL` no projeto Vercel `vela` e
   `VITE_SENTRY_DSN_PORTAL` no projeto `fwlog-portal`, separando Production e
   Preview conforme a política da organização.
3. Configurar `VITE_SENTRY_ENVIRONMENT=production` em Production e
   `preview` em Preview; gerar novo deploy dos dois projetos.
4. Verificar um evento controlado em cada projeto, conferindo `release`,
   `environment`, `surface` e ausência de PII/token no evento. Essa verificação
   é externa ao checkout e não foi executada nesta tarefa.
5. Só então configurar a regra de alerta para novos issues em
   `environment=production`, com rate limit e destinatário aprovados.

## Fora do escopo e blockers

- Não foram criados Better Stack, Sentry, Slack/Teams ou status-page accounts.
- Não foram gerados API keys, heartbeat URLs, DNS records ou alertas.
- Não foram alterados PostHog, R2 ou `.github/dependabot.yml`.
- A separação efetiva de projetos depende da configuração Vercel/Sentry e de
  um deploy; a entrega deste patch é apenas o contrato e o fallback seguro.
- Heartbeats de `pg_cron` dependem de uma implementação posterior nos runners
  e da confirmação das cadências reais no ambiente remoto.
