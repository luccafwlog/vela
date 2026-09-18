# Unificação da família de entrevistas — 2026-09-18

## Decisão

`grilling` passou a ser a entrada canônica para entrevistas estruturadas no
Vela. As duas variações anteriores foram absorvidas como modos:

- **sem persistência:** equivalente ao uso de `grill-me`; entrevista e confirma
  entendimento, sem editar documentos, issues, configuração ou código;
- **persistência confirmada:** equivalente ao uso de `grill-me-with-docs`; grava
  somente decisões duráveis depois de confirmação explícita do usuário.

## Por que unificar

- As três entradas compartilhavam a mesma árvore de decisões, rounds, frontier,
  descoberta de fatos e encerramento.
- A diferença material era o efeito posterior da entrevista: nenhum documento
  ou persistência classificada e confirmada.
- A persistência implícita era um risco; o modo canônico exige pedido explícito
  ou pergunta de confirmação antes da primeira escrita.
- O nome `grilling` já era usado por `wayfinder`, `brainstorming` e documentos
  de decisão; mantê-lo evita quebrar esse vocabulário interno.

## Comportamento preservado

- Perguntas em rounds, sempre sobre a frontier disponível.
- Recomendações em pt-BR e espera pelas respostas do usuário.
- Consulta de fatos no repositório antes de perguntar algo verificável.
- Roteamento para `wayfinder`, `writing-plans` e `executing-plans`.
- Classificação de persistência entre `CONTEXT.md`, ADR, plano/spec/issue ou
  nenhum documento.
- Proibição de implementação, publicação ou alteração silenciosa do destino.

## Migração

As pastas `skills/grill-me/` e `skills/grill-me-with-docs/` foram removidas da
fonte e das cópias gerenciadas. Os comandos antigos permanecem como aliases no
`opencode.json`, encaminhando respectivamente para os modos sem persistência e
persistência confirmada de `grilling`.

## Validação

- Cenários de roteamento: passaram para entrevista sem persistência, persistência
  explícita, intenção ambígua, iniciativa grande e escopo já implementável.
- `npm run docs:check` — passou.
- `git diff --check` — passou.
- `npm run skills:sync -- --check` — passou nas quatro raízes após a aplicação.
- Inventário pós-sincronização: 16 skills Vela-owned no repositório e em cada
  raiz, com hashes correspondentes.
