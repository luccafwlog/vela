# Deploy

O Vela e o Portal Fwlog são publicados no **Cloudflare Pages** por GitHub Actions. Cada build Vite contém as duas entradas (`index.html` e `portal.html`); o staging as separa em `dist/pages-internal` e `dist/pages-portal`, com `_headers` de segurança e `_redirects` para as rotas SPA. O Supabase continua hospedando banco, Auth e Edge Functions.

## Builds e artefatos

- `npm run build`: compila as duas entradas e remove `.map` e `.vite` de `dist` por `scripts/clean-build-artifacts.mjs`.
- `npm run cloudflare:build:sites`: executa o build e prepara as duas pastas independentes.
- `npm run cloudflare:build:internal` e `npm run cloudflare:build:portal`: preparam uma superfície cada.
- `npm run cloudflare:stage:test`: valida staging, redirects, headers e exclusão dos artefatos proibidos.

O staging publica o `index.html` correspondente a cada projeto e copia somente seus assets. O Vela envia `/portal` ao Portal; o alias de preview aponta para o preview irmão da mesma PR. Em produção o destino é `https://portalfwlog.com.br/portal`.

## Workflows

| Workflow | Gatilho | Resultado |
|---|---|---|
| `.github/workflows/ci.yml` | PR (aberta, novo commit, reaberta, pronta para revisão) | Documentação, lint, build, testes, tamanho de bundle, contratos do Pages e replay de migrations em toda PR; suítes SQL só quando o diff toca o banco ([ADR 0086](../adr/0086-ci-confere-na-medida-da-mudanca.md)). Não roda depois do merge. |
| `.github/workflows/local-pg-order.yml` | Segunda, 09:17 UTC, ou execução manual | Suítes SQL nas duas ordens, cada uma num banco recriado, e bateria financeira. |
| `.github/workflows/cloudflare-pages-preview.yml` | Etiqueta `preview` em PR interna, ou execução manual a partir da `main` com o número da PR | Aguarda o check Supabase Preview da branch vinculada à PR e publica os dois previews privados; sem essa branch, termina com falha depois de cerca de 6 min de espera. |
| `.github/workflows/cloudflare-pages-preview-cleanup.yml` | PR interna com etiqueta `preview` fechada | Remove deployments antigos de preview da branch; a Cloudflare mantém o deployment mais recente. |
| `.github/workflows/cloudflare-pages-production.yml` | Push em `main` ou execução manual | Publica as duas pastas na produção quando `CLOUDFLARE_PAGES_PRODUCTION_ENABLED=true`. No push, espera antes o check do app `supabase` no commit: verde publica; vermelho recusa; pulado ou ausente em 10 min só publica se o push não mudar `supabase/migrations/`, e senão pede conferência no painel e execução manual, que publica sem esperar. |
| `.github/workflows/provision-preview-admin.yml` | Etiqueta `preview` em PR interna, ou execução manual a partir da `main` | Cria o usuário administrador fixo na branch Supabase de Preview. |
| `.github/workflows/cloudflare-pages-provision.yml` | execução manual | Cria projetos Pages ausentes; não publica nem altera DNS. |
| Supabase GitHub Integration | Push na branch vinculada; merge em `main` | O Automatic Branching está desligado (decisão do dono de 2026-10-07; estado em [serviços externos](../operations/servicos-externos.md#supabase)). Para ter Preview, crie a branch à mão no painel e preencha "Sync with Git branch" com a branch da PR; a integração aplica nela as migrations da PR, e os workflows de preview acham a branch por esse vínculo, porque o nome da branch Supabase não aceita `/`. Crie-a antes do push que deve gerar o preview, ou envie um commit depois, e remova-a após o teste (custo por hora). No merge em `main`, aplica as migrations pendentes em produção e publica as Edge Functions alteradas ([conferência](../operations/servicos-externos.md#edge-functions)). |

A produção usa o environment GitHub `cloudflare-production`, com variáveis públicas `VITE_*`; o token Cloudflare fica em `CLOUDFLARE_PAGES_API_TOKEN`. O workflow de produção só executa código de `main`. O workflow de preview separa o build do código da PR da etapa confiável que usa o token de publicação. Não coloque segredos server-side em variáveis `VITE_*`.

## Previews protegidos

Os previews ficam atrás do Cloudflare Access, permitindo somente as identidades configuradas na política. Antes de alterar o gate `CLOUDFLARE_PAGES_ACCESS_CONFIGURED`, confira os Access Applications para `*.vela-internal.pages.dev` e `*.vela-portal.pages.dev`. Sem a variável de gate, o workflow não publica preview. Teste uma sessão autorizada e uma não autorizada quando a política ou o domínio de preview mudar.

Cada preview usa alias `pr-<número>` (`pr-123.vela-internal.pages.dev` e `pr-123.vela-portal.pages.dev`). Os `pages.dev` de produção permanecem públicos; os domínios de produção são `vela.app.br` e `portalfwlog.com.br`.

## Staging persistente

Pedido do dono em 2026-10-19. Não é o destino das PRs rejeitado na ADR 0056
(`stagingtdesk`): as PRs seguem para `main`; `staging` é um ambiente fixo de QA
e treino, atualizado por push (ou merge de `main`) na git branch `staging`.

- **Sites:** `https://staging.vela-internal.pages.dev` e
  `https://staging.vela-portal.pages.dev`. A branch `staging` não é o
  production branch dos projetos Pages (`main`), então o deploy é de Preview e
  fica atrás do mesmo Cloudflare Access das prévias `pr-N`.
- **Banco:** branch persistente `staging` do Supabase (filha do projeto Vela,
  ref `uvgqfpleiyfythkhutlj`), ligada à git branch `staging`. Nunca a produção:
  o workflow recusa a URL e o bundle que citem o ref de produção.
- **Workflow:** `.github/workflows/cloudflare-pages-staging.yml`, ligado pela
  variável de repositório `CLOUDFLARE_PAGES_STAGING_ENABLED=true`.
- **GitHub Environment `staging`:** variáveis `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` (da branch staging) e, se houver,
  `VITE_TURNSTILE_SITE_KEY`; secret `CLOUDFLARE_PAGES_API_TOKEN` (o mesmo token
  de Pages Write). `CLOUDFLARE_ACCOUNT_ID` vem da variável de repositório.

## Variáveis do frontend

| Variável | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto/branch Supabase correspondente ao build. |
| `VITE_SUPABASE_ANON_KEY` | chave pública anon do mesmo projeto/branch. |
| `VITE_SENTRY_DSN_INTERNAL` | DSN público do projeto Sentry interno. |
| `VITE_SENTRY_DSN_PORTAL` | DSN público do projeto Sentry do Portal. |
| `VITE_SENTRY_ENVIRONMENT` | `production`, `preview` ou `development`. |
| `VITE_TURNSTILE_SITE_KEY` | Site Key pública do Turnstile no Portal. |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | telemetria do Portal, região EU. |

`VITE_APP_COMMIT_SHA` é opcional; `vite.config.ts` usa o commit Git local quando ausente. Nunca configure `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, tokens de deploy ou outros segredos como variáveis `VITE_*`.

## Headers, rotas e CORS

`_headers` é gerado por `scripts/cloudflare-pages-stage.mjs` e contém CSP, HSTS e os demais headers de segurança. Atualize a CSP ali quando um novo serviço passar a ser acessado pelo navegador. `npm run cloudflare:stage:test` protege esse contrato.

`/assets/*` passa pela Pages Function `functions/assets/[[path]].ts` (fora de `dist`, publicada pelo `wrangler pages deploy` a partir da raiz da checkout confiável). Sem ela, um chunk inexistente cairia no fallback SPA e o navegador guardaria `index.html` como JS `immutable` por um ano, deixando o app em branco mesmo após purge do Cloudflare. A Function responde `404` com `no-store` para arquivo inexistente e define o `immutable` dos assets reais. O workflow de produção confere esse 404 após publicar; previews ficam atrás do Access e são conferidos manualmente com sessão autorizada. Como a checkout do job de preview é sempre o `main`, uma mudança na Function só aparece no preview depois do merge; valide antes com `npx wrangler pages dev dist/pages-internal`.

No navegador, `public/chunk-recovery.js` (script clássico carregado antes do entry) e `src/lib/lazyPage.ts` tratam chunk que falha ao carregar: rebuscam o arquivo com `cache: 'reload'` (sobrescrevendo uma cópia ruim no cache HTTP) e recarregam a página uma vez por arquivo na sessão. No evento `vite:preloadError`, o script só chama `preventDefault()` para CSS ausente: em falha do próprio JS, cancelar o evento faz o `import()` resolver com `undefined` em vez de rejeitar, e a tela quebrava ao ler a exportação (VELA-1M, `reading 'Admin'`). `lazyPage` também trata módulo `undefined` como chunk não carregado. O marcador de `lazyPage` guarda todos os arquivos que já ganharam reload na rota (não só o último, para não entrar em laço se bordas da CDN alternarem versões): logo após um deploy, o reload pelo chunk antigo pode cair na versão nova enquanto o chunk novo ainda responde 404, e esse segundo arquivo ganha a própria tentativa em vez de virar tela de erro (VELA-1P). Sem URL na mensagem (Safari), vale um reload por rota.

As Edge Functions usam a allowlist em `supabase/functions/_shared/cors.ts`: domínios de produção, localhost de desenvolvimento, aliases dos dois projetos Pages e origens HTTPS exatas listadas em `CLOUDFLARE_PAGES_PREVIEW_ORIGINS`. Uma origem rejeitada não recebe `Access-Control-Allow-Origin`.

## Supabase: Functions e migrations

A publicação do frontend não publica Edge Functions; quem as publica é a Supabase GitHub Integration, no merge em `main`. Conferência e publicação manual de reserva: [serviços externos § Edge Functions](../operations/servicos-externos.md#edge-functions) (`supabase functions download` para comparar o código remoto). Segredos operacionais ficam em Supabase → Edge Functions → Secrets e, para jobs `pg_cron`, também no Vault conforme [segredos-cron.md](../operations/segredos-cron.md).

Migrations devem ser aplicadas em ordem e antes do código que dependa delas. O CI faz replay em PostgreSQL descartável; a integração do Supabase aplica as migrations na branch de Preview vinculada à PR, quando ela existe, e o deploy de produção segue a integração configurada para `main`. Migrations aplicadas não devem ser reescritas: reconcilie divergências em migration nova. Consulte também o procedimento de [squash e deploy](../operations/squash-schema-v1-deploy.md).

O deploy não envia e-mails diretamente: o provedor de e-mail (MillionSend) e demais provedores são chamados pelas Edge Functions. `portal-login` exige `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`; jobs de Comunicados e Demurrage usam os secrets e valores do Vault descritos no [manual de serviços externos](../operations/servicos-externos.md).

## Volta operacional

A volta para a Vercel (rollback manual) é configuração de conta e DNS: o estado dos projetos e o passo a passo estão em [serviços externos](../operations/servicos-externos.md#vercel-rollback-manual-sem-publicação-automática).
