---
name: writing-plans
description: "Use when the scope is decided but a substantial change needs an implementation plan for coordination, handoff, or review."
---

# Writing plans

Produce a plan another engineer can execute when the route is already clear but
the work is too large, risky or coordinated for an informal checklist. A plan
is appropriate when at least one of these is true:

- the change crosses files, layers or interfaces with meaningful dependencies;
- another session, person or agent will need to continue the work;
- validation, rollout, migration or rollback has non-trivial ordering.

For a small, clear and localized change, do not create a plan just because this
skill was mentioned; execute the change directly when authorized. If the
destination or the decisions that define the route are still unclear, use
`wayfinder` or an interview skill first. If an adequate plan already exists and
the request is to implement it, use `executing-plans` instead.

## Conteúdo mínimo

Produza um plano que outra pessoa possa executar, com:

- resultado pretendido e fora de escopo;
- restrições atuais e fontes de verdade relevantes;
- arquivos, interfaces e contratos afetados;
- dependências e ordem de execução;
- comportamento observável e critérios de aceite;
- checks, riscos, rollback e qualquer decisão ainda pendente.

Descreva decisões e comportamento observável; inclua código somente quando ele
resolver uma ambiguidade ou um passo frágil.

## Idioma da interação

Quando uma decisão ainda depender do usuário, faça a pergunta, apresente as
alternativas e comunique o que está aguardando em português do Brasil (pt-BR).
Preserve comandos, caminhos, identificadores, código e termos técnicos no
idioma original quando necessário. Só use outro idioma se o usuário pedir
explicitamente.

No resultado e nos critérios de aceite, descreva primeiro o comportamento que a
pessoa verá nas páginas do Vela: ação, estado, coluna, filtro, vínculo ou
mensagem. Use `CONTEXT.md` e os documentos de módulo como vocabulário; liste
arquivos, componentes e RPCs depois, como detalhamento para execução e revisão.

## Decisões e handoff

Escalone o detalhe ao risco. Não duplique implementações completas, não exija
um commit por passo mecânico e não reimprima a documentação do repositório.
Marque decisões que ainda exigem input e diferencie-as das escolhas rotineiras
de implementação. Se uma decisão de produto, domínio, segurança, contrato ou
escopo mudar materialmente o plano, não a invente: apresente as alternativas em
pt-BR, registre o ponto de bloqueio e aguarde a resposta antes de fechar o
plano ou iniciar a execução. Continue as partes independentes enquanto isso.

Save live plans in `docs/plans/YYYY-MM-DD-<topic>.md` and index them in
`docs/plans/README.md`. Specs belong in `docs/spec/`; follow `docs/CONVENCOES.md`
for their lifecycle. Check coverage and contradictions against the requirements.

Quando o plano estiver suficientemente especificado e a implementação tiver
sido solicitada, não peça uma segunda autorização apenas para começar: prossiga
para a execução usando `executing-plans`. Quando o usuário tiver pedido apenas
o plano, entregue o artefato e pare. Não force uma escolha de orquestração de
agentes.
