# Remediação de UI, design system e acessibilidade

- **Data:** 2026-09-20
- **Estado:** aprovado para execução
- **Origem:** auditoria forense de UI, design system e acessibilidade de
  2026-09-20
- **Superfícies:** Vela interno e Portal Fwlog

## Resultado esperado

Os 15 achados da auditoria deixam de ser reproduzíveis. As correções devem
acontecer no menor dono compartilhado possível, sem redesenhar páginas ou
alterar regras de negócio. As duas SPAs continuam com identidade e autenticação
separadas, mas recebem os mesmos contratos acessíveis dos primitives comuns.

## Decisões

### Confiança e semântica

- Erros de operações passam por um adaptador de apresentação baseado em
  `classifyDbError`; mensagens técnicas só aparecem em desenvolvimento.
- `OMIT` e cancelamentos usam vermelho; conclusão usa verde; cinza fica
  reservado a informação neutra ou histórica.
- Cores de campos, badges e contadores usam pares de tokens com contraste AA em
  tema claro e escuro.
- Valores financeiros, pesos, volumes e quantidades usam alinhamento à direita
  e numerais tabulares.

### Interações compartilhadas

- Botões preservam a largura durante carregamento e anunciam `aria-busy`.
- `Field` propaga obrigatoriedade e a relação entre controle, ajuda e erro sem
  sobrescrever atributos fornecidos pelo chamador.
- `Combobox` segue o padrão de listbox: opção ativa identificada por
  `aria-activedescendant`, sem controle interativo aninhado, e estados
  assíncronos anunciados.
- Navegações expansíveis são disclosure de links, não menus de aplicação. O
  menu da conta usa botão nativo, estado expandido, `Escape` e restauração de
  foco.
- Alvos interativos compactos mantêm ícones densos, mas oferecem área acionável
  mínima de 44 × 44 px.

### Fluxos e orientação

- Fechar ADR exige confirmação que identifica a Viagem e explica o efeito.
  Reabrir ADR é ação de perigo, inclusive na confirmação.
- `EmptyState` aceita uma ação contextual e as telas oferecem importação ou
  limpeza de filtros somente quando aplicável e autorizada.
- A paginação informa o intervalo exibido. Skeletons espelham a geometria das
  tabelas e anunciam o estado ocupado.
- O detalhe de Viagem recebe breadcrumb. Textos visíveis usam o vocabulário do
  produto: **Fatura**, **Entrega alternativa** e **Relatório de Saída do Navio
  (ADR)**.

## Alternativas descartadas

1. **Correções apenas por página:** seria mais rápida inicialmente, mas
   duplicaria acessibilidade, loading e tratamento de erro nas duas SPAs.
2. **Reescrita ampla do design system:** aumentaria risco e escopo sem ser
   necessária para remover os achados observados.

## Estratégia de verificação

Cada contrato novo começa com teste de regressão falhando. A entrega exige os
gates de documentação, tipos, lint, testes e build, além de inspeção do diff.
Quando o ambiente local permitir, os fluxos principais serão observados em
desktop (1440 × 900) e mobile (390 × 844); qualquer lacuna de runtime será
declarada no relatório final.

## Fora de escopo

- Mudanças de schema, RLS, autenticação ou regras comerciais.
- Reformulação visual geral das telas.
- Alteração da terminologia canônica de domínio preservada em código, como
  `invoice`; a limpeza de idioma se restringe aos rótulos visíveis apontados.
