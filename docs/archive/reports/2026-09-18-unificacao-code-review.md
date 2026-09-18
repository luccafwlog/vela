# Unificação da família de revisão de código — 2026-09-18

## Decisão

A família de revisão de código foi consolidada em uma única skill Vela-owned:
`vela-code-review`.

As três entradas anteriores tinham o mesmo objeto principal — avaliar um diff,
commit ou branch — mas separavam momentos diferentes do fluxo:

- `requesting-code-review`: solicitar parecer independente;
- `receiving-code-review`: verificar achados já produzidos;
- `thermo-nuclear-code-quality-review`: revisão excepcionalmente rigorosa de
  estrutura e manutenibilidade.

O conteúdo foi preservado como três modos explícitos da entrada canônica:
`solicitar`, `receber` e `rigorosa`.

## Por que unificar

- O sinal de uso mais forte da auditoria foi `requesting-code-review`, com 17
  invocações explícitas observáveis no MacBook; `thermo-nuclear-code-quality-review`
  teve 2 e `receiving-code-review` teve 1 no mesmo relatório.
- As três skills usam a mesma unidade de análise, os mesmos requisitos de
  evidência e a mesma restrição de não autorizar push, merge ou deploy.
- A diferença relevante é o momento do fluxo, que pode ser roteado por modo sem
  manter três implementações concorrentes.
- O nome `vela-code-review` evita colidir com o `/code-review` built-in
  registrado no catálogo do harness.

## Estrutura resultante

- `skills/vela-code-review/SKILL.md`: gate, invariantes, roteamento e saída
  mínima.
- `references/reviewer-prompt.md`: prompt para um revisor independente quando
  essa capacidade existir de fato.
- `references/rigorous-review.md`: critérios de simplificação estrutural,
  abstrações, branching e tamanho de arquivos.
- `opencode.json`: aliases temporários preservam os comandos antigos, mas todos
  encaminham para a implementação canônica.

## Cenários de roteamento verificados

- “Revise meu diff antes da entrega” → modo `solicitar`.
- “O revisor apontou estes problemas; verifique e corrija os justificados” →
  modo `receber`.
- “Faça uma revisão thermo-nuclear da arquitetura” → modo `rigorosa`.
- “Faça um pentest autorizado” → `security-audit-penetration-testing`, não esta
  skill.
- “Implemente esta feature” sem pedido de revisão → workflow de implementação,
  sem criar uma revisão formal artificial.

## Validação

- `quick_validate.py skills/vela-code-review` — passou com PyYAML disponível no
  ambiente temporário do validador.
- `npm run docs:check` — passou.
- `git diff --check` — passou.
- `node --test scripts/skills/skill-sync.test.mjs` — 5/5 passou.
- `npm run skills:sync -- --check` — passou nas quatro raízes.
- Inventário pós-sincronização: 18 skills no repositório e em cada destino,
  incluindo `vela-code-review` com hashes idênticos.

## Impacto e migração

As três pastas antigas foram removidas da fonte e das cópias gerenciadas. Os
nomes antigos continuam apenas como aliases no OpenCode e como histórico nos
relatórios; não existem mais três implementações independentes para divergir.
Plugins, skills do sistema e skills nativas dos harnesses não foram alterados.
