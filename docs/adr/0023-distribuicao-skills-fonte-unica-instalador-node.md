# ADR 0023 — Distribuição de skills: fonte única e instalador Node

- Status: aceito
- Data: 2026-07-10
- Relação: estende a 0010 (validação, testes e gates) no que toca ao
  provisionamento de ferramentas de sessão.

## Contexto

As agent skills precisam estar disponíveis ao iniciar a sessão em quatro
combinações: dois harnesses (Claude Code e Codex) × dois ambientes (nuvem, onde
o container é efêmero e as skills precisam vir do repositório; e local, onde o
usuário quer as skills globais na máquina). O ambiente local é Windows e também
há uso de Codex em macOS.

O estado anterior mantinha **dois stores divergentes**: `skills/<nome>/SKILL.md`
(formato nativo, 33 skills) e `.claude/skills/*.skill` (20 bundles ZIP mantidos à
mão, descompactados pelo `SessionStart` hook). Os stores dessincronizaram — 13
skills existiam apenas em `skills/` e nunca eram vistas pelo Claude Code — e o
Codex não tinha nenhuma ligação com skills.

Claude Code e Codex usam o **mesmo formato** (spec agentskills.io: diretório com
`SKILL.md` + frontmatter `name`/`description`); o que muda é apenas o diretório
escaneado: `~/.claude/skills/` e `~/.codex/skills/`.

## Decisão

- `skills/` é a **fonte única de verdade**. Não há bundles ZIP nem cópias
  versionadas nos diretórios dos harnesses.
- `scripts/skills/install-skills.mjs` copia cada `skills/<nome>/` para
  `~/.claude/skills/` e `~/.codex/skills/`. É Node (já exigido por `npm install`)
  para rodar igual em Windows, macOS e Linux, evitando divisão bash/PowerShell.
- Gatilhos por harness, cobrindo nuvem e local:
  - Claude Code: `.claude/hooks/session-start.sh` chama o instalador e provisiona
    ambos os diretórios (inclusive o do Codex).
  - Codex: não executa o hook do Claude, então a linha
    `node scripts/skills/install-skills.mjs` é adicionada ao *Script de
    configuração* do worktree na config do ambiente Codex — **uma vez por
    máquina** (Windows e macOS), pois essa config não vive no repositório.

## Consequências

- Uma edição de skill acontece em um único lugar; o drift entre stores deixa de
  existir.
- Symlinks versionados foram descartados por quebrarem no Windows local sem
  `core.symlinks=true` + privilégio de administrador.
- Ceiling conhecido (`ponytail:` no instalador): skills removidas de `skills/`
  não são podadas dos diretórios globais; uma skill deletada deixa cópia obsoleta
  até limpeza manual.
- A cobertura do Codex depende de o usuário colar a linha na config de cada
  máquina — passo manual inevitável enquanto a config do Codex for externa ao
  repositório.

## Atualização de governança — 2026-09-18

O instalador original foi mantido como entrada compatível, mas agora delega ao
`scripts/skills/skill-sync.mjs`. O sincronizador trata `~/.agents/skills`,
`~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills` e
`~/.gemini/skills` como stores pessoais gerados, grava um manifesto por destino
em `~/.vela/skill-sync/` e oferece `--dry-run`, `--check` e `--prune-owned`.
O reset inicial é feito por `scripts/skills/skill-reset.mjs`, que cria backup e
reconstrói esses stores com somente as 14 skills ativas.

A poda incremental remove somente nomes registrados como pertencentes ao Vela.
O ledger versionado `scripts/skills/legacy-removed-skills-2026-09-18.json`
registra as 37 remoções aprovadas para auditoria, mas não substitui o reset
explícito. Configurações dos aplicativos, histórico, credenciais, plugins e o
store builtin do Antigravity ficam fora da operação.
