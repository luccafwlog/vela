---
name: design-audit
description: "Use when the user asks for a Vela UI audit across pages, states or viewports with evidence and prioritized findings."
---

# Auditoria de design do Vela

Avalie se uma pessoa normal consegue entender o produto, confiar nos dados e
concluir a ação principal do escopo — por exemplo, cadastrar ou atualizar uma
Viagem, revisar um B/L, conferir Taxas Locais ou acompanhar uma fatura. Uma
auditoria de design não é apenas uma avaliação estética.

## Escopo e capacidade

Antes de iniciar, confirme o escopo: páginas, estados, viewports, ambiente,
profundidade e se o usuário quer somente relatório ou também correções. Toda
comunicação dirigida ao usuário deve ser em português do Brasil (pt-BR), salvo
pedido explícito em contrário.

Ao relatar um achado, use primeiro a linguagem da tela: página, seção, botão,
campo, coluna, filtro, modal, estado e efeito para a pessoa. Conecte o problema
à consequência em outro fluxo ou página quando houver. Só depois informe
componente, arquivo ou CSS como detalhe técnico. Consulte `CONTEXT.md` e os
documentos de módulo para não inventar nomes de entidades ou labels.

Use o stack local e os scripts de auditoria existentes quando estiverem
disponíveis e autorizados. Consulte `WORKFLOW.md`, `CLAUDE.md` e a documentação
de setup antes de preparar banco, servidor ou dados. Não instale pacotes, altere
configuração global, crie credenciais ou inicialize serviços automaticamente
sem necessidade e autorização.

Se browser, banco local, Playwright, seed ou outro recurso necessário não
estiver disponível, faça a parte estática ou manual que for possível e registre
exatamente o que não foi verificado. Nunca diga que uma página, screenshot,
console ou fluxo foi auditado sem evidência.

Use apenas dados sintéticos. Não copie dados de produção. Não execute testes
ativos contra produção ou serviços de terceiros.

## Decisões e sentido do sistema

Considere CONTEXT.md, a sessão atual, os planos e as ADRs vigentes para
entender o fluxo esperado. Uma ADR antiga ou um rótulo histórico não deve ser
tratado como regra atual sem verificar seu status.

Se o comportamento visível da tela contrariar uma decisão anterior e não ficar
claro que houve uma substituição consciente, registre a inconsistência como
decisão pendente. Não corrija a semântica por conta própria. Pergunte ao usuário
qual regra deve vigorar e use um exemplo do Vela, como: “Se a página Viagens
permitir retirar a declaração de Exportação da Escala enquanto houver Embarque
de Vazios, o sistema deve bloquear a ação ou descartar o planejamento?”

Em cada achado material, inclua pelo menos um exemplo hipotético com página,
ação, entidade, estado e efeito. Deixe claro que o exemplo é uma simulação, não
uma evidência observada.

## Coleta de evidências

Quando a auditoria visual completa for solicitada:

1. descubra as rotas atuais no código e na documentação, em vez de confiar em
   uma lista histórica sem conferir;
2. faça login uma vez no ambiente local autorizado;
3. para cada rota e estado relevante, navegue, aguarde a estabilização e salve
   screenshot com viewport registrada; use `fullPage` apenas quando ajudar;
4. repita o passe mínimo em viewport móvel para verificar overflow, tabelas,
   formulários e alvos de toque;
5. registre erros de console, falhas silenciosas de consulta e logs do backend
   junto da evidência visual;
6. marque artefatos conhecidos do ambiente — como fontes externas bloqueadas ou
   websocket indisponível no shim — sem tratá-los automaticamente como bugs do
   produto.

## Critérios de análise

Avalie cada página e estado por:

- entendimento inicial e navegação;
- hierarquia visual, consistência e linguagem pt-BR;
- carregamento, vazio, erro e confirmação;
- confiança nos dados e nos estados;
- acessibilidade, responsividade e tamanho dos alvos;
- caminho de conversão e ação principal.

Procure especialmente códigos de máquina expostos, mistura PT/EN, falhas de
consulta sem aviso, ação destrutiva com hierarquia inadequada e formatação
incorreta de datas ou números.

Separe no relatório:

- problema de entendimento da tela;
- problema de confiança nos dados ou estados;
- problema de conversão ou conclusão da ação;
- defeito técnico observado;
- decisão de produto ainda não confirmada.

## Priorização e correção

Classifique cada achado como P0–P3 e indique o eixo afetado: Entendimento,
Confiança ou Conversão. Inclua evidência, localização, impacto, recomendação e
limitação.

Só aplique correções se o usuário as tiver solicitado ou autorizado. Correções
seguras e locais podem incluir copy, label maps, espaçamento, CSS de overflow e
formatação display-only. Não altere `src/lib/pix.ts`, fluxos de exclusão, RLS,
dinheiro ou semântica de dados como se fossem correções de design; registre-os
como recomendações e encaminhe para o fluxo adequado.

Depois de uma correção, rode os checks afetados e refaça a evidência visual.
Não declare melhoria sem comparação verificável.

## Relatório e entrega

Quando solicitado, escreva ou atualize `docs/design-audit/README.md` com data,
commit/base, método, evidências, tabela de correções, achados P0–P3, resumo por
dimensão, cinco maiores problemas de conversão e cinco quick wins. Use links
relativos para screenshots.

Escrever esse relatório é a entrega documental da auditoria; não crie ADR,
altere CONTEXT.md, mude semântica ou implemente correções sem autorização
explícita. Se o usuário pediu somente análise, entregue o relatório e pare.

Uma auditoria não autoriza commit, push, abertura de PR ou deploy. Essas ações
exigem pedido separado e evidência de que o usuário as deseja.
