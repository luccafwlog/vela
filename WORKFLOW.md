# WORKFLOW.md — Vela

Manual vivo para desenvolver, testar, migrar e publicar o Vela e o Portal Fwlog.
Stack, comandos e contratos documentais revisados em 2026-09-19; deploy remoto não revalidado nesta revisão.

Use este documento para procedimentos técnicos. Consulte:

- [`CONTEXT.md`](./CONTEXT.md) para linguagem de domínio;
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para fluxos e rotas;
- [`docs/adr/README.md`](./docs/adr/README.md) para decisões;
- [`docs/operations/validacao.md`](./docs/operations/validacao.md) para testes operacionais;
- [`docs/CONVENCOES.md`](./docs/CONVENCOES.md) para estilo e labels de evidência;
- [`docs/RASTREABILIDADE.md`](./docs/RASTREABILIDADE.md) para rastrear rotas até componentes, hooks, RPCs e testes;
- [`docs/README.md`](./docs/README.md) para a hierarquia documental.

Código, migrations e configuração executável são a evidência final quando um
snapshot histórico diverge do estado atual.

## Claude Code e `AGENTS.md`

O Claude Code precisa do mod integrado `agents-md` habilitado para tratar
`AGENTS.md` como instruções do projeto. Configure-o no arquivo de usuário
`~/.claude/settings.json`; `.claude/settings.json` do projeto não configura a
opção do mod. Use `instructionFiles` como `claude-md-or-agents-md` (fallback
quando não há `CLAUDE.md`) ou `claude-md-and-agents-md` (carrega ambos). Depois
da alteração, abra uma conversa nova ou execute `/clear`. Em versões sem esse
mod, use temporariamente um `CLAUDE.md` com `@AGENTS.md`.

## 1. Stack verificada

### Frontend

- React 19 e React DOM;
- TypeScript;
- Vite;
- Tailwind CSS via plugin Vite;
- React Router;
- TanStack Query;
- Zod;
- Vitest e Testing Library;
- `@e965/xlsx` para leitura e escrita de planilhas;
- `qrcode.react` para QR PIX;
- `@sentry/react` para telemetria de produção.

As versões exatas vivem em `package.json` e `package-lock.json`; não as duplique
em documentação.

### Backend e infraestrutura

- Supabase PostgreSQL, Auth, RLS e RPCs;
- Edge Functions Deno;
- Resend para email;
- Vercel para hosting dos dois builds estáticos (Vela interno e Portal Fwlog),
  cada um em seu projeto, com Preview Deployments em PRs e Production
  Deployments no `main`;
- GitHub Actions para CI e deploy.

## 2. Arquitetura de execução

```text
Browser
  ├─ sessão interna: supabase
  └─ sessão do Portal: supabasePortal (storage isolado)
       ↓
Supabase
  ├─ PostgreSQL + RLS
  ├─ RPCs transacionais
  ├─ Auth
  └─ Edge Functions
```

Os clientes ficam em `src/services/supabase.ts`.

### Sessão interna

O usuário autentica pelo Supabase Auth e precisa de perfil ativo em
`user_profiles`. `ProtectedRoute` melhora a navegação, mas não é a fronteira de
segurança. Policies e funções do banco precisam continuar corretas mesmo para
uma chamada direta à API.

### Sessão do Portal

O Portal usa Supabase Auth com cliente e chave de storage próprios. A tela aceita
CNPJ e senha. A Edge Function `portal-login` resolve a identidade técnica no
servidor e devolve somente os tokens de sessão; `portal_resolve_login(text)`
não é um contrato de frontend.

Não existe sessão alternativa por senha armazenada em tabela. O acesso anônimo ao resolver da ADR 0013 foi revogado; a
[ADR 0047](./docs/adr/0047-grants-de-funcao-fechados-por-padrao.md) registra
a exceção pública remanescente: `portal_ship_schedule()`.

## 3. Estrutura do repositório

```text
src/
  AppInterno.tsx          mapa de rotas do sistema interno
  AppPortal.tsx           mapa de rotas do Portal Fwlog
  main.tsx                providers globais e telemetria
  pages/                  composição de telas
  hooks/                  queries e mutations reutilizáveis
  services/               Supabase, parsers, imports e domínio
  components/
    ui/                   primitivas visuais
    layout/               shells e guards
    shared/               componentes entre módulos
    billing/              faturamento
    demurrage/            demurrage
  lib/                    utilitários puros
  types/database.ts       tipos gerados e complementos

scripts/
  check-docs.mjs          verificação de documentação (`npm run docs:check`)
  check-destructive-migrations.mjs
                          declaração exigida em migration destrutiva
                          (`npm run migrations:check`)
  provision-preview-admin.mjs  fixture autenticada da Preview Supabase
  perf/                   harness de orçamento de carga das rotas
  design-audit/           bootstrap e seed da auditoria de design

supabase/
  migrations/             história do schema
  functions/              Edge Functions
  scripts/                scripts operacionais
  seeds/                  dados de validação

public/
  templates/              modelos baixados pelo usuário
  branding/               imagens públicas

docs/
  README.md               mapa documental
  ARCHITECTURE.md         arquitetura atual
  ROADMAP.md              baseline, evolução e riscos
  adr/                    decisões arquiteturais
  operations/             regras, validação, segurança e reset
  setup/                  desenvolvimento, testes e deploy
  modules/                documentação por módulo
  CONVENCOES.md           convenções de documentação
  spec/                   specs ainda sem implementação concluída
  plans/                  planos de implementação vivos
  archive/                histórico: planos executados, specs concluídas, auditorias, relatórios
```

Para obter contagens atuais, derive-as do repositório. Exemplo:

```powershell
(Get-ChildItem supabase/migrations -File -Filter *.sql).Count
```

## 4. Preparação local

### Dependências

Use Node.js 24.x, conforme `package.json#engines` e o CI.

```powershell
npm ci --legacy-peer-deps
```

Use `npm ci` para reproduzir o lockfile. Alterações intencionais de dependência
devem atualizar `package.json` e `package-lock.json` juntas.

### Ambiente

```powershell
Copy-Item .env.example .env
```

Variáveis obrigatórias para o app:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publica
```

As variáveis `SUPABASE_*` adicionais são usadas pela suíte de integração. Não
coloque service role no bundle Vite.

Edge Functions de Portal usam `RESEND_API_KEY`, `PORTAL_FROM_EMAIL`,
`PORTAL_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, `NOTIFY_WEBHOOK_SECRET` e
`PORTAL_DIGEST_SECRET` somente em secrets do Supabase. O job `pg_cron` do
resumo diário é sempre agendado, e encontra a base da API e o segredo no
Supabase Vault, sob os nomes `SUPABASE_URL` e `PORTAL_DIGEST_SECRET` — os
mesmos dos Edge Function Secrets, que rotacionam em par com o cofre (ADR 0063
e [`docs/operations/segredos-cron.md`](./docs/operations/segredos-cron.md)).
Com o cofre vazio o job fica inerte e registra `WARNING`, em vez de disparar.
Webhooks e cron têm
`verify_jwt = false` em `supabase/config.toml` e validam seus próprios segredos.
Sem `RESEND_API_KEY`, o módulo transacional opera em dry-run. O domínio do
remetente precisa estar verificado antes de qualquer envio real.

Os consumidores da remediação usam `PORTAL_EMAIL_EVENTS_CRON_SECRET`,
`IMPORT_EFFECTS_CRON_SECRET` e `RECALC_CRON_SECRET`, sempre em par entre o
secret da Edge Function e o Supabase Vault. `import-effects-runner` também exige
`IMPORT_EFFECTS_RUNNER_ENABLED=true`; sem essa variável o endpoint responde
paused e não faz claim. O job de PTAX continua deliberadamente inativo até a
validação externa descrita em `docs/operations/segredos-cron.md`.

### Execução

```powershell
npm run dev
```

O Vite usa a porta padrão local. O proxy `/sb-proxy` existe apenas para a
auditoria de design com Supabase local.

## 5. Migrations Supabase

O diretório usa um único esquema: prefixo sequencial numerado de três dígitos
(`001_…` em diante). Migrations que nasceram com timestamp UTC foram
renumeradas uma única vez para esse padrão (ver ADR 0016); o timestamp original
fica preservado como comentário no cabeçalho de cada arquivo afetado.

Não renomeie arquivos já aplicados para “organizar” a pasta. O nome participa do
histórico remoto; a renumeração de ADR 0016 foi uma padronização pontual,
validada por replay completo das migrations e só segura em banco descartável
(o `db reset` reaplica do zero e ressincroniza `schema_migrations`).

### Aplicação no remoto

O **Automatic branching** da integração GitHub do Supabase permanece habilitado.
Cada branch do GitHub recebe uma branch Supabase efêmera correspondente; as
migrations em `supabase/migrations/` são executadas pelo branch action antes do
Preview ser usado. A integração Supabase/Vercel atualiza as variáveis públicas
do Preview para o project ref dessa mesma branch e reimplanta o Preview quando
necessário.

No merge ou push em `main`, a opção **Deploy to production** aplica as migrations
pendentes no projeto Supabase de produção (`fgmkhbzhaeebrsizwccx`). Não aplique
migrations remotas por ferramentas que geram versão **timestamp** (ex.: `apply_migration`
do MCP Supabase): elas gravam em `supabase_migrations.schema_migrations` uma
versão sem arquivo local correspondente, e a checagem de branching falha com
*“Remote migration versions not found in local migrations directory”*
(`MIGRATIONS_FAILED`). Se acontecer, faça uma reconciliação forward explícita;
não edite migrations aplicadas.

### Antes de criar

1. declare o problema de negócio;
2. identifique todas as tabelas, funções e policies afetadas;
3. leia as migrations recentes e o schema real;
4. confira os ADRs de segurança e domínio relevantes;
5. defina rollback ou reversão operacional.

As regras desta seção são a referência operacional para migrations; mantenha
rollback, RLS, grants, numeração sequencial e validação em banco descartável.

### Validar em banco descartável (local)

Para replay real das migrations sem tocar em produção, rode
`scripts/setup-local-pg.sh` — ele sobe um **PostgreSQL 16 local e descartável**,
aplica os shims Supabase (schema `auth`, roles `anon`/`authenticated`/
`service_role`, `pgcrypto` no schema `extensions`, stub de `pg_cron`, publicação
`supabase_realtime`) e replica todas as migrations. Ecoa a `DATABASE_URL`
(`postgresql://postgres:postgres@127.0.0.1:5432/vela_test`). Use
`--reset` para recriar do zero. Nunca aponte validação de migration ao projeto
Supabase de produção.

### Nome de arquivo novo

```text
NNN_descricao_curta.sql
```

Use o próximo número sequencial disponível — derive-o do repositório com
`ls supabase/migrations/ | sort | tail -1` e some 1 — com três dígitos e zero
à esquerda. Em caso de branches paralelos, reconcilie os números antes do
merge para preservar a ordem lexicográfica = ordem de aplicação.

### Migration que reescreve ou apaga dados

Uma migration que faz `UPDATE`, `DELETE`, `TRUNCATE`, `DROP TABLE` ou
`DROP COLUMN` fora de um corpo de função só é aceitável enquanto valer a
afirmação **"Data status"** da seção Gotchas do `AGENTS.md` — hoje: o projeto de
produção não tem dados de negócio. Declare essa dependência no cabeçalho do
arquivo, citando o nome da afirmação e o `AGENTS.md`; veja
`supabase/migrations/061_bl_weight_semantics_and_triggers.sql` como exemplo.

`npm run migrations:check` verifica isso e roda no gate `quality`. Ele ignora
`UPDATE`/`DELETE` dentro de `CREATE FUNCTION` (código que roda depois, a pedido
da aplicação) mas não dentro de blocos `DO` (executam durante o deploy), e não
cobra declaração das migrations anteriores à 061, que são histórico já
aplicado — o relatório conta quantas são.

Se a afirmação tiver sido revogada, declarar dependência não basta: escreva um
plano de preservação.

### Segurança

- tabelas novas precisam de RLS ou revogação explícita para uso servidor;
- funções `SECURITY DEFINER` precisam de `search_path` controlado;
- revogue `PUBLIC` e `anon` no mesmo arquivo por padrão;
- grants pré-autenticação para `anon` exigem decisão explícita, controles contra
  abuso e teste focado;
- trigger functions não precisam ser executáveis diretamente por clientes.

### Tipos

Regere `src/types/database.ts` quando o contrato usado pelo app mudar. Não edite
tipos gerados manualmente para esconder drift.

### Aplicação

O CI da SPA e a Vercel não aplicam migrations. O branch action do Supabase aplica
as migrations no Preview automático correspondente à PR; depois do merge, a
integração GitHub do Supabase aplica as pendentes em produção. Confirme o check
do Supabase Preview antes do merge e, em caso de falha, compare o histórico
remoto com os arquivos locais antes de reexecutar. Após DDL, verifique advisors
e o contrato usado pela aplicação.

As migrations `022`–`026` e `031`–`037` são a integração atual da remediação:
inbox/dispatch de email, autoridade e snapshot de Demurrage, alerta persistente
de PTAX, consumidor de efeitos de importação e seus consumidores de Granito,
veículos e carga solta (`031`), status parcial de despacho de comunicados (`032`),
readiness guards de CE Mercante antes do dispatch (`033`), alinhamento normativo
do payload estático Pix/BR Code (`034`), desacoplamento do read-model de resumo
operacional de viagens (`035`), agregados server-side de carga solta (`036`) e
correção forward do status nullable do read-model (`037`).
Elas devem ser aplicadas antes de publicar as Edge Functions correspondentes; a
validação local controlada usa os testes `emailInbox.local-pg.test.ts`,
`demurrageAuthority.local-pg.test.ts`, `exchangeRateIntegrity.local-pg.test.ts` e
`importEffects.local-pg.test.ts`.

Nunca execute um reset amplo para “testar” uma migration. O reset operacional
atual está suspenso em
[`docs/operations/reset-ambiente.md`](./docs/operations/reset-ambiente.md).

## 6. Acesso a dados e React Query

### Serviços

Serviços em `src/services/` são os donos preferenciais de:

- chamadas Supabase reutilizáveis;
- regras de domínio;
- parsing e importação;
- exportações;
- normalização de respostas;
- erros de operação.

Uma função de serviço deve retornar dados úteis ou lançar o erro. Não transforme
falha real em sucesso vazio.

### Hooks

Hooks em `src/hooks/` são preferidos quando há:

- estado remoto reutilizado;
- loading/error/refetch compartilhado;
- cache;
- mutation com invalidação;
- consumo por mais de uma tela ou componente.

Use chaves de `src/services/queryKeys.ts` quando já existir uma família para o
domínio. Confira a forma exata do prefixo: acrescentar `undefined` pode impedir
uma invalidação por prefixo.

### Chamadas diretas por páginas

O código atual também chama serviços diretamente em páginas para comandos
pontuais, como importação, exportação, impressão e ações de baixa frequência.
Isso é aceitável quando corresponde ao padrão local e não duplica estado remoto.

Não crie uma chamada Supabase direta numa página se um serviço ou hook já é o
dono daquela operação.

### Supabase direto

Há fluxos legados que importam `supabase` diretamente. Ao tocar neles:

1. preserve a mudança cirúrgica;
2. extraia serviço/hook apenas quando isso reduzir duplicação ou permitir teste;
3. não faça uma migração arquitetural ampla sem plano próprio.

## 7. Importações e planilhas

As regras abaixo são a referência operacional para importações e planilhas.

Regras mínimas:

1. inspecionar arquivo real;
2. validar tamanho com `assertUploadSize` antes de `arrayBuffer()` ou parsing;
3. importar planilhas por `await import('@e965/xlsx')` quando possível;
4. manter parser puro separado da persistência;
5. adicionar fixture e teste de regressão;
6. usar RPC quando múltiplas escritas precisarem ser atômicas;
7. exibir preview e resumo de erros antes da confirmação;
8. validar duplicidade ou idempotência.

Parsers existentes são referências, não contratos universais:

- `blParser.ts` e `blFreightImport.ts`: ingestão documental de B/L de container;
- `breakbulkImport.ts`: carga solta;
- `baplieParser.ts` e `baplieImport.ts`: EDI e staging;
- `vehicleImport.ts`: veículos;
- `ceMercanteImport.ts`: CE;
- `containerDatesImport.ts`: datas;
- `customerBase.ts`: clientes.

## 8. Rotas e páginas

`src/AppInterno.tsx` e `src/AppPortal.tsx` são as fontes executáveis das rotas,
cada uma no seu build.

### Nova rota

1. crie uma página com export nomeado;
2. carregue-a por `lazyPage`;
3. coloque-a sob o guard apropriado;
4. adicione navegação, se aplicável;
5. atualize `docs/ARCHITECTURE.md`;
6. execute `npm run docs:check`.

Rotas do Portal ficam sob `PortalProtectedRoute` e `PortalLayout`. Rotas internas
ficam sob `ProtectedRoute` e `AppLayout`. Administração de usuários usa
`adminOnly`.

## 9. Componentes e interface

- reutilize componentes de `src/components/ui/`;
- use tokens CSS de `src/index.css`;
- mantenha lógica de domínio fora de primitivas visuais;
- preserve estados de loading, vazio, erro e feedback de mutation;
- ícones sem texto precisam de nome acessível;
- ações destrutivas precisam de confirmação e proteção no banco.

As páginas grandes devem ser decompostas somente quando a mudança em curso
ganhar clareza ou testabilidade. Não refatore uma tela inteira como efeito
colateral de uma correção pequena.

## 10. Invoices e impressão

O sistema usa documentos React preparados para impressão:

- `src/components/billing/InvoiceDocumentLocal.tsx`;
- `src/components/demurrage/InvoiceDocument.tsx`;
- `src/components/shared/InvoiceDocumentKit.tsx`;
- `src/components/shared/invoiceFormat.ts`;
- regras `@media print` em `src/index.css`.

A ação chama `window.print()`. O usuário escolhe impressora ou “Salvar como PDF”
no navegador.

Não adicione biblioteca de PDF sem requisito explícito que o diálogo de
impressão não consiga atender; preserve o fluxo de impressão descrito acima.

## 11. Testes e validação

### Gate local

Escolha os checks pelo impacto da alteração. Para mudanças somente em Markdown
ou instruções de agentes, rode `npm run docs:check` e `git diff --check`; se uma
skill tiver scripts alterados, valide também esses scripts. Não rode a suíte da
aplicação apenas por uma mudança de prosa.

Para mudanças de aplicação ou configuração que possam afetar esses contratos,
o gate completo é:

```powershell
npm run docs:check
npm run typecheck
npm run lint
npm test
npm run build
```

Execute testes focados durante a implementação. Após corrigir falhas, repita os
checks afetados; resultados de código e ambiente inalterados continuam válidos.
Os gates do CI permanecem obrigatórios conforme a seção 12.

### Isolamento entre arquivos de teste

`src/test/setup.ts` roda antes de cada arquivo e desmonta o que o React
Testing Library renderizou ao fim de cada teste. Não declare `afterEach(cleanup)`
em arquivos novos — os que já declaram continuam corretos, porque `cleanup` é
idempotente.

O Vitest roda com isolamento por arquivo (`isolate` no padrão). Isso é
obrigatório aqui: 134 arquivos usam `vi.mock` para substituir `supabase`,
hooks e componentes, e dependem de um registro de módulos limpo por arquivo.
Rodar com `--no-isolate` é ~2,5x mais rápido, mas quebra um conjunto
**não determinístico** de arquivos, que muda conforme a distribuição entre
workers. Só faz sentido reavaliar se as dependências passarem a ser injetadas
em vez de mockadas por módulo.

### Orçamento de bundle

```powershell
npm run build
npm run size-limit
```

`npm run size-limit` valida o JS de carga inicial (entry + chunks
pré-carregados em `dist/index.html`) contra o orçamento de 250 kB
comprimidos, configurado na chave `size-limit` do `package.json`. Se um
chunk novo passar a ser pré-carregado, inclua o glob correspondente na
configuração. O CI executa esse gate após o build em todo PR.

### Testes de integração

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Exigem Supabase real e dados controlados. Não aponte a suíte destrutiva para
produção.

### Validação manual

Auth, RLS, RPCs, Edge Functions, email, impressão, PIX e fluxos completos
dependem de ambiente real ou equivalente. Registre ambiente, usuário, dados,
resultado e evidência conforme
[`docs/operations/validacao.md`](./docs/operations/validacao.md).

## 12. CI e deploy

### Pull request

`.github/workflows/ci.yml` executa cinco jobs em paralelo em pull requests e
pushes para `main`, usando Node.js 24 e instalação reproduzível própria (`npm ci
--legacy-peer-deps`):

1. `quality` — verificação documental, lint e a declaração exigida em migration
   destrutiva (`npm run migrations:check`);
2. `build` — build (`tsc` + `vite`) e orçamento de bundle;
3. `test` — suíte Vitest dividida em 3 shards (`--shard=N/3`);
4. `security-audit` — replay estático de autorização (`verificar_guardas.py`);
5. `migration-replay` — aplica as migrations do zero num PostgreSQL 16
   descartável (`setup-local-pg.sh --reset`) e trava invariantes em banco real
   (`check-squash-replay.sql`): é o único gate que executa SQL;
6. `checks` — gate agregador que só fica verde quando os cinco terminam verdes.

`checks` é o nome estável para a proteção de branch: a quantidade de shards
pode mudar sem reconfigurar o repositório. Runs antigos do mesmo ref são
cancelados (`concurrency` + `cancel-in-progress`), então só o commit mais
recente do PR ocupa runners.

Após um CI verde, `.github/workflows/provision-preview-admin.yml` executa no
contexto confiável da branch padrão, aguarda o check `Supabase Preview`, obtém
as credenciais da branch efêmera e roda `scripts/provision-preview-admin.mjs`.
Esse script cria ou atualiza `qa-admin@example.test` pela Auth Admin API e
garante seu `user_profiles.role = 'admin'`. O password fica exclusivamente no
secret `PREVIEW_ADMIN_PASSWORD`; o workflow também exige os secrets
`SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`. Não faça checkout do código da
PR nesse workflow nem coloque credenciais server-side em `VITE_*`.
PRs de forks são ignoradas pelo provisionamento porque não podem receber esses
secrets nem têm branch automática no projeto Supabase conectado.

### Push em main

O projeto Vercel integrado ao GitHub executa Preview Deployments para pull
requests e Production Deployments para `main`. O CI do GitHub permanece como
gate independente de documentação, lint, build, bundle size e testes.

O Preview do Vercel deve usar a integração de branching do Supabase para
receber `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` da branch Supabase
automática daquela PR. Não defina uma URL fixa de Preview no projeto Vercel;
`main` usa somente as credenciais do projeto de produção.

O login com o usuário fixo só deve ser tentado depois que o job `Provision
Preview Admin` estiver verde. A Vercel pode concluir seu build antes desse job,
porque o provisionamento altera dados da Auth, não o artefato estático.

### Edge Functions e banco

O deploy da Vercel não publica Edge Functions nem aplica migrations. Coordene
essas etapas no Supabase antes do frontend que depende delas.

## 13. Telemetria e falhas

`src/lib/telemetry.ts` inicializa Sentry somente em produção e associa o release
ao commit injetado no build.

- falhas principais devem chegar à UI e interromper a operação insegura;
- escritas best-effort podem seguir, mas precisam chamar a telemetria;
- não envie segredos ou PII em contexto de erro;
- mensagens ao usuário devem distinguir regra de negócio de indisponibilidade.

## 14. Checklist de mudança

Antes de concluir:

- a mudança é mínima e rastreável ao pedido;
- regras de domínio usam termos do `CONTEXT.md`;
- decisões novas ou supersessões foram registradas;
- rotas, comandos, auth, migrations e procedimentos atualizaram os documentos
  vivos;
- testes focados passaram;
- `npm run docs:check`, lint, testes e build passaram quando aplicáveis;
- `git diff --check` não aponta whitespace;
- snapshots históricos não foram reescritos como se descrevessem o presente.
