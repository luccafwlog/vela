# Agent Skills

A unified collection of 14 agent skills following the [agentskills.io](https://agentskills.io) specification. Skills provide task-specific guidance for planning, implementation and specialist workflows.

Each skill is a directory containing a `SKILL.md` file (with YAML frontmatter) plus optional supporting files (prompts, references, scripts, tests).

## Skill sources

Every skill below is tagged with where it comes from:

| Tag | Meaning |
|-----|---------|
| **mattpocock/skills** | Vendored from [github.com/mattpocock/skills](https://github.com/mattpocock/skills) at tag `release/v1.2`. See the dedicated section below. |
| **Superpowers** | Vendored from the [obra/superpowers](https://github.com/obra/superpowers) skill set. |
| **Project** | Authored for this repository (Vela domain/workflow skills). |
| **Third-party** | Vendored from another named author/source (credited per skill). |

## Mattpocock Skills (mattpocock/skills @ release/v1.2)

These are vendored from https://github.com/mattpocock/skills/tree/release/v1.2. Local folder names occasionally differ from the upstream slug (noted below) to avoid clashing with a pre-existing local name; content is locally adapted; it is not an exact upstream mirror. `mattpocock/skills`'s own `code-review` skill was **intentionally not vendored** — it shares its name with this project's built-in `/code-review` skill, and vendoring it would shadow that built-in.

| Skill | Upstream path | Description |
|-------|----------------|-------------|
| **grilling** | `skills/productivity/grilling` | Entrada canônica para entrevista estruturada, com rounds/frontier e modos de entrevista sem persistência ou com persistência confirmada. |
| **handoff** | `skills/in-progress/claude-handoff` (renamed locally; upstream "in-progress" = experimental) | Gera um documento Randolph, pronto para copiar e colar, com o contexto, decisões, evidências, bloqueios e próximo passo da sessão. |
| **wayfinder** | `skills/engineering/wayfinder` | Plan a huge chunk of work as a shared map of decision tickets on the issue tracker, resolved one at a time until the way to the goal is clear. |
| **improve-codebase-architecture** | `skills/engineering/improve-codebase-architecture` | Identifica oportunidades de aprofundamento arquitetural no Vela, apresenta candidatos em relatório visual e investiga a opção escolhida sem persistência silenciosa. |
| **wait-what** | `skills/productivity/wait-what` | Reexplica em pt-BR uma mensagem que não ficou clara, mudando a representação e usando o vocabulário de `CONTEXT.md` quando aplicável. |

Test-first behavior remains a repository practice, but the retained catalog no
longer exposes separate `tdd` and `test-driven-development` commands. Use the
project instructions and the focused tests appropriate to each change.
Likewise choose between general frontend design, focused polish and a full
design audit rather than loading all.

## Local adaptation and discovery

The guidance is maintained for capable agents across models, following
[Eric Provencher's article on skills and prompts](https://x.com/pvncher/status/2095991462416490862).
Descriptions identify specific tasks; entrypoints retain constraints and route
to supporting material only when needed. `AGENTS.md` points to `CLAUDE.md`, whose
source map is contextual. Implementation requests continue through validation
without mandatory design, test-boundary or delivery menus.

Preserve concrete production, migration and file protections. Editing a skill
is not permission to change external services or global agent configuration.
Do not bulk-load this catalog or install additional overlapping skills merely
because they exist. Existing invocation metadata is preserved.

### Idioma das interações

Skills que fazem perguntas, conduzem entrevistas, solicitam decisões ou
aguardam aprovação devem usar português do Brasil (pt-BR) em toda comunicação
dirigida ao usuário: perguntas, recomendações, alternativas, confirmações e
encerramentos. Preserve literalmente nomes de comandos, caminhos, labels,
identificadores, código, citações e termos técnicos quando necessário. Use
outro idioma apenas quando o usuário pedir explicitamente.

Quando a tarefa envolver o Vela, a comunicação também deve usar o vocabulário
do sistema: comece pela página, ação, controle, estado e efeito visível; depois
explique arquivos, componentes, services, queries ou RPCs. Consulte o glossário
canônico em [`CONTEXT.md`](../CONTEXT.md) e o [guia de linguagem do sistema](../docs/agents/linguagem-do-sistema.md).

The `frontend-design` entrypoint has three modes: `criar`, `polir` and
`avaliar`. It routes to focused references for accessibility, layout,
flows/dados, revisão e polimento. The consolidated UI guidance has no upstream
search script or database; its written guidance is usable directly. The legacy
OpenCode commands `make-interfaces-feel-better` and `ui-ux-pro-max` remain
compatibility aliases to the `polir` and `avaliar` modes.

See the [instruction audit](../docs/archive/audits/2026-09-06-instrucoes-agentes-skills.md)
for the changes, structural checks and remaining installation limits.

## Superpowers (Core Engineering Skills)

| Skill | Description |
|-------|-------------|
| **brainstorming** | Explora decisões de produto, domínio ou design que mudam materialmente o fluxo do Vela e só persiste decisões com confirmação adequada. |
| **executing-plans** | Executa um plano existente com validação e conclusão verificável. |
| **writing-plans** | Escreve planos orientados a resultado para trabalho substancial, coordenação ou handoff. |
| **writing-skills** | Cria, refina, valida e governa skills reutilizáveis, preservando proveniência, política de invocação e sincronização. |

## Project & Domain Skills

| Skill | Description |
|-------|-------------|
| **design-audit** | Audita páginas, estados e viewports do Vela com evidências, linguagem do sistema e achados P0–P3; não corrige sem autorização. |

## Design & UX Skills

| Skill | Description |
|-------|-------------|
| **frontend-design** | Entrada canônica para criar, polir ou avaliar interfaces web com direção visual coerente, acessibilidade e comportamento pronto para produção. |

## Code Quality & Review Skills

| Skill | Description |
|-------|-------------|
| **vela-code-review** | Revisão orientada ao sentido do Vela: confronta decisões atuais e anteriores, fluxo visível, cenários adversos e qualidade estrutural. |
| **security-audit-penetration-testing** | Scoped, authorized security audit or penetration test with evidence, approval gates, safe validation and explicit limitations. |

## Workflow & Communication Skills

| Skill | Description |
|-------|-------------|
| **eli5** *(Third-party)* | Explica assuntos em pt-BR para o proprietário do Vela, usando o vocabulário das páginas e fluxos sem exigir conhecimento de código. |

## Structure

Each `skills/<name>/SKILL.md` is the discovery entrypoint. Optional `references/`,
prompts and scripts are linked from the owning skill. Inspect that directory
when the selected task needs its supporting files.

## Usage

This directory is the **single source of truth** for the Vela-owned skills. The
the Node scripts materialize them into the local harness directories (same on
Windows/macOS/Linux):

| Destination | Installed into | Triggered by |
|---------|----------------|--------------|
| Shared agent directory | `~/.agents/skills/` | `npm run skills:sync` |
| Claude Code | `~/.claude/skills/` | `.claude/hooks/session-start.sh` |
| Codex | `~/.codex/skills/` | Codex worktree setup or `npm run skills:sync` |
| Antigravity (configuração) | `~/.gemini/config/skills/` | `npm run skills:sync` |
| Antigravity (pessoal) | `~/.gemini/skills/` | `npm run skills:sync` |
| OpenCode | `./skills/` via `opencode.json` | `/skill-name` in the prompt |

To add or edit a skill, change it here only — never hand-maintain copies in the
global directories or ZIP bundles. The first installation on a machine uses
`npm run skills:reset -- --apply`: it backs up the personal stores and
reconstructs them with only the active Vela skills. Depois disso, use
`npm run skills:sync` para atualizações incrementais. O reset não apaga
configurações dos aplicativos, histórico, o store `.system` do Codex, skills
nativas do Antigravity ou caches de plugins.

Skills vendored from `mattpocock/skills` intentionally exclude that repo's own
`agents/*.yaml` metadata files (cross-harness routing config for the `skills.sh`
installer) — this project's own `install-skills.mjs` is the installer here, so
that metadata has no consumer.

The external Superpowers plugin supplies `superpowers:using-superpowers`; Vela
does not vendor a duplicate router. Its availability and behavior are managed
by the plugin, outside Vela ownership.

### Claude Code

The `SessionStart` hook runs the compatibility wrapper, which delegates to the
safe synchronizer. It updates the Vela-owned set without touching plugin or
system skills. A failure is reported in the session output instead of being
silently ignored.

### Codex

Codex does not run the Claude hook, so add one line to your Codex environment's
worktree setup script (all OS tabs — Node is cross-platform):

```bash
node scripts/skills/install-skills.mjs
```

Run it deliberately when you want to synchronize the global copies; use
`npm run skills:sync -- --dry-run` first when reviewing a change. Existing
sessions keep their already loaded catalog. New Codex sessions discover the
installed skills from `~/.codex/skills/`. Plugin and system skills remain
outside Vela ownership. The Antigravity builtin store under
`~/.gemini/antigravity/builtin/skills/` is app-managed and is not a personal
Vela store.
In Codex/T3, use `/skills` to open the skill picker; Codex does not expose each
skill as a separate `/skill-name` command in the main slash catalog.

### With OpenCode

Skills follow the agentskills.io spec. Each `SKILL.md` has YAML frontmatter with
`name` and `description` fields that define when the skill should be invoked.

### With Other Harnesses

Skills supplied by external plugins retain their own harness-specific
references. Vela only synchronizes the skills listed in this repository.

## License

Mattpocock skills: see https://github.com/mattpocock/skills for licensing terms.
Superpowers skills: see original source for licensing terms.
Frontend Design: see `frontend-design/LICENSE.txt`.
The removed vendored skills remain documented in the dated audit report under
`docs/skills/` for traceability; they are not part of the active catalog.
