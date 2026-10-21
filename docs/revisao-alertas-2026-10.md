# Revisão completa dos alertas do Vela — outubro de 2026

Revisão feita em 2026-10-21 sobre a `staging` em `34e2a48` (mesmo conteúdo da
`main` em `806d2b5`), depois do merge das PRs
[#1003](https://github.com/luccafwlog/vela/pull/1003),
[#1005](https://github.com/luccafwlog/vela/pull/1005) e
[#1006](https://github.com/luccafwlog/vela/pull/1006). É registro datado: diz o
que estava no código e no banco local naquele checkout, o que foi corrigido e o
que ficou para decisão. A regra viva do ciclo de vida dos alertas continua em
[Operação e Suporte § Alertas e Notificações Internas](modules/operacao-suporte.md#alertas-e-notificações-internas).
Fica em `docs/` porque foi o caminho pedido; pela [convenção](CONVENCOES.md),
uma revisão datada vai para `docs/archive/audits/` e pode ser movida depois do
merge das PRs. As referências às migrations `346` a `353` apontam para as PRs
abertas, ainda sem merge. As migrations `349` a `353` vieram das decisões do
Lucca sobre as perguntas desta revisão (mesmo dia; ver [Decisões](#decisões)).

## Resumo

**O que estava quebrado.** O padrão do "Baplie ausente" (o alerta lê um dado
que o produtor não grava, ou grava de outro jeito) aparece em mais seis
lugares. Os mais visíveis:

| # | Severidade | O que o usuário via | Causa |
|---|---|---|---|
| D1 | Alta | "Exportação pendente pós-ATD" que não fica na fila e uma Notificação Interna nova a cada 15 minutos para cada usuário de Operações, numa escala com dois terminais | O item é da escala, mas o reconciliador era chamado por terminal e lia só o ATD daquele terminal: a mesma rodada abria e fechava o item |
| D2 | Média | "Pendência geral do Portal" (e convite expirado, falha de envio, e-mail suprimido) aberta para Cliente cujo único B/L foi cancelado; o console de Provisionamento mostrava "processo ativo" | O alerta lia `bls.financial_status = 'cancelled'`; o cancelamento grava `cancelled_at` e não muda o status financeiro. Nenhum gravador põe `'cancelled'` |
| D3 | Média | Pix recebido pelo Itaú e não baixado não aparecia no painel de alertas financeiros de `/taxas-locais` | O painel lia só a entidade `pix_transaction` (extrato); a cobrança Itaú grava `itau_pix_receipt` |
| D4 | Média | "B/Ls esperados" aberto com o B/L importado (porto BRVIT na escala BRVIX) e fechado por B/L cancelado | Comparava o porto sem `normalize_port_code` e contava B/L cancelado; o "CE Mercante pendente" da mesma viagem normaliza e exclui |
| D5 | Média | Escala excluída ou omitida mantinha a "Exportação pendente pós-ATD" | O resolvedor usava a entidade `voyage_escala_terminal`; o item é `voyage_pod_schedule` |
| D6 | Baixa | Mensagem "ETB de 22/10" para um ETB digitado 21/10 22:00 | Data do terminal (timestamptz) convertida no fuso da sessão (UTC) |

E fechamentos que não aconteciam (as lacunas L2, L5, L7, L8 e L10 do
[estudo de 2026-10-20](archive/audits/2026-10-20-auto-resolucao-de-alertas.md),
reproduzidas aqui antes de corrigir): importar, mover ou cancelar B/L não
reconciliava "B/Ls esperados" nem "CE Mercante pendente"; vincular o manifesto
de Granito ou de Vazios não fechava a exportação; a viagem concluída ou
cancelada congelava os alertas dela; o bloqueio de cálculo só fechava pelo
navegador; "Efeito de importação bloqueado" não fechava nunca; excluir B/L
deixava os alertas dele.

**O que foi corrigido (PRs para `staging`, CI verde, sem merge):**

| PR | Migração | Conteúdo |
|---|---|---|
| [#1007](https://github.com/luccafwlog/vela/pull/1007) Alertas de viagem e escala | `346` | D1, D4, D5, D6; L2, L7 e L10 |
| [#1008](https://github.com/luccafwlog/vela/pull/1008) Alertas do B/L cancelado, faturado ou excluído | `347` | D2; L5; B/L excluído leva os alertas; acerto dos alertas já abertos |
| [#1009](https://github.com/luccafwlog/vela/pull/1009) Efeito de importação bloqueado | `348` | L8; acerto dos itens já abertos |
| [#1010](https://github.com/luccafwlog/vela/pull/1010) Pix Itaú no painel financeiro | — (frontend) | D3; rótulos das entidades `itau_pix_receipt` e `business_holidays` |
| [#1011](https://github.com/luccafwlog/vela/pull/1011) Este relatório | — | Relatório, `supabase/scripts/consistencia_alertas.sql` e correção de `observabilidade.md` |
| [#1013](https://github.com/luccafwlog/vela/pull/1013) Datas da Demurrage e Comunicado recusado | `349` | P1 e P2 (L9, L11) |
| [#1015](https://github.com/luccafwlog/vela/pull/1015) Portal segue o processo ativo e fecha na hora | `350` | P3; alertas do Portal abrem e fecham no fato |
| [#1012](https://github.com/luccafwlog/vela/pull/1012) Detector que quebra não para os outros | `351` | P5 (A1, S12) |
| [#1014](https://github.com/luccafwlog/vela/pull/1014) B/L sem Cliente perto do ETA | `352` | P4 (S7), 5 dias |
| [#1016](https://github.com/luccafwlog/vela/pull/1016) Alertas fecham na hora do fato | `353` | Comunicados pendentes, e-mail devolvido, provedor silencioso |

As migrações precisam ir para a `main` na ordem numérica (346 a 353; ver
[PRs e ordem de merge](#prs-e-ordem-de-merge)); se outra ordem for preferida,
renumere antes do merge. As migrações `347`, `348` e `349` acertam os alertas
que já estavam errados e, por isso, declaram a dependência do "Data status" do
`AGENTS.md`.

**Decisões do Lucca (2026-10-21):** as cinco perguntas da revisão foram
respondidas e implementadas nas PRs `349` a `353`; ver [Decisões](#decisões).

**Não verificado:** produção e staging não foram consultados (nem
`cron.job_run_details`, `net._http_response` ou alertas abertos). O Sentry foi
lido (regras e issues), o Better Stack não. Ver
[O que não foi verificado](#o-que-não-foi-verificado).

## Método e evidência

| Etapa | Como |
|---|---|
| Definição vigente | Replay da cadeia ativa num Postgres 16 local (`scripts/setup-local-pg.sh --reset`, 342 migrations) e `pg_get_functiondef` de todas as funções de `public` e `ops`. Evita seguir à mão os envelopes `_legacy_NNN` |
| Inventário do banco | Para cada tipo de `alert_type_catalog`, as funções que citam o literal do tipo, os gatilhos que as chamam, os jobs do `pg_cron` e as chamadas de `src/` e `supabase/functions/` |
| Fonte de dados | Para cada leitor (detector, reconciliador, resolvedor, tela), a tabela, a coluna, o valor e a entidade lidos, comparados com o que cada gravador escreve |
| Reprodução | Cada bug corrigido tem um teste local-pg que falha na `staging` (rodado com a sonda forçada) e passa com a migração |
| Externo | Sentry (org `fwlog`) lido pelo MCP: 4 regras de alerta, nenhum monitor de cron, 15 issues abertos. Better Stack, Supabase remoto e GitHub Actions não foram lidos |

Rótulos de evidência como em [CONVENCOES.md](CONVENCOES.md): **Código**
(leitura estática), **Teste** (local-pg ou Vitest), **Runtime** (observado em
ambiente remoto; não houve).

## Relação com o trabalho de 2026-10-20

A sessão `claude/lucid-clarke-5uqfs2` (PRs #1005 e #1006, já em `staging` e
`main`) fez o [estudo do fechamento automático](archive/audits/2026-10-20-auto-resolucao-de-alertas.md)
e corrigiu, nas migrations `341` a `345`: exclusão da viagem leva os alertas
(L1b), importar o Baplie fecha o "Baplie ausente" (L1), ETA da escala e CE do
B/L reconciliam os alertas de prazo (L3, L4), B/L que ganha Cliente cria o
recebível, conta ativa do Portal não volta para análise, saldo do Portal sem
consolidada em dobro e "na fila" sem efeito. Esta revisão não refaz nada disso:
as migrations `341`–`345` foram lidas, os testes delas passaram no replay, e
nenhuma regressão foi encontrada.

| Lacuna do estudo | Situação depois desta revisão |
|---|---|
| L1, L1b, L3, L4 | Corrigidas na `341` (estudo) |
| L2 — B/L não reconcilia B/Ls esperados nem CE | Corrigida na `346` |
| L5 — bloqueio de cálculo só fecha no navegador | Corrigida na `347` |
| L6 — exportação com entidade trocada | Corrigida na `346` (D5) |
| L7 — Granito/Vazios não fecham a exportação | Corrigida na `346` |
| L8 — efeito bloqueado sem fechamento | Corrigida na `348` |
| L9 — Demurrage com datas alteradas, ramo cancelada e reemitida | Corrigida na `349` (decisão P1) |
| L10 — viagem concluída ou cancelada congela | Corrigida na `346` |
| L11 — justificativa prometida e recusada | Corrigida na `349` (decisão P2) |
| Suspeita "dois terminais" (L6) | Confirmada e corrigida (D1) |

## 1. Inventário

### 1.1 Modelo comum dos alertas do banco

Todo alerta de domínio é um agregado em `alerts` (`type = 'aggregate'`) por
`(entity_type, entity_id)`, com itens em `alert_items` por
`(alerta, item_type, department)`.

| Peça | Onde | Regra |
|---|---|---|
| Unicidade | índices `uq_alerts_foundation_active_entity` e `uq_alert_items_type_department` (migration `002`) | Um agregado aberto por entidade; um item por tipo e setor. Reabrir o item gera nova ocorrência (`occurrence_id`) e nova Notificação Interna |
| Abrir | `upsert_alert_item` (`002`, linha 22228) → `upsert_alert_item_before_milestone_hardening` | Trava `pg_advisory_xact_lock('alert:'‖entidade)`; mudança de `metadata.milestone` abre nova ocorrência |
| Fechar | `resolve_alert_item` (`002`:17108) e `resolve_alert_item_for_department` | Marca `resolved` e recalcula o agregado (`refresh_alert_aggregate`, `002`:15750); não pega a trava consultiva |
| Autorização | `alert_actor_is_authorized()` | `service_role`, gatilho com `alerts.foundation_trigger = 'on'`, usuário interno ativo, ou o contexto temporário das disputas do Portal. Fora disso, `RAISE 42501` |
| Entrega | `fanout_alert_item_for_department` | Notificação Interna (sino) para o setor do item e a audiência do catálogo |
| Manual | `dismiss_alert_item` (dispensa com data de revisão, ADR 0053) e `resolve_alert_item_with_justification` (só os tipos de `_alert_types_resolved_with_justification()`, `316`:42) | — |

### 1.2 Alertas de domínio (catálogo, 52 tipos; 47 ativos)

Chave = `entity_type` / formato de `entity_id`. "Detector" é a Edge Function
`alerts-detector` → `run_alert_detectors()` (`309`:177), a cada 15 minutos.
Números entre crases são migrations da cadeia ativa, com a linha da definição
vigente.

#### Viagem e escala

| Tipo | Definição vigente | Dispara | Abre | Fecha | Fonte de dados | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `voyage_bl_expected` | `reconcile_voyage_bl_expected_alerts` (`346`:388) | Detector, audit `voyage_pod_schedule` e `voyages` (`341`), gatilhos de `bls` (`346`), fim da importação de B/L (`346`) | D-7 do primeiro ETA brasileiro e POL/POD sem B/L vivo | Rotas cobertas ou fora de D-7 | `audit_logs` (`voyage_pod_schedule`/`eta`, `deleted`, `omitted`, `tem_importacao`; `voyage_pol_schedule`/`etd`; `voyages`/`indicated_first_brazilian_*`), `bls.pol/pod/cancelled_at` | `voyage` / `<viagem>` | Viagem |
| `voyage_baplie_missing` | `reconcile_voyage_baplie_missing_alerts` (`324`:39) | Detector, audit da escala, importação do Baplie (`341`) | D-7 sem `baplie_containers` | Baplie importado ou fora de D-7 | `audit_logs` (ETA), `baplie_containers.voyage_id` | `voyage` / `<viagem>` | Viagem |
| `voyage_baplie_documentary_coverage` | `reconcile_voyage_baplie_coverage_alerts` (`324`:77) | Importação do Baplie e do B/L, gatilhos de instrução em `baplie_containers`, `bls`, `bl_containers` | Container do Baplie sem B/L ou B/L sem container no Baplie | Divergência zerada | `baplie_containers` (`status <> 'empty'`), `bls`, `bl_containers` (portos normalizados) | `voyage` / `<viagem>` | Viagem |
| `voyage_ce_mercante_missing` | `reconcile_voyage_ce_mercante_missing_alerts` (`324`:321) | Detector, audit da escala e do CE do B/L (`341`), gatilhos de `bls` (`346`) | D-5 com B/L vivo sem CE ou rota de vazios sem manifesto | Tudo com CE | `bls.ce_mercante`, `vazios_importacao_*`, `manifestos_mercante`, `voyage_route_ce_master` | `voyage` / `<viagem>` | Viagem |
| `voyage_schedule_date_pending` | `reconcile_voyage_schedule_date_alerts` (`346`:183) | Audit da escala, estado do terminal, detector | ETA passou sem ATA; ATA sem ETB | ATA/ETB gravados, escala excluída ou omitida | `audit_logs` (`eta`, `ata`, `deleted`, `omitted`), `voyage_escala_terminal_state.terminal_etb` | `voyage_pod_schedule` / `<viagem>::<porto>` | Escala |
| `voyage_terminal_date_pending` | idem | Gatilho em `voyage_escala_terminal_state` (`002`:15617), detector | ETB passou sem ATB; ATB sem ETD; ETD passou sem ATD | Data seguinte gravada | `voyage_escala_terminal_state` (dia de Brasília desde a `346`) | `voyage_escala_terminal` / `<viagem>::<porto>::<terminal>` | Terminal |
| `voyage_export_after_atd` | `reconcile_voyage_export_after_atd_alerts` (`346`:78) e `reconcile_voyage_export_alerts` (`346`:300) | Detector, estado do terminal, `granite_manifests`, `vazios_manifests`, `voyage_export_schedules` (`346`) | Escala com exportação planejada, ATD em algum terminal e manifesto previsto faltando | Manifesto vinculado, planejamento corrigido, escala excluída/omitida | `voyage_export_schedules`, `voyage_escala_terminal_state.terminal_atd`, `granite_manifests`, `vazios_manifests` (por viagem) | `voyage_pod_schedule` / `<viagem>::<porto>` | Escala |
| `agency_report_department_pending` | `reconcile_agency_report_alerts` (`290`:18), `reconcile_agency_report_alerts_for_scale` (`324`:876) | Audit da escala e sign-offs (`002`:14359), mudança do ADR (`002`:14444), detector | ATD sem sign-off do setor | Sign-off | `agency_departure_reports`, sign-offs, ATD do terminal | `agency_departure_report` / `<viagem>::<porto>[::<terminal>]` | ADR (um item por setor) |
| `agency_report_deadline_missed` | idem + `detect_agency_report_deadline_missed` (`002`:5782) | idem | Prazo do ADR vencido | Fechamento do ADR | idem | idem | ADR |

#### Revisão de B/L

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `review_customer_unlinked` | `reconcile_customer_bl_review_alerts` (`324`:601) | Gatilhos em `bls` (`170`), `save_bl_review`, `complete_review_customer_group`, detector (`002`:5917) | B/L em `pending_review` sem Cliente | Vínculo, revisão concluída ou cancelamento | `bls.customer_id`, `review_status`, `consignee`, `cancelled_at` | `customer` / nome do consignatário ou `sem_cliente` | Grupo de B/Ls |
| `review_portal_not_ready` | idem | idem + gatilhos em `customer_portal_accounts`, `customer_contacts`, `customer_billing_portal_releases` | B/L pendente ou retido sem Portal pronto | Portal pronto ou Liberação | `customer_billing_access_ready`, `bls.billing_hold_reason` | `customer` / `<cliente>` | Cliente |
| `review_breakbulk_weight_missing` | idem | idem | Carga solta/misto sem peso BB | Peso informado | `bls.cargo_mode`, `bb_weight_ton` | `customer` / `<cliente>` ou consignatário | Cliente |
| `review_customer_email_missing`, `review_granite_customer_unlinked` | Inativos (`085`, `325`) | — | — | — | — | — | — |

#### Faturamento e Financeiro

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `billing_calculation_blocked` | `upsert_billing_alert` (`002`:22439) | Navegador (`reviewBillingAutomation.ts`:259 → `createAlert`, `alerts.ts`:624) | Cálculo bloqueado na tentativa da tela | `resolve_billing_alert` (`238`:74) com origem resolvida; desde a `347`, B/L faturado ou cancelado no servidor | `bls.financial_status`, `charge_status`, `billing_hold_reason`, `charge_calculations` (`_billing_alert_origin_resolved`) | `bl` / `<B/L>` | B/L |
| `billing_auto_issue_failed` | `upsert_billing_alert`, `emit_ce_mercante_billing` (`212`:61) | Navegador e emissão pelo CE | Falha técnica na emissão | `resolve_auto_issue_alert_on_invoiced` (`347`), B/L cancelado (`347`) | `bls.financial_status` | `bl` / `<B/L>` | B/L |
| `billing_charge_table_missing` | `_write_charge_table_gap` (`208`:26) | Emissão pelo CE | POD/modalidade sem tabela | Lista de B/Ls vazia (`_drop_bls_from_charge_table_gaps`, `209`:210) | `bls`, tabelas de taxas | `charge_table_gap` / `<POD>::<modalidade>` | POD e modalidade |
| `fatura_desatualizada` | `alert_stale_invoice_for_bl` (`124`:129), `apply_invoice_basis_changes`, `_try_recreate_consolidated` | Correção da base da fatura | Fatura emitida com base alterada | Reemissão (`124`:187), cancelamento (`128`:400), `resolve_stale_invoice` com justificativa | `invoices`, `invoice_basis_changes` | `invoice` / `<fatura>` | Fatura |
| `restituicao_pendente` | `_sync_refund_alert` (`130`:486) | Gatilho em `invoice_refunds` | Restituição pendente | Nada pendente | `invoice_refunds.status` | `invoice` / `<fatura>` | Fatura |
| `pix_unreconciled` | `upsert_pix_reconciliation_exceptions` (`247`:972); `itau_pix_settle` (`153`:194; abertura na linha 266) | Importação do extrato; webhook/consulta Itaú (Edge `itau-pix`) | Pix sem baixa segura | `resolve_pix_reconciliation_exception` (`269`:26), `_itau_pix_close_receipt` (`154`:20), `itau_pix_settle` | `pix_reconciliation_exceptions`; `itau_pix_receipts` | `pix_transaction` / `<exceção>` **e** `itau_pix_receipt` / `<end_to_end_id>` | Pix |
| `invoice_overdue`, `invoice_payment_invalid`, `invoice_cancel_blocked` | Inativos | — | — | `resolve_invoice_alerts_on_status_change` ainda roda a cada mudança de status (caminho morto) | — | — | — |

#### Demurrage

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `demurrage_ptax_recalc_failed` | Edge `recalc-demurrage-ptax` (`index.ts`:116); `itau_pix_maintain` (`219`:232) | Job `recalc-demurrage-ptax` (17:00 UTC, manual) e manutenção do Itaú | PTAX não atualizada | Próxima execução completa | Referência cambial; cobranças vs `current_total_brl` | `exchange_rate_reference` / `global` (Edge) e `itau-pix-14h` (SQL): dois alertas | Referência cambial |
| `calendario_feriados_pendente` | `itau_pix_maintain` (`219`) | Manutenção do Itaú | A partir de 1º/11 sem feriados do ano seguinte | Feriados cadastrados (próxima rodada) | `business_holidays` | `business_holidays` / `itau-pix-calendar` | Calendário |
| `demurrage_invoice_dates_changed` | `_reconcile_demurrage_after_dates` (`317`:533) | Mudança de datas de container | Datas mudaram numa Invoice emitida | `resolve_dates_changed_alert_on_restore` (`208`:163) só quando as datas voltam | `demurrage_invoices.dunning_suspended_reason` | `demurrage_invoice` / `<invoice>` | Invoice (P1) |
| `cobranca_demurrage_recusada` | `settle_demurrage_dunning_claim` (`313`:272) | Régua (Edge `demurrage-dunning`) | Cobrança recusada | Cobrança sai; Invoice paga/isenta/cancelada (`317`:436); justificativa | claims da régua | `demurrage_invoice` / `<invoice>` | Invoice |
| `portal_dispute_opened` | `sync_demurrage_dispute_alert_for_invoice` (`002`:21411) | Gatilhos em `demurrage_invoices`, `demurrage_disputes`, mensagens do Portal | Vez do time na disputa | Vez do Cliente ou disputa fechada | `demurrage_disputes.next_responder`, `state` | `demurrage_invoice` / `<invoice>` | Invoice |

#### Portal, contatos e e-mail

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `portal_pendencia_geral` | `reconcile_client_portal_alerts` (`347`) | Detector e ativação (`portal-invite-activate`) | Cliente com B/L vivo e Portal não pronto | Portal pronto ou sem B/L vivo | `customer_portal_accounts`, `portal_suppressed_emails`, `bls.cancelled_at` (desde a `347`) | `customer` / `<cliente>` | Cliente |
| `portal_convite_expirado` | idem e `portal_mark_expired_invites` (`002`:13068) | Detector, job `portal-mark-expired-invites` (15 min) | Convite expirado com B/L vivo | `resolve_portal_alert_items_on_account_change` (`002`:17700) e detector | `customer_portal_accounts.account_situation`, `portal_invites` | `customer` / `<cliente>` | Cliente |
| `portal_falha_envio` | idem | Detector | Situação `falha_no_envio` | idem | idem | idem | Cliente |
| `portal_email_suprimido` | idem e `process_portal_email_event` (`109`:144) | Detector, runner de eventos de e-mail | E-mail de recuperação suprimido | idem | `recovery_email_status`, `portal_suppressed_emails` | idem | Cliente |
| `portal_reprocessamento_falhou` | `_reprocess_customer_held_billing` (`085`:520); `_portal_email_event_investigate_alert` (`309`:343) | Ativação do Portal; evento de e-mail em `investigate` | Falha técnica | Reprocessamento ok; justificativa (só evento de e-mail) | `bls`; `portal_email_events.status` | `bl` / `<B/L>` e `portal_email_event` / `<evento>` | B/L ou evento |
| `portal_abuso_login` | `register_portal_login_abuse` (`002`:16366) | Edge `portal-login` | Padrão de tentativas | Só justificativa (por desenho) | tentativas de login | `customer` / `<cliente>` | Cliente |
| `portal_excecao_critica_fatura` | `upsert_portal_invoice_exception` (`002`:22638) | Gatilhos de emissão em `invoices`/`invoice_bls` | Fatura emitida sem gate do Portal | `portal_invoice_exception_on_close` (`002`:12316) em paga/parcial/cancelada/obsoleta | `portal_billing_gate` | `bl` / `<B/L>` | B/L (D7) |
| `cliente_contato_bounced_sem_alternativa` | `detect_customer_communication_alerts` (`315`:554); Edge runner de e-mail | Detector; `portal-email-events-runner` | Bounce permanente e nenhum contato válido | Contato trocado (gatilho `002`:17479) e detector | `customer_contacts`, `portal_suppressed_emails` | `customer` / `<cliente>` | Cliente |
| `caixa_sem_destinatario` | `_apply_customer_contact_configuration` (`245`:15), `repair_customer_contact_box_fallbacks` (`010`:20) | Salvamento de contatos | Caixa sem destinatário | Salvamento com destinatário | `customer_contact_box_links` | `customer` / `<cliente>` | Cliente |
| `cliente_sem_contato_principal` | `ensure_customer_contact_email` (`106`:366) | Importação do B/L | E-mail do B/L sem contato ativo | Salvamento dos contatos | `customer_contacts` | `customer` / `<cliente>` | Cliente |
| `nob_sem_destinatario` | `evaluate_and_dispatch_automatic_communications` (`314`:186) | Runner dos Comunicados (15 min) | NOB sem contato ativo | Rodada seguinte; salvamento de contatos (interno e Portal) | caixas e contatos | `customer` / `<cliente>` | Cliente |
| `usuario_email_devolvido` | `detect_email_monitoring_alerts` (`319`:16) | Detector | E-mail de usuário interno suprimido | E-mail trocado ou supressão liberada | `auth.users.email`, as duas tabelas de supressão | `user_profile` / `<uuid>` | Usuário |
| `email_retorno_provedor_silencioso` | idem | Detector | 3+ e-mails aceitos há mais de 2 h sem evento depois deles | Evento recebido | `portal_email_attempts`, `customer_communication_attempts` (`aceito`), `portal_email_events.received_at` | `email_provider` / `webhook` | Provedor |

#### Comunicados e Desbloqueio de CE

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `comunicado_noa_pendente`, `comunicado_nor_pendente`, `comunicado_nob_pendente` | `detect_customer_communication_alerts` (`315`:554) | Detector | Alvo da régua sem Comunicado entregue a todos | Entregue, janela vencida, escala removida | `customer_communication_automation_targets` (ETA/ATA/ATB de `audit_logs` e do terminal, com `customer_communication_safe_timestamptz`) | `voyage_pod_schedule` / `<viagem>::<porto>` (NOB: `voyage_escala_terminal`) | Escala ou terminal |
| `comunicado_recusado` | `refresh_customer_communication_refusal_alert` (`318`:573) | Runner dos Comunicados; recusa do claim | Comunicado recusado pendente | Nada pendente | claims da automação | `customer` / `<cliente>` | Cliente (P2) |
| `comunicado_ce_reenvio_pendente` | `_set_bl_ce_mercante` (`230`:44) | Troca de CE depois do Comunicado de CE e Taxas | CE mudou | Comunicado criado depois da troca enviado (`238`:95) | `customer_communications`, `customer_communication_bls` | `bl` / `<B/L>` | B/L |
| `ce_trocado_com_desbloqueio` | `_set_bl_ce_mercante`, `apply_ce_mercante_rows_atomic` (`325`:245) | Troca de CE depois do Desbloqueio conferido | idem | Conciliação ZPT confere o CE atual (`238`:135); justificativa | `ce_unlock_zpt_status` | `bl` / `<B/L>` | B/L |
| `desbloqueio_ce_aviso_nao_enviado` | `ce_unlock_email_finish` (`314`:302) | Edge `ce-unlock-notify-email` | Aviso esgotou tentativas | Aviso seguinte sai; justificativa | fila de avisos | `customer` / `<cliente>` | Cliente |

#### Importação e infraestrutura

| Tipo | Definição | Dispara | Abre | Fecha | Fonte | Chave | Liga-se a |
|---|---|---|---|---|---|---|---|
| `bl_vehicles_changed_on_reimport` | `import_bl_freight_transactional_legacy_205` (`213`) | Reimportação de B/L | Veículos mudaram | Só justificativa (por desenho) | `vehicles` | `bl` / `<B/L>` | B/L |
| `import_effect_blocked` | `_record_import_effect_blocked_alert` (`025`:157) | Edge `import-effects-runner` | Efeito bloqueado | Desde a `348`, efeito sai de `blocked` | `import_pending_effects.status` | `import_effect` / `<efeito>` | Efeito |
| `import_effects_queue_stalled` | `reconcile_import_effects_queue_alert` (`190`:118) | Job `import-effects-queue-health` (hora em hora) | Pendente vencido há 60 min ou mais | Fila anda | `import_effects_queue_health()` | `import_effect_queue` / `import_pending_effects` | Fila |
| `rotina_http_falhou` | `reconcile_http_job_failures_alert` (`316`:115) | Job `http-job-failures` (15 min) | Na última hora: resposta fora de 2xx, ou 10+ tempos esgotados, ou 30+ na fila | Hora limpa | `net._http_response` (`status_code`, `timed_out`, `created`), `net.http_request_queue` | `cron_http` / `net_http_response` | Rotinas (sem o nome do job) |

### 1.3 Jobs agendados (`pg_cron`)

17 jobs em produção: 13 criados por migration e 4 agendados à mão
([Serviços externos](operations/servicos-externos.md), jobs 23–26). 10 chamam
Edge Function por `ops.dispatch_edge_job` (`165`:56–96), que só enfileira o POST
no `pg_net` e não confere a resposta; 7 são só SQL.

| Job | Agenda | Executa | Heartbeat | O que vigia a falha |
|---|---|---|---|---|
| `alerts-foundation-detectors` | `2-59/15 * * * *` | Edge `alerts-detector` → `run_alert_detectors` | Sim | Sentry (5xx, tags `codigo_erro`/`rpc`), Better Stack, `rotina_http_falhou` |
| `customer-communication-auto-runner` | `4-59/15 * * * *` | Edge do mesmo nome | Sim | idem |
| `demurrage-dunning` | `7 * * * *` | Edge do mesmo nome | Sim | Sentry, Better Stack, `rotina_http_falhou` |
| `portal-daily-digest` | `0 11 * * *` | Edge do mesmo nome | Sim | idem |
| `portal-email-events-runner` | `* * * * *` | Edge do mesmo nome | Sim | idem |
| `import-effects-runner` | `* * * * *` | Edge do mesmo nome | Não | Sentry, `rotina_http_falhou`, `import_effects_queue_stalled` |
| `itau-pix-queue` (manual) | `* * * * *` | Edge `itau-pix` | Não | Só `rotina_http_falhou` (a Edge não usa o helper de Sentry) |
| `ce-unlock-notify-email` (manual) | `*/5 * * * *` | Edge do mesmo nome | Sim | Sentry, Better Stack, `rotina_http_falhou` |
| `ce-unlock-cleanup` (manual) | `0 6 * * *` | Edge do mesmo nome | Não | Só `rotina_http_falhou` (sem Sentry) |
| `recalc-demurrage-ptax` (manual) | `0 17 * * 1-5` | Edge do mesmo nome | Não | Sentry, `demurrage_ptax_recalc_failed`, `rotina_http_falhou` |
| `http-job-failures` | `9-59/15 * * * *` | `reconcile_http_job_failures_alert()` | Não | Nada (S1) |
| `import-effects-queue-health` | `7 * * * *` | `reconcile_import_effects_queue_alert()` | Não | Nada |
| `portal-mark-expired-invites` | `*/15 * * * *` | `portal_mark_expired_invites()` | Não | Nada |
| `billing-release-expiry-review` | `13 3 * * *` | `reevaluate_expired_billing_releases()` | Não | Nada |
| `container-demurrage-status` | `17 3 * * *` | `refresh_containers_demurrage_status()` | Não | Nada |
| `data-retention` | `30 6 * * *` | `run_retention()` | Não | Nada |
| `cleanup-provision-rate-limit` | `30 3 * * *` | `DELETE` em `provision_rate_limit_log` | Não | Nada |

Os jobs só SQL que falham ficam marcados `failed` em `cron.job_run_details` e
nenhum alerta os lê (sugestão S1). O `rotina_http_falhou` enxerga o status real
das chamadas HTTP (lê `net._http_response`, não `cron.job_run_details`), mas
conta também as chamadas disparadas por gatilho (`ops.kick_import_effects_runner`,
`ops.kick_itau_pix_runner`) e não diz qual job falhou.

### 1.4 Sentry (org `fwlog`, projetos `vela` e `portal`)

| Item | Onde | Condição | Tags |
|---|---|---|---|
| Regra "Novo erro em produção — Vela e Portal" (id 6060835) | Sentry | Issue nova ou regressão, `environment = production`, e-mail ao dono | — |
| Regras "Send a notification for high priority issues" (3564292 e 6047806) | Sentry (padrão) | Prioridade alta | — |
| Regra "Send a notification when pull requests are ready" (5711581) | Sentry | — | — |
| Captura de erro de consulta e mutação (aplicação interna) | `src/lib/queryClient.ts`:17–64 → `reportCaughtException` (`telemetry.ts`:304) | Erro do TanStack Query | `modulo`, `tela`, `tarefa`, `categoria_falha`, `diagnostico`, `codigo_erro` |
| Captura no Portal | `src/lib/portalQueryClient.ts`:14–39 | idem | `surface=portal`, `categoria_falha` (**sem** `codigo_erro`) |
| Error boundaries | `ErrorBoundary.tsx`:33–47, `PortalErrorBoundary.tsx`:25–30 | Quebra de renderização | `modulo`, `tela`, `tarefa` |
| Falha best-effort | `reportBestEffortFailure` (`telemetry.ts`:335): `alerts.ts`:640, 658, 810; `billing.ts`:910, 948; `demurrageRates.ts`:119; `demurrageRoe.ts`:131; `operationalEvents.ts`:41 | Alerta de faturamento não gravado/fechado, rótulos, PTAX, cálculo | `context`, `kind=best-effort` |
| Edge Functions (13 das 24) | `_shared/telemetry.ts` + `telemetryContract.ts`:92–130 | Resposta 5xx ou exceção; 2xx com `failed > 0` **não** vai ao Sentry | `function_name`, `status`, `categoria_falha`, `codigo_erro` e `rpc` (só `alerts-detector` e o runner dos Comunicados, `TELEMETRY_RPC_ALLOWLIST`) |

Leitura das regras: a de produção avisa só na primeira ocorrência de um issue
ou na regressão. Uma rotina que falha a cada 15 minutos com o mesmo
fingerprint (`['edge', função, status]`) avisa uma vez; o resto do aviso vem do
Better Stack e do `rotina_http_falhou`. Eventos de `staging` e `preview` não
disparam a regra. O evento da Edge em VELA-24 traz o IP do chamador (o `pg_net`
do Supabase) no campo de usuário, embora o runbook diga que a Edge não manda
usuário; não é dado de Cliente, mas é divergência do contrato de telemetria.

Sem Sentry: `admin-users`, `ce-unlock-cleanup`, `ce-unlock-document-download`,
`ce-unlock-export`, `itau-pix`, `portal-account-suspend`,
`portal-ce-unlock-document`, `portal-dispute-attachment`,
`portal-invite-activate`, `portal-login`, `portal-password-reset`. Nenhum
monitor de cron nem regra de métrica no Sentry.

### 1.5 Better Stack

| Monitor | Origem | Quando avisa |
|---|---|---|
| `https://vela.app.br/` e `https://portalfwlog.com.br/portal/login` | Cadastro no Better Stack ([Serviços externos](operations/servicos-externos.md)) | HTTP check a cada 3 min |
| Heartbeats `alerts-detector`, `demurrage-dunning`, `customer-communication-auto-runner`, `portal-daily-digest`, `ce-unlock-notify-email`, `portal-email-events-runner` | `supabase/functions/_shared/betterStackHeartbeat.ts`:83–113, URL no segredo `BETTERSTACK_HEARTBEAT_*_URL` da Edge | Ping de sucesso com resposta 2xx sem falha contada; `/fail` com resposta fora de 2xx, exceção ou `failed`/`partial`/`releaseFailures` > 0; ausência de ping além da tolerância |
| `backup-r2-diario` | `scripts/backup-r2.mjs`:405–462 (Agendador do Windows) | Falha do backup ou ausência por 1 dia + 6 h |

### 1.6 E-mails e notificações internas

| Canal | Onde | Para quem | Quando |
|---|---|---|---|
| Notificação Interna (sino) | `fanout_alert_item_for_department` | Setor do item e audiência do catálogo | Abertura e reabertura de item |
| Resumo diário do Portal | Edge `portal-daily-digest` (11:00 UTC) | Administrativo e Documentação | Falhas de e-mail do Portal, eventos de provisionamento, convites pendentes, `portal_excecao_critica_fatura` abertos e fechados nas 24 h; nada é enviado com tudo zerado |
| E-mail do Sentry e do Better Stack | Serviços externos | Dono (Sentry); toda a equipe (Better Stack, plano Free) | Regras acima |
| Falha de workflow do GitHub | `local-pg-order.yml` (semanal) | Dono (padrão do GitHub) | Falha da passada em ordem invertida |

## 2. Abertura e fechamento: o que bloqueia

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| A1 | Média | **Uma falha derruba todos os detectores.** `run_alert_detectors` roda os oito detectores numa transação sem isolamento: qualquer `RAISE` devolve 500 e nenhum alerta abre ou fecha naquela rodada. Foi o que aconteceu em VELA-24/25 (`339` tirou a causa, não o acoplamento). Um ETA fora do formato ISO no audit (`get_voyage_first_brazilian_eta` faz `::date`) faria o mesmo com o detector de viagem | `309`:177; `get_voyage_first_brazilian_eta` (`002`:7587) × `customer_communication_safe_timestamptz`, que devolve NULL. Corrigido na `351` (decisão P5), exceto tempo esgotado (`query_canceled`) |
| A2 | Média | **Reconciliação que falha some.** Os gatilhos de reconciliação terminam em `EXCEPTION WHEN OTHERS THEN RAISE WARNING`. Ex.: o audit de CE do B/L gravado sem usuário interno (papel de serviço sem `sub`) chama `get_voyage_first_brazilian_eta`, que exige `is_active_read_user()` e dá 42501; o aviso fica só no log do Postgres. Observado no replay | `341` (`reconcile_voyage_operation_alerts_on_audit`); repro: `WARNING: Reconciliação de alertas de viagem ignorada ... permission denied` |
| A3 | Baixa | **Gatilho sem `alerts.foundation_trigger` quebraria a escrita do Portal.** `portal_invoice_exception_on_close`, `resolve_stale_invoice_on_cancel` e `resolve_stale_invoice_on_reissue` chamam o resolvedor sem ligar o contexto de gatilho; uma escrita do usuário do Portal que os dispare dá 42501 e desfaz a ação. Hoje nenhum caminho do Portal chega lá (a consolidada liga B/Ls por `invoice_receivable_links`, não `invoice_bls`); fica como armadilha | `002`:12316; repro com `invoice_bls` artificial na consolidada: `portal_obsolete_consolidation` → 42501 |
| A4 | Baixa | `trg_reconcile_bl_review_alerts` liga `alerts.foundation_trigger` e retorna antes de desligar: a linha que desliga é inalcançável, e o contexto fica ligado até o fim da transação | `170`:39–72 |
| A5 | Média | "Efeito de importação bloqueado" não fechava (L8) | Corrigido na `348` |
| A6 | Média | Bloqueio de cálculo só fechava no navegador (L5) | Corrigido na `347` |
| A7 | Média | Viagem concluída ou cancelada congelava os alertas (L10) | Corrigido na `346` |
| A8 | Média | Importar/mover/cancelar B/L e vincular manifesto de exportação não reconciliavam (L2, L7) | Corrigido na `346` |
| A9 | Baixa | `portal_excecao_critica_fatura` só abre em fatura avulsa ou divergência entre `customer_billing_access_ready` e `portal_billing_gate`: a emissão comum já é barrada pelo mesmo gate (`enforce_portal_invoice_gate`). Alerta quase morto, contado no resumo diário | `enforce_portal_invoice_gate`, `upsert_portal_invoice_exception` (`002`:22638) |
| A10 | Info | Crons: os segredos são lidos do Vault por nome (`ops.dispatch_edge_job`); cofre vazio vira `WARNING` e nenhuma requisição (ADR 0063). O repositório não mostra job desligado; não foi possível conferir produção | `165`:56–96 |

## 3. Fonte de dados: produtor × consumidor

| # | Severidade | Consumidor (lê) | Produtor (grava) | Efeito | Situação |
|---|---|---|---|---|---|
| D1 | Alta | `reconcile_voyage_operation_alerts` chamava `reconcile_voyage_export_after_atd_alerts` por terminal (`002`:15571), e a função lia o ATD só daquele terminal (`324`:417) | O item é da escala: `voyage_pod_schedule` = `<viagem>::<porto>` (`324`:438) | Com dois terminais, um com ATD e outro sem, abre e fecha na mesma rodada; uma Notificação Interna por rodada (repro: `opened,resolved,opened,resolved`, 1 notificação por rodada por usuário de Operações) | Corrigido na `346` |
| D2 | Média | `reconcile_client_portal_alerts`: `b.financial_status IS DISTINCT FROM 'cancelled'` (`324`:806); console `has_active_process` (`324`:1024) | `cancel_bl` grava `cancelled_at`, `cancelled_by`, `cancel_reason` (`179`:1623); nenhuma função grava `financial_status = 'cancelled'` | Pendências do Portal abertas para Cliente sem B/L vivo; console diz "processo ativo". O módulo do Portal já dizia "B/L não cancelado" | Corrigido na `347` |
| D3 | Média | Painel de `/taxas-locais` e Validação: `listFinancialAlerts` busca `invoice`, `bl`, `pix_transaction`, `exchange_rate_reference` e exige a unidade de `FINANCIAL_ALERT_EVENTS` (`alerts.ts`:151–159, 661–682) | `itau_pix_settle` abre `pix_unreconciled` com `itau_pix_receipt` / `<end_to_end_id>` (`153`:266) | Pix recebido pelo Itaú sem baixa não aparece no painel financeiro; a fila `/alertas` mostra, sem rótulo de registro | Corrigido na PR do frontend |
| D4 | Média | `reconcile_voyage_bl_expected_alerts`: `upper(btrim(b.pod)) = ep.pod` e `b.pol` (`324`:278, 286, 296), sem filtro de cancelado | B/L e escala com o mesmo porto em formas diferentes (`normalize_port_code`, BRVIT → BRVIX); o "CE pendente" normaliza (`324`:352) e exclui `cancelled_at` | "B/Ls esperados" aberto com B/L importado, ou fechado por B/L cancelado | Corrigido na `346` |
| D5 | Média | `reconcile_voyage_schedule_date_alerts` resolvia a exportação com `voyage_escala_terminal` = `<viagem>::<porto>::<terminal>` (`324`:534) | Exportação grava `voyage_pod_schedule` = `<viagem>::<porto>` (`324`:438) | Escala excluída/omitida não fechava a exportação | Corrigido na `346` (L6) |
| D6 | Baixa | `terminal_etb::date` etc. (`324`:566) no fuso da sessão (UTC); `v_today` em `America/Sao_Paulo` | A tela grava o horário com `-03:00` (`combineBrasiliaDateTime`, `src/lib/utils.ts`:111) | Mensagem com o dia errado depois das 21:00; "passou" atrasado em até 3 h | Corrigido na `346` |
| D7 | Baixa | `portal_invoice_exception_on_close` fecha em `paid`, `partially_paid`, `cancelled`, `obsolete` (`002`:12323) | Pagamento da consolidada põe a individual em `covered` (`247`:759) | Exceção crítica ficaria aberta numa fatura coberta. Caminho improvável (A9) | Não corrigido; registrar se A9 for mantido |
| D8 | Baixa | Exportação: `granite_manifests`/`vazios_manifests` por `voyage_id` (`346`) | Manifesto de Vazios não guarda porto | Numa viagem com exportação em dois portos, o manifesto de um fecha o do outro | `ponytail:` na `346`; upgrade: porto de `vazios_bookings` e `granite_manifests.loading_port` |
| D9 | Baixa | `get_voyage_first_brazilian_eta`: `NULLIF(btrim(new_value), '')::date` | Tela grava `AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM:00` (local); testes gravam `...Z` | Com `Z`, o dia é o UTC; valor fora do ISO derruba a rodada (A1). Comunicados usam o parser seguro | Recomendação: usar o parser dos Comunicados também nos prazos D-7/D-5 |
| D10 | Info | Entidades sem rótulo em `ENTITY_TYPE_LABELS`: `itau_pix_receipt`, `business_holidays` | `153`:266, `219` | Registro sem nome na fila | Corrigido na PR do frontend |
| D11 | Info | Valores conferidos sem divergência: `baplie_containers.status` (`full`/`empty`), `*_attempts.status = 'aceito'`, `dispatch_mode = 'real'`, `portal_suppressed_emails.reason`, `customer_portal_accounts.account_situation`, `invoices.status`, `voyages.status`, entidade `customer` do bounce (SQL e Edge iguais), `pix_transaction` do extrato | — | — | — |

O singular `voyage` no audit do Baplie (`121`:133) e do Manifesto Mercante
(`212`:398) continua; desde a `341` nenhum alerta depende dele.

## 4. Matriz evento × alerta

"Hoje" é a `staging` antes desta revisão; "Depois" é com as PRs `346`–`353` e
a do frontend. As três decisões do Lucca estão nas linhas marcadas.

| Evento | Alertas afetados | Hoje | Deveria | Depois |
|---|---|---|---|---|
| Importar Baplie 1.5 ou 2.2 (também reimportar) | Baplie ausente, Cobertura | Fecha na hora (`341`); cobertura reconcilia | **Decisão 3:** fecha na importação | Igual (sem mudança) |
| Importar B/L | B/Ls esperados, CE pendente, Cobertura, Revisão, `cliente_sem_contato_principal`, veículos | Cobertura e Revisão na hora; B/Ls esperados e CE só pelo detector, e só em viagem ativa | Todos na hora | Todos na hora (fim da importação) |
| Editar B/L (viagem, POL, POD) | idem | Só cobertura | idem | idem (gatilho de `bls`) |
| Editar B/L (Cliente, consignatário, modalidade, peso) | Revisão | Na hora | Na hora | Igual |
| Excluir B/L | Revisão, Cobertura, B/Ls esperados, alertas do B/L | Alertas do B/L ficam órfãos | Saem junto | Saem junto; B/Ls esperados reconcilia |
| Cancelar B/L | Revisão, B/Ls esperados, CE, faturamento, Portal | Revisão fecha; faturamento e Portal ficam; B/Ls esperados conta o cancelado | Fecham | Fecham |
| Vincular Cliente | Revisão, `portal_pendencia_geral`, recebível, B/L sem Cliente perto do ETA | Revisão na hora; recebível na hora (`342`); pendência do Portal no detector (até 15 min) | Na hora | Revisão e recebível iguais; pendência do Portal na hora (`350`); B/L sem Cliente perto do ETA fecha na hora (`352`) |
| Desvincular Cliente | Revisão | Na hora | Na hora | Igual |
| Criar viagem | — | Nada até o ETA | — | Igual |
| Editar viagem (primeiro ETA indicado) | Prazos D-7/D-5 | Audit `voyages` reconcilia tudo | Igual | Igual |
| Cancelar viagem | Todos da viagem | Uma reconciliação sem olhar o status; depois congelados | Fecham | Fecham na hora; detector varre |
| Excluir viagem | Todos da viagem | Apagados (`341`) | Apagados | Igual |
| Criar escala, mudar ETA | Prazos, data da escala | Na hora (`341`) | Na hora | Igual |
| ETA da escala a 5 dias com B/L sem Cliente | B/L sem Cliente perto do ETA (novo) | Não existia (`review_customer_unlinked` não olha o prazo) | Decisão P4: 5 dias | Abre no detector quando o prazo chega e na hora se o B/L entra já no prazo; fecha no vínculo, cancelamento, exclusão ou ETA adiado (`352`) |
| Mudar ETD do POL | B/Ls esperados | Na hora pela cadeia da `341` (a leitura inicial desta revisão dizia "só detector"; a frente da `353` conferiu) | Na hora | Igual; caso de teste na `353` |
| Excluir ou omitir escala | Data da escala, terminal, exportação | Exportação ficava | Fecham | Fecham |
| ETB/ATB/ETD/ATD do terminal | Data do terminal, exportação, ADR | Exportação piscava com dois terminais | Estável | Estável; dia de Brasília |
| Última ATD (viagem concluída) | Exportação, CE pendente | Congelados | Reavaliados | Detector reavalia os abertos |
| Vincular manifesto de Granito/Vazios | Exportação | Só detector, e só na viagem ativa | Na hora | Na hora |
| Calcular taxas | Bloqueio de cálculo | Navegador abre e fecha | Servidor confirma a origem | Igual; servidor fecha ao faturar ou cancelar |
| Faturar (tela ou CE) | Bloqueio de cálculo, falha de emissão, tabela faltando, exceção do Portal | Falha de emissão e tabela fecham; bloqueio de cálculo fica quando a emissão é pelo CE | Fecham | Fecham |
| Consolidada do Portal (criar, pagar, desfazer) | Exceção crítica de fatura | Nenhum alerta; fatura coberta não fecha exceção (D7) | — | Igual |
| Cancelar ou corrigir fatura | Fatura desatualizada, restituição, exceção do Portal | Fecham pela origem | Fecham | Igual |
| Pagar o B/L (baixa) | Pendências do Portal | Nada muda: B/L pago contava como processo ativo | Decisão P3: B/L pago sem Demurrage em aberto não conta | Fecham na hora; B/L novo reabre (`350`) |
| **Decisão 2:** B/L não faturado no saldo | — | `344` (estudo) | Fora do saldo | Igual; sugestão S5 |
| Pix Itaú: pagamento sem baixa | `pix_unreconciled` (`itau_pix_receipt`) | Abre; fora do painel financeiro | Visível no painel | Visível |
| Pix Itaú: expiração e renovação | PTAX das 14h, calendário | `itau_pix_maintain` | Igual | Igual |
| Extrato Pix | `pix_unreconciled` (`pix_transaction`) | Abre e fecha | Igual | Igual |
| Comunicado CE e Taxas | Reenvio pendente, recusado | Fecham pela origem; a justificativa prometida era recusada | Igual | Igual; `comunicado_recusado` aceita justificativa e, justificado, só reabre quando outro Comunicado falha (`349`, decisão P2) |
| NOA (`aviso_chegada_noa`) e ETA alterado | NOA, NOR e NOB pendentes | Detector recalcula a cada 15 min; NOA já enviado não é reavaliado com o ETA novo | Fecha no fato | Fecham na entrega a todos os destinatários e na mudança da escala (`353`); a janela que vence sem gravação continua no detector; S6 continua sugestão |
| Desbloqueio de CE | CE trocado com desbloqueio, aviso não enviado | Fecham pela origem ou justificativa | Igual | Igual |
| Portal: cadastro, convite, ativação | Pendências do Portal, Revisão do Portal | Gatilho da conta e detector | Na hora | Na hora, por Cliente (`350`); B/L cancelado (`347`) e B/L pago sem Demurrage em aberto (`350`, decisão P3) não contam |
| **Decisão 1:** conta ativa nunca volta para análise | Revisão do Portal | `343` (estudo); `review_portal_not_ready` usa `customer_billing_access_ready` | Igual | Igual; `portal_pendencia_geral` ainda abre para conta ativa com e-mail de recuperação suprimido, que é outro fato |
| Portal: pedidos (Desbloqueio de CE pelo Portal) | Aviso não enviado | Pela fila de avisos | Igual | Igual |
| Demurrage: datas alteradas | Datas alteradas | Ramo "cancelada e reemitida" não fecha | Decisão P1: fecha se a reemissão cobriu tudo | Não fica aberto quando a reemissão cobre todas as caixas; com caixa sem cobrança, fecha quando ela é cobrada; justificativa aceita (`349`) |
| Demurrage: régua e disputa | Cobrança recusada, disputa | Fecham pela origem | Igual | Igual |
| Efeito de importação bloqueado e reaberto | Efeito bloqueado | Nunca fechava | Fecha ao reabrir | Fecha |

## 5. Fluidez do código

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| F1 | Alta | Alerta que pisca (D1): abre e fecha na mesma rodada e notifica a cada 15 min | Corrigido na `346` |
| F2 | Baixa | Corrida detector × importação: o detector lê o estado antes do `COMMIT` da importação e, se o `upsert` esperar a trava do item, reabre com o veredito velho; a próxima rodada fecha (até 15 min e uma notificação a mais). `resolve_alert_item` não pega a trava consultiva que o `upsert` pega | `002`:17108 × `upsert_alert_item_before_milestone_hardening` |
| F3 | Baixa | Detectores varrem todos os Clientes a cada rodada (`detect_customer_communication_alerts` e `reconcile_client_portal_alerts` chamam `resolve_alert_item` por Cliente); custo cresce com a base | `315`:554, `347` |
| F4 | Baixa | `portal_mark_expired_invites` (`002`:13068) ainda insere linha legada em `alerts`, convertida em item por `route_catalog_alert_insert` e fechada; o `NOT EXISTS` que deduplica nunca casa (a legada nasce fechada) e acumula uma linha fechada por convite | `002`:13068 |
| F5 | Baixa | Caminhos sem chamador: `close_legacy_agency_report_alerts_for_scale`, `detect_agency_report_department_pending`, `reconcile_bl_review_alerts_item`, `evaluate_and_dispatch_automatic_communications_045`, `find_due_customer_communication_automations`, `reconcile_granite_bl_review_alerts` (dois), `detect_granite_bl_review_pendencies` (devolve 0), `resolve_invoice_alerts_on_status_change` (tipos inativos), o ramo dinâmico de `block521_resolve_alert`, onze `portal_*_legacy` | `pg_proc` × chamadas em SQL, `src/`, `supabase/functions/` e gatilhos |
| F6 | Média | Suítes local-pg que reaplicam migration antiga (`alertasSemRepetirRegistro` com a `324`; `granitoSemCliente` com `325`/`329`/`330`; `vaziosLocalServicoInativo` com a `331`; `conditionUsd` com a `172`) devolvem definições antigas para as suítes seguintes. A da `324` quebrava a `346` (sobrecarga a mais e funções da `324`) | Corrigido para a `324` nas PRs `346` e `347` (guarda e restaura); as outras ficam como recomendação |
| F7a | Média | O padrão de VELA-24/25 também está na reescrita de dados da `324`: `LEFT JOIN customer_portal_accounts pa ON a.entity_id ~ '^[0-9]+$' AND pa.customer_id = a.entity_id::bigint` (`324`:1182). Num hash ou merge join o cast roda antes do filtro e um alerta com chave em texto derruba o `UPDATE`. Em produção a `324` já rodou; no CI da #1007 a reaplicação pela suíte falhou com o Pix Itaú `E151SEMATOR`. Reproduzido com `enable_nestloop = off` | A suíte reaplica com hash e merge desligados (PRs `346` e `347`). Regra para SQL novo: guardar o cast com `CASE WHEN ... ~ '^[0-9]+$' THEN ...::bigint END` ou comparar como texto, nunca confiar na ordem dos filtros |
| F7 | Baixa | `alertasDaViagem.local-pg.test.ts` tem um `console.log` de depuração no caso "Obs. 2" | linha 139 |
| F8 | Info | Exclusão apaga o histórico do alerta (viagem na `341`, B/L na `347`); a trilha fica só no audit da exclusão. Coerente com a decisão da `341` | — |
| F9 | Info | Idempotência: abrir é idempotente pela unicidade; fechar sem item é no-op. Alertas abertos por gatilho e detector ao mesmo tempo convergem | — |
| F10 | Info | Exclusão de Cliente não leva os alertas, mas não acontece: com CNPJ obrigatório, `delete_records('customer')` sempre recusa | `delete_records` |

## 6. Consultas de consistência

Arquivo: [`supabase/scripts/consistencia_alertas.sql`](../supabase/scripts/consistencia_alertas.sql).
Abre transação `READ ONLY`, termina em `ROLLBACK` e não lê segredo. As
verificações 01–18 comparam alertas ativos com o estado das entidades; 19–21
leem `net._http_response`, `cron.job_run_details` e `cron.job`, que só existem
no Supabase.

| # | Verifica |
|---|---|
| 01–04 | Alerta de viagem/escala, B/L, Cliente, fatura ou Invoice sem o registro |
| 05 | "Baplie ausente" com Baplie importado |
| 06 / 06b | Alerta aberto de viagem cancelada; de viagem concluída |
| 07 | "B/Ls esperados" com todos os PODs cobertos por B/L vivo |
| 08 | "CE pendente" sem B/L vivo sem CE |
| 09–10 | Exportação pós-ATD sem exportação/ATD, ou com o manifesto já vinculado |
| 11 | Alerta de faturamento de B/L faturado, pago ou cancelado |
| 12 | Pendência do Portal para Cliente sem B/L vivo |
| 13 | Exceção crítica de fatura com a fatura paga, coberta ou cancelada |
| 14 | Efeito bloqueado que já não está bloqueado |
| 15 | "B/L sem Cliente" sem B/L pendente do consignatário |
| 16 | Agregado aberto sem item ativo, ou fechado com item ativo |
| 17 | Item ativo de tipo desativado |
| 18 | Item que abriu mais de 3 vezes em 24 h (pisca) |
| 19 | Respostas HTTP fora de 2xx do `pg_net` nas últimas 24 h |
| 20 | Execuções `failed` no `pg_cron` nas últimas 24 h |
| 21 | Última execução de cada job |

**Resultado no Postgres local.** Replay da `staging` (342 migrations, sem
dados): as 18 verificações devolvem 0. Depois, os cenários dos bugs desta
revisão gravados no mesmo banco (Cliente só com B/L cancelado, B/L faturado
pelo servidor com bloqueio de cálculo aberto, B/L excluído com alerta, escala
com dois terminais reconciliada quatro vezes, viagem cancelada com alertas,
efeito bloqueado reaberto):

| Verificação | Antes (`staging`) | Depois (346–348 aplicadas e uma rodada do detector) |
|---|---|---|
| 02 alerta de B/L sem o B/L | 1 | 0 (acerto da `347`) |
| 06 alerta aberto de viagem cancelada | 3 | 0 (varredura do detector, `346`) |
| 11 alerta de faturamento de B/L faturado ou cancelado | 1 | 0 (acerto da `347`) |
| 12 pendência do Portal para Cliente sem B/L vivo | 1 | 0 (detector com a `347`) |
| 14 efeito bloqueado que já não está bloqueado | 1 | 0 (acerto da `348`) |
| 18 item que abriu mais de 3 vezes em 24 h | 1 | 1: as quatro aberturas de antes continuam na janela; o item agora fica aberto e não reabre |
| demais | 0 | 0 |

A leitura em staging e produção é o que vale; as verificações 02, 05, 06, 06b,
09, 11, 12, 14 e 18 são as que mostram os bugs desta revisão. A bateria
local-pg deixa resíduo que também aparece nelas (fixtures apagadas com
`session_replication_role = replica`, sem gatilho): rodar o script depois da
bateria mostra órfãos que não vêm da aplicação.

## 7. Sugestões de alertas novos

Depois das decisões do Lucca, S7 virou a migration `352` (5 dias) e S12 a `351`;
as demais continuam sugestões.

| # | Alerta | Abre | Fecha | Fonte | Severidade | Canal |
|---|---|---|---|---|---|---|
| S1 | Job SQL falhou | `cron.job_run_details.status = 'failed'` na última hora, para os 7 jobs só SQL | Hora limpa | `cron.job_run_details` (estender `reconcile_http_job_failures_alert`) | Crítico | Alerta interno (Administrativo) |
| S2 | Rotina HTTP falhou, com o nome | Igual ao `rotina_http_falhou`, mas casando `net._http_response.id` com o `request_id` devolvido por `ops.dispatch_edge_job` (gravar o id e o job numa tabela de despachos) | Igual | `net._http_response` + tabela de despachos | Crítico | Alerta interno |
| S3 | Heartbeat das rotinas sem ping | `itau-pix-queue`, `import-effects-runner`, `recalc-demurrage-ptax`, `ce-unlock-cleanup` e `http-job-failures` sem execução bem-sucedida no período | Ping | Better Stack (heartbeat no helper ou SQL via `pg_net`) | Alta | Better Stack |
| S4 | Comunicado elegível que não saiu | Alvo de `customer_communication_automation_targets` sem tentativa `aceito` depois de N rodadas do runner | Envio ou alvo some | Alvos + `customer_communication_attempts` | Normal | Alerta interno (Documentação) |
| S5 | Fatura emitida sem recebível | `invoices.status` emitida sem `invoice_receivable_links` ativo (consolidada) ou sem `bl_receivables` vivo do B/L | Vínculo criado | `invoices`, `bl_receivables`, `invoice_receivable_links` | Crítico | Alerta interno (Administrativo) |
| S6 | ETA mudou depois do NOA | NOA enviado com ETA diferente do ETA atual da escala além de X horas | Novo NOA ou confirmação | `customer_communications` (marco gravado) × `customer_communication_scale_schedules` | Normal | Alerta interno (Documentação) |
| S7 | B/L sem Cliente perto do ETA | B/L vivo sem Cliente há mais de X horas e ETA em menos de Y dias (o `review_customer_unlinked` não olha o prazo) | Vínculo | `bls`, ETA do audit | Crítico | Alerta interno (Documentação). Feito na `352`: 5 dias, sem prazo em horas, um alerta por escala |
| S8 | Conta do Portal inconsistente | `account_situation = 'ativo'` sem `auth_user_id`, ou `active = false` com situação ativa, ou convite pendente vencido sem marca | Conta corrigida | `customer_portal_accounts`, `portal_invites` | Normal | Alerta interno |
| S9 | Pix pago e não conciliado há mais de 1 dia | `itau_pix_receipts` ou exceção do extrato ativos há mais de 24 h | Baixa ou tratamento | `itau_pix_receipts`, `pix_reconciliation_exceptions` | Crítico | Alerta interno + Sentry (mensagem) |
| S10 | Fila de e-mail parada | `portal_email_events` em `pending`/`retry_wait` com `next_attempt_at` vencido há mais de 30 min, ou tentativas `aceito` sem evento (já coberto em parte por `email_retorno_provedor_silencioso`) | Fila anda | `portal_email_events` | Crítico | Alerta interno + Better Stack (o heartbeat do runner já existe) |
| S11 | Alerta órfão | Verificações 01–04 do script | Registro volta ou alerta sai | Script de consistência | Normal | Alerta interno (Administrativo), rodada diária |
| S12 | Detector parcial | Isolar cada detector em `run_alert_detectors` e devolver `failed > 0` quando um quebrar; o heartbeat já manda `/fail` | Rodada limpa | `run_alert_detectors` | Alta | Better Stack + Sentry (mensagem com o detector). Feito na `351` |

## Decisões

As perguntas abaixo ficaram abertas na primeira entrega e foram respondidas
pelo Lucca no mesmo dia (2026-10-21). A coluna "Decisão" registra a resposta e
onde ela foi implementada.

| # | Pergunta | Caso | Opções | Recomendação | Decisão |
|---|---|---|---|---|---|
| P1 | Como fecha "Datas mudaram em Invoice de Demurrage" no ramo sem pagamento, em que a Invoice é cancelada e reemitida? | O alerta fica na Invoice cancelada; nada o fecha, e a justificativa não aceita o tipo (L9) | (a) incluir o tipo em `_alert_types_resolved_with_justification()`; (b) fechar quando a Invoice de origem é cancelada e outra viva cobre os containers | (b), com (a) para os ramos com pagamento | Fecha quando a reemissão cobriu todas as caixas; com caixa sem cobrança, fica até ela ser cobrada ou até a justificativa. B/L ou viagem cancelados (só cancela, nada a cobrar) contam como "cobriu tudo" — ponto para conferir. `349`, [#1013](https://github.com/luccafwlog/vela/pull/1013) |
| P2 | `comunicado_recusado` e `demurrage_invoice_dates_changed` devem aceitar "Resolver com justificativa", como o manual promete? | `alertRulesCatalog.ts` promete; a RPC recusa (L11) | Alinhar o código ou o texto | Alinhar o texto para `comunicado_recusado` (tem fato de origem) e decidir o outro em P1 | Aceitar a justificativa nos dois tipos; `comunicado_recusado` justificado só reabre quando outro Comunicado falha. `349`, [#1013](https://github.com/luccafwlog/vela/pull/1013) |
| P3 | B/L pago é "processo ativo" do Portal? | A `347` tirou só o cancelado. Cliente com todos os B/Ls pagos ainda tem pendência do Portal | (a) manter; (b) só B/L não pago ou com Demurrage aberta | Decisão de produto; (b) parece o pretendido | (b): B/L pago deixa de contar, salvo com Invoice de Demurrage emitida ou vencida; B/L novo reabre. `350`, [#1015](https://github.com/luccafwlog/vela/pull/1015) |
| P4 | Quanto tempo e quão perto do ETA para avisar B/L sem Cliente (S7)? | — | X horas, Y dias | — | 5 dias antes do ETA, sem prazo em horas; crítico, Documentação, um alerta por escala. `352`, [#1014](https://github.com/luccafwlog/vela/pull/1014) |
| P5 | Isolar os detectores (A1, S12)? | VELA-24/25 derrubaram todos os alertas por causa de um | (a) manter a transação única; (b) savepoint por detector e `failed` no retorno | (b) | (b). `351`, [#1012](https://github.com/luccafwlog/vela/pull/1012) |

**Fechar junto com o fato.** Na resposta à P5 o Lucca pediu que o alerta feche
no momento em que o fato que o resolve acontece. A rodada de 15 minutos continua
para abrir alertas de prazo (nenhum evento acontece quando o tempo passa) e como
rede de segurança. Passaram a fechar na hora: os quatro alertas do Portal
(`350`); NOA, NOR e NOB pendentes, `usuario_email_devolvido` e
`email_retorno_provedor_silencioso` (`353`). "B/Ls esperados" no ETD do porto de
origem já fechava na hora pela cadeia da `341`. Ficam no detector: a janela do
Comunicado que vence sem gravação, B/L cancelado ou sem Cliente e Cliente
desativado nos Comunicados, e o e-mail de usuário trocado fora da Edge
`admin-users` (o repositório não tem gatilho no schema `auth`).

## PRs e ordem de merge

As PRs abrem contra `staging`; nenhuma foi mergeada. Merge na ordem numérica
das migrations.

| Ordem | PR | Branch | Migração |
|---|---|---|---|
| 1 | [#1007](https://github.com/luccafwlog/vela/pull/1007) Alertas de viagem e escala | `claude/alertas-viagem-escala` | `346` |
| 2 | [#1008](https://github.com/luccafwlog/vela/pull/1008) Alertas do B/L cancelado, faturado ou excluído | `claude/alertas-bl-cancelado-excluido` | `347` |
| 3 | [#1009](https://github.com/luccafwlog/vela/pull/1009) Efeito de importação bloqueado | `claude/alertas-efeito-importacao` | `348` |
| 4 | [#1010](https://github.com/luccafwlog/vela/pull/1010) Pix Itaú no painel financeiro | `claude/alertas-pix-itau-painel` | — |
| 5 | [#1011](https://github.com/luccafwlog/vela/pull/1011) Este relatório | `claude/stoic-shannon-zosm6m` | — |
| 6 | [#1013](https://github.com/luccafwlog/vela/pull/1013) Datas da Demurrage e Comunicado recusado | `claude/alertas-demurrage-e-justificativa` | `349` |
| 7 | [#1015](https://github.com/luccafwlog/vela/pull/1015) Portal segue o processo ativo e fecha na hora | `claude/alertas-portal-processo-ativo` | `350` |
| 8 | [#1012](https://github.com/luccafwlog/vela/pull/1012) Detector que quebra não para os outros | `claude/alertas-detectores-isolados` | `351` |
| 9 | [#1014](https://github.com/luccafwlog/vela/pull/1014) B/L sem Cliente perto do ETA | `claude/alertas-bl-sem-cliente-eta` | `352` |
| 10 | [#1016](https://github.com/luccafwlog/vela/pull/1016) Alertas fecham na hora do fato | `claude/alertas-fecham-na-hora` | `353` |

A #1010 e este relatório podem entrar em qualquer ponto; as demais seguem a
numeração das migrations. As PRs 1, 2 e 7 trazem a mesma correção em
`src/integration/alertasSemRepetirRegistro.local-pg.test.ts` (linhas idênticas)
e não conflitam entre si. A #1015 (`350`) inclui a branch da #1008 (`347`):
reescreve o mesmo trecho de `docs/modules/portal-cliente.md` e só pode ser
aplicada depois dela; até o merge da #1008, o diff da #1015 mostra também a
`347`.

**Conferência da combinação.** As dez branches, mergeadas nessa ordem sobre a
`staging` num worktree local, entram sem conflito, e as migrations `346` a `353`
aplicam em sequência num banco limpo. A combinação já pegou uma
interação: com a `350`, o B/L vivo abre a pendência do Portal na hora, e a
suíte da `347` esperava que ela nunca tivesse existido; a asserção passou a
ser "não ativa" na #1015.

## O que não foi verificado

- **Produção e staging.** Nenhuma consulta foi feita nos bancos remotos: o
  número de alertas abertos, os jobs ativos e o status real das chamadas HTTP
  não foram vistos. As consultas da seção 6 são para isso.
- **Better Stack.** Monitores e heartbeats vêm do código e do manual de
  serviços externos; o painel não foi aberto.
- **Edge Functions em execução.** Nenhuma foi chamada; o comportamento delas
  vem da leitura do código.
- **Importação de B/L de ponta a ponta.** O fim da importação reconciliando
  "B/Ls esperados" e "CE pendente" está provado por texto da função
  (`pg_get_functiondef`) e pelo adiamento dos gatilhos; a importação completa
  não foi exercitada no teste da `346`.
- **Desempenho.** Os gatilhos novos em `bls` (`346`, `347`, `350` e `352`)
  reconciliam viagem, Cliente ou escala a cada instrução fora da importação;
  não foi medido em volume. O passo novo do detector (`352`) também não.
- **Rodada parcial do detector (`351`).** A Edge `alerts-detector` não foi
  executada contra o Better Stack e o Sentry reais; o `deno check` dela não
  terminou localmente e o CI não checa essa função.
- **Primeira rodada da `352`.** Como ETA já passado conta, escalas antigas
  que ainda tenham B/L sem Cliente abrem o alerta na primeira rodada depois do
  deploy. O número não foi visto (produção não consultada).
