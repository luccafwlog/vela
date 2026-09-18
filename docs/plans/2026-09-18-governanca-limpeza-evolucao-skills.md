# Governança, limpeza e evolução das skills — Plano de Implementação

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir, melhorar e sincronizar as 14 skills próprias do Vela a partir de uma única fonte versionada, reconstruindo os stores pessoais dos aplicativos nos dois computadores sem apagar configurações, histórico ou caches internos de plugins.

**Architecture:** `skills/` no repositório Vela será a fonte oficial das 14 skills. Um reset Node.js explícito, com backup, validação e substituição atômica, reconstruirá os stores pessoais do harness, Claude Code, Codex e Antigravity. O sincronizador incremental manterá esses destinos atualizados depois do reset. Skills internas de plugins e recursos nativos do Antigravity permanecem administrados pelos respectivos aplicativos; não são apagados manualmente nesta operação.

**Tech Stack:** Git/GitHub, Node.js ESM, `node:fs`, `node:path`, `node:crypto`, Vitest, Claude Code, Codex e Antigravity.

---

## Arquivos e responsabilidades

- Create: `scripts/skills/report-skills.mjs` — inventário reproduzível de nomes, hashes, arquivos auxiliares e divergências entre fonte e destinos.
- Create: `scripts/skills/skill-sync.mjs` — motor de sincronização com `--dry-run`, `--check` e poda apenas das skills pertencentes ao Vela.
- Create: `scripts/skills/skill-reset.mjs` — reset controlado dos stores pessoais, com backup e instalação exclusiva das skills ativas.
- Create: `scripts/skills/skill-sync.test.mjs` — testes de sincronização em diretórios temporários, incluindo preservação de skills externas.
- Create: `scripts/skills/skill-reset.test.mjs` — testes do reset, backup, staging e reconstrução dos destinos.
- Create: `scripts/skills/legacy-removed-skills-2026-09-18.json` — ledger versionado da primeira migração de ownership após a aprovação da limpeza.
- Modify: `scripts/skills/install-skills.mjs` — manter a entrada existente usada pelos hooks, delegando ao novo motor sem quebrar o comando atual.
- Modify: `package.json` — adicionar comandos explícitos para inventário, simulação e sincronização.
- Modify: `.claude/hooks/session-start.sh` — continuar sincronizando a partir do clone local, sem fazer `git pull` automático.
- Modify: `skills/README.md` — documentar fonte oficial, destinos, ownership, limites e fluxo entre os dois computadores.
- Modify: `scripts/README.md` — documentar os comandos de inventário e sincronização para macOS e Windows.
- Modify: `opencode.json` — somente se OpenCode continuar no escopo, removendo comandos de skills excluídas ou apontando a descoberta para o destino aprovado.
- Create: `docs/skills/skill-audit-2026-09-18.md` — relatório versionado de decisão, uso, duplicidade e destino de cada skill.
- Modify: `docs/plans/README.md` — registrar este plano entre os planos ativos.

## Guardrails

- Não usar `git reset --hard`, `git clean`, `rm -rf` ou equivalente para resolver divergências.
- Não tocar nas alterações de aplicação já existentes no worktree atual.
- Não editar manualmente cópias em `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills` ou `~/.agents/skills` como forma de manutenção permanente.
- Não remover uma skill apenas porque ela está instalada; instalação não prova uso.
- Não considerar commits ou referências documentais como frequência real de invocação; esses dados serão rotulados como proxies.
- O reset pode remover qualquer skill encontrada somente dentro dos stores pessoais explicitamente listados, depois de criar backup; ele não pode tocar na configuração geral dos aplicativos, no histórico ou nos caches de plugins.
- A sincronização incremental continua sem remover uma skill sem registro prévio de que ela pertence ao Vela.
- Cada alteração de conteúdo de skill será validada individualmente antes de iniciar a próxima.

### Task 1: Preservar o estado atual e fechar o escopo

**Files:**
- Read: `AGENTS.md`
- Read: `CLAUDE.md`
- Read: `skills/README.md`
- Read: `scripts/skills/install-skills.mjs`

- [x] Registrar `git status --short`, branch atual e resumo das alterações sem modificar o worktree.
- [x] Confirmar que o trabalho das skills ficará limitado a `skills/`, `scripts/skills/`, documentação e configurações explicitamente listadas neste plano.
- [x] Confirmar com o usuário que `~/.agents/skills` será um destino do Vela, com ownership somente das skills do Vela; o usuário autorizou não preservar a skill externa `no-mistakes`.
- [x] Registrar que a limpeza abrangerá os stores pessoais de skills de Claude Code, Codex, harness, Antigravity e OpenCode quando encontrados; configurações, histórico, skills nativas do Antigravity e caches de plugins ficam fora do reset.

### Task 2: Criar o inventário técnico reproduzível

**Files:**
- Create: `scripts/skills/report-skills.mjs`
- Create: `docs/skills/skill-inventory-2026-09-18.md`
- Modify: `package.json`

- [x] Implementar o inventário usando `fs.readdirSync` para localizar somente diretórios que contenham `SKILL.md`.
- [x] Calcular SHA-256 do `SKILL.md`, quantidade de arquivos auxiliares e lista de nomes por raiz.
- [x] Usar estas raízes nomeadas, sem assumir que todas existem em cada computador: `repo`, `agents`, `claude`, `codex`, `antigravity-config` e `antigravity-user`.
- [x] Emitir Markdown legível e JSON estável para permitir comparação entre o Mac e o Alienware.
- [x] Classificar cada skill como `same`, `different`, `missing` ou `extra` em relação ao repositório.
- [x] Adicionar os comandos `skills:report` e `skills:report:json` ao `package.json`.
- [x] Executar no Mac e salvar no relatório apenas dados necessários para decisão, sem incluir tokens, credenciais ou conteúdo privado das conversas.
- [ ] Executar o mesmo comando no Alienware depois do `git pull` e anexar os resultados comparáveis ao relatório.

Comandos esperados:

```bash
npm run skills:report
npm run skills:report:json
```

### Task 3: Produzir o relatório de uso e decisão

**Files:**
- Create: `docs/skills/skill-audit-2026-09-18.md`
- Read: `skills/*/SKILL.md`
- Read: planos e documentação ativa que referenciam skills

- [x] Criar uma linha para cada skill com: nome, origem, finalidade, cópias existentes, concordância de hash, referências ativas, sinais de uso, sobreposições, risco de remoção e recomendação preliminar.
- [x] Separar explicitamente `uso observado`, `referência documental`, `atividade de manutenção` e `não há evidência`; não converter um proxy em frequência.
- [x] Marcar como skills de domínio Vela as que protegem comportamento específico do projeto, especialmente `design-audit`, `import-parser`, `invoice-pdf`, `react-query-pattern` e `supabase-migration`.
- [x] Analisar famílias sobrepostas antes de remover qualquer membro: `tdd`/`test-driven-development`; `grill-me`/`grill-me-with-docs`/`grilling`/`loop-me`; `frontend-design`/`ui-ux-pro-max`/`make-interfaces-feel-better`/`emil-design-eng`; e os vários fluxos de revisão.
- [x] Incorporar ao relatório as skills da tela `Claude → Customize` como catálogo externo, sem misturá-las automaticamente com as skills versionadas do Vela.
- [x] Apresentar o relatório preliminar ao usuário para aprovação da lista final de `keep`, `merge`, `rewrite`, `disable` e `delete`.

### Task 4: Definir ownership e implementar a sincronização segura

**Files:**
- Create: `scripts/skills/skill-sync.mjs`
- Create: `scripts/skills/skill-reset.mjs`
- Create: `scripts/skills/skill-sync.test.mjs`
- Create: `scripts/skills/skill-reset.test.mjs`
- Modify: `scripts/skills/install-skills.mjs`
- Modify: `package.json`
- Modify: `.claude/hooks/session-start.sh`

- [x] Definir um manifesto por máquina em `~/.vela/skill-sync/<target>.json`, contendo versão do manifesto, origem e nomes/hashes gerenciados pelo Vela.
- [x] Fazer o sincronizador copiar a árvore completa de cada skill, incluindo referências e scripts auxiliares.
- [x] Implementar `--dry-run` para exibir `add`, `update`, `remove-owned` e `unchanged` sem alterar arquivos.
- [x] Implementar `--check` para retornar falha quando um destino divergir da fonte.
- [x] Implementar `--prune-owned` para remover somente nomes presentes no manifesto anterior e ausentes na fonte atual.
- [x] Preservar diretórios externos, incluindo `.system`, skills de plugins e skills nativas do Antigravity; remover a integração externa `no-mistakes` por decisão explícita do usuário.
- [x] Desativar a reinstalação automática do `no-mistakes`, remover seu registro do OpenCode, retirar o gate Git do Vela e mover os artefatos locais para a Lixeira do macOS.
- [x] Manter `install-skills.mjs` como wrapper compatível para o hook do Claude e para scripts de configuração existentes.
- [x] Garantir que o hook nunca faça `git pull` automático; atualização de código continua sendo uma decisão explícita do usuário.
- [x] Testar cópia idêntica, atualização de hash, skill removida da fonte, skill externa preservada e destino ausente.
- [x] Implementar reset explícito dos stores pessoais, com modo de simulação, backup recuperável, staging validado e troca atômica.
- [x] Incluir `~/.gemini/skills` como store pessoal do Antigravity, além de `~/.gemini/config/skills` quando ambos existirem.
- [x] Cobrir no reset a garantia de que somente as 14 skills com `SKILL.md` no repositório sejam materializadas.
- [x] Preservar o store `.system` do Codex durante a reconstrução do diretório pessoal.

Comandos esperados:

```bash
npm run skills:sync -- --dry-run
npm run skills:sync -- --check
npm run skills:sync
```

### Task 5: Limpar a fonte versionada depois da aprovação

**Files:**
- Modify/Delete: somente as pastas aprovadas dentro de `skills/`
- Modify: `skills/README.md`
- Modify: `scripts/check-docs.mjs`
- Modify: `opencode.json`, se aplicável
- Modify: documentos ativos que apontem para skills removidas

- [x] Usar a lista aprovada pelo usuário, não a lista inferida pelo agente.
- [x] Antes de cada remoção, verificar referências diretas em `CLAUDE.md`, `AGENTS.md`, `opencode.json`, scripts, documentação ativa e outras skills.
- [x] Remover pastas completas somente após registrar no relatório a razão, os substitutos e o impacto esperado.
- [x] Atualizar tabelas, comandos e validações que assumiam a existência das skills removidas.
- [x] Rodar `npm run docs:check` e corrigir referências vivas quebradas.
- [x] Executar o sincronizador em modo `--dry-run` e aplicar a poda controlada antes da decisão de reconstruir os stores.
- [ ] Corrigir o ledger histórico para incluir todas as remoções aprovadas, inclusive aliases consolidados, sem usá-lo como substituto do reset total.

### Task 6: Melhorar skills mantidas com RED-GREEN-REFACTOR

**Files:**
- Modify: uma pasta `skills/<nome>/` por vez
- Create: referências ou scripts apenas quando houver necessidade concreta

- [x] Estabelecer e sincronizar a convenção de português do Brasil (pt-BR) para perguntas, entrevistas, decisões, aprovações e pedidos de feedback nas skills interativas.
- [x] Remover a cópia local de `using-superpowers` após confirmar que ela duplica `superpowers:using-superpowers`; manter o plugin externo fora do ownership do Vela.
- [x] Escolher o primeiro grupo de melhoria de skills de alto valor e alto risco para o Vela, começando pelas skills de domínio e pelos workflows com maior sobreposição: `grill-me-with-docs`, `wayfinder`, `writing-plans` e `executing-plans`.
- [x] Para cada skill do grupo de melhoria, escrever pelo menos três cenários realistas de pressão antes de editar o `SKILL.md`; registro em `docs/archive/reports/2026-09-18-diagnostico-coorte-skills.md`.
- [x] Rodar os cenários sem a versão revisada em teste de mesa documental e registrar as violações, ambiguidades e racionalizações observadas no relatório histórico.
- [x] Ajustar somente o conteúdo necessário para corrigir os problemas observados.
- [x] Manter no frontmatter `name` válido e uma `description` curta, iniciada por `Use when...`, contendo gatilhos discriminantes e sem resumir o workflow.
- [x] Manter no corpo apenas decisões que mudam o comportamento do agente; mover referências pesadas para arquivos ligados e carregados progressivamente.
- [x] Rodar os mesmos cenários com a skill revisada e verificar o comportamento observável.
- [x] Executar o validador oficial em cada skill revisada:

```bash
python3 /Users/luccajuliatti/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/<nome>
```

> Resultado em 2026-09-18: `writing-plans` e `executing-plans` passaram. Em
> `wayfinder` e `grill-me-with-docs`, o script recusou a propriedade existente
> `disable-model-invocation`; ela foi preservada por ser parte da política de
> invocação dessas skills. Ver o relatório histórico para a limitação.

- [x] Medir o tamanho do `SKILL.md`, revisar gatilhos e checar links internos antes de passar à próxima skill.
- [ ] Fazer um commit pequeno por grupo de melhoria aprovado, sem misturar alterações de aplicação.

### Task 6b: Melhorar o grupo de entrevista e comunicação

**Files:**
- Modify: `skills/grill-me/SKILL.md`
- Modify: `skills/grilling/SKILL.md`
- Modify: `skills/eli5/SKILL.md`
- Modify: `skills/wait-what/SKILL.md`
- Modify: `skills/README.md`

- [x] Registrar cenários de roteamento, idioma, fidelidade e capacidade ausente no relatório histórico.
- [x] Diferenciar o motor `grilling`, a entrada `grill-me`, a persistência `grill-me-with-docs` e o reparo `wait-what`.
- [x] Garantir pt-BR nas respostas dirigidas ao usuário e preservar fatos materiais nas explicações simplificadas.
- [x] Sincronizar as quatro skills nas raízes locais e atualizar o catálogo.
- [x] Repetir os cenários e executar os checks de documentação, diff e sincronizador.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

> Adendo de arquitetura: as entradas `grill-me` e `grill-me-with-docs` foram
> posteriormente absorvidas por `grilling`; os nomes continuam somente como
> aliases de compatibilidade no OpenCode.

### Task 6c: Consolidar a família de revisão de código

**Files:**
- Create: `skills/vela-code-review/SKILL.md`
- Create: `skills/vela-code-review/references/rigorous-review.md`
- Create: `skills/vela-code-review/references/reviewer-prompt.md`
- Delete: `skills/receiving-code-review/`, `skills/requesting-code-review/`, `skills/thermo-nuclear-code-quality-review/`
- Modify: `skills/security-audit-penetration-testing/SKILL.md`, `skills/README.md`, `opencode.json`
- Create: `docs/archive/reports/2026-09-18-unificacao-code-review.md`

- [x] Confirmar a sobreposição por gatilho, objetivo, saída e momento entre as
  três skills de revisão existentes.
- [x] Definir `vela-code-review` como entrada canônica com os modos `solicitar`,
  `receber` e `rigorosa`.
- [x] Preservar o prompt de revisor independente e os critérios de revisão
  estrutural em referências carregadas progressivamente.
- [x] Manter aliases temporários no `opencode.json` sem manter três
  implementações ou diretórios redundantes.
- [x] Atualizar rotas de segurança, catálogo e documentação ativa.
- [x] Executar cenários de roteamento, validação estrutural, checks de docs e
  sincronização com poda controlada.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 6d: Padronizar a linguagem do sistema nas skills

**Files:**
- Create: `docs/agents/linguagem-do-sistema.md`
- Modify: `CONTEXT.md`, `skills/README.md` e os entrypoints das skills ativas
- Modify: `docs/skills/skill-audit-2026-09-18.md`

- [x] Definir o glossário canônico e o formato `onde → ação → efeito → conexão
  → detalhe técnico`.
- [x] Orientar as skills de UI, planejamento, entrevista, revisão, auditoria,
  segurança, explicação e handoff a começar pela linguagem visível do Vela.
- [x] Preservar termos técnicos quando necessários, mas apresentá-los como
  detalhe de implementação depois do efeito no sistema.
- [x] Validar documentação e sincronizar a regra nas quatro raízes locais.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 6e: Consolidar a família de entrevistas

**Files:**
- Modify: `skills/grilling/SKILL.md`, `skills/brainstorming/SKILL.md`, `skills/README.md`, `opencode.json`
- Delete: `skills/grill-me/`, `skills/grill-me-with-docs/`
- Create: `docs/archive/reports/2026-09-18-unificacao-entrevista.md`

- [x] Definir `grilling` como entrada canônica para entrevista sem persistência
  e persistência confirmada.
- [x] Incorporar o roteamento para `wayfinder`, `writing-plans` e
  `executing-plans`, sem permitir implementação silenciosa.
- [x] Preservar a confirmação explícita antes de alterar `CONTEXT.md`, ADRs,
  planos, specs ou issues.
- [x] Manter aliases temporários no OpenCode e remover as duas implementações
  redundantes da fonte.
- [x] Executar cenários de roteamento, validação estrutural, checks de docs e
  sincronização com poda controlada.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 6f: Consolidar a família de design de interfaces

**Files:**
- Modify: `skills/frontend-design/SKILL.md`
- Create: `skills/frontend-design/references/accessibility-interaction.md`
- Create: `skills/frontend-design/references/flows-data.md`
- Create: `skills/frontend-design/references/layout-style.md`
- Create: `skills/frontend-design/references/polish.md`
- Create: `skills/frontend-design/references/review.md`
- Delete: `skills/make-interfaces-feel-better/`, `skills/ui-ux-pro-max/`
- Modify: `skills/README.md`, `opencode.json`
- Create: `docs/archive/reports/2026-09-18-unificacao-design-ui.md`

- [x] Confirmar que criação, polimento e avaliação são intenções relacionadas,
  mas com critérios e saídas diferentes.
- [x] Definir `frontend-design` como entrada canônica com os modos `criar`,
  `polir` e `avaliar`.
- [x] Incorporar as orientações úteis de acessibilidade, layout, fluxos,
  dados, revisão e microinterações em referências carregadas progressivamente.
- [x] Adaptar regras originalmente móveis ou excessivamente rígidas para o
  contexto web do Vela, respeitando tokens, acessibilidade e estados reais.
- [x] Manter `design-audit` separado para auditoria completa do produto.
- [x] Manter aliases temporários no OpenCode e remover as duas implementações
  redundantes da fonte.
- [x] Executar cenários de roteamento, validação estrutural, checks de docs e
  sincronização com poda controlada.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 6g: Ajustar explicação, handoff e revisão orientada ao sentido

**Files:**
- Modify: skills/eli5/SKILL.md
- Modify: skills/handoff/SKILL.md
- Modify: skills/vela-code-review/SKILL.md
- Modify: skills/vela-code-review/references/reviewer-prompt.md
- Modify: skills/vela-code-review/references/rigorous-review.md
- Modify: skills/README.md, opencode.json
- Create: docs/archive/reports/2026-09-18-ajustes-eli5-handoff-code-review.md

- [x] Redefinir eli5 para o perfil de proprietário do Vela, sem infantilização e
  com explicação pelo vocabulário das páginas e fluxos.
- [x] Redefinir handoff como documento Randolph pronto para copiar e colar,
  sem invocação automática de subagentes por padrão.
- [x] Fazer vela-code-review confrontar código, decisões atuais e anteriores,
  especificações, planos, ADRs e comportamento visível.
- [x] Exigir investigação de substituições de lógica ambíguas, pergunta
  explícita ao usuário e exemplo hipotético no vocabulário do Vela.
- [x] Executar validação estrutural, checks de docs, cenários de roteamento e
  sincronização com poda controlada.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 6h: Ajustar as seis skills restantes

**Files:**
- Modify: `skills/brainstorming/SKILL.md`, `skills/brainstorming/visual-companion.md`
- Modify: `skills/design-audit/SKILL.md`
- Modify: `skills/improve-codebase-architecture/SKILL.md`, `skills/improve-codebase-architecture/HTML-REPORT.md`
- Modify: `skills/security-audit-penetration-testing/SKILL.md`
- Modify: `skills/wait-what/SKILL.md`
- Modify: `skills/writing-skills/SKILL.md`
- Modify: `skills/README.md`, `opencode.json`
- Create: `docs/archive/reports/2026-09-18-ajustes-seis-skills-restantes.md`

- [x] Ajustar `brainstorming` para confirmação explícita antes de persistir
  decisões e usar exemplos do fluxo Vela.
- [x] Ajustar `design-audit` para separar achados de decisão de produto e
  investigar conflitos de semântica antes de corrigir.
- [x] Reescrever o contrato de `improve-codebase-architecture` e seu formato
  HTML para ser portável, offline e orientado ao vocabulário do Vela.
- [x] Reforçar limites de escopo em `security-audit-penetration-testing` e
  aplicar o perfil do proprietário em `wait-what`.
- [x] Governar fonte, destinos e matriz de cenários em `writing-skills`.
- [x] Rodar validação estrutural, documentação, diff, testes do sincronizador
  e dry-run nos quatro destinos.
- [x] Aplicar sincronização efetiva, gerar inventário pós-ajuste e executar
  `npm run skills:sync -- --check`.
- [ ] Fazer um commit pequeno do grupo, sem misturar alterações de aplicação.

### Task 7: Validar e replicar nos dois computadores

**Files:**
- Modify: `docs/skills/skill-audit-2026-09-18.md`
- Read: inventários gerados no Mac e no Alienware

- [x] Rodar inventário e reset no Mac; o inventário confirmou 14 skills em cada store pessoal.
- [ ] Abrir novas sessões e confirmar a descoberta das 14 skills no Claude Code, Codex, harness e Antigravity.
- [x] Fazer commit e push somente dos arquivos aprovados. Commit: `8bc8d976`.
- [ ] No Alienware, executar `git pull --ff-only` na branch aprovada.
- [ ] Executar o mesmo reset no Alienware, revisar a simulação e então aplicar a reconstrução.
- [ ] Repetir o inventário e comparar os resultados das duas máquinas.
- [ ] Confirmar que somente os stores pessoais foram reconstruídos; skills nativas e caches de plugins continuam administrados pelos aplicativos.
- [ ] Registrar divergências residuais no relatório, sem resolvê-las destrutivamente.

### Task 8: Encerrar e manter a governança

**Files:**
- Modify: `docs/plans/README.md`
- Modify: `skills/README.md`
- Modify: `scripts/README.md`
- Modify: `docs/CHANGELOG.md`

- [ ] Documentar o fluxo oficial: editar no repositório, fazer commit/push, fazer pull no outro computador e sincronizar.
- [ ] Documentar que diretórios globais são artefatos gerados e não devem ser editados manualmente.
- [ ] Registrar como skills de sistema, plugins e Claude Customize ficam fora do ownership do Vela.
- [ ] Rodar `npm run docs:check` e os testes específicos do sincronizador.
- [ ] Revisar o diff final, confirmar que nenhuma alteração de aplicação foi incluída e só então arquivar este plano em `docs/archive/plans/`.

## Critério de conclusão

O trabalho estará concluído quando:

1. existir um relatório aprovado de uso, duplicidade e decisão para cada skill;
2. o repositório for a única fonte editável das skills pertencentes ao Vela;
3. o reset reconstruir os stores pessoais sem apagar configurações ou caches externos, e o sincronizador incremental respeitar ownership;
4. Mac e Alienware apresentarem o mesmo inventário das skills do Vela;
5. cada skill mantida e revisada tiver validação estrutural e cenário comportamental correspondente;
6. novas sessões dos três aplicativos carregarem o conjunto aprovado.
