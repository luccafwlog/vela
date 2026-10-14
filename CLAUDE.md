@AGENTS.md

# Gate local do Claude Code

As regras do repositório continuam em [AGENTS.md](AGENTS.md). Este arquivo só
diz o que rodar antes de `git commit` e `git push`. Não copie regras para cá.

O hook `.claude/hooks/pre-push-gate.sh` (em `.claude/settings.json`, timeout
de 60 minutos) bloqueia o comando se o gate falhar.
`CLAUDE_SKIP_LOCAL_GATE=1` pula o hook apenas quando a pessoa pede isso na
conversa.

Antes de instalar dependências, o comando é `npm ci --legacy-peer-deps`.

- Diff só de Markdown ou de arquivos em `docs/`: `npm run docs:check` e
  `git diff --check`.
- Qualquer outro arquivo:
  - `npm run lint`
  - `npm test`
  - `npm run build`
  - `python3 -B -m unittest discover -s scripts/security -p 'test_*.py'`
  - `python3 -B scripts/security/verificar_guardas.py --ci`

Aparência, CSS ou componente visual também pede `npm run design:check` e
`npm run a11y:contrast`.

## Replay de migrations

Quando o diff mexe em `supabase/`, `src/integration/` ou nos scripts desse
replay, o hook roda `scripts/replay-local-pg.sh` e bloqueia o commit e o
push se ele falhar. O GitHub Actions não executa mais esse replay.

Pré-requisito: PostgreSQL 16 nesta máquina. O script
`scripts/setup-local-pg.sh` administra um cluster local. Não use a CLI do
Supabase para este gate.

- Debian/Ubuntu: pacote `postgresql-16`, com o cluster `16/main` visível em
  `pg_lsclusters`. O replay chama `sudo -n`; o sudo precisa funcionar sem
  pedir senha, porque o hook não pode esperar prompt.
- macOS: `brew install postgresql@16`, ou `PG_BIN` apontando para o diretório
  `bin`. O cluster fica em `TMPDIR`. Não use `brew services`.
- Windows: WSL com o mesmo pré-requisito do Linux.

Docker não substitui esse cluster. Um contêiner `postgres:16` publicado na
porta 5432 não é o que o script administra. Se o Docker não estiver
instalado, nada muda: o caminho é o PostgreSQL 16 do sistema. Sem ele, o
hook recusa o commit e o push e imprime estes pré-requisitos de novo.

O procedimento completo está em
[WORKFLOW.md](WORKFLOW.md#11-testes-e-validação).
