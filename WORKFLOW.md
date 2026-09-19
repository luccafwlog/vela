# WORKFLOW.md — Vela

Manual vivo para desenvolver, testar, migrar e publicar o Vela e o Portal Fwlog.
Stack, comandos e contratos documentais revisados em 2026-09-19.

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

Execute os comandos a partir da raiz do checkout correto. Antes de instalar,
editar ou sincronizar, confira `git status --short` e a branch atual; preserve
alterações alheias. `npm run sync` exige avanço fast-forward da branch atual.
`npm run sync:hard` descarta alterações e arquivos não rastreados e redefine a
branch para `origin/main`: não é procedimento de atualização cotidiana.

| Necessidade | Seção |
|---|---|
| Preparar e executar as duas aplicações | 4 |
| Alterar schema ou contrato de RPC | 5 e 11 |
| Alterar acesso a dados, imports ou rotas | 6–8 |
| Escolher verificações e interpretar CI | 11–12 |
| Entregar a mudança | 14 |

## Claude Code e `AGENTS.md`

O repositório mantém suas instruções em `AGENTS.md`, sem um `CLAUDE.md` na
raiz. Sincronizar ou fazer merge entrega o arquivo; não comprova que o Claude
Code instalado naquela máquina o carregou.

Para instalações que disponibilizam o mod integrado `agents-md`:

1. Confirme que o mod está disponível e habilitado em `/plugin`. Em `/config`,
   confira a opção **Project instructions**.
2. Use `claude-md-or-agents-md` para carregar `AGENTS.md` na ausência de
   instruções próprias do projeto, ou `claude-md-and-agents-md` para carregar
   ambos. No modo fallback, um `CLAUDE.md`, `.claude/CLAUDE.md` ou
   `CLAUDE.local.md` no caminho até o diretório de trabalho pode impedir o
   carregamento. Inspecione eventuais conflitos antes de alterar esses arquivos.
3. Se configurar por arquivo, mescle a entrada abaixo nas configurações do
   usuário (`~/.claude/settings.json`), preservando as demais opções.
   `.claude/settings.json` do projeto não configura opções desse mod.

```json
{
  "pluginConfigs": {
    "agents-md@builtin": {
      "options": { "instructionFiles": "claude-md-or-agents-md" }
    }
  }
}
```

Abra uma conversa nova ou execute `/clear` e verifique o anúncio de
carregamento de `AGENTS.md` no contexto da sessão. JSON válido comprova apenas
a configuração gravada; `/memory` não é um inventário desses arquivos.
Se o mod não estiver disponível, ou não houver evidência de carregamento,
registre essa limitação e investigue suporte/configuração da instalação.
Não recrie `CLAUDE.md` como fallback automático nem declare a máquina pronta
apenas pela presença da opção. Essa verificação é por instalação, inclusive
quando Windows e WSL coexistirem.

Referência: [documentação oficial do mod agents-md](https://github.com/anthropics/claude-code/tree/main/mods/agents-md).

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
  main.tsx                entrada interna, providers e telemetria
  portal-main.tsx         entrada do Portal, providers e telemetria
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
  migrations/             cadeia ativa do schema
  migrations_archive/     migrations históricas anteriores ao squash
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
  spec/                   especificações de produto e contrato
  plans/                  planos de implementação documentados
  archive/                histórico: planos, specs, auditorias e relatórios
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

Em Bash/zsh, use `cp .env.example .env`. Copie somente se `.env` ainda não
existir; preserve a configuração local existente. Confira o projeto apontado
pelas variáveis antes de abrir fluxos que escrevem no banco.

Variáveis obrigatórias para o app:

```env
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-publica
```

As variáveis `SUPABASE_*` adicionais do exemplo são usadas pela suíte de
integração e precisam estar no ambiente do processo de teste. Não coloque
service role no bundle Vite. Tudo que usa prefixo `VITE_` pode chegar ao
navegador; mudança de valor exige novo build do artefato publicado.

Confira também `VITE_PORTAL_URL` e `VITE_PORTAL_BILLING_URL`: na ausência
delas há fallback para URLs de produção. Em validação isolada, configure o
destino correto antes de gerar links de comunicação. `.env.example` é a
referência de nomes, não um conjunto de credenciais utilizáveis.

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
O modo dry-run deve ser confirmado no caminho de envio que será exercitado;
não presuma que remover uma chave simula todas as Edge Functions. O domínio do
remetente precisa estar verificado antes de qualquer envio real.

Os consumidores desses fluxos usam `PORTAL_EMAIL_EVENTS_CRON_SECRET`,
`IMPORT_EFFECTS_CRON_SECRET` e `RECALC_CRON_SECRET`, sempre em par entre o
secret da Edge Function e o Supabase Vault. `import-effects-runner` também exige
`IMPORT_EFFECTS_RUNNER_ENABLED=true`; sem essa variável o endpoint responde
paused e não faz claim. O job de PTAX só pode ser ativado depois da validação
externa descrita em `docs/operations/segredos-cron.md`.

### Execução

```powershell
npm run dev
```

Use a URL indicada pelo Vite: `/login` abre o Vela e `/portal/login` abre o
Portal. `vite.config.ts` direciona `/portal/*` para `portal.html` durante o
desenvolvimento. O build gera as duas entradas, `index.html` e `portal.html`.
O proxy `/sb-proxy` é um recurso de desenvolvimento usado pela auditoria de
design; não faz parte do deploy e não equivale ao backend real.

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

O fluxo esperado usa **Automatic branching** da integração GitHub do Supabase.
Confirme sua configuração e os checks da PR no ambiente alvo; o checkout não
comprova que a integração remota está habilitada. Para PRs elegíveis, as
migrations em `supabase/migrations/` são executadas pelo branch action antes do
Preview ser usado. A integração Supabase/Vercel atualiza as variáveis públicas
do Preview para o project ref dessa mesma branch e reimplanta o Preview quando
necessário.

No merge ou push em `main`, quando habilitada, a opção **Deploy to production** aplica as migrations
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
3. leia a cadeia ativa e a última definição de cada objeto; confira o schema
   do ambiente alvo quando a tarefa envolver aplicação remota;
4. confira os ADRs de segurança e domínio relevantes;
5. defina rollback ou reversão operacional.

As regras desta seção são a referência operacional para migrations; mantenha
rollback, RLS, grants, numeração sequencial e validação em banco descartável.

### Validar em banco descartável (local)

O script [setup-local-pg.sh](scripts/setup-local-pg.sh) requer PostgreSQL 16 e
deve rodar na raiz do repositório:

- Debian/Ubuntu: usa o cluster `16/main`, com privilégios para administrar o
  cluster e executar como `postgres` (no CI: `sudo scripts/setup-local-pg.sh --reset`).
- macOS: usa os binários do Homebrew `postgresql@16` ou `PG_BIN`, criando um
  cluster em `TMPDIR`; não usa `brew services`.
- Windows: o script é Bash; use um ambiente WSL com os pré-requisitos Linux.
  Não execute sua sintaxe diretamente no PowerShell.

O alvo é `vela_test`, com porta configurável por `LOCAL_PG_PORT` (padrão 5432).
`--reset` recria esse banco; no macOS também recria o cluster temporário.
O caminho Debian usa um cluster existente e ajusta a senha local de `postgres`:
reserve um ambiente de testes. Sem `--reset`, o script pode retornar ao encontrar
`public.bls`, sem aplicar migrations adicionadas depois do último replay.

O replay executa SQL real, mas usa shims de Auth, Vault, cron, HTTP e Storage.
Não comprova login, envio de email, disparo de cron nem criptografia do Vault.
Não use segredos reais nesses shims. O script imprime uma URL local; não exporta
variáveis para o shell chamador. O seed operacional `supabase/seed.sql` é uma
etapa separada, validada no CI. Nunca aponte testes de migration para produção.

### Nome de arquivo novo

```text
NNN_descricao_curta.sql
```

Use o maior prefixo numérico da cadeia ativa mais um, com três dígitos e zero
à esquerda. Não use a quantidade de arquivos: lacunas históricas não devem ser
preenchidas. Em caso de branches paralelos, reconcilie os arquivos novos antes do
merge para preservar a ordem lexicográfica = ordem de aplicação.

### Migration que reescreve ou apaga dados

Uma migration que faz `UPDATE`, `DELETE`, `TRUNCATE`, `DROP TABLE` ou
`DROP COLUMN` fora de um corpo de função só é aceitável enquanto valer a
afirmação **"Data status"** da seção Gotchas do `AGENTS.md`, datada de
2026-09-18 e revogável pelo proprietário. Consulte sua validade antes da mudança;
este manual não renova a afirmação sobre dados de produção. Declare a dependência no cabeçalho do
arquivo, citando o nome da afirmação e o `AGENTS.md`; veja
`supabase/migrations/061_bl_weight_semantics_and_triggers.sql` como exemplo.

`npm run migrations:check` verifica isso e roda no gate `quality`. Ele ignora
`UPDATE`/`DELETE` dentro de `CREATE FUNCTION` (código que roda depois, a pedido
da aplicação) mas não dentro de blocos `DO` (executam durante o deploy), e não
cobra declaração ausente nas migrations até a 061, inclusive, tratadas como
históricas pelo checker atual. Nesse intervalo também aceita a referência
antiga a `CLAUDE.md`; arquivos novos devem citar `AGENTS.md`. O relatório conta
as exceções. A análise é textual e não detecta toda forma de SQL dinâmico ou
efeito indireto: ela complementa a revisão, não autoriza perda de dados.

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

Quando o contrato usado pelo app mudar, planeje a regeneração de
`src/types/database.ts` a partir do schema correto, preservando os complementos
tipados existentes. O arquivo é protegido: siga a autorização exigida em
`AGENTS.md` antes de modificá-lo. Não edite tipos para esconder drift.

### Aplicação

O CI da SPA e a Vercel não aplicam migrations. O branch action do Supabase aplica
as migrations no Preview automático correspondente à PR; depois do merge, a
integração GitHub do Supabase aplica as pendentes em produção. Confirme o check
do Supabase Preview antes do merge e, em caso de falha, compare o histórico
remoto com os arquivos locais antes de reexecutar. Após DDL, verifique advisors
e o contrato usado pela aplicação.

As migrations `022`–`026` e `031`–`037` implementam os fluxos de:
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
5. deixar um teste de regressão com o menor exemplo representativo; reutilizar
   o harness e evitar fixture com dados pessoais ou scaffolding desnecessário;
6. usar RPC quando múltiplas escritas precisarem ser atômicas;
7. exibir preview e resumo de erros antes da confirmação;
8. validar duplicidade ou idempotência.

Reutilize `src/services/importCore.ts` para leitura de planilhas e casamento de
cabeçalhos quando aplicável. Diferencie importação de arquivo de importação
marítima: Granito ingere arquivos, mas sua carga é de exportação.

Parsers em `src/services/` são referências, não contratos universais:

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
5. atualize `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md` e o módulo dono;
6. execute `npm run docs:check`.

Rotas autenticadas do Portal ficam sob `PortalProtectedRoute`,
`PortalScopeProvider` e `PortalLayout`; login, ativação e recuperação são públicas.
Rotas internas usam `ProtectedRoute`; a maioria usa `AppLayout`, mas TV e
inspeção do Portal têm composição própria. Toda a árvore `/admin` usa
`adminOnly`, e `/clientes/comunicacao` exige `customer_communications`.
Confira também preloading, título, redirects antigos e acesso direto por URL.
Guard de rota não substitui autorização no banco.

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

O Vitest roda com isolamento por arquivo (`isolate` no padrão). Os mocks de
módulo dependem desse isolamento; não use `--no-isolate` como otimização
rotineira. O ambiente padrão é Node; testes de componente optam por jsdom
com `// @vitest-environment jsdom`, conforme `vite.config.ts`.

### Orçamento de bundle

```powershell
npm run build
npm run size-limit
```

`npm run size-limit` executa `scripts/check-size-limit.mjs`. O script soma o
tamanho gzip dos assets JS referenciados por cada HTML, separadamente para
`dist/index.html` e `dist/portal.html`, com limite de **250 KiB por entrada**.
Descobre esses assets no HTML gerado; não usa globs em `package.json`.
Não mede todos os chunks lazy, tempo de renderização nem rede. Para o orçamento
por rota, consulte [setup/testing.md](docs/setup/testing.md).

### Testes de integração

Há dois caminhos distintos:

| Caminho | Ativação e alcance |
|---|---|
| PostgreSQL local | `LOCAL_PG_INTEGRATION=1` e `LOCAL_DATABASE_URL` apontando para o banco descartável; executa SQL com shims |
| Supabase completo | `SUPABASE_RUN_INTEGRATION=1`, credenciais e fixtures controladas; exercita Auth/API no projeto escolhido |

Para Postgres local, depois do replay, execute as suítes relevantes com
`npx vitest run --no-file-parallelism <arquivos.local-pg.test.ts>`.
Use a lista explícita de `.github/workflows/ci.yml` para reproduzir o gate
completo. As suítes compartilham banco e precisam rodar em série; cada uma deve
usar seu próprio namespace de IDs e documentos nas fixtures.

`npm run rpc:check` requer `psql` e banco já preparado. Configure explicitamente
`LOCAL_DATABASE_URL` para o alvo descartável; o script também aceita
`DATABASE_URL` e possui fallback local. Ele compara nomes chamados com
`public.pg_proc`, não valida assinaturas, grants nem comportamento das RPCs.

Para Supabase completo, carregue no ambiente do processo as variáveis indicadas
em `.env.example`, inclusive os IDs das fixtures, antes de habilitar a suíte:

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Exigem Supabase real e dados controlados. Não aponte a suíte destrutiva para
produção. Em Bash, a ativação equivalente é
`SUPABASE_RUN_INTEGRATION=1 npm run test:integration`. Apenas copiar `.env` não
garante que essas variáveis estejam em `process.env` do teste. Casos opcionais
podem ficar skipped se faltarem fixtures: reporte isso, não os conte como aprovados.

### Validação manual

Auth, RLS, RPCs, Edge Functions, email, impressão, PIX e fluxos completos
dependem de ambiente real ou equivalente. Registre ambiente, usuário, dados,
resultado e evidência conforme
[`docs/operations/validacao.md`](./docs/operations/validacao.md).

## 12. CI e deploy

### Pull request

`.github/workflows/ci.yml` define cinco grupos de validação em pull requests e
pushes para `main`, mais o agregador. As etapas Node usam a versão 24 e
`npm ci --legacy-peer-deps`; o replay de guardas usa Python e o replay de banco
requer PostgreSQL 16:

1. `quality` — verificação documental e autotestes, lint, self-check do gerador
   de squash, declaração de migration destrutiva e autotestes desse checker;
2. `build` — build (`tsc` + `vite`) e orçamento de bundle;
3. `test` — suíte Vitest dividida em 3 shards (`--shard=N/3`);
4. `security-audit` — replay estático de autorização (`verificar_guardas.py`);
5. `migration-replay` — aplica as migrations do zero num PostgreSQL 16
   descartável (`setup-local-pg.sh --reset`) e trava invariantes em banco real
   (`check-squash-replay.sql` e `check-comunicados-caixas-nob.sql`), roda as
   suítes locais serializadas, confere o catálogo de RPCs e aplica/verifica
   `supabase/seed.sql`; é o job dedicado à execução real de SQL;
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
secrets nesse workflow. A disponibilidade de Preview remoto deve ser conferida
na integração, não inferida da existência da PR.

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

`src/lib/telemetry.ts` inicializa Sentry quando `import.meta.env.PROD` é
verdadeiro e associa o release ao commit injetado no build. Isso inclui builds
de Preview; não significa exclusivamente o ambiente remoto de produção.

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

Registre o commit verificado, os comandos e resultados, os casos skipped e o
ambiente efetivamente exercitado. Depois de publicar a PR, acompanhe os checks
do commit enviado até concluírem; após verde, encerre o acompanhamento conforme
[AGENTS.md](AGENTS.md). CI verde não é autorização de merge ou deploy adicional.
