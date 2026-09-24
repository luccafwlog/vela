# Roteiro de configuração dos serviços externos e migração para Cloudflare

> **Data:** 2026-09-24 (reescrito no mesmo dia após revisão contra o código)
> **Status:** Ativo
> **Para quem:** o dono do projeto, com um agente acompanhando. Cada etapa diz
> onde clicar, o que cadastrar, como conferir e como desfazer.

## Como usar

- Faça as etapas **na ordem**. As etapas 1 a 7 são reversíveis e não mexem na
  hospedagem; a 8 publica no Cloudflare sem trocar domínio; só a 9 e a 10 mexem
  em DNS e tiram o tráfego da Vercel.
- Ao terminar cada etapa, rode a conferência dela. Se falhar, desfaça pelo
  "Como desfazer" antes de seguir.
- Nunca cole chave, token ou senha no chat, em issue, em arquivo do repositório
  ou em print. Os lugares certos são: **Supabase → Edge Functions → Secrets**,
  **GitHub → Settings → Secrets and variables → Actions**, o painel da
  **Vercel** e o gerenciador de senhas.
- Os comandos com `supabase` exigem `supabase login` feito no terminal. O
  projeto de produção é `fgmkhbzhaeebrsizwccx`.

## Etapa 0 — Pré-requisitos

- [x] PR #746 no `main`: o rate limit volta a obedecer o Supabase, e a CSP
  aceita Turnstile e PostHog.
- [x] `portal-login`, `portal-password-recovery`, `portal-recovery-email-change`
  e `portal-invite-activate` republicadas em 2026-09-24 com a correção.
- [x] Depois do merge da #745, republicar as funções que usam a lista de CORS,
  que passou a aceitar os endereços `pages.dev` do Vela:

  ```bash
  supabase functions deploy admin-users portal-account-suspend portal-dispute-attachment portal-invite-activate portal-invite-send portal-password-recovery portal-password-reset portal-login portal-recovery-email-change send-customer-communication --project-ref fgmkhbzhaeebrsizwccx
  ```

---

## Etapa 1 — Upstash (segunda trava de tentativas do Portal)

**Para que serve:** soma uma trava por IP+CNPJ à trava do Supabase (5 erros em
15 minutos por CNPJ), que continua valendo sempre.

**Situação:** já configurado. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
e `PORTAL_RATE_LIMIT_HMAC_SECRET` estão nos secrets de produção desde
2026-09-22, e a correção da #746 está publicada. Falta só a conferência abaixo.

Se algum dia for preciso recriar:
1. Em [console.upstash.com](https://console.upstash.com) → **Redis** → **Create
   Database** → nome `vela-rate-limit`, região **São Paulo (sa-east-1)**, plano
   **Free**. Na aba **REST API**, copie `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN` (não o token "Read-Only").
2. Gere o segredo HMAC com
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Cadastre os três em Supabase → **Edge Functions** → **Secrets**. Não
   cadastre `PORTAL_RATE_LIMIT_THRESHOLD` nem `PORTAL_RATE_LIMIT_WINDOW_SECONDS`:
   os padrões (10 erros em 5 minutos) são os aprovados.

**Conferência:**
1. Em uma janela anônima, erre a senha 3 vezes com um CNPJ de teste em
   `https://portalfwlog.com.br/portal/login`. Cada tentativa tem de mostrar a
   mensagem de CNPJ ou senha inválidos. Se aparecer "Portal indisponível" (erro
   500), pare: falta configuração no servidor, e nada é contado. Veja o
   ocorrido de 2026-09-24 no registro de execução.
2. No Upstash → **Data Browser**, busque `vela:portal-rate:login:*`. Deve
   aparecer uma chave com valor `3` e TTL abaixo de 300 segundos. A chave não
   pode conter CNPJ nem IP legíveis.
3. Entre com a senha certa de um CNPJ que **não** foi usado no passo 1 (ou
   espere 15 minutos). O login tem de funcionar.

**Como desfazer:** apague os três secrets. O login volta a usar só a trava do
Supabase, sem efeito para o cliente.

---

## Etapa 2 — Turnstile (anti-robô no login e na recuperação do Portal)

1. Cloudflare Dashboard → **Turnstile** → **Add widget**:
   - **Widget name:** `Portal Fwlog`
   - **Hostnames:** `portalfwlog.com.br`, `vela-portal.pages.dev` e `localhost`
   - **Widget Mode:** `Managed`
   - **Pre-clearance:** `No`
2. Copie a **Site Key** e a **Secret Key**.
3. **Primeiro a tela.** Na Vercel → projeto `fwlog-portal` → **Settings** →
   **Environment Variables**, adicione `VITE_TURNSTILE_SITE_KEY` = Site Key,
   marcando **Production** e **Preview**. Depois, em **Deployments**, abra o
   último deployment de Production → **⋯** → **Redeploy**, sem "Use existing
   Build Cache".
4. Confira que o widget aparece em `https://portalfwlog.com.br/portal/login` e
   em `/portal/esqueci-senha`, e que o login de teste funciona.
5. **Depois o servidor.** Supabase → **Edge Functions** → **Secrets** →
   `TURNSTILE_SECRET_KEY` = Secret Key. Não cadastre
   `TURNSTILE_ALLOWED_HOSTNAMES`: o padrão já aceita `portalfwlog.com.br`.

   A ordem importa: com o secret no servidor e a tela sem Site Key, todo login e
   toda recuperação recebem 403.

**Conferência:**
- Login com a senha certa entra.
- No terminal, uma chamada sem token é recusada:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://portalfwlog.com.br" -H "Content-Type: application/json" -d '{}' https://fgmkhbzhaeebrsizwccx.supabase.co/functions/v1/portal-login
  ```

  O esperado é `403`; antes do passo 5, a resposta era `401`.

**Como desfazer:** apague `TURNSTILE_SECRET_KEY` primeiro, depois a variável da
Vercel, e faça o redeploy.

---

## Etapa 3 — Better Stack (site no ar e rotinas agendadas)

1. [betterstack.com](https://betterstack.com) → **Uptime** → **Monitors** →
   **Create monitor**, um para cada endereço:
   - `https://vela.app.br/` — *Alert us when:* **URL becomes unavailable**,
     checagem a cada **3 minutos**
   - `https://portalfwlog.com.br/portal/login` — mesma configuração
2. **Heartbeats** → **Create heartbeat**, um por rotina:

   | Nome | Expect a heartbeat every | Grace period | Secret no Supabase |
   |---|---|---|---|
   | `alerts-detector` | 15 minutes | 10 minutes | `BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL` |
   | `customer-communication-auto-runner` | 15 minutes | 10 minutes | `BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_AUTO_RUNNER_URL` |
   | `demurrage-dunning` | 1 hour | 15 minutes | `BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL` |
   | `portal-daily-digest` | 1 day | 1 hour | `BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL` |

3. Copie a URL de cada heartbeat (`https://uptime.betterstack.com/api/v1/heartbeat/...`)
   para o secret correspondente em Supabase → **Edge Functions** → **Secrets**.
   Cole a URL como está, sem `/fail` no fim: o código acrescenta `/fail` quando
   a rotina falha.
4. Em **On-call** / **Escalation policies**, defina o e-mail (e o app, se
   quiser) de quem recebe o alarme de madrugada.

**Conferência:**
- em até 25 minutos, `alerts-detector` e `customer-communication-auto-runner`
  ficam **Up**;
- `demurrage-dunning` fica **Up** em até 1 hora;
- `portal-daily-digest` fica **Up** depois das 08:00 de Brasília (11:00 UTC).

Um heartbeat **Down** logo depois do cadastro quase sempre é o nome do secret
digitado errado.

**Como desfazer:** apague os secrets; as rotinas continuam rodando, só sem
avisar.

---

## Etapa 4 — Sentry (erros do app, do Portal e das Edge Functions)

1. No Sentry, confirme os projetos `vela` (interno) e `fwlog-portal` (Portal).
   Em cada um: **Settings → Client Keys (DSN)** → copie o DSN.
2. Vercel → projeto `vela` → **Environment Variables**:
   - `VITE_SENTRY_DSN_INTERNAL` = DSN do `vela` (Production e Preview)
   - `VITE_SENTRY_ENVIRONMENT` = `production`, só em **Production**
   - `VITE_SENTRY_ENVIRONMENT` = `preview`, só em **Preview**
3. Vercel → projeto `fwlog-portal`: o mesmo, com `VITE_SENTRY_DSN_PORTAL` = DSN
   do `fwlog-portal`.
4. Faça **Redeploy** de Production nos dois projetos.
5. Supabase → **Edge Functions** → **Secrets**:
   - `SENTRY_DSN` = DSN do projeto `vela`
   - `SENTRY_ENVIRONMENT` = `production`
6. Em cada projeto do Sentry: **Alerts → Create Alert → Issues** → *A new issue
   is created*, com filtro `environment:production` → ação: e-mail para você.

**Conferência:** no Sentry, em **Issues**, os filtros `environment:preview` e
`environment:production` separam os dois ambientes. Os eventos do Portal não
trazem ID de Cliente.

**Como desfazer:** apague as variáveis; o código volta ao DSN antigo
compartilhado.

---

## Etapa 5 — PostHog (só conferência; já está ligado)

A chave do PostHog já está no build de produção do Portal.

1. PostHog (região **EU**) → **Project settings**: confirme que a **Project API
   Key** é a mesma de `VITE_POSTHOG_KEY` no projeto `fwlog-portal` da Vercel, e
   que `VITE_POSTHOG_HOST` = `https://eu.i.posthog.com`.
2. Não coloque `VITE_POSTHOG_KEY` no projeto `vela` da Vercel.

**Conferência:** abra uma fatura no Portal com um usuário de teste. Em
**Activity**, no PostHog, deve aparecer `invoice_viewed` só com `surface` e
`invoice_type`, sem URL, CNPJ ou e-mail. No console do navegador não pode haver
erro de CSP do PostHog.

---

## Etapa 6 — Backup cifrado diário no R2

**O que é salvo:** o schema `public` (todos os dados de negócio), cifrado antes
de sair da máquina. **Não** entram os usuários do Auth nem os arquivos do
Storage; para eles vale o backup do próprio Supabase (Dashboard → **Database →
Backups**).

1. **Bucket:** Cloudflare → **R2** → confirme o bucket `vela-database-backups`.
   Se não existir: **Create bucket**, sem domínio público. Em **Settings →
   Object lifecycle rules → Add rule**, configure para apagar objetos após
   **90 dias**.
2. **Token:** R2 → **Manage R2 API Tokens** → **Create API Token** → permissão
   **Object Read & Write**, em **Apply to specific buckets only** →
   `vela-database-backups`. Guarde o **Access Key ID**, a **Secret Access Key**
   e o endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Chave de cifragem:** gere a chave e guarde **no gerenciador de senhas**,
   separada do token do R2. Sem ela, o backup é ilegível:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. **Conexão do banco:** Supabase → **Connect** → **Session pooler** → copie a
   URI e troque `[YOUR-PASSWORD]` pela senha do banco.
5. **Programas no Windows:** instale o Node 24, o **PostgreSQL 17** (para ter
   `pg_dump` e `pg_restore`; marque só "Command Line Tools") e o **AWS CLI v2**.
   Confira no PowerShell:

   ```powershell
   node --version; pg_dump --version; pg_restore --version; aws --version
   ```

6. **Variáveis do usuário do Windows** (PowerShell). Os valores ficam no perfil
   do usuário, nunca no repositório:

   ```powershell
   [Environment]::SetEnvironmentVariable('SUPABASE_DB_URL', '<URI do passo 4>', 'User')
   [Environment]::SetEnvironmentVariable('BACKUP_ENCRYPTION_KEY_HEX', '<chave do passo 3>', 'User')
   [Environment]::SetEnvironmentVariable('R2_ENDPOINT', 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com', 'User')
   [Environment]::SetEnvironmentVariable('R2_BUCKET', 'vela-database-backups', 'User')
   [Environment]::SetEnvironmentVariable('R2_ACCESS_KEY_ID', '<Access Key ID>', 'User')
   [Environment]::SetEnvironmentVariable('R2_SECRET_ACCESS_KEY', '<Secret Access Key>', 'User')
   [Environment]::SetEnvironmentVariable('BACKUP_ALLOW_PRODUCTION', 'YES', 'User')
   ```

   Feche e reabra o PowerShell.
7. **Ensaio e primeira execução**, na pasta do repositório:

   ```powershell
   node scripts/backup-r2.mjs --dry-run --environment production --project-ref fgmkhbzhaeebrsizwccx
   node scripts/backup-r2.mjs --execute --allow-production --environment production --project-ref fgmkhbzhaeebrsizwccx
   ```

   O segundo comando termina com `upload concluido no prefixo R2`. No bucket
   devem aparecer `vela/database/production/fgmkhbzhaeebrsizwccx/<data>.dump.enc`
   e o `.manifest.json` correspondente.
8. **Agendamento:** Agendador de Tarefas → **Criar Tarefa** (não "Criar Tarefa
   Básica"):
   - **Geral:** nome `Backup Diario Vela R2`; marque **Executar estando o
     usuário conectado ou não**.
   - **Disparadores:** Diariamente, 09:00.
   - **Ações:** Programa `C:\Program Files\nodejs\node.exe`; Argumentos
     `scripts\backup-r2.mjs --execute --allow-production --environment production --project-ref fgmkhbzhaeebrsizwccx`;
     Iniciar em: a pasta do repositório (ex.: `C:\Users\Lucca\Downloads\Vela`).
   - **Configurações:** marque **Executar a tarefa assim que possível após uma
     inicialização agendada ter sido perdida**.

**Conferência:** no dia seguinte, deve haver um novo par de objetos no bucket.
Uma vez por trimestre, baixe um `.dump.enc` e valide, sem restaurar nada:

```powershell
node scripts/backup-r2.mjs --verify C:\caminho\<arquivo>.dump.enc
```

**Como desfazer:** desative a tarefa e revogue o token do R2.

---

## Etapa 7 — Previews protegidas no Cloudflare Pages

Os projetos `vela-internal` e `vela-portal` já existem (upload direto, sem
integração Git). O secret `CLOUDFLARE_PAGES_API_TOKEN` e a variável
`CLOUDFLARE_ACCOUNT_ID` já estão no GitHub.

1. Cloudflare → **Zero Trust** → **Access** → **Applications**. Confirme que
   existem aplicações cobrindo `*.vela-internal.pages.dev` e
   `*.vela-portal.pages.dev`, com política **Allow** → **Include: Emails** →
   `luccafwlog@gmail.com`, e nenhuma outra regra Include.
2. GitHub → **Settings → Secrets and variables → Actions → Variables** →
   **New repository variable**: `CLOUDFLARE_PAGES_ACCESS_CONFIGURED` = `true`.
3. Abra uma PR pequena (por exemplo, um ajuste de texto) e espere o CI. O
   workflow **Cloudflare Pages Preview** publica `pr-<n>.vela-internal.pages.dev`
   e `pr-<n>.vela-portal.pages.dev`; os links aparecem no resumo da execução.
4. **Teste autorizado:** abra os dois links, entre com `luccafwlog@gmail.com` e
   faça login no Vela e no Portal da Preview.
5. **Teste negado:** em janela anônima, tente outro e-mail. O Access tem de
   recusar.

**Como desfazer:** se o teste 5 falhar, apague na hora a variável do passo 2.
Nenhuma nova Preview é publicada até corrigir o Access.

---

## Etapa 8 — Produção no Cloudflare Pages, sem trocar domínio

O workflow `.github/workflows/cloudflare-pages-production.yml` compila o `main`
e publica `dist/pages-internal` em `vela-internal` e `dist/pages-portal` em
`vela-portal`. Não configure build pelo painel do Pages: os projetos são de
upload direto, e `npm run build` com a pasta `dist` publicaria o app interno no
lugar do Portal, sem os cabeçalhos de segurança.

1. GitHub → **Settings → Environments → New environment** →
   `cloudflare-production`. Em **Deployment branches and tags**, escolha
   **Selected branches and tags** → `main`.
2. No environment, **Add environment variable** para cada item abaixo. Todos são
   valores públicos do navegador; copie-os da Vercel → projeto `fwlog-portal` →
   Environment Variables → Production:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `VITE_SENTRY_DSN_INTERNAL`, `VITE_SENTRY_DSN_PORTAL`
   - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
   - `VITE_TURNSTILE_SITE_KEY`
3. Nas **Variables** do repositório, crie `CLOUDFLARE_PAGES_PRODUCTION_ENABLED`
   = `true`.
4. Em **Actions → Cloudflare Pages Production → Run workflow**, rode na branch
   `main`.
5. Teste em `https://vela-internal.pages.dev` e
   `https://vela-portal.pages.dev/portal/login`:
   - login interno e navegação por Viagens, B/Ls e Faturamento;
   - login do Portal (com Turnstile), faturas, e **F5** dentro de
     `/portal/billing` (rota profunda);
   - nenhum erro de CSP no console do navegador;
   - `vela-internal.pages.dev/portal` redireciona para
     `portalfwlog.com.br/portal`.

A partir daqui, cada merge no `main` publica nos dois lugares, Vercel e Pages.

**Como desfazer:** apague a variável do passo 3.

---

## Etapa 9 — DNS na Cloudflare (a hospedagem continua na Vercel)

Faça um domínio por vez, fora do horário comercial, começando por `vela.app.br`
(uso interno). Só passe para `portalfwlog.com.br` depois de 24 horas sem
problema.

1. **Foto do DNS atual.** No terminal, guarde a saída num arquivo; ela é o
   plano B (troque `D` pelo domínio da vez):

   ```bash
   D=portalfwlog.com.br; for t in A AAAA CNAME MX TXT NS CAA; do echo "== $t"; dig +short $t $D; done; for s in www _dmarc resend._domainkey send; do echo "== $s"; dig +short CNAME $s.$D; dig +short TXT $s.$D; dig +short MX $s.$D; done
   ```

2. **DNSSEC.** Registro.br → domínio → **DNS** → seção **DNSSEC**. Se houver
   chave (DS) cadastrada, **remova-a** e espere **24 horas** antes do passo 5.
   Trocar os servidores DNS com o DS antigo derruba o domínio.
3. Cloudflare → **Add a domain** → digite o domínio → deixe a opção de
   **importar automaticamente** os registros (Quick scan) → plano **Free**.
4. Na revisão dos registros, compare com a foto do passo 1, **um a um**:
   - todos os registros de e-mail precisam estar lá, idênticos: **MX**
     (ImprovMX), **TXT** de SPF, **TXT** de `_dmarc` e os do Resend
     (`resend._domainkey`, `send`, com o MX e o TXT de `send`). O que faltar,
     adicione em **Add record** com o valor da foto;
   - os registros da Vercel (`A` `76.76.21.21` e/ou `CNAME`
     `cname.vercel-dns.com`) ficam com a nuvem **cinza (DNS only)**. Proxy
     laranja na frente da Vercel quebra a emissão de certificado.
5. Registro.br → domínio → **DNS** → **Alterar servidores DNS** → **Utilizar
   servidores DNS de terceiros** → informe os dois nomes que a Cloudflare
   mostrou.
6. Espere a Cloudflare marcar o domínio como **Active**. Ela avisa por e-mail;
   leva de minutos a algumas horas.
7. Só então ative o DNSSEC novo: Cloudflare → **DNS → Settings → Enable
   DNSSEC** → copie os dados do DS → Registro.br → **DNSSEC** → adicione.

**Conferência** (depois do Active):
- o site abre com cadeado válido;
- login interno e do Portal funcionam;
- um convite de teste do Portal chega por e-mail;
- no Resend → **Domains**, o domínio continua **Verified**, e nada precisa ser
  recriado lá;
- os comandos do passo 1 devolvem os mesmos valores;
- `supabase secrets list --project-ref fgmkhbzhaeebrsizwccx` continua listando
  `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` e `PORTAL_FROM_EMAIL`. Não é preciso
  alterá-los.

**Como desfazer:** Registro.br → servidores DNS → volte para os anteriores (os
que estavam antes do passo 5). Com o DNSSEC removido no passo 2, a volta é
segura.

---

## Etapa 10 — Domínios no Pages e desligamento da Vercel

Pré-requisito: etapas 8 e 9 concluídas, com os dois domínios **Active** na
Cloudflare.

1. Cloudflare → **Workers & Pages** → `vela-internal` → **Custom domains** →
   **Set up a custom domain** → `vela.app.br` → **Activate domain**. A
   Cloudflare troca o registro da Vercel pelo do Pages.
2. Teste o domínio como na etapa 8, passo 5.
3. Repita para `vela-portal` com `portalfwlog.com.br`, fora do horário
   comercial.
4. Mantenha os projetos da Vercel **por 7 dias** como volta rápida.
5. Depois de 7 dias sem problema, faça na Vercel, em cada projeto: **Settings →
   Domains** → remova o domínio; depois **Settings → Git → Disconnect**, para
   parar os builds.

**Como desfazer (dentro dos 7 dias):** Cloudflare → **DNS** → apague o registro
do Pages e recrie o registro da Vercel com o valor da foto da etapa 9 (nuvem
cinza). Em seguida, remova o custom domain do projeto Pages.

---

## Registro de execução

| Etapa | Data | Quem | Resultado |
|---|---|---|---|
| 0 | 2026-09-24 | Claude Code | #746 no `main`; 4 funções do Portal republicadas |
| 0 | 2026-09-24 | Claude Code | #745 no `main`; 10 funções com CORS republicadas e conferidas (código publicado = `main`; `pr-<n>.vela-portal.pages.dev` aceito, outro `pages.dev` recusado) |
| 1 | 2026-09-24 | Dono + Claude Code | Contador do Upstash conferido (chave com valor 2, sem CNPJ/IP legível); login real com senha certa funcionou |
| 2 | 2026-09-24 | Dono | Parcial: widget `Portal Fwlog` criado e `VITE_TURNSTILE_SITE_KEY` salva na Vercel (tipo Config); redeploy recusado pelo limite diário da Vercel (100 deploys/dia). `TURNSTILE_SECRET_KEY` **não** cadastrado; retomar pelo redeploy, sem cache e sem "Ignore Build Step" |
| 8 | 2026-09-24 | Dono + Claude Code | Adiantada enquanto a Etapa 2 espera a Vercel. Environment `cloudflare-production` (só `main`, 7 variáveis) e `CLOUDFLARE_PAGES_PRODUCTION_ENABLED=true`; workflow verde. Conferido: 200 nos dois `pages.dev` e em `/portal/billing`, CSP presente, `/portal` do interno → 302 para `portalfwlog.com.br`; dono fez login no Vela e no Portal (widget Turnstile visível, F5 em `/portal/billing`, `/portal/esqueci-senha` OK). Erros de `/_vercel/*` no console corrigidos na #750; console limpo nos dois |

### Ocorrido de 2026-09-24 — login do Portal fora do ar

- **Sintoma:** na conferência da Etapa 1, toda tentativa com CNPJ completo
  recebia erro 500 ("Portal indisponível"), inclusive com a senha certa. Nada
  era contado no Upstash nem no balde do Supabase.
- **Causa:** o secret `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`, exigido por
  `portal-login` desde a PR 707 (2026-09-20), nunca foi cadastrado em produção.
  Os testes anteriores usavam corpo vazio, que é recusado antes desse ponto, e
  não revelaram a falha. Os logs guardam só 24 horas; não é possível saber
  desde quando clientes estavam sem acesso.
- **Correção (12:35 UTC):** criado no Auth o usuário técnico
  `portal-login-dummy@portal-interno.transhippingdesk.invalid`
  (`91abc3b0-96ab-49b0-9a7d-750d5e7d9e84`), confirmado, com senha aleatória não
  guardada, sem vínculo em `customer_portal_accounts` nem `user_profiles`; o id
  foi cadastrado como `PORTAL_LOGIN_DUMMY_AUTH_USER_ID`.
- **Conferência:** senha errada com CNPJ sem conta → 401 e falha registrada no
  Supabase e no Upstash; login real do dono com a senha certa funcionou.
- **Prevenção:** a conferência da Etapa 1 passou a exigir a mensagem de senha
  inválida em cada erro e um login com a senha certa. Não apague esse usuário
  técnico: sem ele o login do Portal volta a falhar.
