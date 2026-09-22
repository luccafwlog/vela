# Deploy

> Hosting: **Vercel**, com dois projetos sobre a mesma base de código. O projeto
> `vela` publica o build interno em `vela.app.br`; `fwlog-portal` publica o
> Portal em `portalfwlog.com.br`. Ambos geram Preview Deployments em pull
> requests e Production Deployments em `main` pela integração GitHub/Vercel.

## Workflows

| Integração | Gatilho | O que faz |
|---|---|---|
| `.github/workflows/ci.yml` | `pull_request` e push em `main` | `docs:check`, lint, build, bundle size e testes em shards. |
| `.github/workflows/provision-preview-admin.yml` | conclusão verde do CI de uma PR | Aguarda o check `Supabase Preview` e cria/atualiza o usuário admin de teste na branch Supabase correspondente. |
| Supabase GitHub Integration — Automatic branching | branch/PR do GitHub | Cria a branch Supabase efêmera correspondente e executa migrations/configuração do Preview. |
| Supabase + Vercel Branching Integration | PR aberta | Sincroniza as variáveis públicas do Preview com a branch Supabase correspondente e reimplanta se houver corrida de timing. |
| Supabase GitHub Integration — Deploy to production | merge/push em `main` | Aplica migrations e publica os artefatos de produção no projeto Supabase principal. |
| Vercel + GitHub | pull request | Build e Preview Deployment. |
| Vercel + GitHub | push em `main` | Build e Production Deployment. |

Não há mais workflow de deploy Firebase no repositório. A integração Vercel é
configurada no projeto Vercel, não como uma segunda publicação no GitHub
Actions.

## Configuração do projeto Vercel

O contrato versionado está em [`vercel.json`](../../vercel.json):

- framework Vite;
- Node.js `24.x` em Vercel e no CI;
- instalação reproduzível com `npm ci --legacy-peer-deps`;
- comando `node scripts/vercel-build.mjs`, que roda `npm run build` e trata a
  corrida de variáveis do Preview (ver abaixo);
- saída `dist`;
- `ignoreCommand` ignora commits sem alterações no frontend, dependências ou
  configuração de build;
- entradas `index.html` e `portal.html`, com cada projeto selecionando seu
  build e rewrite correspondente para preservar refresh em qualquer rota React
  Router;
- headers de segurança versionados no Vercel;
- HTML sem cache e assets em `/assets/` com cache longo e `immutable`.

No projeto Vercel, configure o Root Directory como a raiz deste repositório e
deixe o Git Integration responsável por Preview/Production. Não configure
migrations, Edge Functions ou comandos de backend no build da Vercel.

O `ignoreCommand` só ignora um deployment quando o commit não altera arquivos
que participam do frontend ou do build. Se não houver SHA anterior disponível,
ou se o SHA não estiver presente no clone raso usado pela Vercel, o comando
continua o build por segurança. Alterações em `docs/` isoladamente não geram um
novo deployment.

## Variáveis do frontend

As únicas variáveis necessárias ao bundle são públicas por definição do Vite:

| Variável | Production | Preview | Development |
|---|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase de produção | URL da branch automática correspondente à PR, injetada pela integração Supabase/Vercel | valor do ambiente local |
| `VITE_SUPABASE_ANON_KEY` | chave pública `anon` correspondente | chave pública da branch automática correspondente, injetada pela integração Supabase/Vercel | chave pública do ambiente local |
| `VITE_SENTRY_DSN_INTERNAL` | DSN público do projeto Sentry interno | DSN público de Preview do projeto interno, se separado | vazio usa o fallback legado |
| `VITE_SENTRY_DSN_PORTAL` | DSN público do projeto Sentry do Portal | DSN público de Preview do Portal, se separado | vazio usa o fallback legado |
| `VITE_SENTRY_ENVIRONMENT` | `production` | `preview` | `development` |

`VITE_APP_COMMIT_SHA` é opcional: `vite.config.ts` injeta o commit Git atual
quando a variável não é fornecida, mantendo o release visível no Sentry e na
interface. Nunca configure `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ou
outros segredos de Edge Functions como variáveis `VITE_*`.

Os DSNs do Sentry são identificadores públicos do browser, não API keys. Para a
separação do M3, configure `VITE_SENTRY_DSN_INTERNAL` somente no projeto
Vercel `vela` e `VITE_SENTRY_DSN_PORTAL` somente no projeto `fwlog-portal`.
Configure também `VITE_SENTRY_ENVIRONMENT=production` em Production e
`preview` em Preview; sem isso, o fallback de ambiente permanece `production`.
O contrato completo e o runbook de Better Stack estão em
[`docs/operations/observabilidade.md`](../operations/observabilidade.md).

Cadastre as credenciais de produção no Vercel Project Settings em Production e
as credenciais locais em Development. Não mantenha um valor global fixo para
Preview: na integração Supabase/Vercel, configure o prefixo específico do
framework para `VITE_` e deixe a integração criar/atualizar
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` por branch/PR. O CI do GitHub
mantém suas próprias variáveis públicas de build; isso não substitui a
configuração do projeto Vercel.

### Preview ligado à branch automática

Os projetos Vercel `vela` e `fwlog-portal` devem estar conectados ao GitHub
`luccafwlog/vela` e à integração de branching do Supabase. O
Automatic branching deve permanecer habilitado no Supabase, com o diretório de
trabalho `.`, e **Supabase changes only** deve ficar desligado quando todo
Preview precisar de um banco isolado — caso contrário uma PR que só altera
frontend pode não criar a branch Supabase correspondente.

Ao abrir uma PR, o Supabase cria uma branch efêmera baseada na branch do GitHub,
aplica as migrations e configura os artefatos declarados. A integração Supabase
com Vercel atualiza no Preview as variáveis `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY` com os valores daquela branch. O primeiro deploy pode
ser refeito automaticamente pela integração por causa da corrida entre a
criação da branch e o build do Vercel.

Quando o primeiro deploy cai nessa janela, ele não tem as variáveis e o guard de
[`vite.config.ts`](../../vite.config.ts) derrubaria o build. Para que a corrida
não vire um deployment vermelho enganoso a cada PR,
[`scripts/vercel-build.mjs`](../../scripts/vercel-build.mjs) publica uma página
de espera autoexplicativa — e só isso — quando `VERCEL_ENV=preview` e falta
`VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY`. Nada do app é publicado nesse
estado, e o redeploy automático da integração substitui a página pela build
real. Em Production, ou com as variáveis presentes, o wrapper apenas executa
`npm run build`: a falta de variável em produção continua quebrando o build de
forma visível.

### Usuário administrador da Preview

O workflow [`provision-preview-admin.yml`](../../.github/workflows/provision-preview-admin.yml)
é executado por `workflow_run` após um CI verde de uma PR. Ele usa a versão do
arquivo na branch padrão e faz checkout explícito dessa mesma branch; não
executa scripts modificados pela PR com secrets disponíveis. Depois de aguardar
o check `Supabase Preview`, obtém as credenciais da branch com o Supabase CLI e
roda [`scripts/provision-preview-admin.mjs`](../../scripts/provision-preview-admin.mjs).

A decisão de prontidão vive em
[`scripts/preview-readiness.mjs`](../../scripts/preview-readiness.mjs)
(`decidePreviewReadiness`, coberta por
`src/services/__tests__/previewReadiness.test.ts`): PR fechada ou SHA superado
conclui como `obsolete` sem carregar credenciais nem provisionar; `skipped`
com a PR aberta é `investigate` — diagnóstico sem segredo, nunca sucesso; o
provisionamento só ocorre em `ready` (check verde no SHA exato, branch pronta
e SHA/estado revalidados), sem fallback para produção.

O script usa a Auth Admin API server-side para criar ou atualizar, de forma
idempotente, o usuário `qa-admin@example.test`, confirmar seu e-mail e fazer
upsert de `public.user_profiles` com `role = 'admin'` e `active = true`. A senha
não fica no repositório nem em variáveis `VITE_*`. O usuário é recriado quando a
PR gera uma nova branch; ao fechar a PR, o próprio Supabase remove a Preview
Branch e seus dados.

A migration [`042_preview_admin_service_role_grant.sql`](../../supabase/migrations/042_preview_admin_service_role_grant.sql)
concede ao `service_role` somente `SELECT`, `INSERT` e `UPDATE` em
`public.user_profiles`, necessários para esse upsert server-side. As policies e
os grants dos roles do navegador permanecem inalterados. Se um rerun encontrar
um fixture cuja senha deixou de atender à política atual do Auth, o script
preserva a senha existente e repara o e-mail, metadados e perfil; a rotação da
senha continua sendo uma ação explícita de configuração.

Configure uma vez, em **Settings → Secrets and variables → Actions** do
repositório, os secrets:

| Secret | Conteúdo |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token do Supabase com acesso ao projeto e ao branching. |
| `SUPABASE_PROJECT_REF` | `fgmkhbzhaeebrsizwccx`, project ref de produção usado para localizar as branches. |
| `PREVIEW_ADMIN_PASSWORD` | Senha fixa de teste, com pelo menos 8 caracteres e compatível com a política de Auth. |

O `SUPABASE_ACCESS_TOKEN` e a senha são consumidos somente pelo GitHub Actions.
Não use `pull_request_target` com checkout do código da PR e não copie a chave
server-side para o Vercel. O Vercel pode terminar o build antes do workflow de
provisionamento, mas o login só deve ser testado depois que o job
`Provision Preview Admin` estiver verde.
PRs originadas de forks são ignoradas, pois não têm acesso aos secrets e não
possuem uma branch automática correspondente no projeto Supabase conectado.

O arquivo [`supabase/seed.sql`](../../supabase/seed.sql) é executado depois das
migrations em resets/bancos descartáveis e fornece os catálogos-base corretos
para uma branch nova: taxas locais, demurrage, depots e terminais. Ele é um
snapshot semântico de `main`, resolve vínculos por chaves naturais/LOCODEs e
contém guardas para abortar se houver dados operacionais. O seed não é aplicado
no deploy de migrations de produção; portanto não substitui nem altera o
catálogo já correto de `main`. Se o catálogo de produção mudar, o snapshot deve
ser atualizado conscientemente e validado com
`supabase/tests/seed_catalog.sql` em banco descartável.

Não cadastre uma URL de Preview fixa nem reutilize uma branch Supabase entre
PRs. `main` usa o projeto de produção (`fgmkhbzhaeebrsizwccx`) e cada Preview
usa seu próprio project ref efêmero. Chaves públicas podem chegar ao bundle;
service role, secret keys e URLs PostgreSQL permanecem fora do Vercel.

Checklist no Dashboard:

1. No Vercel Marketplace, mantenha a integração Supabase instalada e conectada
   aos projetos `vela` e `fwlog-portal`.
2. Na integração Supabase/Vercel, configure o prefixo específico do framework
   para `VITE_`, mantendo os nomes `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` usados pelo código.
3. No Supabase GitHub Integration, conecte `luccafwlog/vela`, use
   working directory `.`, deixe **Automatic branching** ligado e
   **Supabase changes only** desligado.
4. Nos dois projetos Vercel, use o mesmo repositório e `main` como production
   branch; configure o build interno no `vela` e o build Portal no
   `fwlog-portal`. Não use variáveis Preview fixas.
5. Abra uma PR e confirme os sinais em cada projeto: branch Supabase
   automática criada e saudável, comentário/check do Supabase Preview
   concluído e Preview contendo as duas variáveis `VITE_*` da mesma branch.

Se o Preview mostrar a tela de erro de configuração, o deploy recebeu zero ou
apenas parte dessas variáveis. Verifique em **Vercel → Project Settings →
Integrations** os projetos `vela` e `fwlog-portal` conectados ao projeto
Supabase correto; na configuração da integração, use o prefixo `VITE_`. Depois
de corrigir a integração, reimplante o commit mais recente da PR para que o
Vercel refaça os dois builds com os valores da branch automática. O build agora
falha explicitamente quando roda no Vercel sem essas variáveis, evitando
publicar um Preview quebrado silenciosamente.

## Domínios e cutover sem downtime

Os projetos Vercel recebem:

- `https://vela.app.br` — aplicação interna;
- `https://portalfwlog.com.br` — Portal do Cliente.

O `PORTAL_URL` das Edge Functions continua sendo
`https://portalfwlog.com.br`, e `APP_URL` passa a ser
`https://vela.app.br`. Nenhum deles deve ser trocado por um domínio
`.vercel.app`.

Sequência operacional:

1. criar/vincular o projeto Vercel e configurar as variáveis;
2. gerar um Preview/Production Deployment e testar o domínio `.vercel.app`;
3. validar login interno, Portal, refresh de sessão, rotas profundas, Supabase,
   Realtime, PTAX, Sentry, CSP, assets e Edge Functions;
4. adicionar os dois domínios ao projeto Vercel e usar os registros exibidos
   por `vercel domains inspect`;
5. trocar somente os registros web no provedor DNS, preservando MX, SPF, DKIM,
   DMARC, ImprovMX, Resend e demais registros de email;
6. validar DNS, SSL, aplicação, Portal, Supabase, emails e Sentry; o domínio
   antigo nunca deve ser apontado para produção.

## Content-Security-Policy

A CSP é definida em `vercel.json`. As origens efetivamente usadas pelo browser
são:

```text
default-src 'self'
script-src  'self'
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://olinda.bcb.gov.br https://*.ingest.us.sentry.io
font-src    'self' https://fonts.gstatic.com
```

`api.resend.com` não é acessado pelo browser: Resend continua sendo chamado
somente pelas Supabase Edge Functions e por isso não precisa estar no
`connect-src`. Não há `unsafe-eval`; o `unsafe-inline` existente é limitado a
`style-src`, conforme o contrato atual da aplicação.

## Analytics e Speed Insights

Web Analytics e Speed Insights são carregados globalmente em produção pelos
componentes oficiais da Vercel. Antes do envio, query strings são removidas e
segmentos dinâmicos de CNPJ, B/L, viagem e cliente são normalizados para evitar
que identificadores operacionais apareçam na telemetria. As métricas continuam
agrupáveis por tela, sem expor o registro acessado.

## CORS das Edge Functions

As origens de produção permanecem na allowlist compartilhada em
`supabase/functions/_shared/cors.ts`: `vela.app.br` e
`portalfwlog.com.br`.

Os aliases de Preview dos projetos `vela` e `fwlog-portal` são aceitos pela
allowlist das Edge Functions. Para um domínio adicional que invoque Edge
Functions pelo browser, configure no ambiente da branch Supabase:

```text
VERCEL_PREVIEW_ORIGINS=https://<url-preview-exata>.vercel.app
```

Múltiplas URLs podem ser separadas por vírgula. O parser aceita somente URLs
HTTPS exatas, sem caminho e sem `*`. A variável é necessária apenas para
domínios adicionais; os aliases gerados pelos projetos Vercel já são validados
pelos padrões restritos em `supabase/functions/_shared/cors.ts`.

## Edge Functions, Resend e migrations

Edge Functions continuam sendo publicadas separadamente no Supabase CLI/Console
e continuam usando `PORTAL_URL`, `APP_URL`, `RESEND_API_KEY` e demais segredos
server-side. A função `portal-login` também exige
`PORTAL_LOGIN_DUMMY_AUTH_USER_ID`: UUID de uma identidade Auth confirmada, com
senha aleatória de alta entropia e sem vínculo em `customer_portal_accounts`.
Ela equaliza o lookup e a tentativa de senha quando o CNPJ não existe; qualquer
sessão dummy é descartada no servidor. Para Comunicados, configure também `COMMUNICATIONS_REPLY_TO` (o
reply-to operacional do canal, distinto de `PORTAL_REPLY_TO`); o remetente
continua sendo `PORTAL_FROM_EMAIL`. Se a chave global de Comunicados estiver desligada, a
Function registra simulação e não exige chamada ao Resend; para envio real, o
remetente, reply-to e `RESEND_API_KEY` precisam estar configurados. Resend não é
migrado para Vercel Functions.

As Edge Functions instrumentadas com Sentry usam o manifesto compartilhado
`supabase/functions/deno.json`, referenciado individualmente como `import_map`
em `supabase/config.toml`. Mantenha a versão do SDK nesse manifesto e publique
as Functions alteradas pelo fluxo normal do Supabase; o deploy do frontend na
Vercel não publica nem ativa essa telemetria. Sem `SENTRY_DSN`, o adaptador fica
inativo.

A régua de Demurrage exige o segredo server-side `DEMURRAGE_DUNNING_SECRET`.
O mesmo valor precisa estar no Supabase Vault sob o **mesmo nome**, junto de
`SUPABASE_URL`, para que o `pg_cron` consiga chamar a Edge Function
`demurrage-dunning` de hora em hora.

O runner automático de NOA/NOR exige o segredo server-side
`CUSTOMER_COMMUNICATION_AUTOMATION_SECRET`, também espelhado no Vault com o
mesmo nome, junto de `SUPABASE_URL`.

As migrations `022`–`026` adicionam `portal-email-events-runner` (segredo
`PORTAL_EMAIL_EVENTS_CRON_SECRET`), `import-effects-runner` (segredo
`IMPORT_EFFECTS_CRON_SECRET`) e o alerta/contrato do `recalc-demurrage-ptax`
(`RECALC_CRON_SECRET`). Todos os segredos também precisam existir no Vault. O
runner de efeitos é fail-closed e só processa após
`IMPORT_EFFECTS_RUNNER_ENABLED=true`; o job de PTAX permanece inativo até a
validação de gateway, Preview e observabilidade. Após aplicar as migrations,
valide os jobs novos e existentes pela consulta do procedimento operacional,
sem expor nenhum segredo no frontend.

Os GUCs `app.settings.*` **não** são mais o mecanismo de configuração: a role
`postgres` do Supabase não é superuser e não pode defini-los
(`permission denied to set parameter`). O procedimento de cadastro, rotação e
verificação está em
[`../operations/segredos-cron.md`](../operations/segredos-cron.md) e a decisão
na [ADR 0063](../adr/0063-configuracao-de-jobs-cron-no-vault.md).
(As migrations `381` a `384` que criaram essa automação vivem hoje em
`supabase/migrations_archive/`; seus efeitos estão consolidados em
`supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql` para os jobs e em
`001`/`002` para o schema.)
Claims abandonadas da automação possuem lease de 30 minutos e podem ser retomadas pelo ciclo
seguinte; falhas de liberação aparecem como erro do runner.

Os fluxos públicos de login, recuperação e ativação também podem usar o
rate-limit distribuído do Upstash. Configure somente nas Edge Functions
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` e
`PORTAL_RATE_LIMIT_HMAC_SECRET` (os parâmetros opcionais e o rollback estão em
[Rate limit do Portal](../operations/portal-rate-limit.md)). A migration
`076_portal_activation_rate_limit.sql` deve preceder o deploy da função de
ativação. O token de rate limit é independente do token de backup do R2; nenhum
deles deve ser colocado no Vercel ou em `VITE_*`.

Migrations continuam sendo aplicadas no Supabase, em ordem e antes do deploy de
código que dependa delas, pelo branch action da integração GitHub no Preview e
pelo deploy de produção quando `main` recebe o merge. As reconciliações abaixo
vivem hoje em `supabase/migrations_archive/` (efeitos preservados nas
migrations consolidadas `001`–`004`); a descrição histórica é mantida porque
explica o estado atual da produção. As migrations
`351_reconcile_branch_schema_drift.sql`,
`352_reconcile_remaining_runtime_drift.sql` e
`354_reconcile_import_batches_timestamp.sql` reassertam, de forma idempotente,
os elementos de schema necessários para que a produção e branches de Preview
permaneçam alinhadas mesmo quando uma execução histórica deixou a versão
registrada sem o efeito correspondente. A migration 352 remove resíduos do
antigo bloqueio `overdue`, repõe o índice de CE Mercante e preserva dados ao
recusar a conversão de `import_batches.created_at` quando os valores legados
divergirem de `uploaded_at`. A migration 354 consulta o catálogo antes de
referenciar a coluna opcional, cria a coluna quando ela está ausente e converge
branches automáticas que já registraram a 352 antes dessa proteção. A migration
355 corrige, de forma controlada e idempotente, o nome histórico remoto da versão
169 para que o rebase use o arquivo correto (`169_demurrage...`) e não tente
reaplicar a policy da migration 170. A migration 356 aplica a mesma reconciliação
à versão 341, cujo nome histórico remoto também divergia do arquivo local;
migrations aplicadas não devem ser reescritas fora de uma migration explícita de
reconciliação. A exceção documentada é o squash v1.0 (PR 651 / ADR 0062), cuja
reconciliação do histórico remoto via `supabase migration repair` está em
`docs/operations/squash-schema-v1-deploy.md` (inclui o procedimento de
reversão).
A migration 362 corrige a autorização do backfill da divergência
Baplie/BL e mantém as reimportações atômicas sem transições intermediárias. A
Vercel nunca executa migrations implicitamente.

## Hosting legado

O Firebase Hosting foi removido do repositório e não participa mais do
cutover. O domínio antigo nunca deve ser apontado para produção; qualquer
referência histórica a ele deve permanecer apenas em documentação arquivada.
