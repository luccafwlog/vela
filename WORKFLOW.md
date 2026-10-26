# WORKFLOW.md — Vela

Manual vivo para desenvolver, testar, migrar e publicar o Vela e o Portal Fwlog.
Stack, comandos e contratos documentais revisados em 2026-09-19.

Use este documento para procedimentos técnicos. Consulte:

- [`CONTEXT.md`](./CONTEXT.md) para linguagem de domínio;
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) para fluxos e rotas;
- [`docs/adr/README.md`](./docs/adr/README.md) para decisões;
- [`docs/operations/validacao.md`](./docs/operations/validacao.md) para testes operacionais;
- [`docs/operations/backup-r2.md`](./docs/operations/backup-r2.md) para o backup lógico cifrado M10 R2;
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

### Permissões dos conectores e servidores MCP

`.claude/settings.json` libera em `permissions.allow`, sem pedir confirmação,
todas as ferramentas destes conectores e servidores MCP, inclusive as de
escrita:

| Regra | Serviço | Escritas liberadas (exemplos) |
| --- | --- | --- |
| `mcp__Supabase` | Supabase (produção `fgmkhbzhaeebrsizwccx`) | `execute_sql`, `apply_migration`, deploy de Edge Functions, secrets, branches |
| `mcp__Sentry` | Sentry (organização `fwlog`) | `update_issue` (resolver, ignorar, atribuir) |
| `mcp__Cloudflare_Developer_Platform` | Cloudflare | criar e excluir D1, KV, R2, Hyperdrive |
| `mcp__Resend` | Resend | enviar e-mails e broadcasts, domínios, API keys, webhooks |
| `mcp__PostHog` | PostHog | feature flags, dashboards, insights |
| `mcp__github` | GitHub | PRs, merges, comentários, arquivos |
| `mcp__context7`, `mcp__playwright`, `mcp__shadcn` | servidores de `.mcp.json` | consultas e navegação local |

Assim, sessões cloud (ambiente Vela Cloud) e locais não pedem confirmação para
elas, desde que o próprio conector também as libere (abaixo). A ausência de
prompt não muda as regras deste documento: `apply_migration`
continua vetado para produção (seção 5), e envio de e-mails, mudanças em
serviços externos e em produção continuam exigindo autorização da tarefa. Para
voltar a pedir confirmação, remova a regra. A regra usa o nome do conector na
sessão; um conector com outro nome numa instalação local não é coberto. A
sessão cloud só lê esse arquivo quando tem um único repositório.

Os conectores do claude.ai têm permissão própria por ferramenta, ajustada em
<https://claude.ai/customize/connectors>. Uma ferramenta marcada ali como
"precisa de aprovação" pede confirmação a cada chamada, mesmo no modo
automático e mesmo coberta por `permissions.allow`. O pedido oferece apenas
"Negar" e "Permitir uma vez", sem opção de lembrar a escolha. Em 2026-10-12, o
`execute_sql` do Supabase estava assim e pedia confirmação até para
`select 1`, enquanto `list_projects` passava direto; depois de liberar a
ferramenta no conector, as leituras rodaram sem prompt na mesma sessão. Se esse
pedido voltar, ajuste a ferramenta no conector; se a opção estiver bloqueada,
quem decide é um administrador da organização no claude.ai.

## 1. Stack verificada

### Versões dos auxiliares de agentes

`.mcp.json` fixa Context7 e Playwright por versão exata e usa o servidor oficial
`shadcn@4.21.3 mcp` (o pacote anterior `@shadcn/mcp` não existe no npm).
`opencode.json` fixa Ponytail por versão e `opencode-skills-as-commands` por
commit completo. Atualizações são deliberadas: conferir origem e compatibilidade,
alterar a referência fixa e validar a inicialização no cliente correspondente.
Referências: [shadcn MCP](https://ui.shadcn.com/docs/mcp) e
[plugins OpenCode](https://opencode.ai/v2/docs/plugins).

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
- MillionSend para email (API compatível com a Resend);
- Cloudflare Pages para hosting dos dois builds estáticos (Vela interno e Portal Fwlog),
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

O cliente interno usa `flowType: 'pkce'`: links do Auth (confirmação de troca
de e-mail em Meu perfil) chegam com `?code=`, que só vira sessão no mesmo
navegador que pediu a ação, porque é ele que guarda o verificador. A
confirmação em si é gravada pelo Supabase quando o link é aberto, em qualquer
navegador: aberto em outro, o link confirma a troca, mas não entrega sessão, e
o Vela pede login (observado em produção em 2026-10-08). Com "Secure email
change" ligado, a troca exige os links enviados ao e-mail antigo e ao novo. Sem
`emailRedirectTo`, o link volta ao Site URL do projeto (`https://vela.app.br`).
Sem sessão, `useAuth` limpa o cache do TanStack Query.
Na inicialização, `Invalid Refresh Token`/`invalid_grant` provoca limpeza da
sessão e estado `signed-out`, permitindo novo login; outras falhas de sessão
mantêm o estado `transient-error` para não mascarar indisponibilidade.

### Sessão do Portal

O Portal usa Supabase Auth com cliente e chave de storage próprios. A tela aceita
CNPJ e senha. A Edge Function `portal-login` resolve a identidade técnica no
servidor e devolve somente os tokens de sessão; `portal_resolve_login(text)`
não é um contrato de frontend.

Não existe sessão alternativa por senha armazenada em tabela. O acesso anônimo ao resolver da ADR 0013 foi revogado, e
nenhuma função é executável antes do login: `portal_ship_schedule()`, a última
exceção da [ADR 0047](./docs/adr/0047-grants-de-funcao-fechados-por-padrao.md),
fechou na migration `320` ([ADR 0090](./docs/adr/0090-programacao-de-navios-so-com-sessao.md)),
e desde a `337` recusa conta `authenticated` sem perfil interno ativo nem conta
ativa do Portal.

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
  manual/                 inventário do sistema e check de cobertura do
                          Manual do Operador (`npm run manual:coverage`)

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
  manual/                 Manual do Operador: matriz de cobertura
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

Os segredos das Edge Functions (e-mail, Portal, anti-robô, trava de
tentativas, jobs, Itaú e monitoramento) ficam somente em Supabase → Edge
Functions → Secrets; a lista de nomes tem um único dono, o
[manual de serviços externos](./docs/operations/servicos-externos.md#secrets-das-edge-functions).
Os jobs `pg_cron` encontram a base da API e o segredo no Supabase Vault, sob os
mesmos nomes dos Edge Function Secrets, que rotacionam em par com o cofre (ADR
0063 e [`docs/operations/segredos-cron.md`](./docs/operations/segredos-cron.md),
que lista as entradas do cofre). Com o cofre vazio o job fica inerte e registra
`WARNING`, em vez de disparar. Webhooks e cron têm
`verify_jwt = false` em `supabase/config.toml` e validam seus próprios segredos.
O modo dry-run deve ser confirmado no caminho de envio que será exercitado;
não presuma que remover uma chave simula todas as Edge Functions. O domínio do
remetente precisa estar verificado antes de qualquer envio real.

`import-effects-runner` também exige `IMPORT_EFFECTS_RUNNER_ENABLED=true`; sem
essa variável o endpoint responde `503 paused` e não faz claim. Em banco novo,
o job de PTAX (`recalc-demurrage-ptax`) não existe até ser agendado à mão,
depois de validar segredo, Edge e gateway, conforme
[`segredos-cron.md`](./docs/operations/segredos-cron.md#agendar-o-recálculo-de-ptax).

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

A cadeia ativa (`supabase/migrations/`) usa prefixo sequencial de três dígitos
e recomeçou em `001_…` com a consolidação da
[ADR 0062](./docs/adr/0062-consolidacao-migrations-schema-1-0.md).
`supabase/migrations_archive/` guarda a cadeia anterior (`001`–`384`), cujos
números se repetem com outro conteúdo: em documento vivo, número sem
qualificação é da cadeia ativa, e o da cadeia anterior é citado como
"migration arquivada `NNN`" ([CONVENCOES.md](./docs/CONVENCOES.md#histórico-vs-arquivo)).
A renumeração de timestamps UTC da ADR 0016 aconteceu na cadeia arquivada; é lá
que os cabeçalhos guardam o timestamp original.

Não renomeie arquivos já aplicados para “organizar” a pasta. O nome participa do
histórico remoto; a renumeração de ADR 0016 foi uma padronização pontual,
validada por replay completo das migrations e só segura em banco descartável
(o `db reset` reaplica do zero e ressincroniza `schema_migrations`).

### Aplicação no remoto

O **Automatic branching** da integração GitHub do Supabase está **desligado**
por decisão do dono de 2026-10-07 (estado conferido no
[manual de serviços externos](./docs/operations/servicos-externos.md#supabase)):
abrir uma PR não cria branch Supabase nem o check `Supabase Preview`. Para
validar a PR num banco de Preview, crie uma branch pontual no painel e preencha
"Sync with Git branch" com a branch da PR ([deploy.md](./docs/setup/deploy.md#workflows));
ela tem custo por hora, depende de autorização e é removida depois do teste.
Com a branch vinculada, a integração aplica nela as migrations de
`supabase/migrations/`, e o workflow Cloudflare Pages Preview publica os dois
sites protegidos com as credenciais públicas dessa branch. Sem ela, a prova
das migrations da PR é o job `db` do CI (seção 12). Os workflows Cloudflare
Pages Preview e Provision Preview Admin só rodam com a etiqueta `preview` na PR
(ou disparo manual a partir da `main`); sem a branch vinculada, esperam o check
`Supabase Preview` por 36 tentativas de 10 s (cerca de 6 min) e terminam com
falha. O checkout não comprova a configuração remota: confira-a no painel.

No merge ou push em `main`, quando habilitada, a opção **Deploy to production** aplica as migrations
pendentes no projeto Supabase de produção (`fgmkhbzhaeebrsizwccx`). Não aplique
migrations remotas por ferramentas que geram versão **timestamp** (ex.: `apply_migration`
do MCP Supabase): elas gravam em `supabase_migrations.schema_migrations` uma
versão sem arquivo local correspondente, e a checagem de branching falha com
*“Remote migration versions not found in local migrations directory”*
(`MIGRATIONS_FAILED`). Se acontecer, faça uma reconciliação forward explícita;
não edite migrations aplicadas.

Uma branch nova repete o histórico a partir de
`supabase_migrations.schema_migrations.statements`, não dos arquivos. Uma linha
que guarda só um comentário (versão marcada como aplicada fora do CLI) vira
no-op na branch e quebra a primeira migration que dependa dela. Foi o caso de
`007` e `135` em produção (a `165` falha com `schema "ops" does not exist`):
o reparo `supabase/scripts/reparo_schema_migrations_007_135.sql` grava o SQL
dos arquivos no formato do CLI, guarda backup das linhas e tem rollback em
`supabase/scripts/reparo_schema_migrations_007_135_rollback.sql`. Foi
executado em produção em 2026-10-20, com autorização do dono; o backup ficou em
`supabase_migrations.schema_migrations_bkp_007_135`.

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
`npm run migrations:check` também recusa versões repetidas: o prefixo numérico
antes de `_` precisa ser único, mesmo quando os nomes dos arquivos diferem.
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
- toda função fixa `search_path` (`SET search_path = ''` com nomes qualificados,
  ou `public, pg_temp` nas `SECURITY DEFINER`); a suíte local-pg
  `advisorFuncoesFechadas` falha com função sem ele, salvo as quatro funções
  SQL de volume que ficam inline por desempenho
  ([Segurança](./docs/operations/seguranca.md#rls-first));
- revogue `PUBLIC` e `anon` no mesmo arquivo por padrão;
- tabela nova recebe `GRANT` explícito na própria migration: `SELECT`,
  `INSERT`, `UPDATE`, `DELETE` para `service_role` (menos o que for
  append-only) e, para `authenticated`, só o que a tela lê ou grava direto
  pela Data API, atrás de RLS. Branch Supabase e replay local não têm os
  default privileges de produção. A suíte local-pg `grantsDoReplay` falha sem
  o grant de `service_role`; o de `authenticated` ela não tem como inferir, e
  a falta só aparece no teste da tela (migration `340`,
  [Segurança](./docs/operations/seguranca.md#rls-first));
- grants pré-autenticação para `anon` exigem decisão explícita, controles contra
  abuso e teste focado;
- trigger functions não precisam ser executáveis diretamente por clientes;
- FK nova em `bls`, `bl_*`, `invoices`, `invoice_*` ou `demurrage_*` nasce com
  índice que começa pelas colunas dela (a mesma suíte confere).

### Tipos

Quando o contrato usado pelo app mudar, planeje a regeneração de
`src/types/database.ts` a partir do schema correto, preservando os complementos
tipados existentes. O arquivo é protegido: siga a autorização exigida em
`AGENTS.md` antes de modificá-lo. Não edite tipos para esconder drift.

### Aplicação

O CI da SPA e o Cloudflare Pages não aplicam migrations. Quando existe a
branch Supabase de Preview vinculada à PR, a integração aplica nela as
migrations da PR; confirme o check `Supabase Preview` antes do merge e, em caso
de falha, compare o histórico remoto com os arquivos locais antes de
reexecutar. Sem essa branch, o gate de migration da PR é o job `db`.
Depois do merge, a integração GitHub do Supabase (Deploy to production) aplica
as pendentes em produção. Após DDL, verifique advisors e o contrato usado pela
aplicação.

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

Nunca execute a limpeza ampla para “testar” uma migration. A limpeza de dados
de teste (`supabase/scripts/limpar_dados_teste.sql`) só vale enquanto a
afirmação "Data status" do `AGENTS.md` estiver vigente; o procedimento está em
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

A aparência segue a [identidade visual](docs/identidade-visual.md)
([ADR 0081](docs/adr/0081-identidade-visual-unica.md)): nove regras, peças
comuns e aprovação tela a tela da organização. Em resumo:

- componha as peças de `src/components/ui/` (`Block`, `LeadValue`,
  `FactList`, `IdentityBand`, `NextAction`, `NoValue`, `Button` e as demais);
- não crie CSS próprio de página nem cor, tamanho de letra ou caixa alta fora
  dos tokens; `npm run design:check` recusa o que cresce além da linha de base
  `scripts/design-baseline.json`, e `npm run design:check -- --update` trava o
  ganho depois de migrar uma tela (recusa número que subiu; aumento
  intencional usa `--allow-increase` e é justificado na PR);
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

Há dois caminhos de impressão. O detalhe interno (Taxas Locais, Demurrage e
Conciliação) usa `printDocumentElement` em `src/lib/printDocument.ts`, que abre
uma janela só com o documento e chama `print()`; por isso os documentos usam
estilos inline. Portal,
ADR e relatório por Cliente chamam `window.print()` com as regras `@media print`
de `src/index.css`, que deixam no papel só o modal com o documento. As duas
folhas são A4 com margem vertical na página e "Página N de M" no rodapé; mude
as duas juntas. O usuário escolhe impressora ou “Salvar como PDF” no navegador.

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

Mudança de aparência, CSS ou componente visual roda também
`npm run design:check` e `npm run a11y:contrast` (os dois estão no job
`quality` do CI).

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
Para reproduzir o gate completo, use `npm run test:local-pg`, que roda em
série as suítes de [`scripts/local-pg-suites.txt`](scripts/local-pg-suites.txt)
na ordem da lista; `npm run test:local-pg -- --reverse` roda de trás para
frente. O Vitest reordena os arquivos por conta própria (falhos e lentos
primeiro); o script passa a ordem ao sequenciador do `vite.config.ts`. O CI da
PR roda a ordem natural; o workflow semanal `local-pg-order.yml` (segunda de
manhã e disparo manual) roda as duas ordens, cada uma num banco recém-replicado
(`setup-local-pg.sh --reset` antes da invertida), o que prova que nenhuma suíte
depende do que a anterior fez nem é quebrada por ela ([ADR 0086](docs/adr/0086-ci-confere-na-medida-da-mudanca.md)). As suítes
compartilham banco e precisam rodar em série; cada uma deve
usar seu próprio namespace de IDs e documentos nas fixtures e apagar o que
cria, inclusive versões de regra de tarifa e contas de Portal do próprio Cliente:
a bateria financeira roda num passo próprio, por último, e falha com resíduo
global. Toda suíte nova entra em `scripts/local-pg-suites.txt`;
`npm run localpg:check` falha quando um `*.local-pg.test.ts` fica fora dela
(e dos passos do CI), quando há suíte repetida, quando o CI ou o workflow
semanal deixa de rodar a sua ordem, ou quando uma suíte chama
`execFileSync('psql', ...)` ou `spawnSync('psql', ...)`. Sonda de pré-requisito usa
`describeWithProbe` (`src/integration/localTestData.ts`): com
`LOCAL_PG_INTEGRATION=1`, sonda falsa falha o teste em vez de pular a suíte.

Suíte nova executa SQL com `execPsql` e `spawnPsql`
(`src/integration/localPsql.ts`). Eles recebem os mesmos argumentos e opções de
`execFileSync('psql', ...)` e `spawnSync('psql', ...)` e devolvem o mesmo
formato, mas usam uma conexão por arquivo de suíte em vez de um processo e uma
conexão por chamada:

```ts
import { execPsql } from './localPsql'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}
```

Cada chamada termina com `ROLLBACK` e `DISCARD ALL`, então começa como um
`psql` novo: sem `SET`/`SET ROLE`, temporárias, locks consultivos nem
transação aberta. A diferença conhecida: uma variável personalizada que a
sessão já usou (`request.jwt.claim.sub`, `vela.*`) volta como `''`, não `NULL`,
em `current_setting(nome, true)`, como numa conexão do PostgREST. O teste
`src/integration/localPsql.local-pg.test.ts` compara a saída, os erros, os
avisos e o status com o binário `psql`. Para outra sessão em paralelo (janela
de concorrência, lock), continue usando `spawn('psql', ...)`.

`npm run rpc:check` requer `psql` e banco já preparado. Configure explicitamente
`LOCAL_DATABASE_URL` para o alvo descartável; sem ela, o script usa
`postgresql://postgres:postgres@127.0.0.1:5432/vela_test` e ignora
`DATABASE_URL`. A conexão chega ao `psql` por variáveis `PG*`, fora da linha
de comando, e a mensagem de falha mostra a URL com a senha trocada por `***`.
Ele compara nomes chamados com `public.pg_proc`, não valida assinaturas,
grants nem comportamento das RPCs.

`npm run manual:coverage` usa o mesmo banco preparado e a mesma
`LOCAL_DATABASE_URL`. Ele extrai o inventário do sistema
(`scripts/manual/inventory.mjs`: rotas, funções que as telas chamam, regras
automáticas, restrições, rotinas, funções de servidor, alertas, e-mails,
matriz de permissões e mensagens) e falha quando um item não tem lugar na
[matriz de cobertura do Manual do Operador](docs/manual/README.md), quando a
matriz cita um item que deixou de existir ou quando uma linha usa destino fora
da lista. `npm run manual:inventory` imprime o inventário em JSON. Mudança que
cria, remove ou renomeia um desses itens atualiza a matriz na mesma alteração.

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

### Backup lógico cifrado para R2 (M10 R2)

O comando `npm run backup:r2` é dry-run por padrão. A execução autorizada lê a
URL PostgreSQL e os segredos R2 somente do ambiente do processo, cifra o
`pg_dump` do schema `public` antes do upload e valida o arquivo com
`pg_restore --list`. Consulte o [runbook do backup R2](./docs/operations/backup-r2.md)
para pré-requisitos, variáveis, proteção adicional de produção e os passos que
dependem do Supabase/Cloudflare Dashboard. Não existe workflow GitHub para este
backup: a execução diária de produção roda numa tarefa agendada fora do GitHub,
descrita no [manual de serviços externos](./docs/operations/servicos-externos.md#backup).
Nenhum restore destrutivo faz parte dos checks locais.

## 12. CI e deploy

### Pull request

`.github/workflows/ci.yml` roda só em pull requests (aberta, novo commit,
reaberta ou saída de rascunho), em três jobs mais o agregador
([ADR 0086](docs/adr/0086-ci-confere-na-medida-da-mudanca.md)). As etapas Node
usam a versão 24 e `npm ci --legacy-peer-deps`; o replay de guardas usa Python
e o de banco requer PostgreSQL 16:

1. `quality` — verificação documental e autotestes, testes dos scripts do CI
   (`npm run ci:test`), lint, identidade visual, self-check do gerador de
   squash, declaração de migration destrutiva e autotestes desse checker, lista
   das suítes local-pg (`npm run localpg:check`), contratos de staging e de
   provisionamento do Cloudflare Pages (`npm run cloudflare:stage:test` e
   `npm run cloudflare:provision:test`), autotestes do analisador e replay
   estático de autorização (`verificar_guardas.py`: RLS, policies, guardas das
   DEFINER, defaults de EXECUTE e trava tomada antes da guarda de perfil em
   função de `authenticated`), build (`tsc` + `vite`) com
   staging dos dois sites Pages (`npm run cloudflare:build:sites`, que exige
   `VITE_SUPABASE_URL` para o `connect-src` da CSP) e orçamento de bundle;
   inclui os contratos de upload e de expurgo CE em Deno 2.9.6, com HTTP simulado e
   dependências remotas verificadas por `deno.lock` (`--frozen`); o lock da raiz
   cobre só esses imports remotos (`--no-config` e `DENO_NO_PACKAGE_JSON=1`),
   então atualizações npm não o invalidam;
2. `test` — suíte Vitest dividida em 2 shards (`--shard=N/2`);
3. `db` — aplica as migrations do zero num PostgreSQL 16 descartável (a imagem
   do runner traz outra versão; o passo instala o 16 pelo repositório oficial
   PGDG e remove o cluster da outra versão para o 16 ficar na porta 5432)
   (`setup-local-pg.sh --reset`), trava invariantes em banco real
   (`check-squash-replay.sql` e `check-comunicados-caixas-nob.sql`), confere o
   catálogo de RPCs e aplica/verifica `supabase/seed.sql` em toda PR. As suítes
   locais serializadas (ordem natural) e a bateria financeira rodam só quando o
   diff da PR toca o banco: `supabase/`, `src/integration/`, os scripts do
   replay e das suítes, `vite.config.ts`, `package.json`, `package-lock.json`,
   o próprio `ci.yml` ou o classificador `scripts/ci-db-paths.mjs`, que escreve
   a decisão no log do passo. A condição fica nos passos, então o job nunca é
   pulado;
4. `checks` — gate agregador que só fica verde quando os três terminam verdes.

`checks` é o nome estável para a proteção de branch: a quantidade de shards
pode mudar sem reconfigurar o repositório. Runs antigos do mesmo ref são
cancelados (`concurrency` + `cancel-in-progress`), então só o commit mais
recente do PR ocupa runners. A passada das suítes em ordem invertida roda uma
vez por semana em `.github/workflows/local-pg-order.yml` (seção 11).

As previews são sob demanda: `.github/workflows/cloudflare-pages-preview.yml` e
`.github/workflows/provision-preview-admin.yml` rodam quando a PR recebe a
etiqueta `preview` (`pull_request_target`, YAML da branch base) ou por disparo
manual a partir da `main` com o número da PR. Não dependem do CI verde: quem
põe a etiqueta decide o momento. `cloudflare-pages-preview-cleanup.yml` só roda
ao fechar PR com essa etiqueta.

`provision-preview-admin.yml` executa no contexto confiável da branch padrão,
aguarda o check `Supabase Preview` (que só existe com a branch de Preview
vinculada à PR; sem ela, o workflow termina com falha por tempo esgotado,
seção 5), obtém as credenciais da branch e roda
`scripts/provision-preview-admin.mjs`.
Esse script cria ou atualiza `qa-admin@example.test` pela Auth Admin API e
garante seu `user_profiles.role = 'administrativo'`. O password fica exclusivamente no
secret `PREVIEW_ADMIN_PASSWORD`; o workflow também exige os secrets
`SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`. Não faça checkout do código da
PR nesse workflow nem coloque credenciais server-side em `VITE_*`.
PRs de forks são ignoradas pelo provisionamento porque não podem receber esses
secrets nesse workflow. A disponibilidade de Preview remoto deve ser conferida
na integração, não inferida da existência da PR.

### Promoção da staging para a main

PR de feature abre contra `staging`. O check `main-only-from-staging`
(`.github/workflows/main-only-from-staging.yml`) falha quando a PR contra a
`main` não vem da branch `staging` deste repositório. O push na `staging` (o
merge de uma PR) dispara `.github/workflows/staging-to-main-pr.yml`, que acha a
PR mergeada pelo commit, abre a PR `staging` → `main` ou atualiza a que já
estiver aberta. O merge na `main`
continua manual: é esse push que publica a produção. A lista de PRs no corpo
sai do assunto dos commits (`título (#n)` ou `Merge pull request #n`).

O secret `STAGING_TO_MAIN_TOKEN` (PAT fine-grained só deste repositório,
Contents em leitura e Pull requests em escrita) faz o CI dessa PR começar
sozinho. Desde a auditoria run-3 (decisão do dono de 2026-10-22) ele mora no
environment GitHub `staging-release`, restrito à branch `staging`, e não mais
nos secrets do repositório: só um job rodando na `staging` o lê. Por isso o
gatilho é o push, e não o fechamento da PR (no evento de PR o GitHub confere a
restrição contra `refs/pull/N/merge`). Sem o secret no environment, o workflow
usa o `GITHUB_TOKEN` e o CI fica esperando aprovação. Marcar o check
`main-only-from-staging` como obrigatório na proteção da `main`, trocar a
branch padrão para `staging`, criar o environment com a restrição e mover o
secret para ele são passos do dono, fora do workflow. Regra
em [ADR 0091](docs/adr/0091-promocao-feature-staging-main.md) e em
[Deploy](docs/setup/deploy.md#workflows).

### Push em main

O CI não roda de novo depois do merge. `cloudflare-pages-production.yml`
começa no próprio push em `main` e, antes de publicar, espera o check do app
`supabase` no commit (`scripts/wait-supabase-migrations.mjs`): verde publica;
vermelho, cancelado ou estourado recusa; pulado, ou sem check em 10 min, só
publica se o push não mudar `supabase/migrations/`, e senão pede conferência no
painel do Supabase e publicação manual (`workflow_dispatch`, que não espera). No
push em `staging`, o mesmo passo também confere na Management API se as
migrations do push já estão na branch Supabase do staging antes de recusar um
check pulado ([Deploy](docs/setup/deploy.md#staging-persistente)). O
environment `cloudflare-production` fornece as variáveis públicas do build. O
login com o usuário fixo numa preview só deve ser tentado depois que
`Provision Preview Admin` estiver verde.

### Edge Functions e banco

O deploy do Cloudflare Pages não publica Edge Functions nem aplica migrations. Coordene
essas etapas no Supabase antes do frontend que depende delas.

## 13. Telemetria e falhas

`src/lib/telemetry.ts` inicializa Sentry quando `import.meta.env.PROD` é
verdadeiro e associa o release ao commit injetado no build. Isso inclui builds
de Preview; não significa exclusivamente o ambiente remoto de produção.

As Edge Functions prioritárias usam o helper best-effort
`supabase/functions/_shared/telemetry.ts`: sem `SENTRY_DSN`, ele não envia
eventos; quando configurado, captura exceções não tratadas e respostas 5xx sem
mensagens brutas, usuário, headers ou corpos HTTP. Não coloque valores de
cliente em tags/extra. Uma Edge que devolve 5xx por falha de RPC pode marcar a
resposta com `telemetryFailureHeaders(rpc, error)`: o evento ganha as tags
`codigo_erro` (só SQLSTATE ou `PGRSTnnn`) e `rpc` (só nomes de
`TELEMETRY_RPC_ALLOWLIST`, em `src/lib/telemetryContract.ts`), e os cabeçalhos
saem da resposta antes de ela voltar ao chamador. Hoje marcam `alerts-detector`
e `customer-communication-auto-runner`. Valide em Preview e confirme o ambiente antes de ativar
o DSN de produção. O SDK Deno está em beta e não isola automaticamente escopos
por requisição.

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
