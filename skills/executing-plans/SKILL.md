---
name: executing-plans
description: "Use when an existing implementation plan is current enough to execute and must be validated through completion."
---

# Executing plans

Execute somente um plano existente e autorizado. Antes de editar, faça um
preflight:

1. leia o plano inteiro, seu status e os documentos vivos que ele referencia;
2. confira no repositório as premissas, arquivos, interfaces, dependências e
   checks citados;
3. separe o que está pendente do que já foi concluído e classifique o plano
   como executável, incompleto, obsoleto ou contraditório.

Se não houver plano, se ele estiver arquivado sem uma solicitação explícita de
retomada, ou se faltar uma decisão material, pare o fluxo de execução e
encaminhe para `writing-plans` ou peça somente a informação que está faltando.
Não invente requisitos para tornar um plano executável.

## Drift do plano

Preserve os requisitos e execute o trabalho pendente em ordem de dependência.
Quando o repositório divergir do plano, classifique a divergência:

- **Mecânica:** caminho renomeado, comando equivalente, ajuste de ordem sem
  mudança de comportamento ou outra diferença local. Adapte, registre a
  diferença no resultado e continue validando.
- **Material:** mudança de objetivo, escopo, contrato público, modelo de dados,
  segurança, arquitetura, requisito de aceite ou risco de rollout. Não adapte
  silenciosamente: pare no ponto seguro, explique em pt-BR e peça atualização
  do plano ou uma decisão do usuário antes de seguir.

Uma falha de teste inicia diagnóstico e correção; não é motivo automático para
pedir autorização. Uma correção que amplie o escopo ou altere uma decisão do
plano, porém, é drift material e segue a regra acima.

Quando precisar pedir esclarecimento, informar uma mudança de escopo ou
aguardar uma decisão do usuário, escreva essa comunicação em português do
Brasil (pt-BR). Preserve comandos, caminhos, identificadores, código e termos
técnicos no idioma original quando necessário. Só use outro idioma se o usuário
pedir explicitamente.

Ao comunicar progresso ou resultado no Vela, descreva primeiro o efeito
observável: página, ação, registro, coluna, filtro ou fluxo afetado. Use o
vocabulário de `CONTEXT.md` e deixe arquivos, funções, queries e RPCs como
detalhamento técnico depois da explicação do sistema.

Continue through implementation, relevant checks, and fixes caused by the
change. A failing test starts diagnosis, not an automatic request for permission.
Ask only for unresolved requirements, missing access, or a material scope change;
continue independent tasks while waiting.

Use the existing workspace unless isolation is needed. Delegation is optional
and subject to the session's authorization; a plan does not require subagents.

At completion, archive the plan and its completed spec and update their indexes
as required by `docs/CONVENCOES.md`. Report the result, validation and remaining
limitations. Follow the requested delivery action; if none was requested, leave
the reviewable patch in the workspace.

## Critério de conclusão

Só declare o plano concluído quando:

- o resultado pretendido foi entregue e o escopo ficou explícito;
- todos os passos executáveis foram concluídos ou uma pendência foi assumida
  pelo usuário;
- os checks relevantes passaram, ou cada falha residual está diagnosticada e
  registrada;
- a documentação viva afetada foi atualizada e o diff foi revisado;
- o plano foi arquivado somente se não restar trabalho de execução. Caso
  contrário, mantenha-o em `docs/plans/` com o estado e as pendências claras.

Comunique perguntas, drift, resultado, validações e limitações em português do
Brasil (pt-BR), preservando comandos, caminhos, identificadores, código e
termos técnicos quando necessário. Não trate a existência de um plano como
autorização para publicar, mudar produção ou ampliar o pedido.
