# 2026-10-15 — Compactação do CI

Plano vivo para reduzir o tempo de espera do CI e o que ele faz sem
necessidade, sem tirar nenhuma conferência que proteja o Vela ou o Portal. A
medição que o motiva está no
[relatório de 2026-10-15](../archive/reports/2026-10-15-medicao-do-tempo-do-ci.md).
PR principal: luccafwlog/vela#953, que leva este plano e o Lote 1. O Lote 2
entra numa PR própria ligada a ela.

## Resultado pretendido

Quem acompanha uma PR vê o `checks` ficar verde em poucos minutos, e um merge
chega ao Vela e ao Portal em produção logo depois:

| Situação | Hoje | Depois do Lote 1 | Depois do Lote 2 |
| --- | ---: | ---: | ---: |
| PR que não mexe no banco (ex.: tela de BLs) | ~11 min | ~3 min | ~3 min |
| PR que mexe no banco (migration, RPC, suíte SQL) | ~11 min | ~6 min | ~3 a 4 min |
| Do merge na `main` ao Vela atualizado | ~13 min | ~2 min | ~2 min |
| Minutos cobrados por run de PR (tela / banco) | ~21 / ~21 | ~11 / ~16 | ~11 / ~13 |

Os números depois das mudanças são estimativas a partir da medição. Cada
etapa abaixo tem o seu critério de aceite medido no GitHub.

Continua obrigatório em toda PR: documentação, lint, identidade visual, build
dos dois sites, testes comuns (inclusive os de tela), guardas de segurança, o
replay das migrations num PostgreSQL 16 real, as invariantes do schema, o
catálogo de RPCs e o seed. As suítes SQL (`*.local-pg.test.ts`) continuam
obrigatórias sempre que a PR mexer no banco ou nelas mesmas.

## Fora de escopo

- **Volume de runs por PR** (~3 por PR, por reenvios dos agentes) e o teto de
  minutos do plano do GitHub: decisão separada, depois deste plano.
- Runner próprio ou de terceiros.
- Otimizar os testes de tela (jsdom), que são 90% do tempo dos testes comuns e
  valem o que custam.
- Aposentar os 223 testes de texto de migration (ponte `ponytail:` em
  `src/test/setup.ts`, item 6 da ADR 0062): custam ~2 s.
- Gate local no Claude Code. A versão anterior desta PR o propunha. Foi
  revertida: não alcança Cursor, Codex nem edição pelo GitHub.

## Fontes de verdade

- `.github/workflows/ci.yml`, `cloudflare-pages-production.yml`,
  `cloudflare-pages-preview.yml`, `cloudflare-pages-preview-cleanup.yml`,
  `provision-preview-admin.yml`.
- `scripts/check-local-pg-ci.mjs` (exige hoje as duas ordens no `ci.yml`),
  `scripts/local-pg-suites.txt`, `scripts/run-local-pg-suites.mjs`,
  `scripts/setup-local-pg.sh`, `vite.config.ts` (sequenciador).
- [WORKFLOW.md](../../WORKFLOW.md) §11 e §12, [Deploy](../setup/deploy.md),
  [Testes](../setup/testing.md),
  [serviços externos](../operations/servicos-externos.md),
  [ADR 0010](../adr/0010-validacao-testes-deploy-gates.md).
- Proteção de branch da `main`: o único check obrigatório esperado é
  `checks` (WORKFLOW §12). **Conferir nas configurações antes de renomear
  jobs.**

## Decisões

| # | Decisão | Situação |
| --- | --- | --- |
| D1 | Como garantir que a produção não publique código antes da migration que ele usa, quando o CI da `main` deixar de existir (achado P1 do Codex nesta PR). **(a)** A publicação espera o check da integração do Supabase no commit do merge, se esse check existir (não verificado); custa 1 a 3 min de espera por publicação. **(b)** Só a regra de `deploy.md`: migration numa PR própria, que entra antes do código que depende dela. Recomendação: (a) se o check existir; senão (b), com a regra repetida no template de PR. | **Aguarda o dono.** Bloqueia só o item 1.2. |
| D2 | Exigir que a PR esteja atualizada com a `main` antes do merge ("Require branches to be up to date"), já que a `main` não terá CI próprio. Protege de duas PRs verdes que quebram juntas, mas obriga a rodar o CI de novo a cada merge alheio. Recomendação: não exigir agora; reavaliar se acontecer. | **Aguarda o dono.** Não bloqueia. |
| D3 | Cadência da passada invertida: semanal, segunda de manhã, mais disparo manual. | Padrão do plano |
| D4 | Previews e admin de preview só com a etiqueta `preview` ou disparo manual a partir da `main`. | Padrão do plano |
| D5 | Número de shards dos testes comuns: o menor que mantenha o job de testes abaixo de ~3 min de parede. | Escolha de execução, medida no item 1.4 |

## Lote 1 — ajustes no CI, sem mexer nos testes

Ordem pensada para entregar primeiro o que não tem risco. Cada item é um
commit nesta PR, com o CI da própria PR como prova.

### 1.1 Previews só por etiqueta (D4)

**O que muda para quem usa:** uma PR sem a etiqueta `preview` não dispara
mais os robôs de preview nem o de limpeza. Quem quer testar uma PR no
navegador põe a etiqueta, depois de criar a branch do Supabase à mão (fluxo
atual de `deploy.md`).

- `cloudflare-pages-preview.yml` e `provision-preview-admin.yml`: de
  `workflow_run` do CI para `pull_request_target` com `types: [labeled]`,
  filtrando `label.name == 'preview'`, mais `workflow_dispatch` aceito só a
  partir da `main`. Mantém a separação atual de segurança: o YAML vem da
  branch base; o único job que faz checkout do SHA da PR recebe só a URL e a
  chave pública da branch Supabase; o token da Cloudflare fica no job que só
  publica o artefato. A versão revertida desta PR (`a4afa128`) serve de
  referência.
- `cloudflare-pages-preview-cleanup.yml`: só roda se a PR tiver a etiqueta
  `preview` ao fechar.
- A preview deixa de depender do CI verde. Quem põe a etiqueta decide.

**Aceite:** PR sem etiqueta → nenhum run dos três workflows. Etiqueta numa PR
com branch Supabase vinculada → preview publicada como hoje. Sem branch
vinculada → falha na espera, como hoje.

### 1.2 Sem CI repetido depois do merge (depende de D1)

**O que muda:** o merge publica o Vela e o Portal em ~2 min, sem os ~11 min
de CI de novo na `main`.

- `ci.yml`: só `pull_request` (`opened`, `synchronize`, `reopened`,
  `ready_for_review`); sai o `push` na `main`. `concurrency` com
  `cancel-in-progress` continua.
- `cloudflare-pages-production.yml`: de `workflow_run` para `push` na `main`
  mais `workflow_dispatch`, mantendo `CLOUDFLARE_PAGES_PRODUCTION_ENABLED`, o
  environment `cloudflare-production` e `github.ref == 'refs/heads/main'`.
  Com D1 = (a), um passo antes da publicação espera o check do Supabase no SHA
  e falha se ele falhar.

**Aceite:** merge de teste → nenhum run de `CI` na `main`. `Cloudflare Pages
Production` começa no push e termina em ~2 min (com D1 = (a), mais a espera
do Supabase).

**Risco:** com D2 = não, duas PRs verdes podem quebrar juntas na `main` sem
CI que perceba. A PR seguinte fica vermelha e mostra o problema.

### 1.3 Suítes SQL só quando a PR mexe no banco

**O que muda:** uma PR de tela não espera mais os ~9 min das suítes SQL. O
schema continua sendo montado e conferido em toda PR.

O job de banco sempre faz, nesta ordem: PostgreSQL 16, `setup-local-pg.sh
--reset`, `check-squash-replay.sql`, `check-comunicados-caixas-nob.sql`,
`npm ci`, `rpc:check` (pega tela chamando RPC inexistente), seed e contagem
de tarifas. Leva ~1 a 1,5 min.

As suítes (`npm run test:local-pg`, ordem natural) e a bateria financeira só
rodam quando o diff da PR contra a base toca em:

- `supabase/`
- `src/integration/`
- `scripts/local-pg-suites.txt`, `scripts/local-pg-suites.mjs`,
  `scripts/run-local-pg-suites.mjs`, `scripts/setup-local-pg.sh`,
  `scripts/check-*.sql`, `scripts/check-rpc-catalog.mjs`
- `vite.config.ts`, `package.json`, `package-lock.json`
- `.github/workflows/ci.yml`, ou o próprio classificador

Detalhes:

- **Classificador:** um script pequeno com teste, que lê `git diff
  --name-only` entre o SHA base da PR e o HEAD. A decisão vai para o log do
  passo.
- **Achado P1 do Codex:** o classificador roda o código da PR, assim como o
  próprio `ci.yml`. Por isso, mudar `.github/` ou o classificador força as
  suítes. A defesa real contra uma PR que se aprova é a revisão de quem altera
  workflow, não a origem do script.
- **Sem jobs pulados:** a condição fica nos passos, dentro do mesmo job. O
  `checks` continua exigindo `success` de todos os jobs.

**Aceite:** PR que só muda `src/pages/` → o job de banco termina em ≤ ~2 min,
com a linha "suítes SQL puladas: nenhum caminho de banco no diff". PR que muda
`supabase/migrations/` → suítes e bateria financeira rodam. Teste do
classificador cobre os dois casos, o forçado por `.github/` e diff vazio.

### 1.4 Menos computadores por run

**O que muda:** menos minutos cobrados; quase nada na espera.

- **Um job `quality`:** docs, lint, identidade visual, contrato CE em Deno,
  contratos do Pages, checagens de migration, guardas de segurança (Python
  3.12), build dos dois sites e `size-limit`. Junta os atuais `quality`,
  `build` e `security-audit`, com um só `npm ci`.
- **Testes comuns:** medir 1, 2 e 3 shards na própria PR e ficar com o menor
  que mantenha o job abaixo de ~3 min (D5). Registrar a medição na descrição
  da PR.
- **Jobs finais:** `quality`, `test` (N shards), `db` e `checks`. O nome
  `checks` não muda.

**Aceite:** run de PR de tela com espera ≤ ~3 min e ≤ ~11 minutos cobrados;
`checks` verde só com todos os jobs em `success`.

### 1.5 Passada invertida semanal (D3)

**O que muda:** a conferência de que as suítes não dependem da ordem sai do
caminho de toda PR e roda uma vez por semana. Uma falha aparece em até uma
semana, como alerta de workflow para o dono.

- **Workflow novo** (ex.: `.github/workflows/local-pg-order.yml`):
  - `schedule` semanal, com minuto fora da hora cheia;
  - `workflow_dispatch`;
  - `concurrency` próprio.
- **O que ele faz:** replay, ordem natural, replay de novo, ordem invertida e
  bateria financeira.
- **Custo:** ~11 min por semana, ~45 min/mês.
- `scripts/check-local-pg-ci.mjs` passa a exigir a ordem natural no
  `ci.yml` e a invertida no workflow semanal.

**Aceite:** um disparo manual verde do workflow semanal, e `npm run
localpg:check` falha se qualquer uma das duas ordens sumir.

### 1.6 Documentação e decisão

Na mesma PR, junto com o código de cada item:

- **ADR 0086:** "O CI confere na medida do que a PR muda", com o motivo
  (medição de 2026-10-15) e o que continua obrigatório. Faixa "Situação atual"
  na ADR 0010. Confirmar o número livre no momento do commit.
- **WORKFLOW.md:**
  - §11: a passada invertida vira semanal;
  - §12: jobs, quando as suítes rodam, o fim do "Push em main" como CI,
    previews por etiqueta.
- **`docs/setup/deploy.md`:** tabela de workflows e gatilhos; texto da regra
  de ordem migration → código conforme D1.
- **`docs/setup/testing.md`:** `test:local-pg -- --reverse` agora roda no
  workflow semanal.
- **`docs/operations/servicos-externos.md`:** workflow agendado novo e
  gatilho das previews.
- **`docs/CHANGELOG.md`:** ao concluir o lote.

### Validação do Lote 1

- `actionlint` nos workflows alterados.
- Testes dos scripts novos ou alterados (classificador,
  `check-local-pg-ci.mjs`).
- Os gates de `AGENTS.md` para configuração: `npm run docs:check`,
  `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- CI desta PR verde. Ela toca em `.github/`, então roda tudo.
- Prova do caminho curto: uma PR de teste que só muda um texto de tela,
  fechada sem merge depois da medição.
- Tempos de cada run registrados na descrição da PR.

**Rollback:** reverter os commits do lote. O `ci.yml` anterior está no
histórico; nenhuma configuração de repositório muda, salvo o que D2 decidir.

## Lote 2 — suítes SQL com conexão reaproveitada

**O que muda:** as suítes SQL fazem o mesmo trabalho em menos tempo. A PR que
mexe no banco cai de ~6 para ~3 a 4 min. Nenhuma asserção muda.

### Contrato a preservar

Hoje cada consulta abre um `psql` novo (4.042 por passada). Cada chamada é,
portanto, uma sessão limpa, e o helper novo precisa manter isso. Para cada
chamada:

- **Sessão limpa ao terminar:** `DISCARD ALL` depois de cada chamada. Desfaz
  `SET ROLE`, `set_config(..., false)`, `session_replication_role`, tabelas
  `pg_temp` como `pg_temp.captured_post` e preparações.
- **Saída igual à do `psql -At`:** valores como texto do servidor, sem
  conversão de tipo (`t`/`f`, numérico como escrito, nulo vazio). Colunas
  separadas por `|`, linhas por `\n`. Com vários comandos, vale só o
  resultado do último, como no `psql -c`.
- **Erros com o mesmo texto:** a mensagem que os testes comparam (ex.: "não
  pode ser apagada (TRUNCATE)"), no mesmo canal (exceção ou retorno, conforme
  o helper atual de cada arquivo).
- **Avisos:** `NOTICE` e `WARNING` coletados para os testes que os leem.

### Itens

| # | Item | Aceite |
| --- | --- | --- |
| 2.1 | Helper compartilhado em `src/integration/` (cliente `pg` como devDependency, ou equivalente que aceite comandos múltiplos e devolva texto bruto), com uma conexão por arquivo de suíte, aberta no `beforeAll` e fechada no `afterAll`. As chamadas passam a ser `await`. | Testes do próprio helper contra o Postgres local: formato, erro, último resultado, sessão limpa entre chamadas |
| 2.2 | **Piloto** nos seis arquivos que somam 47% do tempo: `invoicePostBillingSafety`, `auditoriaImportacaoBlContainer`, `ceUnlock`, `ceImportacaoContrato`, `auditoriaFaturasDemurrageComunicado`, `itauPixCharges`. Em `invoicePostBillingSafety`, a limpeza vai para o `beforeEach` e um `afterAll`; sai a do `afterEach`. | Mesmo número de testes, verdes nas duas ordens. Tempo dos seis medido antes e depois com `--reporter=json`. **Seguir para 2.3 só se cair ≥ 50%**; senão, registrar o resultado e parar o lote |
| 2.3 | Migração dos demais arquivos, em levas, removendo a cópia local de `psql` de cada um. | 81 suítes / 660 testes verdes (ou o total vigente) na ordem natural e no disparo manual do workflow semanal |
| 2.4 | `localpg:check` recusa `execFileSync('psql'` e `spawnSync('psql'` novos em `src/integration/*.local-pg.test.ts`, para o padrão não voltar. Exceção explícita só para teste que precise do binário `psql`. | Check falha com uma chamada nova de exemplo |
| 2.5 | `WORKFLOW.md` §11 ("Testes de integração"): como escrever suíte nova com o helper. | `npm run docs:check` |

### Riscos do Lote 2

- **Teste que passa pelo motivo errado** depois da troca. Mitigações:
  - comparar, arquivo a arquivo, o número de testes antes e depois;
  - no piloto, quebrar de propósito uma função SQL coberta por cada um dos
    seis arquivos e ver o teste falhar.
- **Estado de sessão vazando** entre chamadas: coberto pelo `DISCARD ALL` e
  pelo teste do helper.
- **Esforço:** ~80 arquivos e 1.464 chamadas. A troca é mecânica, mas exige
  revisão.

## Ao concluir

Mover este plano para `docs/archive/plans/`, tirar a linha do
[índice](README.md), registrar no `CHANGELOG.md` e rodar `npm run docs:check`.
