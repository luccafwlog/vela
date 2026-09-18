# Ajustes de explicação, handoff e revisão de código — 2026-09-18

## eli5 — explicação para o proprietário do Vela

O comportamento literal de “explicar para uma criança de cinco anos” foi
removido como padrão para o Vela. A skill agora trata o usuário como
proprietário do sistema:

- conhece Viagens, BLs, containers, veículos, faturamento, taxas, locais e o
  fluxo operacional;
- não precisa conhecer componentes, hooks, services, queries, RPCs ou a
  organização interna do código;
- precisa entender a página, a ação, o estado, o efeito e a decisão necessária.

A explicação deve ser adulta, direta e didática. Analogias infantis só podem
ser usadas quando forem explicitamente solicitadas. O detalhe técnico aparece
depois da explicação do sistema e não substitui o vocabulário real do Vela.

## handoff — documento Randolph

O handoff deixou de priorizar a execução de uma transferência automática. Ao
ser invocado, ele deve produzir um único documento autocontido e pronto para
copiar e colar, contendo:

- objetivo da próxima sessão;
- contexto visível do sistema;
- estado atual;
- decisões confirmadas, rejeitadas e abertas;
- trabalho realizado;
- fontes de verdade e conflitos;
- checks e evidências;
- bloqueios, riscos e hipóteses;
- próximo passo exato;
- critério de conclusão;
- skills sugeridas.

Subagente, nova thread ou handoff nativo só podem ser usados se o usuário pedir
explicitamente a transferência automática, e ainda assim depois da geração do
documento copiável. O campo de invocação existente foi preservado para manter
a política do harness.

## vela-code-review — revisão semântica e adversarial

A revisão agora confronta dois níveis:

1. se o código funciona tecnicamente;
2. se o código faz o fluxo de trabalho que o usuário decidiu para o Vela.

Uma decisão mais recente não é tratada como soberana automaticamente. Ela é
uma intenção provável que precisa ser confrontada com decisões anteriores,
planos, specs, ADRs, CONTEXT.md, comportamento atual e código.

Quando houver substituição de lógica sem confirmação explícita, a revisão deve
parar nesse ponto e perguntar:

> É isso mesmo que você quer? É essa substituição de lógica que você quer
> implementar?

A pergunta deve vir acompanhada de um exemplo hipotético no vocabulário do
sistema, como uma Viagem criada sem navio afetando a coluna correspondente dos
BLs, uma taxa alterada depois do faturamento ou um container já associado a
outro BL.

Mesmo sem conflito documental, toda revisão deve apresentar ao menos um exemplo
hipotético de caminho fora do happy path. A análise agora inclui duplicidade,
retry, erro parcial, cancelamento, concorrência, permissões, registros legados,
status e consistência entre páginas.

## Validação

- quick_validate.py em eli5 — passou.
- quick_validate.py em vela-code-review — passou.
- quick_validate.py em handoff — recusou argument-hint e
  disable-model-invocation, propriedades suportadas pelo harness e preservadas
  deliberadamente.
- npm run docs:check — passou.
- git diff --check — passou.
- node --test scripts/skills/skill-sync.test.mjs — 5/5 passou.
- npm run skills:sync -- --dry-run — mostrou somente as três atualizações
  aprovadas em cada destino.
- npm run skills:sync — aplicado em .agents, Claude, Codex e Antigravity.
- npm run skills:sync -- --check — passou nas quatro raízes.
- Inventário pós-sincronização — 14 skills Vela-owned em cada raiz, com hashes
  correspondentes.
