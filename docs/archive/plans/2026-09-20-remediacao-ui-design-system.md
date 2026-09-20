# Plano de remediação de UI, design system e acessibilidade

- **Data:** 2026-09-20
- **Estado:** concluído em 2026-09-20
- **Spec:**
  [remediação de UI, design system e acessibilidade](../specs/2026-09-20-remediacao-ui-design-system-design.md)

## Objetivo

Corrigir os 6 achados P1 e 9 achados P2 da auditoria de 2026-09-20 com
regressões automatizadas, documentação histórica e uma PR isolada contra
`main`.

## Task 1: Confiança e semântica operacional

**Arquivos:** `src/lib/errors.ts`, `src/components/ErrorBoundary.tsx`,
`src/lib/statusLabels.ts`, `src/pages/faturamentoInvoiceStatus.ts`, componentes
de Viagens/Faturas e seus testes.

1. Escrever testes que reproduzam mensagem técnica exposta, tons incorretos,
   fechamento de ADR sem confirmação e números sem alinhamento semântico.
2. Executar os testes focados e confirmar RED pela ausência dos contratos.
3. Implementar o menor helper/mapeamento e as confirmações necessárias.
4. Executar `npx vitest run` nos testes afetados; esperado: todos verdes.

## Task 2: Primitives e tokens acessíveis

**Arquivos:** `src/components/ui/{Button,Input,Card,Skeleton,TableFooterPagination}.tsx`,
`src/index.css` e testes de UI/CSS.

1. Escrever testes para loading estável, required programático, ação do estado
   vazio, intervalo de paginação, skeleton estrutural, contraste e alvo de 44 px.
2. Confirmar RED, implementar contratos compatíveis e executar os testes
   focados; esperado: todos verdes.

## Task 3: Teclado, foco e combobox

**Arquivos:** `src/components/ui/Combobox.tsx`,
`src/components/layout/AppLayout.tsx`,
`src/components/layout/InternalNotificationBell.tsx` e testes associados.

1. Escrever testes para disclosure sem papéis ARIA incorretos, botão de conta,
   `Escape`, restauração de foco e opção ativa do combobox.
2. Confirmar RED, implementar o padrão e executar os testes focados; esperado:
   todos verdes.

## Task 4: Aplicação nas telas

**Arquivos:** `src/pages/{Bls,Containers,Viagens}.tsx`, componentes de Faturas e
Viagens, e testes de comportamento.

1. Escrever testes para CTAs de vazio, skeletons equivalentes, breadcrumb,
   rótulos em português, alinhamento numérico e alvos de toque.
2. Confirmar RED, aplicar os primitives e executar os testes focados; esperado:
   todos verdes.

## Task 5: Evidência e entrega

**Arquivos:** auditoria histórica, `CHANGELOG.md`, plano e spec.

1. Executar `npm run docs:check`, `npm run typecheck`, `npm run lint`,
   `npm test`, `npm run build` e `git diff --check`; esperado: todos verdes.
2. Fazer a verificação visual possível em desktop e mobile e registrar o limite
   real da evidência.
3. Arquivar plano e spec, registrar a remediação sem reescrever as observações
   históricas e revisar o diff contra `main`.
4. Abrir a PR e acompanhar o CI do commit enviado até todos os checks
   terminarem verdes.

## Critérios de conclusão

- Os 15 achados têm correção rastreável em código e teste, ou limitação
  explicitamente documentada com justificativa.
- `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test` e
  `npm run build` passam no commit enviado.
- A PR contém somente a auditoria e sua remediação, sem alterações de Clientes,
  comunicação ou banco presentes na árvore original.
