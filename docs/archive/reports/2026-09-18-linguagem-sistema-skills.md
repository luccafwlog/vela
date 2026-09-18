# Linguagem do sistema nas skills — 2026-09-18

## Decisão

As skills do Vela devem falar primeiro na linguagem que a pessoa reconhece na
interface e nos fluxos do sistema. O padrão canônico é:

`onde → ação → efeito visível → conexão com outro fluxo → detalhe técnico`

O glossário de referência é `CONTEXT.md`, complementado pelos documentos de
módulo, `docs/ARCHITECTURE.md` e pelos rótulos reais da interface.

## Aplicação

- `Viagens`, `BLs`, `Escalas`, `Manifesto Mercante`, `ADR`, `Portal` e outros
  nomes de domínio devem permanecer como nomes de domínio.
- Em pedidos de UI, prefira página, tela, botão, campo, coluna, filtro,
  dropdown, modal, aba, card, linha, status e mensagem.
- Componentes, hooks, services, queries, mutations, RPCs e arquivos entram
  depois, como detalhe para implementação, validação ou manutenção.
- Relatórios e planos devem explicar o impacto no fluxo antes da lista técnica.
- Quando a tela ou o vínculo não tiver sido verificado, a skill deve declarar a
  hipótese ou a necessidade de confirmação, sem inventar labels.
- Em tarefas sem tela, como sincronização e infraestrutura, explique primeiro o
  efeito operacional e depois o mecanismo.

## Alcance

O contrato foi incluído em `CONTEXT.md`, no catálogo e nos 18 entrypoints
Vela-owned. A regra cobre skills de planejamento, entrevistas, UI/UX, auditoria,
segurança, revisão, explicação, handoff, execução e manutenção de skills.

## Validação

- `npm run docs:check` — passou com 158 Markdown files.
- `git diff --check` — passou.
- `npm run skills:sync -- --check` — passou nas quatro raízes após a aplicação.
- Inventário pós-sincronização — 18 skills no repositório e em cada raiz, com
  hashes correspondentes.
