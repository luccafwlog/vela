# Linguagem do sistema nas comunicações dos agentes

Este é o contrato de comunicação do Vela com quem acompanha o trabalho pela
interface do sistema.

## Regra principal

Explique primeiro o problema e o efeito no sistema usando a linguagem que a
pessoa vê nas páginas, botões, colunas, filtros, campos, modais e estados. Só
depois acrescente o detalhe de implementação quando ele ajudar a decidir,
validar ou manter o trabalho.

O glossário canônico é `CONTEXT.md`. As páginas em `docs/modules/`, a
`docs/ARCHITECTURE.md` e os rótulos reais da interface complementam o glossário
quando a explicação depender de uma tela específica.

## Formato recomendado

Descreva o fluxo nesta ordem:

1. **Onde:** página, seção ou fluxo visível — por exemplo, `Viagens`, `BLs`,
   `Chegadas e Saídas` ou `Faturamento`.
2. **Ação:** rótulo visível do botão, campo, filtro, dropdown, modal ou ação.
3. **Efeito:** o que muda para a pessoa na tela e qual registro ou vínculo do
   sistema é afetado.
4. **Conexão:** onde esse resultado aparece depois — por exemplo, em qual
   coluna, ficha, linha do tempo, Manifesto Mercante, ADR ou Portal.
5. **Detalhe técnico opcional:** arquivo, componente, serviço, RPC, query ou
   teste, identificado como detalhe de implementação.

Exemplo:

> Na página **Viagens**, o botão **Nova Viagem** cadastra o navio e o número da
> viagem. Depois, essa Viagem passa a aparecer na página **BLs**, onde os BLs
> ficam vinculados à mesma viagem. No código, isso é refletido pelo fluxo de
> persistência de `voyage_id`.

## Vocabulário e limites

- Prefira os nomes canônicos do glossário e os textos visíveis da tela. Não
  invente sinônimos para entidades, estados ou ações.
- Para pedidos de interface, fale primeiro em **página**, **tela**, **botão**,
  **campo**, **coluna**, **filtro**, **dropdown**, **modal**, **aba**, **card**,
  **linha**, **status** ou **mensagem**. Use `component`, `hook`, `service`,
  `query`, `mutation` e termos equivalentes somente na camada técnica.
- Não troque o nome da entidade de negócio por uma aproximação técnica:
  **Viagem** não vira “registro de voyage”; **B/L** não vira “objeto”; **Escala**
  não vira “item de rota”.
- Ao falar de impacto, conecte a ação à consequência observável. Não diga
  apenas “altera o estado”; diga qual página, coluna, filtro ou próxima ação
  muda.
- Se a tela, o rótulo ou o vínculo ainda não tiver sido verificado, diga que é
  uma hipótese ou que precisa ser confirmado. Não fabrique um label.
- Preserve termos técnicos indispensáveis em código, comandos, caminhos,
  identificadores, logs, contratos e citações; traduza o significado ao redor
  deles.
- Em uma revisão, plano ou relatório, escreva o resumo executivo em linguagem
  do sistema e deixe o detalhamento técnico abaixo.

## Quando não houver uma tela

Para tarefas de infraestrutura, sincronização, segurança ou manutenção interna,
explique o efeito operacional antes do mecanismo. Exemplo: “o sincronizador
atualiza a cópia das instruções que o Codex lê” antes de mencionar manifestos,
hashes e diretórios. Se não houver impacto de tela, diga isso claramente e use
o vocabulário operacional do projeto.

## Aplicação pelas skills

Toda skill que pergunta, recomenda, planeja, revisa, audita, explica ou entrega
um handoff deve seguir este contrato. A skill pode preservar jargão técnico
quando ele for necessário, mas não deve obrigar o usuário a traduzir código
para entender qual problema do Vela está sendo tratado.
