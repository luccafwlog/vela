# 0084 — Registro de decisões já em produção: Itaú Pix, branching manual e environments de Preview

> **Situação atual (2026-10-14).** Os três itens continuam. No item 3, o código que usa segredo segue vindo da branch padrão, com checkout dela. O gatilho da Preview e do admin de teste deixou de ser `workflow_run` depois do CI: é a etiqueta `preview` (`pull_request_target`) ou `workflow_dispatch` em `main`. A produção publica no push em `main`, sem repetir o CI. Procedimento em [WORKFLOW.md](../../WORKFLOW.md#12-ci-e-deploy).

Status: aceito — 2026-10-14 (registro pedido pelo dono, item C1 da
[revisão geral](../archive/plans/2026-10-13-revisao-geral-documentacao.md)).
Implementado: as três decisões já estavam em produção quando foram registradas.

Registra decisões tomadas e entregues sem ADR. Não muda comportamento.
Supersede parcialmente a
[ADR 0056](./0056-branching-automatico-supabase-vercel.md) quanto ao Automatic
branching.

## Contexto

A revisão geral de 2026-10-13 achou três decisões em produção que só estavam
descritas em planos arquivados, no manual de serviços externos e no CHANGELOG.
Sem ADR, o motivo e o risco aceito de cada uma ficavam sem dono.

## Decisão

1. **Cobrança Pix dinâmica pelo Itaú, com baixa automática.** Com
   `app_settings.pix_provider = 'itau'`, cada fatura de Taxas Locais, fatura
   avulsa e Invoice de Demurrage ganha uma cobrança na API Pix Recebimentos do
   Itaú, com TXID `VELA…`; a Edge Function `itau-pix` consulta os recebimentos
   e dá baixa sozinha. O extrato bancário continua como plano B. Em produção
   desde 2026-10-07 (migrations `151`–`154`, com disparo imediato pela `219`).
   Motivo: o QR estático exigia conciliar todo pagamento pelo extrato. A regra
   vigente está em [Conciliação PIX](../modules/reconciliacao-pix.md#cobrança-dinâmica-itaú--migration-151).
2. **Automatic branching do Supabase desligado.** Desde 2026-10-07, a
   integração GitHub do Supabase não cria branch para cada PR. Quem precisa de
   Preview cria a branch à mão no painel, vinculada à branch Git da PR, e a
   remove depois do teste. Motivo: custo por hora de cada branch aberta.
   Procedimento em [Deploy](../setup/deploy.md) e estado em
   [Serviços externos](../operations/servicos-externos.md#supabase).
3. **Environments de Preview sem restrição de branch.** Os environments
   `cloudflare-pages` e `supabase-branches` do GitHub não ficam restritos à
   branch `main`; o dono recusou a restrição em 2026-10-06. O risco aceito:
   um job desses environments pode receber os segredos fora da `main`. A
   mitigação é que o código que usa os segredos vem da branch padrão
   (`pull_request_target` e `workflow_run` com checkout dela), não da PR.
   Estado em [Serviços externos](../operations/servicos-externos.md).

## Alternativas rejeitadas

- Continuar só com QR estático e conciliação pelo extrato (item 1).
- Manter o Automatic branching ligado, com uma branch paga por PR (item 2).
- Restringir os environments à `main`, como pedia a auditoria de segurança
  run-2, achado #14 (item 3).

## Consequências

- Uma mudança em qualquer desses pontos passa por ADR nova, e não só pelo
  manual de serviços externos.
- O item 3 continua aparecendo em auditorias de segurança; a resposta é esta
  ADR.
