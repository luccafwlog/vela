---
name: improve-codebase-architecture
description: "Use when the user asks to identify and compare architectural deepening opportunities in the Vela codebase and select one for further investigation."
disable-model-invocation: true
---

# Aprofundamento da arquitetura do Vela

Esta skill localiza atrito arquitetural e apresenta oportunidades de
aprofundamento: mudanças que tornam um módulo mais profundo, concentrando
complexidade atrás de uma interface compreensível. O resultado inicial é um
relatório de opções; a skill não implementa a refatoração automaticamente.

Use-a quando o usuário quiser investigar a estrutura do código, comparar
opções de arquitetura ou encontrar módulos difíceis de entender e testar. Para
revisão de um diff específico, use vela-code-review. Para um bug sem causa
conhecida, use o workflow de debugging. Para uma decisão ainda aberta, use
brainstorming ou grilling.

## Linguagem e contrato

Toda comunicação dirigida ao usuário deve ser em português do Brasil. Comece
pela linguagem do sistema: página, ação, entidade, estado, efeito e conexão
entre áreas. Só depois explique módulo, interface, seam, adapter, locality,
leverage, depth ou outros termos arquiteturais.

Use os termos de arquitetura quando eles clarificarem a análise, mas não os
trate como uma proibição artificial contra nomes reais do projeto. Componentes,
services, APIs, queries e RPCs podem ser mencionados quando forem evidência
necessária. O objetivo é explicar por que a estrutura técnica afeta o fluxo de
Viagens, BLs, containers, veículos, faturamento, taxas, locais ou outra área do
Vela.

Uma oportunidade arquitetural é uma hipótese, não uma decisão. Não transforme
o relatório em autorização para alterar código, CONTEXT.md, ADRs, planos,
issues, configuração global, commit ou deploy.

## 1. Explorar com escopo

Antes de escanear:

1. confirme a área, módulo, página ou dor que o usuário quer investigar;
2. leia CONTEXT.md e as ADRs ativas relacionadas;
3. examine o histórico recente para localizar áreas que mudam repetidamente,
   sem tratar frequência de commit como prova de defeito;
4. defina o conjunto de arquivos que sustenta cada candidato.

Se o usuário não indicar uma área, explore os pontos de maior mudança recente e
amplie somente quando não houver concentração clara. Não faça uma varredura
indiscriminada apenas para produzir mais candidatos.

Use uma capacidade independente de exploração somente quando ela existir no
harness atual e estiver autorizada. Caso contrário, faça a inspeção na sessão
atual. Não invoque nem prometa um tipo de subagente, ferramenta ou
subagent_type que não esteja disponível.

Procure atrito real:

- entender uma Viagem ou B/L exige atravessar muitos módulos pequenos;
- a interface de um módulo é quase tão complexa quanto sua implementação;
- uma regra de faturamento ou Taxa Local vaza para páginas que não deveriam
  conhecê-la;
- uma alteração em uma coluna ou estado exige sincronizar várias cópias da
  mesma decisão;
- testes precisam conhecer detalhes internos porque não existe uma interface
  estável;
- módulos acoplados vazam conceitos entre seus seams.

Aplique o teste da exclusão: remover o módulo concentraria a complexidade em
um lugar mais claro ou apenas moveria o problema? Só proponha aprofundamento
quando houver ganho de locality, leverage, testabilidade ou compreensão
proporcional ao custo.

## 2. Apresentar candidatos em relatório visual

Escreva um único relatório HTML autocontido em um diretório temporário do
ambiente. Use CSS e SVG inline para que ele continue legível sem internet.
Mermaid, Tailwind ou outros recursos externos são opcionais e só podem ser
usados com fallback que não deixe o relatório inutilizável offline.

Abra o relatório pelo navegador ou painel disponível no harness. Se não houver
essa capacidade, informe o caminho absoluto e entregue uma descrição textual
dos candidatos. Não presuma comandos específicos como xdg-open, open ou start.

Leia [HTML-REPORT.md](HTML-REPORT.md) para o formato dos cartões e diagramas.
O relatório deve conter:

- contexto e escopo da análise;
- candidatos com arquivos ou módulos envolvidos;
- problema observável e conexão com o fluxo do Vela;
- solução proposta em linguagem simples;
- ganhos de locality, leverage e testabilidade;
- diagrama antes/depois quando ele realmente esclarecer a relação;
- força da recomendação: Forte, Vale explorar ou Especulativa;
- ADR conflitante, quando houver, com aviso explícito;
- limitações e evidências não verificadas;
- uma recomendação principal e o motivo.

Cada candidato deve incluir um exemplo hipotético do fluxo. Por exemplo:
“Se a página BLs precisar conhecer diretamente a regra de cálculo de uma Taxa
Local, uma alteração no faturamento pode mudar a coluna e a fatura ao mesmo
tempo. O aprofundamento deve concentrar a regra em uma interface que as duas
áreas consigam consultar sem duplicação.” O exemplo não é prova; é uma forma
de testar o sentido da proposta.

Depois de escrever o relatório, pergunte em pt-BR:

> Qual destas opções você gostaria de explorar?

Não escolha nem implemente um candidato sem resposta do usuário.

## 3. Explorar a opção escolhida

Quando o usuário escolher um candidato:

- use grilling para investigar restrições, dependências, dados, seams,
  contratos e testes;
- mantenha a conversa orientada ao fluxo visível e depois traduza para a
  estrutura técnica;
- compare alternativas somente quando elas mudarem a decisão;
- use design-it-twice diretamente quando duas interfaces plausíveis merecerem
  comparação;
- encaminhe uma decisão já fechada para writing-plans, ou um plano existente
  para executing-plans.

Persistência exige confirmação. Se a conversa sugerir alterar CONTEXT.md, uma
ADR, uma spec, um plano ou uma issue:

- apresente primeiro o texto ou a decisão que seria registrada;
- peça confirmação, salvo quando o usuário tiver solicitado explicitamente
  aquele documento;
- não atualize o domínio para fazer uma hipótese parecer uma decisão;
- se a proposta contrariar uma decisão anterior, pergunte se é uma substituição
  consciente e mostre um exemplo no vocabulário do Vela.

Se o usuário rejeitar uma opção por um motivo que futuras análises precisariam
conhecer, ofereça registrar um ADR em português. Não registre recusas
temporárias ou preferências autoexplicativas sem necessidade.

## Limites e entrega

Esta skill entrega opções arquiteturais e uma investigação orientada. Ela não
faz a implementação, não aplica migrações, não muda semântica de dados e não
publica nada sem autorização e workflow próprios.

No encerramento, informe:

- candidato escolhido ou decisão ainda aberta;
- fluxo do Vela afetado;
- evidências que sustentam a oportunidade;
- trade-offs e riscos;
- documentos que foram ou não atualizados;
- próximo passo recomendado e condição para considerar a investigação fechada.
