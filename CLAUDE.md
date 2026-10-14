@AGENTS.md

# Gate local do Claude Code

As regras do repositório continuam em [AGENTS.md](AGENTS.md). Este arquivo só
diz o que rodar antes de `git commit` e `git push`. Não copie regras para cá.

O hook `.claude/hooks/pre-push-gate.sh` (em `.claude/settings.json`) bloqueia
o comando se o gate falhar. `CLAUDE_SKIP_LOCAL_GATE=1` pula o hook apenas
quando a pessoa pede isso na conversa.

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
`npm run a11y:contrast`. Migration, seed ou suíte `*.local-pg.test.ts` não
entram neste hook: o job `migration-replay` do CI cobre isso quando o diff da
PR mexe nesses arquivos. O procedimento completo está em
[WORKFLOW.md](WORKFLOW.md#11-testes-e-validação).
