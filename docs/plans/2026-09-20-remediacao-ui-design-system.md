# Plano de remediação de UI, design system e acessibilidade

- **Data:** 2026-09-20
- **Estado:** em execução
- **Spec:**
  [remediação de UI, design system e acessibilidade](../spec/2026-09-20-remediacao-ui-design-system-design.md)

## Objetivo

Corrigir os 6 achados P1 e 9 achados P2 da auditoria de 2026-09-20 com
regressões automatizadas, documentação histórica e uma PR isolada contra
`main`.

## Etapas

1. Adicionar testes falhos para apresentação segura de erros, semântica de
   status, confirmação de ADR e alinhamento numérico.
2. Corrigir tokens de contraste, alvos de toque, loading de botão, campos
   obrigatórios, paginação, empty state e skeletons.
3. Corrigir os contratos de teclado/foco de navegação, conta, notificações e
   combobox.
4. Aplicar os primitives nas telas de B/Ls, Containers, Faturas e Viagens,
   incluindo breadcrumb e terminologia em português.
5. Executar testes focados, gates completos e verificação visual possível.
6. Arquivar spec e plano, registrar a remediação na auditoria e no changelog,
   revisar o diff, abrir a PR e acompanhar seu CI até o término.

## Critérios de conclusão

- Os 15 achados têm correção rastreável em código e teste, ou limitação
  explicitamente documentada com justificativa.
- `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test` e
  `npm run build` passam no commit enviado.
- A PR contém somente a auditoria e sua remediação, sem alterações de Clientes,
  comunicação ou banco presentes na árvore original.
