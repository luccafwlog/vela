---
name: frontend-design
description: "Use when the user asks to create, polish, or evaluate a frontend interface with a coherent visual direction, accessible interaction and production-ready behavior."
license: Complete terms in LICENSE.txt
---

# Design de interfaces

Esta é a entrada canônica para trabalho de interface no Vela. Ela reúne três
modos que antes ficavam distribuídos em skills diferentes:

- **criar**: desenhar e implementar uma página, seção, componente ou fluxo novo;
- **polir**: melhorar uma interface existente, seus estados, microinterações e
  detalhes visuais;
- **avaliar**: analisar acessibilidade, layout, interação, fluxo e qualidade
  visual, entregando achados priorizados sem alterar código por conta própria.

Escolha o modo pelo verbo e pelo resultado pedido. Se a pessoa pedir uma
auditoria completa das páginas do Vela com execução do app, capturas e
priorização P0–P3, use design-audit. Se pedir revisão de código, use
vela-code-review. Não carregue as referências dos três modos sem necessidade.

## Contrato comum

Toda comunicação dirigida ao usuário deve ser em português do Brasil, salvo
pedido explícito em contrário. Preserve literalmente comandos, caminhos,
identificadores, código e termos técnicos quando forem necessários.

Ao falar do Vela, comece pelo que a pessoa vê: página, seção, botão, campo,
dropdown, modal, coluna, estado, mensagem e efeito no fluxo seguinte. Consulte
CONTEXT.md e docs/agents/linguagem-do-sistema.md para usar os nomes canônicos.
Explique o componente, token, arquivo, service, query ou RPC somente depois de
explicar o efeito visível.

Antes de propor uma direção:

1. Inspecione a página ou fluxo atual, o conteúdo, os componentes reutilizáveis,
   os tokens e as restrições do produto.
2. Identifique o objetivo da tela, a pessoa que a utiliza e a decisão ou ação
   que ela precisa concluir.
3. Preserve o design system existente quando ele atende ao caso. Não crie um
   novo sistema de design para uma mudança isolada.
4. Escolha uma direção visual proporcional ao produto. Diferenciação deve
   melhorar compreensão, hierarquia ou confiança; novidade não é um objetivo
   isolado.

Em qualquer modo, considere teclado, foco visível, contraste, leitura por
tecnologia assistiva, responsividade e os estados de carregamento, vazio, erro,
desabilitado e sucesso que façam sentido para o fluxo. Não use emojis como
ícones estruturais. Prefira ícones vetoriais já adotados pelo produto.

Não faça commit, push, deploy ou alteração de configuração global
automaticamente. Em modo avaliar, não edite código salvo pedido explícito.

## Modo criar

Use quando o resultado esperado é uma interface nova ou uma mudança que
introduz um fluxo visual/funcional relevante.

- Defina a finalidade, o público, a ação principal e as restrições antes de
  codificar.
- Escolha tipografia, cores, composição, densidade e movimento coerentes com o
  produto. Minimalismo, densidade operacional ou uma direção mais expressiva
  são válidos quando servem ao fluxo.
- Implemente código funcional e integrado aos componentes, tokens e padrões
  existentes. Não entregue apenas uma maquete estática se a tarefa pede
  comportamento.
- Cubra os estados necessários: inicial, carregando, vazio, erro, sucesso,
  desabilitado, foco e interação em andamento.
- Verifique a tela em larguras relevantes, com teclado e com movimento reduzido
  quando houver animação.

Para critérios detalhados, leia apenas as referências necessárias:

- acessibilidade e controles: [accessibility-interaction.md](references/accessibility-interaction.md);
- composição, responsividade, tipografia e desempenho:
  [layout-style.md](references/layout-style.md);
- formulários, navegação, dados e movimento:
  [flows-data.md](references/flows-data.md);
- revisão antes de entregar: [review.md](references/review.md).

## Modo polir

Use quando a página ou o fluxo já existe e a intenção é fazê-lo parecer mais
claro, estável, rápido ou agradável sem descaracterizar o produto.

1. Observe o comportamento atual e localize a sensação que precisa melhorar:
   hierarquia, alinhamento, densidade, feedback, transição, legibilidade ou
   recuperação de erro.
2. Priorize mudanças que o usuário perceberá na página ou no fluxo seguinte.
   Não espalhe microinterações decorativas por toda a tela.
3. Use os princípios de [polish.md](references/polish.md) como heurísticas.
   Duração, raio, escala, área acionável e espaçamento devem respeitar os
   tokens, o dispositivo e a acessibilidade do produto; os valores de exemplo
   não são dogmas.
4. Preserve a semântica e a área de interação. Uma animação não pode bloquear
   uma ação, causar mudança inesperada de layout ou esconder uma mensagem.
5. Respeite prefers-reduced-motion e forneça uma versão estável quando o
   movimento for reduzido ou desativado.

Se apresentar um resumo das alterações, use uma tabela Antes/Depois somente
quando ela facilitar a leitura. Cada linha deve apontar a página ou controle,
o efeito percebido e, quando útil, o detalhe técnico responsável.

## Modo avaliar

Use quando a pessoa quer um diagnóstico, uma segunda opinião ou critérios para
decidir uma melhoria, sem pedir implementação imediata.

- Colete evidências da página, estado e viewport analisados. Não trate uma
  preferência visual como defeito sem explicar o impacto no fluxo.
- Avalie na ordem mais útil para o caso: compreensão da página, ação principal,
  estados e feedback, acessibilidade, layout/responsividade, consistência
  visual, desempenho e detalhes de polimento.
- Priorize achados por impacto na tarefa e risco, por exemplo P0–P3 quando o
  pedido usar essa escala. Para cada achado, informe localização visível,
  problema, efeito para a pessoa usuária e recomendação.
- Diferencie fato observado, risco provável e sugestão de preferência.
- Leia progressivamente somente as referências correspondentes ao escopo:
  acessibilidade, layout, fluxos/dados, revisão ou polimento.

Se a avaliação for de todas as páginas, estados ou viewports do Vela, roteie
para design-audit. Se for uma análise de uma tela ou fluxo específico, este
modo é suficiente.

## Critério de saída

Antes de encerrar, confirme que a resposta deixa claro:

- qual página, controle ou fluxo foi criado, polido ou avaliado;
- qual efeito a pessoa usuária verá;
- quais estados e limitações foram considerados;
- quais verificações foram feitas e quais ainda dependem de execução visual;
- quais decisões exigem confirmação do usuário, se houver.
