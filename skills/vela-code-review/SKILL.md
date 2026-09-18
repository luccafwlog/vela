---
name: vela-code-review
description: "Use when the user asks for a code review, wants an independent review before delivery, brings review findings, or needs implementation confronted with Vela decisions and non-happy paths."
---

# Revisão de código orientada ao sentido do Vela

Esta é a entrada canônica para revisão de código no Vela. A revisão precisa
responder a duas perguntas diferentes:

1. O código funciona tecnicamente nos caminhos verificados?
2. O código implementa o fluxo de trabalho que o usuário realmente decidiu
   para o sistema?

Não basta encontrar erro de sintaxe, teste ausente ou abstração ruim. Uma
implementação pode estar tecnicamente correta e ainda fazer a página, a
Viagem, o BL, o container, o veículo, o faturamento, a taxa ou o local
funcionarem de um jeito que não corresponde à decisão do produto.

Escolha um modo antes de agir:

- **solicitar** — obter um parecer independente sobre um diff, commit ou branch;
- **receber** — verificar achados que outra revisão já produziu;
- **rigorosa** — executar escrutínio excepcional de estrutura, sentido,
  manutenibilidade, contratos e caminhos fora do happy path.

Se o pedido for uma auditoria de segurança ou penetration test autorizado,
encaminhe para security-audit-penetration-testing. Se for implementação,
debugging ou planejamento sem pedido de revisão, use o workflow correspondente;
esta skill não transforma toda alteração em uma revisão formal.

## Contrato de decisão e cronologia

Uma decisão mais recente é um sinal forte da intenção atual, mas não é
automaticamente soberana. Ela pode ser uma substituição consciente de uma regra
anterior ou pode ser apenas uma formulação incompleta, um teste de ideia ou uma
contradição acidental.

Considere as fontes nesta ordem de investigação, sem transformar a ordem em
uma autorização silenciosa:

1. decisões explícitas do usuário na sessão atual;
2. objetivo e requisitos atuais, incluindo pedido, plano, spec ou issue;
3. CONTEXT.md e glossário do sistema;
4. ADRs e documentação ativa, verificando se ainda estão vigentes;
5. comportamento observado no produto e no código;
6. documentos históricos, comentários e decisões antigas já superadas.

Use essa cronologia para localizar a intenção provável, não para encerrar um
conflito automaticamente. Quando uma decisão atual contrariar uma anterior:

- registre qual era a regra anterior e qual é a regra proposta agora;
- verifique se o usuário declarou explicitamente que a regra anterior deve ser
  substituída, em que escopo e com quais efeitos de migração;
- procure evidência de que a mudança foi consciente, e não apenas uma
  inconsistência entre plano, código e conversa;
- se a substituição não estiver explícita, pare na fronteira da decisão e
  volte ao usuário antes de aprovar a implementação ou recomendar uma correção.

Use uma pergunta direta, em português do Brasil:

> É isso mesmo que você quer? É essa substituição de lógica que você quer
> implementar?

Não escolha silenciosamente entre a regra antiga e a nova. Não trate a decisão
mais recente como soberana somente porque ela apareceu por último. Enquanto a
resposta não vier, classifique o item como **decisão pendente** ou **bloqueado
por ambiguidade de produto**.

## Exemplos hipotéticos obrigatórios

Toda revisão deve apresentar exemplos hipotéticos concretos usando o
vocabulário do sistema. Um achado não deve ficar apenas no nível de “há uma
condição incorreta”.

Para cada conflito material ou achado importante, mostre o que aconteceria,
por exemplo:

- “Se, ao clicar em Nova Viagem, o sistema deixar de exigir o navio, a Viagem
  será criada, mas a página de BLs poderá não saber qual navio deve aparecer na
  coluna correspondente. É isso mesmo que você quer?”
- “Se uma taxa for alterada depois de o faturamento ter sido calculado, o
  recálculo deve atualizar os valores já exibidos ou somente os novos
  lançamentos?”
- “Se o container já estiver associado a outro BL e a pessoa tentar vinculá-lo
  novamente, o sistema deve bloquear, substituir o vínculo ou mostrar os dois?”

Adapte o exemplo ao fluxo real. O exemplo serve para confirmar o sentido da
regra, não para inventar requisito ou simular evidência.

## Invariantes

- Inspecione o diff, a base comparada, os requisitos, as decisões, os callers,
  os fluxos afetados e os checks reais. Não produza parecer apenas a partir de
  um resumo.
- Defina a unidade revisada: working tree, commit, branch ou outro artefato
  verificável. Se a base estiver ambígua, resolva isso com leitura.
- Monte antes um mapa de contexto: página, ação, entidade, estado, regra,
  efeito visível e conexão com outras páginas ou processos.
- Leia o caminho real de dados e os callers relevantes. Verifique se os nomes
  técnicos representam a entidade e o fluxo que o usuário reconhece.
- Ajuste profundidade ao risco. Contratos públicos, segurança, dados, BLs,
  faturamento, taxas, migrações e arquitetura justificam escrutínio adicional.
- Nunca simule revisor, subagente, ferramenta ou check que não foi executado.
  Se não houver capacidade independente, declare a limitação.
- Uma revisão não autoriza push, merge, deploy, publicação, alteração de
  contrato ou ampliação de escopo.
- Comunicação dirigida ao usuário deve ser em português do Brasil. Comece pelo
  fluxo visível do Vela; arquivo, componente, service, query ou RPC entram
  depois como evidência técnica.

## Gate inicial

1. Classifique o pedido como solicitar, receber ou rigorosa.
2. Registre objetivo, escopo, base, requisitos, decisões, restrições e checks.
3. Leia a sessão atual e as fontes de decisão relevantes antes de formar um
   juízo sobre o comportamento esperado.
4. Marque documentos antigos como históricos quando a própria documentação
   indicar que foram substituídos. Uma ADR antiga não vence uma decisão atual
   apenas por existir.
5. Compare a intenção provável com o diff e o comportamento implementado.
6. Procure conflitos entre decisões atuais e anteriores. Se não houver
   substituição consciente explícita, faça a pergunta de confirmação e pare o
   veredito nesse ponto.
7. Só então analise estrutura, tipos, testes, desempenho e manutenibilidade.

## O caminho feliz não basta

Além do caminho principal, investigue cenários plausíveis que podem mudar o
sentido do sistema:

- ausência de dados, BL, container, veículo, local ou taxa;
- duplicidade, vínculo já existente ou tentativa de substituir uma relação;
- cancelamento, voltar, atualizar a página, abrir uma URL profunda ou repetir
  a ação;
- erro parcial: a Viagem foi salva, mas os BLs ou o faturamento não foram;
- retry, duplo clique, concorrência ou dados alterados em outra tela;
- permissão insuficiente, estado desabilitado ou registro legado;
- datas, valores, arredondamento, moeda, status e transições inválidas;
- filtros, colunas e cálculos que precisam permanecer coerentes entre páginas.

Não force todos os cenários em toda revisão. Selecione os que têm relação com o
diff e explique por que foram ou não foram verificados.

## Modo solicitar

Use quando o usuário pedir um parecer independente ou quando o risco justificar
uma verificação adicional.

- Prepare o diff exato, a base verificada, o mapa do fluxo, as decisões
  relevantes, os requisitos, as restrições, os checks e os cenários adversos.
- Quando houver revisor independente realmente disponível, use
  [reviewer-prompt.md](references/reviewer-prompt.md) e forneça também o
  contexto de decisão e os exemplos hipotéticos.
- Verifique os achados contra o código real antes de apresentá-los como
  conclusões. Não diga que houve revisão independente se ela não ocorreu.
- Se surgir conflito de lógica sem substituição explícita, apresente a pergunta
  ao usuário antes de um veredito. O parecer pode registrar achados técnicos,
  mas não pode declarar o fluxo correto por conta própria.

## Modo receber

Use quando o usuário trouxer comentários, um parecer ou achados de revisão.

- Leia cada achado contra o diff, os callers, o contexto do Vela e as decisões
  atuais e anteriores.
- Diferencie defeito reproduzível, preferência, hipótese especulativa,
  contradição de produto e item fora do escopo.
- Classifique cada item como **aceito e corrigido**, **rejeitado com evidência**,
  **não reproduzido**, **fora de escopo**, **decisão pendente** ou **bloqueado
  por acesso**.
- Se um achado revelar substituição ambígua de lógica, faça a pergunta de
  confirmação e inclua um exemplo hipotético com a página e as entidades
  afetadas.
- Implemente somente correções justificadas e autorizadas. Rode os checks
  afetados e registre o que mudou.

## Modo rigorosa

Use quando o usuário pedir revisão excepcionalmente rigorosa ou quando o risco
estrutural e semântico justificar esse nível. Carregue
[rigorous-review.md](references/rigorous-review.md).

A revisão rigorosa não passa por cima do gate de decisão. Uma arquitetura
elegante que implementa o fluxo errado continua sendo um defeito. Ela pode
recomendar eliminar camadas, branches ou abstrações, mas não executa
refatorações sem autorização explícita.

## Saída mínima

Apresente em pt-BR, nesta ordem:

1. **Contexto revisado:** página, ação, entidades, estados, base e escopo;
2. **Fontes de decisão:** requisitos atuais, decisões anteriores, documentos
   consultados e conflitos encontrados;
3. **Intenção esperada:** o fluxo que o código deveria produzir;
4. **Status das decisões:** confirmado, sem conflito, decisão pendente ou
   bloqueado por ambiguidade;
5. **Exemplo hipotético:** cenário concreto no vocabulário do Vela;
6. **Pontos fortes**, quando houver;
7. **Achados priorizados:** arquivo/linha, cenário, evidência, efeito no sistema,
   severidade e correção sugerida;
8. **Checks e limitações:** somente o que foi realmente verificado;
9. **Perguntas ao usuário:** obrigatórias quando houver substituição de lógica
   não explicitamente confirmada;
10. **Veredito:** proporcional ao escopo e suspenso quando a decisão de produto
    ainda estiver aberta.

Não transforme uma revisão em autorização implícita para publicar ou ampliar o
trabalho.
