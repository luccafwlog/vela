# 0087 — Aceite operacional e jurídico do Desbloqueio de CE

> **Situação atual (2026-10-15).** O item 5 foi ajustado pelo responsável na revisão da PR 956: os 30 dias contam a partir do encerramento da solicitação (cancelada, ou concluída com todos os B/Ls exportados), não do envio. Solicitação em andamento mantém os PDFs, porque um pedido em análise que perdia os documentos ficava travado: o desk não recusa documento já expurgado, e o cliente só reenvia quando há correção solicitada. Regra vigente no [módulo](../modules/desbloqueio-ce.md). Os demais itens continuam valendo.

Status: aceito — 2026-10-14 (decisões do dono). Itens 2 e 3 implementados na
migration `279` e item 5 na `280` (PR 956), com testes no Postgres local; ver o
[plano do Desbloqueio de CE](../plans/2026-10-04-desbloqueio-ce-mercante.md).

Fecha o aceite operacional e jurídico que a
[spec](../spec/2026-10-04-desbloqueio-ce-mercante-design.md) deixava em
"Decisões necessárias antes da execução dependente". As regras vivem no
[módulo Desbloqueio de CE](../modules/desbloqueio-ce.md).

## Contexto

O Desbloqueio foi publicado com regras provisórias definidas na execução:
pagamento só das Taxas Locais, B/L sem cobrança de Taxas Locais tratado como
não pago, documentos inativos guardados por 5 anos e conferência dos PDFs
apenas pela análise do desk. Faltava quem responde pela operação confirmar
ou corrigir essas regras antes de abrir a funcionalidade a clientes.

## Decisão

1. **Entrega física independente.** O desk registra a entrega do B/L original
   antes ou depois da solicitação; um ato não depende do outro. O código já
   funciona assim.
2. **B/L isento.** B/L com Taxas Locais isentas não tem o requisito de
   pagamento: fica apto com termo, procuração e entrega do B/L.
3. **Outras taxas do B/L.** O requisito de pagamento inclui, além das Taxas
   Locais, as cobranças avulsas referentes ao B/L. Demurrage não entra.
4. **Conferência humana.** Conteúdo, assinatura e validade do termo e da
   procuração são conferidos só pela análise do desk; o sistema não valida
   assinatura nem validade desses documentos (a validade anual VIP até 31/12
   continua).
5. **Retenção.** Todos os anexos de uma solicitação são expurgados 30 dias
   após o envio. Os documentos do Termo Anual (VIP) permanecem até serem
   substituídos por um novo termo aprovado depois do vencimento; só então o
   anterior é expurgado. Os prazos curtos de limpeza (upload abandonado em
   1 dia, rascunho em 7 dias) continuam.

## Alternativas rejeitadas

- Incluir Demurrage no requisito: a cobrança costuma surgir na devolução do
  container, depois do desbloqueio, e prenderia o CE a um valor futuro.
- Manter 5 anos de retenção dos anexos: guardava documentos de cliente além
  do necessário para a operação.

## Consequências

- Itens 2 e 3 mudam o cálculo de aptidão (`ce_unlock_private.item`, hoje só
  `bl_receivables` com origem `local_charges`) e a projeção usada pelo Portal
  e pela planilha ZPT; a coluna de pagamento da planilha passa a sair "Sim"
  para B/L isento.
- Item 5 substitui a regra de 5 anos de `ce_unlock_cleanup_candidates`. Um
  pedido ainda em análise 30 dias depois do envio perde os PDFs; o histórico e
  os metadados ficam, e o desk pede reenvio se precisar.
- O aceite operacional/jurídico deixa de bloquear a ativação; passam a
  bloquear as três mudanças de código.
