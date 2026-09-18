---
name: brainstorming
description: "Use when unresolved product or design choices materially change a substantial implementation."
---

# Brainstorming

Resolve the decisions that determine what to build. Inspect the affected code
and relevant domain context, identify the desired outcome and constraints, and
compare alternatives only where the tradeoff matters.

## Gate e roteamento

Use esta skill quando existe uma escolha de produto, domínio ou design que pode
mudar o resultado, o escopo, a arquitetura ou a experiência. Para uma mudança
pequena e já especificada, execute diretamente quando autorizado; não crie uma
cerimônia de design por hábito.

- Use `grilling` quando o trabalho principal é entrevistar e estressar
  decisões; escolha o modo sem persistência ou persistência confirmada conforme
  a intenção explícita do usuário.
- Use `wayfinder` quando ainda há várias decisões dependentes e a rota precisa
  de um mapa entre sessões, pessoas ou agentes.
- Use `writing-plans` quando as decisões estão fechadas e falta organizar a
  implementação; use `executing-plans` quando o plano já existe.

Não trate uma preferência local ou um detalhe mecânico como decisão de produto.
Não escolha por conta própria uma alternativa quando a escolha mudaria
materialmente o resultado; apresente opções, trade-offs e uma recomendação em
pt-BR.

## Decisões e persistência

Uma conversa de brainstorming pode esclarecer uma decisão sem ainda autorizar
que ela seja gravada. Se a conclusão precisar alterar CONTEXT.md, um ADR, uma
spec, um plano, uma issue ou outro documento durável:

- se o usuário pediu explicitamente esse documento, siga o destino solicitado;
- caso contrário, apresente o que seria registrado e peça confirmação antes da
  primeira escrita;
- não trate uma decisão nova como substituição automática de uma regra anterior;
  se houver conflito, mostre as duas regras, o efeito provável e pergunte qual
  deve vigorar;
- quando a decisão envolver o Vela, use um exemplo hipotético com a página,
  ação, entidade e efeito visível. Por exemplo: “Se a Nova Viagem aceitar o
  cadastro sem navio, o que deve aparecer na página de BLs e na coluna do
  navio?”

Use grilling para conduzir a investigação e confirmar a decisão. Use
writing-plans ou executing-plans somente depois que o resultado estiver claro;
a existência de uma conversa não autoriza implementação ou publicação.

## Idioma da interação

Toda comunicação dirigida ao usuário — perguntas, alternativas,
recomendações, decisões, confirmações e encerramento — deve ser em português do
Brasil (pt-BR). Preserve comandos, caminhos, identificadores, código e termos
técnicos no idioma original quando isso evitar ambiguidade. Só use outro idioma
se o usuário pedir explicitamente.

Quando a decisão envolver o Vela, comece pela página, seção, ação e efeito
visível. Use os nomes canônicos de `CONTEXT.md` e os rótulos reais da tela;
explique a conexão com a próxima página, coluna, ficha ou fluxo antes de falar
em componentes, hooks, services ou outras estruturas de código.

Ask for missing business decisions that would change the result. Use existing
requirements and authorization; a clear implementation request does not need a
separate design approval ceremony. A request limited to exploration ends with
a recommendation, not an unsolicited implementation.

For substantial designs that will guide implementation or handoff, present the
proposed behavior, boundaries, failure cases and acceptance criteria first. Only
after the user confirms the durable record should you write
`docs/spec/YYYY-MM-DD-<topic>-design.md`. Follow `docs/CONVENCOES.md` for
indexing and archival. Small explorations, rejected alternatives and one-off
preferences need no spec file unless the user explicitly asks for a durable
record.

When implementation is requested and decisions are sufficient, continue through
implementation and validation. Write a plan only if coordination or handoff
needs one; otherwise do not create a plan just to document the brainstorm. Use
[visual-companion.md](visual-companion.md) when the browser companion would
help resolve an actual visual decision, and do not start it for a purely textual
choice.
