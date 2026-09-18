# Unificação da família de design de interfaces — 2026-09-18

## Decisão

A família de design/UI foi consolidada em uma única skill Vela-owned:
frontend-design.

As três entradas anteriores tinham relação direta, mas atendiam momentos
distintos do mesmo trabalho:

| Intenção | Entrada canônica |
| --- | --- |
| Criar uma página, componente ou fluxo | frontend-design no modo criar |
| Melhorar uma interface existente | frontend-design no modo polir |
| Avaliar uma tela, fluxo ou interação | frontend-design no modo avaliar |

design-audit continua separado. Ele cobre uma auditoria ampla do Vela, com
execução do app, capturas de páginas, análise de estados/viewports, priorização
P0–P3 e aplicação controlada de correções. Essa escala e esse ciclo operacional
justificam uma entrada própria.

## Por que unificar

- As três skills usavam a mesma unidade de trabalho: uma interface, seus
  estados e o fluxo que ela suporta.
- A diferença principal era o resultado esperado — implementação, polimento ou
  diagnóstico — e não uma tecnologia ou um produto diferente.
- Manter três implementações fazia as regras de acessibilidade, responsividade
  e movimento divergirem.
- Uma entrada única torna a escolha explícita sem obrigar o agente a carregar
  referências de criação, polimento e avaliação ao mesmo tempo.

## Estrutura resultante

- skills/frontend-design/SKILL.md: contrato comum, seleção de modo, vocabulário
  do sistema, invariantes e critérios de saída.
- references/accessibility-interaction.md: foco, teclado, nomes, estados,
  contraste, feedback e interação responsiva.
- references/layout-style.md: composição, responsividade, tokens, tipografia,
  superfícies e desempenho percebido.
- references/flows-data.md: movimento, formulários, navegação, tabelas,
  gráficos, carregamento e recuperação de erro.
- references/polish.md: princípios de refinamento visual e microinterações.
- references/review.md: ordem de revisão, checklist e formato de achados.

O conteúdo foi adaptado para o Vela web. Regras que antes estavam formuladas
para iOS/Android ou como valores universais passaram a ser heurísticas
contextuais: tokens existentes, viewport, acessibilidade, estado da tela e
impacto no fluxo determinam a decisão.

A licença existente de frontend-design foi preservada em
skills/frontend-design/LICENSE.txt.

## Migração e compatibilidade

As pastas skills/make-interfaces-feel-better/ e skills/ui-ux-pro-max/ foram
removidas da fonte versionada. As cópias gerenciadas em .agents, Claude, Codex
e Antigravity foram atualizadas pelo sincronizador e tiveram somente esses
dois nomes removidos.

Os comandos antigos continuam disponíveis no opencode.json como aliases:

- make-interfaces-feel-better encaminha para frontend-design no modo polir;
- ui-ux-pro-max encaminha para frontend-design no modo avaliar.

Isso preserva chamadas antigas sem manter duas implementações redundantes.
Skills de sistema, plugins e skills nativas dos harnesses continuam fora do
ownership do Vela e não foram removidas.

## Linguagem de comunicação

Os três modos devem se comunicar em português do Brasil e começar pelo
vocabulário visível do sistema: página, seção, botão, campo, dropdown, modal,
coluna, estado, mensagem e efeito no fluxo. Nomes de componentes, tokens,
arquivos e serviços aparecem depois como detalhe de implementação.

## Validação

- quick_validate.py skills/frontend-design — passou.
- npm run docs:check — passou.
- git diff --check — passou.
- npm run skills:sync -- --dry-run — mostrou apenas atualização de
  frontend-design e remoção dos dois nomes aprovados em cada destino.
- npm run skills:sync — aplicado nas quatro raízes locais.
- npm run skills:sync -- --check — passou nas quatro raízes.
- node --test scripts/skills/skill-sync.test.mjs — 5/5 passou.
- Inventário pós-sincronização — 14 skills no repositório e em cada raiz
  gerenciada, com hashes correspondentes.

## Próxima etapa

O trabalho ainda não foi commitado ou enviado ao remoto. O próximo checkpoint
é revisar o diff agrupado, fazer um commit pequeno da família de design/UI e,
depois do push, executar no Alienware git pull --ff-only, revisar o dry-run e
aplicar o mesmo npm run skills:sync.
