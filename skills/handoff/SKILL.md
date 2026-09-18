---
name: handoff
description: "Use when the user explicitly asks for a copy-ready handoff of the current session so another agent or session can continue the work."
argument-hint: "What must the next agent continue?"
disable-model-invocation: true
---

# Documento de handoff — modo Randolph

Esta skill prepara a entrega contextualizada do trabalho atual para outro
agente ou sessão. O resultado principal é um documento completo, pronto para
copiar e colar. Ela não é, por padrão, uma skill para lançar subagentes,
enviar mensagens ou transferir automaticamente a sessão.

O comportamento esperado é o que o usuário chama de “Randolph”: reconstruir o
estado do trabalho, registrar decisões e pendências e entregar uma passagem
operacional para que o próximo agente consiga continuar sem recomeçar a
investigação.

## Invariantes

- Ao ser invocada, produza o documento de handoff nesta mesma resposta.
- Entregue um bloco único, autocontido e fácil de copiar, precedido apenas por
  uma orientação curta. Não espalhe o conteúdo em várias mensagens ou
  tabelas que dificultem a cópia.
- Não invoque subagente, não envie mensagem, não crie thread e não mude de
  sessão apenas porque a continuidade parece útil.
- Uma capacidade nativa de handoff só pode ser usada se o usuário pedir
  explicitamente uma transferência automática. Mesmo nesse caso, gere primeiro
  o documento copiável.
- Não faça commit, push, merge, deploy ou alteração de configuração global.
- Não invente conclusão, check, arquivo, decisão ou capacidade. Diferencie fato
  verificado, inferência, hipótese e informação ausente.
- Remova API keys, senhas, tokens, dados pessoais e outros segredos. Não copie
  código extenso quando um caminho, símbolo ou resumo verificável for
  suficiente.

## Reconstrução da sessão

Antes de escrever, revise a conversa atual e o workspace relevante. Não resuma
somente a última mensagem. Recupere:

1. objetivo original e foco específico da próxima sessão;
2. contexto visível do sistema — páginas, ações, entidades, estados e efeitos;
3. decisões confirmadas pelo usuário, decisões rejeitadas e decisões em aberto;
4. o que já foi investigado, implementado, corrigido ou descartado;
5. estado do repositório, branch, working tree, arquivos e diffs relevantes;
6. comandos, testes, checks e resultados realmente executados;
7. erros, bloqueios, limitações de acesso e hipóteses ainda não verificadas;
8. próximo passo exato e condição objetiva para considerar o trabalho concluído;
9. skills que o próximo agente deve usar, somente quando forem pertinentes.

Quando o assunto for o Vela, use CONTEXT.md e
docs/agents/linguagem-do-sistema.md. Descreva primeiro o que acontece em
Viagens, BLs, containers, veículos, faturamento, taxas, locais ou outras áreas
do sistema; acrescente arquivos, funções, queries e RPCs como mapa técnico
posterior.

Se o usuário passou um argumento ao invocar a skill, trate-o como foco
principal do próximo agente, sem perder os bloqueios e decisões que o tornam
compreensível. Se o limite de tokens estiver próximo, prefira registrar o
estado completo e as incertezas a produzir uma mensagem curta demais.

## Formato obrigatório da entrega

Entregue o conteúdo em um único bloco de texto com título claro. Use esta
estrutura e remova seções realmente irrelevantes:

    # HANDOFF — VELA

    ## Objetivo da próxima sessão
    ...

    ## Contexto do sistema
    Página, ação, entidade, estado e efeito visível que o próximo agente precisa
    reconhecer.

    ## Estado atual
    O que está funcionando, o que está incompleto e em que ponto o trabalho
    parou.

    ## Decisões confirmadas
    Decisões do usuário e contratos que não devem ser reinterpretados.

    ## Decisões rejeitadas ou em aberto
    O que não deve ser retomado como se estivesse aprovado e o que ainda exige
    decisão.

    ## Trabalho realizado
    Investigações, alterações, remoções, consolidações e resultados observados.

    ## Fontes de verdade
    Arquivos, planos, ADRs, issues, commits, diffs, telas ou comandos relevantes.
    Registre conflitos e indique qual fonte é mais recente ou mais autorizada.

    ## Checks e evidências
    Comandos executados, resultado, limitações e verificações ainda pendentes.

    ## Riscos, bloqueios e hipóteses
    Condições que podem mudar a próxima decisão ou fazer o caminho atual falhar.

    ## Próximo passo exato
    A primeira ação que o próximo agente deve executar, sem repetir a análise já
    concluída.

    ## Critério de conclusão
    Como saber que o objetivo foi realmente atendido.

    ## Skills sugeridas
    Somente as skills necessárias para continuar, com o motivo de cada uma.

## Revisão antes de entregar

Confira se outra pessoa consegue responder, somente lendo o bloco:

- O que o usuário queria?
- O que já foi decidido e o que ainda pode ser alterado?
- Qual página ou fluxo do Vela está envolvido?
- O que foi realmente feito e como foi verificado?
- Qual é a próxima ação concreta?
- O que não pode ser afirmado ou repetido sem nova verificação?

Se alguma resposta depender de informação ausente, escreva “não verificado” ou
“decisão pendente” dentro do documento. O handoff deve permitir continuidade,
não criar uma falsa sensação de conclusão.
