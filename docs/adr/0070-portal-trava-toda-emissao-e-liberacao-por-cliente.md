# 0070 — O Portal trava toda emissão; a saída é a Liberação por Cliente

Status: aceito — 2026-09-23

Supersede a exceção interna da migration `051` descrita nas notas das
[ADR 0054](./0054-portal-como-gate-de-faturamento.md),
[ADR 0041](./0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md) e
[ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md).
Mantém a decisão original da 0054: a fatura só existe quando o cliente
consegue vê-la.

## Contexto

A 0054 fez do Portal pronto uma condição de faturamento. A migration `051`
abriu uma exceção: a emissão automática pela transição do CE Mercante rodava
num contexto privado que dispensava o Portal. Na prática, só a emissão manual
respeitava o gate. Um Cliente sem Portal recebia fatura automática, que ele não
conseguia ver, e o sistema abria em seguida um Alerta crítico dizendo isso.

A revisão da apresentação contra o código (plano
[2026-09-23](../plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md))
levou a questão ao dono do produto. As decisões foram:

- **R4:** Portal não provisionado sempre bloqueia a emissão, inclusive a
  automática.
- **R5:** a fatura espera. O Administrativo libera a emissão por Cliente, com
  justificativa. Ativar o Portal emite o que ficou retido.
- **3.6:** a liberação tem data de revisão. O Alerta de Portal não provisionado
  continua tratado pela Documentação, com o Administrativo avisado.

## Decisão

1. **Um gate só.** `customer_billing_access_ready` e `portal_billing_gate`
   passam quando o Portal está pronto **ou** há uma Liberação vigente. Não há
   mais contexto que dispense o Portal. As triggers de invoice e a revisão
   usam o mesmo gate.
2. **O CE retém em vez de emitir.** Sem gate aberto, a transição do CE calcula
   as taxas, grava `billing_hold_reason = 'Acesso ao portal nao provisionado'`
   e devolve `held`. Não é falha: a fila de efeitos não é acionada, e o efeito
   legado que a RPC do CE registra termina como sucesso retido. A Validação
   mostra *Portal não provisionado*.
3. **Liberação de faturamento sem Portal.** Tabela
   `customer_billing_portal_releases`: uma liberação aberta por Cliente, com
   justificativa, autor, data de concessão e data de revisão. Vigente enquanto
   não revogada e antes da data de revisão. Só o Administrativo concede
   (`grant_customer_billing_portal_release`) e revoga
   (`revoke_customer_billing_portal_release`); a equipe interna lê; o Portal
   não enxerga. Renovar revoga a anterior. Revogações ficam em `audit_logs`.
4. **Abrir o gate emite o que ficou retido.** Conceder a liberação e ativar o
   Portal (`reprocess_customer_billing_after_portal_activation`) chamam o mesmo
   reprocessamento, que emite pelo mesmo caminho da transição do CE. Assim
   "liberar" e "ativar" produzem a fatura que o CE teria produzido.
5. **Alerta.** `review_portal_not_ready` conta os B/Ls em revisão e os retidos
   pelo CE. Continua com a Documentação como responsável; o Administrativo
   entra na audiência.

## Consequências

- Clientes sem Portal deixam de ter faturas automáticas. O dinheiro espera até
  o Portal ou a Liberação. É o custo aceito em R4.
- A vigência é lida na hora, sem job: vencida a data, a trava volta no mesmo
  instante. O Alerta reaparece na próxima retenção ou reconciliação do
  Cliente, não no instante do vencimento. Se for preciso avisar no
  vencimento, o caminho é um `pg_cron` diário (marcado `ponytail:` na `083`).
- O contexto privado da `051` continua existindo só para dispensar o **e-mail
  de contato** na emissão automática. A emissão manual continua exigindo esse
  e-mail. Essa assimetria é anterior e não foi decidida aqui.
- A fatura emitida com a Liberação vigente não abre a exceção crítica
  `portal_excecao_critica_fatura`: a Liberação é a decisão registrada.
- Rollback: uma migration que devolva a exceção interna a
  `customer_billing_access_ready` e às triggers, sem tocar faturas emitidas.

## Evidência

- Migration: [083](../../supabase/migrations/083_portal_trava_universal_liberacao_faturamento.sql).
- Teste no Postgres: [portalBillingRelease.local-pg.test.ts](../../src/integration/portalBillingRelease.local-pg.test.ts)
  prova retenção, permissão, concessão com emissão, CE com liberação vigente,
  revogação, vencimento e ativação do Portal.
- Tela: [BillingPortalReleaseCard.tsx](../../src/components/clientes/BillingPortalReleaseCard.tsx),
  na ficha do Cliente e no Console do Portal.
