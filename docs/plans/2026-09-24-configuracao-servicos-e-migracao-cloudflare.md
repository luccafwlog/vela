# Plano de Configuração de Serviços e Migração para Cloudflare

> **Data:** 2026-09-24  
> **Status:** Ativo (para execução assistida pelo Codex)  
> **Objetivo:** Guia prático, objetivo e sem complexidade para auxiliar o operador a habilitar todos os serviços externos do ecossistema Vela e realizar a transição completa da hospedagem da Vercel para a Cloudflare (Pages + DNS + R2 + Turnstile + Zero Trust), seguido dos demais serviços (Better Stack, Sentry, PostHog, Resend e Backup Windows).

---

## Sumário das Etapas

1. **Bloco 1: Cloudflare & Migração da Vercel (Prioridade)**
   - 1.1 Cloudflare Turnstile (Proteção Anti-Bot no Portal)
   - 1.2 Cloudflare R2 (Bucket de Backups)
   - 1.3 Cloudflare DNS (Configuração de Zonas e Registro.br)
   - 1.4 Cloudflare Pages (Deploy de Produção & Desligamento da Vercel)
   - 1.5 Cloudflare Zero Trust (Acesso Seguro a Previews)
2. **Bloco 2: Observabilidade & Alertas**
   - 2.1 Better Stack (Uptime & Heartbeats dos Runners)
   - 2.2 Sentry (Projetos Separados & Alertas de Erro)
   - 2.3 PostHog EU (Telemetria do Portal)
3. **Bloco 3: E-mail e Automações**
   - 3.1 Resend (Configuração de Domínio e Envio Transacional)
   - 3.2 Rotina de Backup R2 no Windows (Agendamento Diário)

---

## Bloco 1: Cloudflare & Transição da Vercel (Prioridade Máxima)

### 1.1 Cloudflare Turnstile (Anti-Bot no Portal)
* **Objetivo:** Proteger o login e recuperação de senha do Portal Fwlog contra ataques de força bruta. O código já está pronto na `main`.
* **Ações no Painel da Cloudflare:**
  1. Acesse o Cloudflare Dashboard → menu lateral **Turnstile** → **Add Site**.
  2. **Site name:** `Portal Fwlog`.
  3. **Domain(s):** Adicione `portalfwlog.com.br` e `localhost`.
  4. **Widget Mode:** Selecione **Managed** (desafio automático e amigável).
  5. Copie a **Site Key** e a **Secret Key** geradas.
* **Configuração dos Ambientes:**
  - **No Vercel** (projeto `fwlog-portal`, ambientes Production e Preview) e **no Cloudflare Pages**:
    Cadastrar a variável: `VITE_TURNSTILE_SITE_KEY=<Site Key copiada>`.
  - **No Supabase Dashboard** (Project Settings → Configuration → Secrets):
    Cadastrar o secret: `TURNSTILE_SECRET_KEY=<Secret Key copiada>`.
* **Resultado Esperado:** Acessar a tela de login do Portal (`/portal/login`) e ver a validação do Turnstile antes de submeter o formulário.

---

### 1.2 Cloudflare R2 (Armazenamento de Backups)
* **Objetivo:** Bucket na nuvem para receber os backups diários do banco de dados do Supabase.
* **Ações no Painel da Cloudflare:**
  1. Acesse Cloudflare Dashboard → **R2** → confirme a existência do bucket privado `vela-database-backups`.
  2. Em **Manage R2 API Tokens** → clique em **Create API Token**.
  3. Selecione a permissão **Object Read & Write**, vinculada especificamente ao bucket `vela-database-backups`.
  4. Salve com segurança:
     - `R2_ACCESS_KEY_ID`
     - `R2_SECRET_ACCESS_KEY`
     - `R2_ENDPOINT` (ex: `https://<account_id>.r2.cloudflarestorage.com`)
     - Nome do bucket: `vela-database-backups`.

---

### 1.3 Cloudflare DNS (Preparação de Zonas)
* **Objetivo:** Passar o gerenciamento de DNS para a Cloudflare para ganho de performance, segurança contra ataques e conexão direta ao Pages.
* **Ações no Painel da Cloudflare:**
  1. Acesse Cloudflare Dashboard → **Add a site**:
     - Adicione `vela.app.br` (selecione o plano **Free**).
     - Adicione `portalfwlog.com.br` (selecione o plano **Free**).
  2. Na tela de revisão de registros DNS, confira se todos os registros existentes atuais foram detectados (A, CNAME, TXT, MX).
  3. A Cloudflare informará dois servidores DNS (ex: `ada.ns.cloudflare.com` e `bob.ns.cloudflare.com`).
* **Ação no Registro.br:**
  - No painel do [Registro.br](https://registro.br), acerte a delegação dos domínios `vela.app.br` e `portalfwlog.com.br` apontando os Servidores DNS para os nameservers fornecidos pela Cloudflare.

---

### 1.4 Cloudflare Pages (Deploy de Produção & Transição da Vercel)
* **Objetivo:** Publicar as duas aplicações (`vela` e `portal`) diretamente no Cloudflare Pages, tornando-o a hospedagem oficial e aposentando a Vercel.
* **Ações no Painel da Cloudflare (Workers & Pages):**
  1. **Aplicação Interna (Vela):**
     - Em Pages, acesse o projeto `vela-internal` (ou crie a partir do repositório GitHub `luccafwlog/vela`).
     - **Build settings:**
       - Framework preset: `Vite`
       - Build command: `npm run build`
       - Build output directory: `dist`
     - **Environment variables (Production):**
       - `VITE_SUPABASE_URL` = `<URL de Produção>`
       - `VITE_SUPABASE_ANON_KEY` = `<Anon Key de Produção>`
       - `VITE_SENTRY_DSN_INTERNAL` = `<DSN Sentry Interno>`
       - `VITE_SENTRY_ENVIRONMENT` = `production`
     - **Custom Domains:** Vincule `vela.app.br`.
  2. **Aplicação do Cliente (Portal Fwlog):**
     - Em Pages, acesse o projeto `vela-portal`.
     - **Build settings:**
       - Framework preset: `Vite`
       - Build command: `npm run build`
       - Build output directory: `dist`
     - **Environment variables (Production):**
       - `VITE_SUPABASE_URL` = `<URL de Produção>`
       - `VITE_SUPABASE_ANON_KEY` = `<Anon Key de Produção>`
       - `VITE_SENTRY_DSN_PORTAL` = `<DSN Sentry Portal>`
       - `VITE_SENTRY_ENVIRONMENT` = `production`
       - `VITE_TURNSTILE_SITE_KEY` = `<Turnstile Site Key>`
     - **Custom Domains:** Vincule `portalfwlog.com.br`.
  3. **Desligamento da Vercel:**
     - Após validar que os dois domínios oficiais estão respondendo com perfeição no Cloudflare Pages, acesse o painel da Vercel e remova os domínios customizados para encerrar o tráfego por lá.

---

### 1.5 Cloudflare Zero Trust (Acesso a Ambientes de Preview)
* **Objetivo:** Garantir que branches de teste/previews geradas pelo GitHub fiquem restritas exclusivamente a você.
* **Ações no Painel Zero Trust:**
  1. Acesse o painel **Zero Trust** → **Access** → **Applications**.
  2. Verifique os apps para `*.vela-internal.pages.dev` e `*.vela-portal.pages.dev`.
  3. Confirme que a política de acesso está configurada com:
     - **Action:** Allow
     - **Rule:** Include → Emails → `luccafwlog@gmail.com`.

---

## Bloco 2: Observabilidade & Alertas

### 2.1 Better Stack (Uptime & Heartbeats dos Runners)
* **Objetivo:** Saber em tempo real se o sistema está no ar e se os jobs em segundo plano rodaram.
* **Ações no Painel do Better Stack:**
  1. **Monitores de Uptime (HTTP Checks):**
     - Criar monitor para `https://vela.app.br/` (cadência: 5 min).
     - Criar monitor para `https://portalfwlog.com.br/portal/login` (cadência: 5 min).
  2. **Heartbeats:**
     - Criar 4 Heartbeats em **Heartbeats** → **Add Heartbeat**:
       - `alerts-detector` (Período: 15 minutos).
       - `customer-communication-auto-runner` (Período: 15 minutos).
       - `demurrage-dunning` (Período: 1 hora).
       - `portal-daily-digest` (Período: 24 horas).
  3. Copiar a URL de cada Heartbeat e cadastrar nos **Secrets do Supabase** (Project Settings → Secrets):
     - `BETTERSTACK_HEARTBEAT_ALERTS_DETECTOR_URL`
     - `BETTERSTACK_HEARTBEAT_CUSTOMER_COMMUNICATION_URL`
     - `BETTERSTACK_HEARTBEAT_DEMURRAGE_DUNNING_URL`
     - `BETTERSTACK_HEARTBEAT_PORTAL_DAILY_DIGEST_URL`

---

### 2.2 Sentry (Projetos Separados & Notificações de Erro)
* **Objetivo:** Rastrear falhas do sistema com isolamento entre operação interna e Portal.
* **Ações no Painel do Sentry:**
  1. Confirmar os dois projetos: `vela` (interno) e `fwlog-portal` (Portal).
  2. Obter o DSN público de cada projeto e garantir que estejam configurados nas variáveis de ambiente dos apps no Pages/Vercel:
     - `VITE_SENTRY_DSN_INTERNAL`
     - `VITE_SENTRY_DSN_PORTAL`
  3. Em **Alerts** de cada projeto no Sentry, cadastrar alerta por e-mail para novas ocorrências críticas de erro.

---

### 2.3 PostHog EU (Telemetria do Portal)
* **Objetivo:** Métricas agregadas de uso do Portal (ex: abertura e download de faturas).
* **Ações no Painel do PostHog:**
  1. Confirmar no projeto PostHog (região EU) a chave pública de API.
  2. Garantir que as variáveis estejam no ambiente do `vela-portal`:
     - `VITE_POSTHOG_KEY` = `<sua-key>`
     - `VITE_POSTHOG_HOST` = `https://eu.i.posthog.com`

---

## Bloco 3: E-mail e Automações

### 3.1 Resend (Configuração de Domínio e Envio Transacional)
* **Objetivo:** Envio de convites de acesso, recuperação de senha e notificações automáticas de faturas aos clientes.
* **Ações no Painel do Resend:**
  1. Acesse [Resend](https://resend.com) → **Domains** → **Add Domain**:
     - Adicione `portalfwlog.com.br`.
  2. O Resend gerará registros DNS (DKIM, SPF, MX).
  3. Copie esses registros e adicione-os na zona DNS da Cloudflare para `portalfwlog.com.br`.
  4. Crie uma API Key em **API Keys** com permissão de envio (Sending Access).
  5. Cadastre a chave no **Supabase Dashboard → Secrets**:
     - `RESEND_API_KEY` = `re_<sua-chave>`

---

### 3.2 Rotina de Backup R2 no Windows (Agendamento Diário)
* **Objetivo:** Automatizar o backup completo do banco de dados para a Cloudflare R2 todos os dias às 09:00.
* **Ações na Máquina / Host Windows:**
  1. Confirmar se o utilitário `pg_dump` está disponível no terminal (via instalação do PostgreSQL para Windows).
  2. Definir as variáveis de ambiente locais do sistema (ou script `.env` seguro):
     - `SUPABASE_DB_URL` = `<string de conexão direta ao banco Supabase>`
     - `R2_ENDPOINT` = `https://<account_id>.r2.cloudflarestorage.com`
     - `R2_ACCESS_KEY_ID` = `<token r2>`
     - `R2_SECRET_ACCESS_KEY` = `<token r2 secret>`
     - `R2_BUCKET_NAME` = `vela-database-backups`
     - `BACKUP_ENCRYPTION_KEY_HEX` = `<chave hex de 32 bytes para criptografia AES>`
  3. No **Agendador de Tarefas do Windows** (Task Scheduler):
     - **Criar Tarefa Básica:** Nome `Backup Diario Vela R2`.
     - **Disparador:** Diariamente às 09:00 (marcar opção "Executar assim que possível se uma inicialização agendada for perdida").
     - **Ação:** Iniciar um programa:
       - Programa/script: `node`
       - Argumentos: `scripts/backup-r2.mjs --execute --allow-production`
       - Iniciar em: `C:\Users\Lucca\Downloads\Vela`
