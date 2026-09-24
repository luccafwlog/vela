# 0041 — Validação como fila de bloqueios; CE Mercante como confirmação

> **Nota editorial — 2026-09-23.** A exceção interna da `051` foi retirada pela [ADR 0070](./0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md) (migration `083`): o Portal trava toda emissão, inclusive a automática pelo CE, e a saída sem Portal é a Liberação de faturamento sem Portal, por Cliente, concedida pelo Administrativo.
>
> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Validação está em /taxas-locais; reconciliação de cliente fica na Revisão. Portal é gate manual, com exceção interna de emissão automática pelo CE na 051.
> Rastreabilidade: [ADR 0050](./0050-financeiro-segregado-por-processo-faturavel.md), [ADR 0054](./0054-portal-como-gate-de-faturamento.md), [ADR 0061](./0061-conciliacao-de-cliente-com-casa-unica-na-revisao.md); [migration ativa 051](../../supabase/migrations/051_ce_mercante_auto_billing.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-10

## Contexto

A aba Validação misturava estados internos de `charge_status` com um funil e
ações de aprovação/marcação em lote. O fluxo automático já calcula o B/L e usa o
cadastro do CE Mercante para confirmar e emitir, portanto esses atos não eram
uma confirmação operacional confiável. Falhas de emissão também ficavam apenas
em telemetria.

## Decisão

1. `/faturamento` é uma fila derivada de três bloqueios: Sem cliente vinculado,
   Cálculo incompleto e Aguardando CE Mercante. Faturado e Isento ficam fora por
   padrão e retornam pelo filtro de resolvidos.
2. O cadastro do CE Mercante é o ato de confirmação do cálculo. A Validação
   oferece desbloqueio por recálculo, reconciliação e emissão individual, sem
   aprovação ou marcação em lote.
3. Falhas de emissão automática criam um alerta `billing_auto_issue_failed`
   para o B/L, sem transformar espera normal (cliente, cálculo ou CE) em alerta.
4. A conferência provisória é exportada em XLSX e a emissão operacional por
   linha usa o workflow que preserva o caminho de Granito.

## Consequências

`charge_status` continua no banco e nas demais superfícies, mas deixa de ser o
modelo visual da fila. A RPC e as ações por B/L permanecem disponíveis. O lote
de aprovação/marcação sai da tela; o lote de recálculo continua limitado à
seleção do operador.

## Alternativas consideradas

**Nota histórica — 2026-08-10:** a decisão 2 registrava a marcação manual de
"pronto para faturar" de **Granito** como ponte até o CE de Granito.

**Nota editorial — 2026-08-20:** o fluxo vigente de Granito é somente apoio
quantitativo. Não há promoção para `ready_for_billing` nem emissão nova de
invoice; registros financeiros antigos permanecem consultáveis sem serem
apagados ou promovidos novamente.

- Manter o funil e expor `charge_status`: rejeitado, pois o campo é detalhe do
  motor e não representa o bloqueio que o operador precisa resolver.
- Criar uma tabela de falhas: rejeitado; `alerts` já é a superfície operacional
  existente e aceita o tipo livre sem migration.
