# Auditoria das skills e decisão de limpeza — 2026-09-18

> **Status:** matriz histórica aprovada pelo usuário; a remoção das candidatas da
> fonte versionada e o reset dos stores pessoais do Mac foram executados. Os
> números abaixo descrevem o estado anterior e não devem ser lidos como o
> inventário atual. Consulte o inventário pós-reset para o estado vigente.

## Objetivo

Separar disponibilidade, divergência, evidência de uso e qualidade. A matriz foi
comparada com o relatório do Alienware e serviu de base para a aprovação da
limpeza.

## Baseline de validação

`npm run docs:check` foi executado antes da limpeza e falhou com quatro referências de rotas já existentes:

- `docs/ARCHITECTURE.md`: `/carga-solta/:blId` não documentada.
- `docs/RASTREABILIDADE.md`: `/carga-solta`, `/carga-solta/:blId` e `/manifestos` não mapeadas.

Essas falhas não foram introduzidas pelo inventário e não serão corrigidas dentro deste trabalho de skills.

## Evidências do MacBook M5

- Repositório Vela: 50 skills.
- `~/.agents/skills`: 49 skills após a remoção de `no-mistakes` (o inventário inicial tinha 50).
- `~/.claude/skills`: 50 skills.
- `~/.codex/skills`: 50 skills.
- `~/.gemini/config/skills`: 50 skills.
- Em relação ao repositório, `SKILL.md` diverge em 37 skills no diretório `.agents` e em 38 skills em Claude, Codex e Antigravity.
- Apenas 12 skills são idênticas entre o repositório e cada destino principal.
- `eli5` está ausente em `.agents`; o extra `no-mistakes` foi removido dos diretórios `.agents` e Claude durante esta limpeza.
- Antes da limpeza, o hook `.claude/hooks/session-start.sh` reinstalava `no-mistakes` por meio de `scripts/no-mistakes/`; o bloco foi removido para impedir o retorno automático.
- A tela do Claude Customize mostrou 27 skills criadas pelo usuário, várias desabilitadas, além de 13 skills de Anthropic/parceiros. Esse catálogo é externo ao repositório.
- O Antigravity mostrou 55 skills no total, incluindo skills próprias do aplicativo além das 50 cópias globais.

## Caso especial: `no-mistakes`

`no-mistakes` não pertence às 50 skills do Vela. Era uma integração externa de qualidade para Git, composta por duas partes:

- a skill `/no-mistakes`, instalada no nível do usuário para orientar agentes;
- o binário/portão Git `no-mistakes`, que recebe um `git push no-mistakes`, cria um worktree descartável, executa uma sequência de revisão, testes, documentação, lint, push, PR e CI, e só encaminha a alteração após os gates passarem. Ver o [repositório oficial](https://github.com/kunchenguid/no-mistakes).

No inventário inicial do MacBook, a integração estava instalada localmente: havia o binário em `~/.no-mistakes`, um remoto Git chamado `no-mistakes` e um hook que chamava `scripts/no-mistakes/setup.sh` e `no-mistakes init`. Esses componentes foram removidos; os artefatos locais foram movidos para a Lixeira do macOS como medida reversível.

Ela não era necessária para executar a aplicação Vela, rodar testes ou fazer deploy. Sua importância era exclusivamente de processo: funcionava como uma barreira adicional antes do envio de código. A integração completa foi removida por decisão explícita do usuário; referências em documentos arquivados e no próprio registro desta auditoria são históricas e não reativam o gate.

## Atualização pós-reset — 2026-09-18

O reset controlado reconstruiu os cinco stores pessoais encontrados no MacBook:

- `~/.agents/skills`
- `~/.claude/skills`
- `~/.codex/skills`
- `~/.gemini/config/skills`
- `~/.gemini/skills`

Cada store agora contém as mesmas 14 skills ativas do repositório. O Antigravity
builtin (`~/.gemini/antigravity/builtin/skills`) e os caches de plugins não
foram apagados. O backup recuperável está em
`~/.vela/skill-sync/backups/2026-09-18T19-55-02.466Z/`.

## Como interpretar a matriz

- **Hash/status:** compara somente o conteúdo do `SKILL.md`; arquivos auxiliares são contabilizados no inventário, mas ainda precisam de comparação própria antes da sincronização.
- **Referências:** referências documentais e commits são proxies de manutenção/contexto, não frequência real de invocação.
- **Candidata indicada:** skill marcada para exclusão na matriz e aprovada pelo
  usuário em 2026-09-18.
- **Manter provisoriamente:** skill que não entrou no grupo de exclusão; ainda
  será revisada e poderá ser melhorada ou consolidada.
- **Vela / domínio:** merece análise de impacto antes de exclusão porque contém regras específicas do produto.

## Comparação consolidada entre MacBook e Alienware

Os dois relatórios foram aceitos como base suficiente para a próxima decisão. Eles não devem ser somados como se fossem uma única série temporal: o relatório do Alienware cobre registros desde maio, enquanto o relatório do MacBook concentra-se em agosto e setembro, e os critérios de filtragem não são perfeitamente idênticos.

| Medida | MacBook | Alienware | Leitura |
| --- | ---: | ---: | --- |
| Skills com invocação explícita | 14/50 | 21/50 | O Alienware possui histórico mais antigo e mais amplo. |
| Invocações explícitas contabilizadas | 43 | 68 | Não somar como frequência global sem deduplicação entre máquinas. |
| Skills explícitas em ambas as máquinas | 9 | 9 | Sinal mais forte de uso recorrente. |
| Skills explícitas somente nesta máquina | 5 | 12 | Pode refletir contexto, período ou preferência de aplicativo. |
| Skills sem invocação explícita na máquina | 36/50 | 29/50 | Em conjunto, 24/50 não tiveram invocação explícita; isso não prova inutilidade. |

### Sinais mais consistentes

- `requesting-code-review`: 17 no MacBook e 13 no Alienware.
- `tdd`: 9 no MacBook e 7 no Alienware.
- `eli5`: 3 no MacBook e 4 no Alienware.
- `handoff`: 3 no MacBook e 2 no Alienware.
- `grill-me-with-docs`: 1 no MacBook e 10 no Alienware.
- `make-interfaces-feel-better`, `prototype`, `receiving-code-review` e `thermo-nuclear-code-quality-review` aparecem explicitamente nas duas máquinas.

### Skills explícitas apenas no MacBook

`caveman`, `import-parser`, `improve`, `invoice-pdf` e `supabase-migration`.

As três skills de domínio (`import-parser`, `invoice-pdf` e `supabase-migration`) ficam protegidas contra qualquer decisão baseada apenas em frequência.

### Skills explícitas apenas no Alienware

`grilling`, `loop-me`, `emil-design-eng`, `domain-modeling`, `executing-plans`, `implement`, `writing-plans`, `frontend-design`, `subagent-driven-development`, `ui-ux-pro-max`, `using-superpowers` e `wayfinder`.

Isso reforça que a limpeza precisa considerar o conjunto das duas máquinas, e não apenas o comportamento observado no MacBook.

### Decisão preliminar por família

| Família | Evidência combinada | Próximo tratamento |
| --- | --- | --- |
| Testes: `tdd` / `test-driven-development` | `tdd` é explícita nas duas máquinas; a segunda tem evidência indireta | Escolher uma skill canônica e absorver a outra, sem apagar antes da comparação de conteúdo. |
| Elicitação: `grill-me` / `grill-me-with-docs` / `grilling` / `loop-me` | Uso explícito forte no Alienware e algum uso no MacBook | Consolidar variantes e definir gatilhos discriminantes. |
| Revisão: `requesting-code-review` / `receiving-code-review` / `autoreview` / `thermo-nuclear-code-quality-review` | `requesting-code-review` é o maior sinal global; outras aparecem em pelo menos uma máquina | Delimitar entrada, saída e momento de cada fluxo. |
| Design: `frontend-design` / `ui-ux-pro-max` / `make-interfaces-feel-better` / `emil-design-eng` | Uso distribuído entre as duas máquinas | Reduzir sobreposição sem perder design de produto, UI e polimento de interação. |
| Planejamento/execução | Uso explícito relevante no Alienware | Modelar como fluxo único antes de decidir fusões ou aposentadorias. |
| Domínio Vela | Baixa frequência explícita, mas papel específico no produto | Proteger e revisar qualidade, gatilhos, referências e contratos. |

### Análise inicial: `tdd` versus `test-driven-development`

Esta família não é uma duplicata textual simples:

- `tdd` é a referência detalhada para TDD solicitado explicitamente. Define seam público, teste comportamental, red→green, ciclo vertical e anti-padrões; possui `tests.md` e `mocking.md`.
- `test-driven-development` é mais curto e tem gatilho mais amplo: implementar qualquer feature ou correção antes do código, incluindo reprodução de regressões. Também preserva trabalho existente e aponta para `testing-anti-patterns.md`.
- O próprio catálogo declara que são referências alternativas, e `opencode.json` expõe as duas com comandos distintos.
- O uso explícito favorece `tdd` nas duas máquinas, mas a evidência técnica de `test-driven-development` indica que ele pode cumprir um papel automático de processo. Frequência explícita, portanto, não é motivo suficiente para removê-lo.

**Recomendação registrada antes da aprovação:** manter as duas durante a
limpeza; definir `tdd` como referência canônica do conteúdo test-first e
transformar `test-driven-development` em uma entrada fina de compatibilidade.
Essa recomendação foi superada pela decisão posterior do usuário de excluir
ambas, preservando o histórico desta análise.

### Regra de decisão

Esta comparação orientou a ordem da análise. A remoção exigiu aprovação
explícita do usuário, verificação de referências ativas e atualização dos
destinos controlados pelo sincronizador.

## Matriz das 50 skills

| Skill | Categoria | Finalidade declarada | Palavras no corpo | Hash repo | Destinos no Mac | Candidata indicada | Ação preliminar |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| ask-matt | Mattpocock / roteamento | Ask which skill or flow fits your situation. A router over the skills in this repo. | 1778 | same:3d38910535f5 | agents=same:3d38910535f5; claude=same:3d38910535f5; codex=same:3d38910535f5; antigravity=same:3d38910535f5 | sim | candidata indicada; revisar impacto |
| autoreview | revisão / qualidade | "Run a structured code review with the requested engine for a local, commit or branch diff." | 1496 | same:1119e8955990 | agents=different:33a323d89244; claude=different:33a323d89244; codex=different:33a323d89244; antigravity=different:33a323d89244 | sim | candidata indicada; revisar impacto |
| brainstorming | Superpowers / planejamento | "Explore unresolved product or design choices before a substantial implementation." | 133 | same:4075be7c6054 | agents=different:0a5064929bf5; claude=different:0a5064929bf5; codex=different:0a5064929bf5; antigravity=different:0a5064929bf5 | não | manter provisoriamente; validar uso |
| caveman | comunicação | "Use compressed caveman-style wording when the user requests that communication mode." | 233 | same:250f50636a8b | agents=different:b4bb6fe3bf3d; claude=different:b4bb6fe3bf3d; codex=different:b4bb6fe3bf3d; antigravity=different:b4bb6fe3bf3d | sim | candidata indicada; revisar impacto |
| codebase-design | Mattpocock / arquitetura | "Design module interfaces and boundaries to improve locality and testability." | 820 | same:f43e901c632d | agents=different:a8d50abac5a4; claude=different:a8d50abac5a4; codex=different:a8d50abac5a4; antigravity=different:a8d50abac5a4 | sim | candidata indicada; revisar impacto |
| design-audit | Vela / domínio | "Audit Vela UI across pages with screenshots and prioritized findings." | 694 | same:295648d1e2c9 | agents=different:71cb79b735ba; claude=different:71cb79b735ba; codex=different:71cb79b735ba; antigravity=different:71cb79b735ba | não | manter provisoriamente; validar uso |
| diagnosing-bugs | Mattpocock / diagnóstico | "Investigate difficult bugs or performance regressions with competing hypotheses." | 1387 | same:c541efc4bf3c | agents=different:7a0779480f32; claude=different:7a0779480f32; codex=different:7a0779480f32; antigravity=different:7a0779480f32 | sim | candidata indicada; revisar impacto |
| dispatching-parallel-agents | Superpowers / coordenação | "Coordinate authorized parallel investigations of independent problems." | 901 | same:467f7e15f0b3 | agents=different:76806091c7f9; claude=different:76806091c7f9; codex=different:76806091c7f9; antigravity=different:76806091c7f9 | sim | candidata indicada; revisar impacto |
| domain-modeling | Mattpocock / domínio | "Clarify domain terminology and record related architectural decisions." | 475 | same:c13b3b5ecb9b | agents=different:152e2c97239a; claude=different:152e2c97239a; codex=different:152e2c97239a; antigravity=different:152e2c97239a | sim | candidata indicada; revisar impacto |
| eli5 | comunicação | "Explain a topic at an explicitly requested audience or knowledge level." | 1134 | same:302fde38e79c | agents=missing; claude=different:a671efd44a81; codex=different:a671efd44a81; antigravity=different:a671efd44a81 | não | manter provisoriamente; validar uso |
| emil-design-eng | design / UX | "Refine component motion and interaction using Emil Kowalski design principles." | 119 | same:ddce6eef4755 | agents=different:bb6455cc51e4; claude=different:bb6455cc51e4; codex=different:bb6455cc51e4; antigravity=different:bb6455cc51e4 | sim | candidata indicada; revisar impacto |
| executing-plans | Superpowers / execução | "Implement an existing plan through validation and completion." | 137 | same:527aafff5052 | agents=different:a6bef9ff919a; claude=different:a6bef9ff919a; codex=different:a6bef9ff919a; antigravity=different:a6bef9ff919a | não | manter provisoriamente; validar uso |
| finishing-a-development-branch | Superpowers / entrega | "Complete a requested branch integration, PR delivery or workspace cleanup." | 168 | same:d68414d3e712 | agents=different:5c8d4b59aedb; claude=different:5c8d4b59aedb; codex=different:5c8d4b59aedb; antigravity=different:5c8d4b59aedb | sim | candidata indicada; revisar impacto |
| frontend-design | design / UI | "Design and implement a web interface with a coherent visual direction." | 520 | same:02811b0f7c82 | agents=different:b81e2ff87ed8; claude=different:b81e2ff87ed8; codex=different:b81e2ff87ed8; antigravity=different:b81e2ff87ed8 | não | manter provisoriamente; validar uso |
| grill-me | Mattpocock / elicitação | A relentless interview to sharpen a plan or design. | 4 | same:6189dfceb730 | agents=same:6189dfceb730; claude=same:6189dfceb730; codex=same:6189dfceb730; antigravity=same:6189dfceb730 | não | manter provisoriamente; validar uso |
| grill-me-with-docs | Mattpocock / elicitação | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. | 8 | same:d339f8718245 | agents=same:d339f8718245; claude=same:d339f8718245; codex=same:d339f8718245; antigravity=same:d339f8718245 | não | manter provisoriamente; validar uso |
| grilling | Mattpocock / elicitação | Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases. | 277 | same:fa5c1e5ee76b | agents=same:fa5c1e5ee76b; claude=same:fa5c1e5ee76b; codex=same:fa5c1e5ee76b; antigravity=same:fa5c1e5ee76b | não | manter provisoriamente; validar uso |
| handoff | Mattpocock / continuidade | Hand the current conversation off to a fresh background agent that picks up the work immediately. | 164 | same:0fc09a63f488 | agents=same:0fc09a63f488; claude=same:0fc09a63f488; codex=same:0fc09a63f488; antigravity=same:0fc09a63f488 | não | manter provisoriamente; validar uso |
| implement | Mattpocock / execução | "Implement an agreed spec or set of tickets through verification." | 73 | same:2968d9a04cf8 | agents=different:6d3fd9e83b8f; claude=different:6d3fd9e83b8f; codex=different:6d3fd9e83b8f; antigravity=different:6d3fd9e83b8f | sim | candidata indicada; revisar impacto |
| import-parser | Vela / domínio | "Add or change Vela file parsing and import persistence." | 700 | same:bd8fce12d95b | agents=different:51ed7df1a883; claude=different:51ed7df1a883; codex=different:51ed7df1a883; antigravity=different:51ed7df1a883 | sim | candidata indicada; revisar impacto |
| improve | auditoria / planejamento | "Audit a codebase and produce prioritized improvement plans without implementation." | 2195 | same:83e0b7d13acf | agents=different:1599aa29e9b1; claude=different:1599aa29e9b1; codex=different:1599aa29e9b1; antigravity=different:1599aa29e9b1 | sim | candidata indicada; revisar impacto |
| improve-codebase-architecture | Mattpocock / arquitetura | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. | 887 | same:4b4cb798c386 | agents=same:4b4cb798c386; claude=same:4b4cb798c386; codex=same:4b4cb798c386; antigravity=same:4b4cb798c386 | não | manter provisoriamente; validar uso |
| invoice-pdf | Vela / domínio | "Change Vela invoice content, formatting or browser print layout." | 413 | same:ae719ab86ee9 | agents=different:2fbe2449c97a; claude=different:2fbe2449c97a; codex=different:2fbe2449c97a; antigravity=different:2fbe2449c97a | sim | candidata indicada; revisar impacto |
| loop-me | Mattpocock / elicitação | Grill me about specs for the workflows I want to build, within this workspace. | 394 | same:2b2c725f8b6e | agents=same:2b2c725f8b6e; claude=same:2b2c725f8b6e; codex=same:2b2c725f8b6e; antigravity=same:2b2c725f8b6e | sim | candidata indicada; revisar impacto |
| make-interfaces-feel-better | design / UI | "Polish existing interface interactions, animation and visual details." | 1111 | same:6026f40594b9 | agents=different:ab38771399de; claude=different:ab38771399de; codex=different:ab38771399de; antigravity=different:ab38771399de | não | manter provisoriamente; validar uso |
| prototype | Mattpocock / prototipagem | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like. | 458 | same:2579ecf89a7f | agents=same:2579ecf89a7f; claude=same:2579ecf89a7f; codex=same:2579ecf89a7f; antigravity=same:2579ecf89a7f | sim | candidata indicada; revisar impacto |
| react-query-pattern | Vela / domínio | "Change Vela remote-state ownership, query keys or mutation invalidation." | 546 | same:37dcc095d825 | agents=different:a3698bf75ab4; claude=different:a3698bf75ab4; codex=different:a3698bf75ab4; antigravity=different:a3698bf75ab4 | sim | candidata indicada; revisar impacto |
| receiving-code-review | Superpowers / revisão | "Evaluate code-review findings against the code and implement justified corrections." | 101 | same:b9e851c560d1 | agents=different:c9382e92b8f3; claude=different:c9382e92b8f3; codex=different:c9382e92b8f3; antigravity=different:c9382e92b8f3 | não | manter provisoriamente; validar uso |
| requesting-code-review | Superpowers / revisão | "Arrange a focused independent review when requested or warranted by change risk." | 120 | same:5ca0898496f9 | agents=different:22592fe43536; claude=different:22592fe43536; codex=different:22592fe43536; antigravity=different:22592fe43536 | não | manter provisoriamente; validar uso |
| research | Mattpocock / pesquisa | "Investigate a question using primary sources and record findings in the repository." | 89 | same:1ed0f0323892 | agents=different:af378829f015; claude=different:af378829f015; codex=different:af378829f015; antigravity=different:af378829f015 | sim | candidata indicada; revisar impacto |
| resolving-merge-conflicts | Mattpocock / Git | "Use when you need to resolve an in-progress git merge/rebase conflict." | 118 | same:c7c9ba81362a | agents=same:c7c9ba81362a; claude=same:c7c9ba81362a; codex=same:c7c9ba81362a; antigravity=same:c7c9ba81362a | sim | candidata indicada; revisar impacto |
| security-audit-penetration-testing | revisão / segurança | "Perform a scoped security audit or authorized penetration test." | 1035 | same:415710e53901 | agents=different:47c411eab3d0; claude=different:47c411eab3d0; codex=different:47c411eab3d0; antigravity=different:47c411eab3d0 | não | manter provisoriamente; validar uso |
| setup-matt-pocock-skills | Mattpocock / configuração | "Configure issue tracking and domain documentation for Matt Pocock workflows." | 1002 | same:f1944ff5606b | agents=different:def265a8b15f; claude=different:def265a8b15f; codex=different:def265a8b15f; antigravity=different:def265a8b15f | sim | candidata indicada; revisar impacto |
| subagent-driven-development | Superpowers / coordenação | "Execute a plan through authorized subagents with independent task ownership." | 156 | same:9a85009b53bd | agents=different:91c47d55ac3a; claude=different:91c47d55ac3a; codex=different:91c47d55ac3a; antigravity=different:91c47d55ac3a | sim | candidata indicada; revisar impacto |
| supabase-migration | Vela / domínio | "Create or review a Vela database migration and its app contract." | 599 | same:335fd647f399 | agents=different:78627b37fa36; claude=different:78627b37fa36; codex=different:78627b37fa36; antigravity=different:78627b37fa36 | sim | candidata indicada; revisar impacto |
| systematic-debugging | Superpowers / diagnóstico | "Trace an unexplained failure to its root cause before changing code." | 189 | same:38d03ef0d79b | agents=different:4999cb851360; claude=different:4999cb851360; codex=different:4999cb851360; antigravity=different:4999cb851360 | sim | candidata indicada; revisar impacto |
| tdd | Mattpocock / testes | "Develop test-first behavior at public interfaces when TDD is requested." | 437 | same:8011a3cb761b | agents=different:5363bb277567; claude=different:5363bb277567; codex=different:5363bb277567; antigravity=different:5363bb277567 | sim | candidata indicada; revisar impacto |
| test-driven-development | Superpowers / testes | "Implement behavior test-first when TDD is requested or a regression needs reproduction." | 136 | same:6b86f4fa07e2 | agents=different:7dee67b4af6b; claude=different:7dee67b4af6b; codex=different:7dee67b4af6b; antigravity=different:7dee67b4af6b | sim | candidata indicada; revisar impacto |
| thermo-nuclear-code-quality-review | revisão / qualidade | "Perform a requested strict maintainability and abstraction review." | 1883 | same:90d71204066b | agents=different:7faca08b51b6; claude=different:7faca08b51b6; codex=different:7faca08b51b6; antigravity=different:7faca08b51b6 | não | manter provisoriamente; validar uso |
| to-spec | Mattpocock / especificação | Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed. | 469 | same:267638edd513 | agents=same:267638edd513; claude=same:267638edd513; codex=same:267638edd513; antigravity=same:267638edd513 | sim | candidata indicada; revisar impacto |
| to-tickets | Mattpocock / planejamento | "Turn an agreed plan or spec into dependency-linked implementation tickets." | 874 | same:77e841b7dbd0 | agents=different:1846d215e24e; claude=different:1846d215e24e; codex=different:1846d215e24e; antigravity=different:1846d215e24e | sim | candidata indicada; revisar impacto |
| triage | Mattpocock / triagem | Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs. | 974 | same:d45827c299c0 | agents=same:d45827c299c0; claude=same:d45827c299c0; codex=same:d45827c299c0; antigravity=same:d45827c299c0 | sim | candidata indicada; revisar impacto |
| ui-ux-pro-max | design / UX | "Evaluate UI accessibility, layout and interaction patterns for a design task." | 132 | same:5b6d8b90857c | agents=different:9bd26c52dfd1; claude=different:9bd26c52dfd1; codex=different:9bd26c52dfd1; antigravity=different:9bd26c52dfd1 | não | manter provisoriamente; validar uso |
| using-git-worktrees | Superpowers / Git | "Create or reuse a Git worktree when the task needs workspace isolation." | 159 | same:ec344ecd4752 | agents=different:085a45ee3de4; claude=different:085a45ee3de4; codex=different:085a45ee3de4; antigravity=different:085a45ee3de4 | sim | candidata indicada; revisar impacto |
| using-superpowers | Superpowers / roteamento | "Select a relevant engineering skill when workflow choice is unclear." | 93 | same:2f26620b0f6e | agents=different:316e29381219; claude=different:316e29381219; codex=different:316e29381219; antigravity=different:316e29381219 | não | manter provisoriamente; validar uso |
| verification-before-completion | Superpowers / verificação | "Assess whether validation evidence supports a completion claim." | 107 | same:3f6bc4dceb6e | agents=different:ea52d15aabaf; claude=different:ea52d15aabaf; codex=different:ea52d15aabaf; antigravity=different:ea52d15aabaf | sim | candidata indicada; revisar impacto |
| wait-what | Mattpocock / comunicação | Stop. That last message did not land — re-pitch it. | 32 | same:8923f7df1a0d | agents=same:8923f7df1a0d; claude=same:8923f7df1a0d; codex=same:8923f7df1a0d; antigravity=same:8923f7df1a0d | não | manter provisoriamente; validar uso |
| wayfinder | Mattpocock / planejamento | "Map a large initiative into dependency-linked decision tickets." | 1975 | same:98f848ef5acc | agents=different:257e40665b28; claude=different:257e40665b28; codex=different:257e40665b28; antigravity=different:257e40665b28 | não | manter provisoriamente; validar uso |
| writing-plans | Mattpocock / planejamento | "Write an implementation plan for substantial work needing coordination or handoff." | 138 | same:93b52f55025a | agents=different:09e280bbb1f8; claude=different:09e280bbb1f8; codex=different:09e280bbb1f8; antigravity=different:09e280bbb1f8 | não | manter provisoriamente; validar uso |
| writing-skills | Superpowers / manutenção | "Create or refine a reusable skill and its task-specific references." | 183 | same:2b6b43e48cea | agents=different:38ba648975ae; claude=different:38ba648975ae; codex=different:38ba648975ae; antigravity=different:38ba648975ae | não | manter provisoriamente; validar uso |

## Famílias que precisam ser analisadas juntas

- **Testes:** `tdd` e `test-driven-development`.
- **Elicitação:** `grill-me`, `grill-me-with-docs`, `grilling` e `loop-me`.
- **Design:** `frontend-design`, `ui-ux-pro-max`, `make-interfaces-feel-better` e `emil-design-eng`.
- **Planejamento/execução:** `writing-plans`, `executing-plans`, `implement`, `subagent-driven-development`, `to-spec`, `to-tickets` e `wayfinder`.
- **Revisão:** `autoreview`, `receiving-code-review`, `requesting-code-review` e `thermo-nuclear-code-quality-review`.
- **Roteamento/meta:** `ask-matt`, `using-superpowers`, `setup-matt-pocock-skills` e `handoff`.

## Lista de candidatas indicada anteriormente

- `ask-matt`
- `autoreview`
- `caveman`
- `codebase-design`
- `diagnosing-bugs`
- `dispatching-parallel-agents`
- `domain-modeling`
- `emil-design-eng`
- `finishing-a-development-branch`
- `implement`
- `import-parser`
- `improve`
- `invoice-pdf`
- `loop-me`
- `prototype`
- `react-query-pattern`
- `research`
- `resolving-merge-conflicts`
- `setup-matt-pocock-skills`
- `subagent-driven-development`
- `supabase-migration`
- `systematic-debugging`
- `tdd`
- `test-driven-development`
- `to-spec`
- `to-tickets`
- `triage`
- `using-git-worktrees`
- `verification-before-completion`

## Decisão e execução — 2026-09-18

O usuário aprovou a exclusão de todas as 29 skills marcadas como candidatas na
matriz. Na primeira etapa, a fonte versionada passou a conter 21 skills; as 29
pastas aprovadas foram removidas de `skills/`.

Também foram removidos os comandos correspondentes do `opencode.json` e
atualizadas as referências ativas que apontavam para skills excluídas. Os
relatórios de uso, a matriz de 50 itens e os documentos arquivados permanecem
como histórico da decisão e não são um catálogo executável.

As cópias em `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` e
`~/.gemini/config/skills` serão atualizadas somente pelo sincronizador. A poda
de nomes antigos fica condicionada ao manifesto de ownership e ao `--dry-run`,
para não apagar skills externas, de plugins ou nativas dos harnesses.

Na primeira etapa da migração no MacBook, o inventário pós-limpeza registrou 21
skills em cada uma das quatro raízes e todos os hashes coincidiram com o
repositório. O `skills:sync --check` também passou. A replicação no Alienware
continua sendo a etapa posterior de pull e sincronização, não uma segunda
análise de uso.

### Adendo — deduplicação com o plugin Superpowers — 2026-09-18

Após comparar a cópia local com `superpowers:using-superpowers`, o usuário
confirmou a remoção da versão pertencente ao Vela. O plugin fornece a versão
canônica no harness que o possui; plugins continuam fora do ownership e do
sincronizador do Vela.

A fonte versionada passa a conter 20 skills próprias. A poda da cópia local em
`~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` e
`~/.gemini/config/skills` será feita somente pelo sincronizador, após revisão do
`--dry-run`. A skill `superpowers:using-superpowers` não será removida.

Por consequência, o primeiro grupo de melhoria passa a ser composto por
`grill-me-with-docs`, `wayfinder`, `writing-plans` e `executing-plans`.

## Próximo checkpoint

1. Validar a fonte reduzida, o catálogo OpenCode e as referências documentais.
2. Executar o sincronizador em modo `--dry-run` e revisar os manifests por máquina.
3. Escolher o primeiro grupo pequeno de skills mantidas para melhoria comportamental.

## Grupo recomendado para melhoria

Começar pelo fluxo de decisão e execução, porque ele absorveu várias skills
removidas e afeta a seleção das demais:

1. `grill-me-with-docs` e `wayfinder`: elicitação e registro de decisões.
2. `writing-plans` e `executing-plans`: passagem de decisão para execução
   verificável.
3. `requesting-code-review`, `receiving-code-review` e
   `thermo-nuclear-code-quality-review`: revisão com entradas e saídas
   discriminantes.

Cada grupo deve passar por cenários RED-GREEN-REFACTOR antes de uma mudança de
conteúdo. A validação oficial ainda requer um ambiente Python com PyYAML; a
checagem estrutural local confirmou 21 entrypoints antes da deduplicação e 20
após a remoção da cópia local de `using-superpowers`.

### Adendo — unificação da família de revisão de código — 2026-09-18

As entradas `requesting-code-review`, `receiving-code-review` e
`thermo-nuclear-code-quality-review` foram consolidadas em
`vela-code-review`, com os modos `solicitar`, `receber` e `rigorosa`. A
implementação canônica evita a colisão com o `/code-review` built-in do harness;
os aliases antigos permanecem somente no `opencode.json` para compatibilidade.

O sinal de uso continua preservado como evidência histórica: a auditoria
registrou 17 invocações explícitas de `requesting-code-review`, 2 de
`thermo-nuclear-code-quality-review` e 1 de `receiving-code-review` no relatório
do MacBook. Esses números não são somados como se fossem uma nova série:
serviram para priorizar a família e justificar uma implementação canônica.

Após a sincronização controlada, o inventário registra 18 skills no repositório,
em `.agents`, Claude, Codex e Antigravity, com hashes idênticos. As três pastas
anteriores não existem mais nos destinos gerenciados; plugins, skills de sistema
e skills nativas permanecem fora do ownership do Vela.

### Adendo — unificação da família de entrevistas — 2026-09-18

`grilling` passou a ser a entrada canônica para entrevistas. O modo sem
persistência cobre o antigo `grill-me`; o modo de persistência confirmada cobre
o antigo `grill-me-with-docs`. A escrita continua condicionada a pedido explícito
ou confirmação do usuário e à classificação entre `CONTEXT.md`, ADR, plano,
spec, issue ou nenhum documento.

As duas pastas antigas foram removidas da fonte e dos destinos gerenciados; seus
comandos continuam como aliases do OpenCode. O inventário atual registra 16
skills Vela-owned em cada raiz local, com hashes idênticos.

### Adendo — unificação da família de design de interfaces — 2026-09-18

frontend-design passou a ser a entrada canônica para três modos:

- criar: implementar uma página, componente ou fluxo;
- polir: melhorar uma interface existente, seus estados e microinterações;
- avaliar: analisar uma tela ou fluxo sem alterar código automaticamente.

As orientações de make-interfaces-feel-better e ui-ux-pro-max foram
preservadas em referências progressivas dentro de frontend-design. O material
foi adaptado ao Vela web: valores fixos e regras originalmente voltadas a apps
móveis passaram a ser heurísticas dependentes de tokens, viewport,
acessibilidade e estado da tela.

As duas pastas antigas foram removidas da fonte e dos quatro destinos gerenciados.
Os comandos antigos permanecem como aliases no OpenCode. design-audit continua
separado por executar auditoria ampla do produto. O inventário pós-sincronização
registra 14 skills Vela-owned em cada raiz, com hashes correspondentes.

### Adendo — ajustes de explicação, handoff e revisão — 2026-09-18

eli5 foi ajustada para explicar o Vela ao proprietário do sistema, usando o
vocabulário das páginas e fluxos sem infantilização literal. A pessoa conhece
Viagens, BLs, containers, veículos, faturamento, taxas e locais, mas não precisa
conhecer a implementação em código.

handoff foi redefinida como documento Randolph pronto para copiar e colar. A
skill deve reconstruir o contexto da sessão, decisões, evidências, bloqueios e
próximo passo. Ela não deve invocar subagente ou transferir a sessão
automaticamente por padrão.

vela-code-review passou a revisar também o sentido do fluxo de trabalho. Uma
decisão recente é uma intenção provável, não uma substituição automaticamente
soberana de uma decisão anterior. Quando a substituição não for explícita, a
skill deve perguntar ao usuário se é isso mesmo que ele quer implementar e
apresentar um exemplo hipotético com o vocabulário do Vela. Toda revisão deve
incluir ao menos um exemplo de caminho fora do happy path.

### Adendo — ajustes das seis skills restantes — 2026-09-18

As seis skills que permaneceram fora das consolidações receberam ajustes
comportamentais:

- `brainstorming` agora separa decisão de persistência e exige confirmação
  antes de gravar documentos do Vela;
- `design-audit` separa achado de decisão de produto e não corrige semântica
  conflitante sem investigar com o usuário;
- `improve-codebase-architecture` passou a usar exploração disponível no
  harness, relatório offline autocontido e exemplos do fluxo Vela;
- `security-audit-penetration-testing` adotou análise local/estática como
  padrão e exige escopo para teste ativo;
- `wait-what` recebeu o perfil do proprietário do Vela, sem infantilização;
- `writing-skills` formalizou a fonte única no repositório, a sincronização com
  ownership e a matriz de cenários antes/depois.

O relatório detalhado está em
`docs/archive/reports/2026-09-18-ajustes-seis-skills-restantes.md`. A validação
estrutural passou nas quatro skills aceitas pelo validador; as duas skills com
`disable-model-invocation` foram rejeitadas apenas porque o validador antigo
não reconhece essa propriedade do harness. `docs:check`, `git diff --check`, os
cinco testes do sincronizador e o dry-run passaram. A sincronização efetiva e o
inventário pós-ajuste também passaram: 14 skills em cada raiz, com hashes
iguais ao repositório. Commit e push continuam pendentes de aprovação.
