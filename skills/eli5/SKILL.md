---
name: eli5
description: "Use when the user asks for a clear explanation adapted to their knowledge level, especially as the Vela owner who knows the system vocabulary but not code."
---

# Explicação clara para o proprietário do Vela

Esta skill transforma assuntos complexos em explicações compreensíveis. No
contexto do Vela, ELI5 não significa falar literalmente com uma criança de
cinco anos. Significa remover o jargão de código sem remover a lógica, os
impactos, as condições ou as decisões importantes.

## Perfil padrão no Vela

Quando o assunto for o Vela, trate o usuário como proprietário e responsável
pelas decisões do sistema:

- ele conhece o fluxo de trabalho e o vocabulário das áreas do Vela;
- conhece páginas, ações e entidades como Viagens, BLs, containers, veículos,
  faturamento, taxas e locais;
- não precisa conhecer componentes, hooks, services, queries, RPCs ou a
  organização interna do código;
- precisa entender o que acontece na tela, por que acontece, quais áreas são
  afetadas e qual decisão precisa tomar.

Não use tom infantil, analogias com brinquedos, animais ou doces, nem reduza a
explicação a frases artificiais. Use linguagem adulta, direta, respeitosa e
didática. O objetivo é que o proprietário consiga visualizar o sistema e
decidir sobre ele sem precisar traduzir código.

## Vocabulário e ponto de partida

Consulte CONTEXT.md e docs/agents/linguagem-do-sistema.md. Comece sempre pelo
vocabulário visível:

1. em qual página, seção ou fluxo estamos;
2. qual botão, campo, dropdown, coluna ou mensagem participa;
3. qual ação a pessoa realiza;
4. qual estado ou efeito aparece em seguida;
5. qual entidade, página ou processo relacionado recebe a consequência.

Use os nomes reais do Vela. Não substitua BLs por “registros”, Viagens por
“objetos” ou faturamento por “processamento” apenas para parecer técnico ou
genérico. Se um termo ainda não estiver no glossário, preserve o termo usado
na tela e sinalize a incerteza em vez de inventar um nome.

Quando o assunto vier de código, erro ou mudança técnica, traduza primeiro para
o comportamento do sistema. Só depois explique o detalhe de implementação, se
ele ajudar o usuário a decidir, validar ou acompanhar o trabalho.

## Estrutura recomendada

Organize a explicação em camadas, sem obrigar o usuário a atravessar o código:

1. **Resumo:** o que está acontecendo em uma ou duas frases.
2. **Fluxo visível:** página, ação, estado e efeito seguinte.
3. **Motivo:** por que o sistema foi construído ou alterado dessa forma.
4. **Impacto:** o que muda para Viagens, BLs, containers, veículos,
   faturamento, taxas, locais ou outras áreas relacionadas.
5. **Exceções:** o que acontece quando não há dados, há erro, duplicidade,
   cancelamento, permissão insuficiente ou informação incompleta.
6. **Detalhe técnico opcional:** arquivo, componente, service, query, RPC,
   teste ou comando, sempre como suporte à explicação do sistema.
7. **Próxima decisão:** o que precisa ser confirmado, testado ou feito.

Simplifique a linguagem, não os fatos materiais. Preserve ressalvas,
dependências, riscos, incertezas e conflitos entre documentos. Se uma analogia
for útil, use uma analogia de operação do Vela ou de um processo de trabalho
conhecido pelo usuário, e declare onde ela deixa de ser exata.

## Roteamento

- Se o usuário mencionar o Vela, este perfil de proprietário é o padrão,
  mesmo que use a expressão ELI5.
- Se o usuário pedir explicitamente uma explicação para uma criança, uma idade,
  um papel ou um público diferente, respeite esse pedido específico.
- Se o pedido for apenas “explique” dentro do Vela, use este perfil e não
  force uma simplificação infantil.
- Se a pergunta exigir leitura de código, documentação ou estado do workspace,
  leia as fontes relevantes antes de explicar. Não invente o comportamento a
  partir do nome de um arquivo.
- Se a ausência de contexto mudar materialmente a resposta, faça uma pergunta
  curta. Caso contrário, explique o que é conhecido e marque o que ainda é
  hipótese.

## O que evitar

- começar por código, banco de dados, arquitetura ou nomes internos;
- usar termos técnicos como substitutos de entidades do Vela;
- tratar o usuário como criança ou presumir que ele quer uma aula de
  programação;
- esconder limitações para tornar a resposta mais confortável;
- afirmar que um fluxo funciona sem verificar a implementação, o documento ou
  o estado que sustenta a afirmação;
- responder só com uma definição, sem dizer onde isso aparece no sistema e qual
  consequência produz.
