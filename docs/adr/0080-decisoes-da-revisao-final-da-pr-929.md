# 0080 — Decisões da revisão final da PR 929

Status: aceito — 2026-10-12 (decisões do dono). Implementado nas migrations
`181` (editada antes do primeiro deploy), `214` e `215`, em produção desde o
merge da PR 929 em 2026-10-12 (ver "Evidência").

Refina o item 20 da
[ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
(Invoice única de Demurrage por grupo) e o item 6 (Manifesto Mercante como
fonte única da rota).

## Contexto

A [revisão final da PR 929](../archive/audits/2026-10-12-revisao-final-pr-929.md)
encontrou três pontos em que a correção dependia de regra de negócio, não só de
código. O dono decidiu os três em 2026-10-12.

## Decisão

1. **Demurrage de container compartilhado: cada caixa uma vez, por caixa.**
   O "já faturado" passa a ser decidido pela caixa (número do container,
   não-SOC) e não pelo B/L do grupo do momento. Caixa que já está numa Invoice
   de Demurrage emitida ou paga da mesma Viagem e do mesmo Cliente — inclusive
   ancorada em B/L hoje cancelado — nunca é cobrada de novo. Quando o grupo já
   tem Invoice e entra uma caixa ainda não cobrada (o B/L que chega depois), a
   emissão gera uma Invoice complementar pelo B/L-âncora atual, só com as caixas
   ainda não cobradas. Exemplo: os B/Ls 100 e 101 dividem o container X e a
   Invoice sai pelo 100 com X; chega o 102 com X e Z; a próxima emissão cobra só
   Z. Se o grupo se divide ou o âncora é cancelado com a Invoice paga, X não é
   cobrado outra vez.
2. **"Informar Nº" não troca nem limpa o Manifesto que já tem B/L.** Com B/L
   vinculado ao número antigo, a troca e a limpeza são recusadas e a mensagem
   manda usar Ver B/Ls → Mover ou Desvincular, que pedem motivo e gravam o
   Histórico de cada B/L. Sem B/L vinculado, o número antigo é o digitado
   errado e sai do cadastro; a rota fica só com o número novo.
3. **Migration `181` editada antes do primeiro deploy.** A reescrita do Nº de
   Manifesto e do CE Master para a forma canônica pula as linhas de Viagem
   Cancelada, que são seladas e abortariam a migration. Autorização explícita
   do dono para editar a migration protegida, que nunca foi aplicada em
   produção; o diagnóstico de pré-deploy (consulta 4c) lista essas linhas.

## Consequências

- Nenhuma caixa é cobrada duas vezes por mudança no grupo depois da emissão, e
  a caixa de um irmão tardio não fica sem cobrança. Um grupo pode ter mais de
  uma Invoice (a original e as complementares).
- A reemissão automática depois de datas corrigidas refaz exatamente as caixas
  da Invoice cancelada que não estão cobertas em outra.
- A aba Rotas e Manifestos nunca mostra dois números para a mesma rota por
  causa do "Informar Nº", e o Histórico da Viagem registra só o que mudou.
- Viagem Cancelada com número fora do formato mantém o número antigo; o
  `CHECK` de formato fica `NOT VALID` enquanto houver linha assim.

## Evidência

Testes de contrato no PostgreSQL 16 local com replay das migrations `001`–`215`
(`demurrageCobrancaPorCaixa`, `ceImportacaoContrato`) e replay da cadeia
`181`–`213` sobre um banco com Viagem Cancelada de número fora do formato, em
que a `181` original abortava. Até a decisão, nada foi verificado em navegador
nem em Supabase real.

**Deploy (conferido em 2026-10-13, em leitura):** o registro de migrations do
projeto Supabase de produção lista `181`, `214` e `215`, dentro da cadeia
`174`–`219`; a aplicação está registrada em
[servicos-externos.md](../operations/servicos-externos.md) ("Execução
(2026-10-12, produção)"). O registro prova que as migrations foram aplicadas,
não o comportamento em produção nem o fluxo em navegador.
