# Estudo do fechamento automático dos alertas — 2026-10-20

Estudo feito em 2026-10-20 no branch `claude/lucid-clarke-5uqfs2`, checkout
`9bb090c` (com a migration `341` já commitada em `cd38189`). É registro
histórico: descreve, tipo a tipo, o que abre e o que fecha cada alerta do
catálogo `alert_type_catalog` naquele checkout, e lista os eventos que mudam a
condição de origem de um alerta sem chamar a reconciliação dele. A regra viva
do ciclo de vida continua em
[Operação e Suporte § Alertas e Notificações Internas](../../modules/operacao-suporte.md#alertas-e-notificações-internas).

## Resultado em uma frase

Dos 52 tipos do catálogo, 47 estão ativos. Quase todos fecham pela origem,
mas os alertas de viagem do prazo D-7/D-5 (`voyage_bl_expected`,
`voyage_baplie_missing`, `voyage_ce_mercante_missing`) e o
`voyage_export_after_atd` só são reconciliados por três caminhos (o detector de
15 minutos, o audit da tabela `voyages` e a mudança de atracação). Importações e
edições que mudam a origem deles (B/L, CE Mercante, ETA da escala, Granito,
Embarque de Vazios) não chamam a reconciliação. Na viagem ativa isso atrasa o
fechamento em até 15 minutos. Na viagem concluída ou cancelada, que o detector
não varre, o alerta fica aberto até alguém mexer na viagem ou nas atracações.
Há ainda dois tipos sem fechamento nenhum (`import_effect_blocked` e o ramo
"cancelada e reemitida" de `demurrage_invoice_dates_changed`) e um resolvedor
com a entidade trocada (`voyage_export_after_atd`).

## Método e evidência

| Etapa | O que foi feito |
|---|---|
| Catálogo | Última inserção de cada tipo na cadeia ativa `supabase/migrations/` (seed de `002`, linhas 31294–31323, e inserções das migrations `008`, `024`, `026`, `124`, `128`, `153`, `175`, `177`, `178`, `179`, `181`, `204`, `243`, `297`, `305`, `307`, `309` e `310`; desativações em `085` e `325`). `supabase/migrations_archive/` foi ignorada |
| Produtor e resolvedor | Para cada tipo, as funções que citam o literal do tipo, com a última definição (arquivo de número mais alto) de cada uma. O sufixo `_legacy_NNN` foi seguido até o corpo efetivo (por exemplo, a migration `189` renomeia por `ALTER FUNCTION ... RENAME`, sem `CREATE`) |
| Chamadores | Para cada `reconcile_*`, todos os `PERFORM` na cadeia ativa, nos serviços de `src/` e nas Edge Functions |
| Lacunas | Para cada escrita que muda a origem de um alerta: confere se a escrita chama a reconciliação, se o audit dela tem um `entity_type` que algum gatilho de `audit_logs` aceita, ou se só o detector a alcança |

**Evidência:** Código (leitura estática das migrations ativas, de `src/` e de
`supabase/functions/`). Nenhuma afirmação deste estudo foi reproduzida em
Postgres; a exceção é o que o teste
`src/integration/alertasDaViagem.local-pg.test.ts` (migration `341`) cobre, que
existe mas não foi executado neste estudo. Os itens marcados **Suspeita**
precisam de reprodução antes de virar correção.

## Mecanismos de fechamento

| Mecanismo | Onde | Alcance |
|---|---|---|
| `resolve_alert_item(tipo, entidade, id, origem, metadados)` | `002` (linha 17108) | Primitiva: marca o item `resolved`, grava o evento e chama `refresh_alert_aggregate`. Todo resolvedor automático passa por ela ou por `resolve_alert_item_for_department` (`002`, linha 17152) |
| Detector periódico | Edge Function `alerts-detector` → `run_alert_detectors` (`309`, linha 177); job `alerts-foundation-detectors` a cada 15 min (`003`/`005`) | Revisão de B/L, ADR, viagens (`detect_voyage_operation_alerts`, `002` linha 6395, só `voyages.status = 'active'`), Portal (`reconcile_client_portal_alerts`), Comunicados e e-mails. Depende do cron, do segredo `ALERTS_DETECTOR_SECRET` e de haver usuário interno ativo |
| Gatilhos em `audit_logs` | `reconcile_voyage_operation_alerts_on_audit` (`341`, linha 168) e `reconcile_agency_report_alerts_on_audit` (`002`, linha 14359) | Só reagem a `entity_type` `voyage_pod_schedule`, `voyage_pol_schedule` e `voyages` (viagem) ou às escalas e sign-offs (ADR) |
| Gatilhos de tabela | `voyage_escala_terminal_state`, `baplie_containers`, `bls`, `bl_containers`, `invoices`, `customer_contacts`, `customer_portal_accounts`, `demurrage_invoices`, `customer_communications`, `ce_unlock_zpt_status` | Cada um cobre o tipo indicado na tabela abaixo |
| Jobs próprios | `import-effects-queue-health` (hora em hora, `178`), `http-job-failures` (15 min, `310`), `itau_pix_maintain` (`219`), `portal-mark-expired-invites` (`003`) | Tipos de infraestrutura e Portal |
| Navegador | `src/services/reviewBillingAutomation.ts` → `createAlert`/`resolveAlertItem` (`src/services/alerts.ts`) → `upsert_billing_alert`/`resolve_billing_alert` | Só `billing_calculation_blocked` e `billing_auto_issue_failed` |
| Resolver com justificativa | `resolve_alert_item_with_justification` e `_alert_types_resolved_with_justification()` (`316`, linhas 42–67; espelho em `ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION`) | `portal_abuso_login`, `bl_vehicles_changed_on_reimport`, `ce_trocado_com_desbloqueio`, `cobranca_demurrage_recusada`, `desbloqueio_ce_aviso_nao_enviado` e `portal_reprocessamento_falhou` quando a entidade é `portal_email_event` (migration `238` e seguintes) |
| Dispensa | `dismiss_alert_item` | Vale para qualquer tipo; não fecha |

## Tipo a tipo

Legenda da coluna **Manual**: "—" quando o tipo só fecha pela origem (a fila
oferece apenas a dispensa); "Justificativa" quando
`resolve_alert_item_with_justification` aceita o tipo; "RPC própria" quando há
uma ação de tela específica.

### Revisão de B/L

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `review_customer_unlinked` | `reconcile_customer_bl_review_alerts` (`324`:601) chamada pelo gatilho `trg_reconcile_bl_review_alerts` (`170`:38, em `bls`: `review_status`, `customer_id`, `consignee`, `cargo_mode`, `bb_weight_ton`), por `save_bl_review`/`complete_review_customer_group` e pelo detector `detect_bl_review_pendencies` (`002`:5917) | A mesma reconciliação, ao vincular o Cliente, concluir a revisão ou cancelar o B/L (`169`) | — | Nenhuma encontrada |
| `review_customer_email_missing` | Inativo desde `085` (os abertos foram fechados ali) | — | — | — |
| `review_portal_not_ready` | Igual ao anterior, mais `trg_reconcile_bl_review_on_portal_change` (`170`:76, em `customer_portal_accounts` e `customer_contacts`) e a liberação (`083`/`167`) | Portal pronto ou Liberação de faturamento vigente | — | Nenhuma encontrada |
| `review_breakbulk_weight_missing` | Igual ao `review_customer_unlinked` | Peso informado (coluna `bb_weight_ton` no gatilho) | — | Nenhuma encontrada |
| `review_granite_customer_unlinked` | Inativo desde `325` (gatilho removido, abertos fechados) | — | — | — |

### Faturamento de Taxas Locais

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `billing_calculation_blocked` | Navegador: `reviewBillingAutomation.ts` → `upsert_billing_alert` (`002`:22439) | Só o navegador, depois de um faturamento bem-sucedido do mesmo B/L: `resolve_billing_alert` (`238`:74), que confere `_billing_alert_origin_resolved` (`238`:44) | — | **L5**: nenhum gatilho de servidor fecha; B/L faturado pela emissão do CE, cancelado ou excluído deixa o alerta aberto |
| `billing_auto_issue_failed` | Navegador (`upsert_billing_alert`) e `emit_ce_mercante_billing` (`212`:61) | Gatilho `resolve_auto_issue_alert_on_invoiced` (`208`:85; criado em `195`:683 em `bls.financial_status` de `pending` para faturado) e `resolve_billing_alert` | — | **L5**: B/L cancelado ou excluído não fecha |
| `billing_charge_table_missing` | `_write_charge_table_gap` (`208`:26) via `_note_charge_table_gap` (`209`) na emissão pelo CE | `_drop_bls_from_charge_table_gaps` (`209`:210) pelos gatilhos `drop_bl_from_charge_table_gaps` (B/L cancelado, sem CE, outro POD ou modalidade), `drop_voyage_bls_from_charge_table_gaps` (viagem cancelada) e `resolve_auto_issue_alert_on_invoiced` (faturado); lista vazia fecha | — | Cadastrar a tabela não fecha: fecha quando a emissão refeita sai, como o manual diz. Não é lacuna |
| `invoice_overdue` | Inativo (seed de `002`; issue #605) | — | — | — |
| `invoice_payment_invalid` | Inativo; `register_invoice_payment` (`241`:785) hoje só grava audit `system_event` | `resolve_invoice_alerts_on_status_change` (`002`:17540) ainda existe | — | — |
| `invoice_cancel_blocked` | Inativo | `resolve_invoice_alerts_on_status_change` | — | — |
| `fatura_desatualizada` | `alert_stale_invoice_for_bl` (`124`:129), `apply_invoice_basis_changes` (`130`:356), `_try_recreate_consolidated` (`128`) | `resolve_stale_invoice_on_reissue` (`124`:187, gatilho em `invoices.replaces_invoice_id`), `resolve_stale_invoice_on_cancel` (`128`:400), `_close_pending_reissue` (`128`) | RPC própria `resolve_stale_invoice` (`246`:749, avulsa, com justificativa) | Nenhuma encontrada |
| `restituicao_pendente` | `_sync_refund_alert` (`130`:486, gatilho em `invoice_refunds`) | O mesmo gatilho quando não resta restituição pendente | — | Nenhuma encontrada |
| `pix_unreconciled` | `upsert_pix_reconciliation_exceptions` (`247`:972) e `reopen_pix_reconciliation_exception` (`002`) | `resolve_pix_reconciliation_exception` (`269`:26), `itau_pix_settle` (`153`) e `_itau_pix_close_receipt` (`154`) | A conciliação na tela é o fato de origem | Nenhuma encontrada |

### Demurrage

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `demurrage_ptax_recalc_failed` | Edge Function `recalc-demurrage-ptax` (`upsert_alert_item`) e `itau_pix_maintain` (`219`:232) | A próxima execução completa (`resolve_alert_item` na Edge Function e em `itau_pix_maintain`) | — | Nenhuma encontrada (latência do job) |
| `calendario_feriados_pendente` | `itau_pix_maintain` (`219`), a partir de 1º/11 | A rodada seguinte de `itau_pix_maintain` com os feriados do ano seguinte cadastrados | — | Cadastrar o feriado não fecha na hora; fecha na próxima rodada. Latência, não lacuna |
| `demurrage_invoice_dates_changed` | `_reconcile_demurrage_after_dates` (`317`:533) | `resolve_dates_changed_alert_on_restore` (`208`:163, gatilho `208`:181) quando `dunning_suspended_reason` volta a nulo (datas de volta às faturadas) | Nenhum | **L9**: no ramo "sem pagamento: cancelada e reemitida" o alerta fica na Invoice cancelada e nada o fecha; o manual promete "registre a conferência ao resolver o alerta", mas o tipo não está em `_alert_types_resolved_with_justification()` |
| `cobranca_demurrage_recusada` | `settle_demurrage_dunning_claim` (`313`:272) | O mesmo, quando a cobrança sai; `resolve_demurrage_dunning_alert_on_closed_invoice` (`317`:436, Invoice paga, isenta ou cancelada) | Justificativa (retoma a Régua por `resume_demurrage_dunning_on_alert_resolved`, `317`) | Nenhuma encontrada |
| `portal_dispute_opened` | `sync_demurrage_dispute_alert` e `sync_demurrage_dispute_alert_for_invoice` (`002`:21371 e 21411, gatilhos em `demurrage_invoices` e `demurrage_disputes`), mensagens (`081`, `109`) | Os mesmos gatilhos e `resolve_demurrage_alert_on_status_change` (`002`:17521) quando a vez volta ao Cliente ou a disputa fecha | — | Nenhuma encontrada |

### Portal e contatos

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `portal_pendencia_geral` | `reconcile_client_portal_alerts` (`324`:785), pelo detector e pela Edge Function `portal-invite-activate` | A mesma reconciliação | — | Só o detector e a ativação fecham: latência de até 15 min. Não é lacuna |
| `portal_convite_expirado` | `portal_mark_expired_invites` (job do `003`) e `reconcile_client_portal_alerts` | `resolve_portal_alert_items_on_account_change` (`002`:17700, gatilho em `customer_portal_accounts`) e a reconciliação | — | Nenhuma encontrada |
| `portal_falha_envio` | `reconcile_client_portal_alerts` | Idem | — | Nenhuma encontrada |
| `portal_email_suprimido` | `process_portal_email_event` (`109`) e `reconcile_client_portal_alerts` | Idem | — | Nenhuma encontrada |
| `portal_reprocessamento_falhou` | Por B/L: `_reprocess_customer_held_billing` (`085`:520). Por evento de e-mail: `_portal_email_event_investigate_alert` (`309`:343) | Por B/L: o reprocessamento bem-sucedido | Justificativa só quando a entidade é `portal_email_event` (`316`) | Nenhuma encontrada |
| `portal_abuso_login` | `register_portal_login_abuse` (`002`:16366) | Nenhum (conferência sem fato de origem) | Justificativa | Por desenho (ADR 0083, item 23) |
| `portal_excecao_critica_fatura` | `upsert_portal_invoice_exception` (`002`:22638), por gatilho na emissão | `portal_invoice_exception_on_close` (`002`:12316, gatilho `trg_portal_invoice_exception_close` em `invoices.status`) com a fatura paga, parcialmente paga, cancelada ou obsoleta | — | Ativar o Portal depois não fecha; o manual diz que fecha com a fatura. Não é lacuna |
| `cliente_contato_bounced_sem_alternativa` | `detect_customer_communication_alerts` (`315`:554) | `resolve_customer_contact_bounce_alert_on_change` (`002`:17479, gatilho em `customer_contacts.email`) e o detector | — | Nenhuma encontrada |
| `caixa_sem_destinatario` | `_apply_customer_contact_configuration` (`245`:15) e `repair_customer_contact_box_fallbacks` (`010`) | O salvamento dos contatos com destinatário em toda caixa (`245`) | — | Nenhuma encontrada |
| `cliente_sem_contato_principal` | `ensure_customer_contact_email` (`106`:366), na importação do B/L | O salvamento dos contatos (`245`) | — | Nenhuma encontrada |
| `usuario_email_devolvido` | `detect_email_monitoring_alerts` (`319`:16) | O mesmo detector (e-mail trocado, supressão liberada ou usuário inativo) | — | Latência do detector |
| `email_retorno_provedor_silencioso` | `detect_email_monitoring_alerts` (`319`) | O mesmo detector, na rodada depois do primeiro evento do provedor | — | Nenhuma encontrada |

### Viagem e escala

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `voyage_bl_expected` | `reconcile_voyage_bl_expected_alerts` (`324`:213) | A mesma função. Só é chamada por `reconcile_voyage_operation_alerts` (`002`:15535), que roda pelo detector (viagem ativa), pelo audit `voyages` e pela mudança de atracação | — | **L2** (importação de B/L), **L3** (ETA/ETD da escala), **L10** (viagem concluída ou cancelada) |
| `voyage_baplie_missing` | `reconcile_voyage_baplie_missing_alerts` (`324`:39) | A mesma função; desde `341` também a importação do Baplie (`341`:222) | — | **L1** (corrigida na `341`), **L3**, **L10** |
| `voyage_baplie_documentary_coverage` | `reconcile_voyage_baplie_coverage_alerts` (`324`:77) | A importação do Baplie (`121`:145), a do B/L (`175`:1116) e os gatilhos de instrução em `baplie_containers`, `bls` e `bl_containers` (`002`:23393–23457) | — | Nenhuma encontrada; é o modelo para as outras |
| `voyage_ce_mercante_missing` | `reconcile_voyage_ce_mercante_missing_alerts` (`324`:321) | A mesma função, só por `reconcile_voyage_operation_alerts` | — | **L2**, **L3**, **L4** (CE Mercante), **L10** |
| `voyage_schedule_date_pending` | `reconcile_voyage_schedule_date_alerts` (`324`:491) | O audit `voyage_pod_schedule`/`voyage_pol_schedule` (gatilho de `341`:168) e a mudança de atracação | — | **L10** (viagem cancelada) |
| `voyage_terminal_date_pending` | Idem | Idem e `reconcile_voyage_operation_alerts_on_terminal_change` (`002`:15617, gatilho `002`:23473) | — | **L10** |
| `voyage_export_after_atd` | `reconcile_voyage_export_after_atd_alerts` (`324`:417), entidade `voyage_pod_schedule` = `<viagem>::<porto>` | A mesma função, só por `reconcile_voyage_operation_alerts` | — | **L6** (resolvedor com entidade trocada), **L7** (Granito e Embarque de Vazios), **L10** |
| `agency_report_department_pending` | `reconcile_agency_report_alerts` (`290`:18) e `reconcile_agency_report_alerts_for_scale` (`324`:876), por `reconcile_agency_report_alerts_on_audit` (`002`:14359: ATD, omissão, exclusão, sign-offs), `reconcile_agency_report_alerts_on_report_change` (`002`:14444) e pelo detector (`002`:5896) | Os mesmos, com o sign-off do departamento | — | Nenhuma encontrada |
| `agency_report_deadline_missed` | Idem, mais `detect_agency_report_deadline_missed` (`002`:5782) | Idem | — | Nenhuma encontrada |

### Comunicados ao Cliente e Desbloqueio de CE

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `comunicado_noa_pendente` | `detect_customer_communication_alerts` (`315`:554) | O mesmo detector, com o NOA enviado ou a janela vencida | — | Latência do detector |
| `comunicado_nor_pendente` | Idem | Idem (NOR) | — | Latência do detector |
| `comunicado_nob_pendente` | Idem | Idem (NOB) | — | Latência do detector |
| `comunicado_recusado` | `refresh_customer_communication_refusal_alert` (`318`:573), por `evaluate_and_dispatch_automatic_communications` (`314`:186) e `reject_customer_communication_automation_claim` (`297`) | A mesma função (`318`:633) quando nada fica pendente | Nenhum | **L11**: o manual promete "também pode ser encerrado com justificativa", mas o tipo não está na lista da justificativa |
| `nob_sem_destinatario` | `evaluate_and_dispatch_automatic_communications` (`314`) | A rodada seguinte e o salvamento dos contatos (`internal_save_customer_contact_configuration` e `portal_save_contact_configuration`, `267`) | — | Nenhuma encontrada |
| `comunicado_ce_reenvio_pendente` | `_set_bl_ce_mercante` (`230`:44) | `resolve_ce_resend_alert_on_communication_sent` (`238`:95, gatilho em `customer_communications`) | — | Nenhuma encontrada |
| `ce_trocado_com_desbloqueio` | `_set_bl_ce_mercante` (`230`) e `apply_ce_mercante_rows_atomic` (`181`) | `resolve_ce_changed_unlock_alert_on_reconcile` (`238`:135, gatilho em `ce_unlock_zpt_status`) | Justificativa | Por desenho |
| `desbloqueio_ce_aviso_nao_enviado` | `ce_unlock_email_finish` (`314`:302) | A mesma função, quando um aviso seguinte do Cliente sai | Justificativa | Nenhuma encontrada |

### Importação e infraestrutura

| Tipo | Abre | Fecha automaticamente | Manual | Lacuna |
|---|---|---|---|---|
| `bl_vehicles_changed_on_reimport` | `import_bl_freight_transactional_legacy_205` (`213`:984) | Nenhum | Justificativa | Por desenho |
| `import_effect_blocked` | `_record_import_effect_blocked_alert` (`025`:157) | **Nenhum**: o literal só aparece em `025`, `026` e no fechamento único da `325` | Nenhum | **L8** |
| `import_effects_queue_stalled` | `reconcile_import_effects_queue_alert` (`190`:118), job `import-effects-queue-health` (`178`:1055) | O mesmo job, quando a fila anda | — | Nenhuma encontrada |
| `rotina_http_falhou` | `reconcile_http_job_failures_alert` (`316`:115), job `http-job-failures` (`310`:122) | O mesmo job, sem falha na última hora | — | Nenhuma encontrada |

## Lacunas: eventos que deveriam reconciliar e não reconciliam

Classificação: **correção óbvia** é uma única chamada que falta, a uma função
de reconciliação ou resolução que já existe, num caminho de escrita que já
existe. **Recomendação** pede uma decisão de desenho ou mexe em mais de um
lugar.

### L1 — Importar o Baplie não fechava o "Baplie ausente" (corrigida na `341`)

- **Antes da `341`.** O envelope `import_baplie_staging_transactional`
  (`268`:17–33) chama o corpo `import_baplie_staging_transactional_legacy_189`.
  Esse corpo é a definição da migration `121_container_soc_coc.sql` (linhas
  55–149), que a `189_rastro_das_importacoes.sql` renomeou (linha 125, `ALTER
  FUNCTION ... RENAME TO <nome>_legacy_189`); nenhuma migration posterior
  recria o corpo. Ele grava o audit com `entity_type = 'voyage'` no singular
  (`121`:133–140) e só chama `reconcile_voyage_baplie_coverage_alerts`
  (`121`:145). O gatilho `reconcile_voyage_operation_alerts_on_audit` (`002`,
  linha 15592; gatilho em `002`:23465) só aceita `voyage_pod_schedule`,
  `voyage_pol_schedule` e `voyages`. Resultado: `reconcile_voyage_baplie_missing_alerts`
  (`324`:39) não rodava na importação.
- **Hoje.** A `341` (linhas 202–227) redefine o envelope: depois do corpo, chama
  `reconcile_voyage_baplie_missing_alerts(p_voyage_id, 'baplie_import')`
  (linha 222). **Teste:** `alertasDaViagem.local-pg.test.ts`, caso "Obs. 3"
  (existe; não executado neste estudo).
- **Classificação:** correção óbvia, já feita.
- **Resta:** o corpo continua gravando `entity_type = 'voyage'`; o mesmo
  singular aparece em `apply_baplie_physical_flags_atomic` (`121`:355) e em
  `manifesto_mercante_created` (`212`:398). Nenhum gatilho de alerta lê esse
  valor; é rastro, não gatilho. Não mudar sem conferir os leitores do
  Histórico.

### L1b — Excluir a viagem deixava os alertas dela (corrigida na `341`)

`voyage_delete_children_spec()` (`088`:144) não lista `alerts`, e `alerts` não
tem FK para `voyages`. A `341` cria `voyage_alert_scope` e
`delete_voyage_alerts` (linhas 45 e 70) e as chama em `delete_voyage_children`
(linha 94) e na prévia (linha 127). Também faz o gatilho de audit ignorar viagem
que não existe mais (linha 168). **Teste:** caso "Obs. 2" do mesmo arquivo.

### L2 — Importar B/L não reconcilia os B/Ls esperados nem o CE pendente

- **Origem afetada.** `voyage_bl_expected` conta os B/Ls da viagem por POL e
  POD; `voyage_ce_mercante_missing` conta os B/Ls sem CE.
- **Escrita.** Importar B/L de container chega a
  `import_bl_freight_transactional_legacy_070` (`175`:1045), que adia a
  cobertura (`alerts.baplie_coverage_deferred`, `175`:1076) e no fim percorre
  as viagens afetadas chamando só `reconcile_voyage_baplie_coverage_alerts`
  (`175`:1116). O audit dos B/Ls sai como `bl`/`bls` e o gatilho de insert em
  `bls` (`reconcile_baplie_coverage_on_bls_insert`, `002`:23449) também só
  chama a cobertura.
- **Correção óbvia.** No laço de `175`:1112–1116, chamar também
  `reconcile_voyage_bl_expected_alerts(v_voyage_id, …)` e
  `reconcile_voyage_ce_mercante_missing_alerts(v_voyage_id, …)` (ou
  `reconcile_voyage_operation_alerts(v_voyage_id, …)`, que já inclui as duas).
- **Outras portas do mesmo tipo (recomendação).** Manifesto BB e B/L avulso
  (`import_breakbulk_manifest_transactional_legacy_189`, `213`:1287) não
  chamam nenhuma reconciliação de viagem. Cancelar e reativar B/L (`cancel_bl`,
  `179`:1586) e trocar o POD mudam as duas contagens sem reconciliar. O dono
  mais barato para todas é o conjunto de gatilhos de instrução já existente em
  `bls` (`reconcile_baplie_coverage_from_new_rows`, `_from_old_rows` e
  `_from_updated_bls`, `002`:14497, 14562 e 14691), que já calcula as viagens
  afetadas; o de update filtra só `voyage_id`, `pol` e `pod` e precisaria
  incluir `cancelled_at` e `ce_mercante`.

### L3 — Mudar o ETA da escala não reconciliava os alertas de prazo (corrigida na `341`)

- **Origem afetada.** `voyage_bl_expected` e `voyage_baplie_missing` contam a
  partir de D-7 do primeiro ETA brasileiro, e `voyage_ce_mercante_missing` de
  D-5 (`get_voyage_first_brazilian_eta`, `002`:7587, lê o audit
  `voyage_pod_schedule`/`eta`). `voyage_bl_expected` também lê o `etd` de
  `voyage_pol_schedule`.
- **Escrita.** A ficha da viagem e a planilha de Programação
  (`apply_schedule_sheet_atomic_legacy_189`, `217`:235–239) gravam o audit
  `voyage_pod_schedule`/`voyage_pol_schedule`. O gatilho
  `reconcile_voyage_operation_alerts_on_audit` (`341`:168; ramo de escala nas
  linhas equivalentes a `002`:15599–15602) chama só
  `reconcile_voyage_schedule_date_alerts`. ETA adiado para fora de D-7, escala
  excluída ou omitida mantêm o "Baplie ausente", os "B/Ls esperados" e o "CE
  pendente" abertos até o detector.
- **Correção óbvia.** No ramo de escala do gatilho, quando `field_name` for
  `eta`, `etd`, `deleted` ou `omitted`, chamar também as três funções de nível
  viagem (`reconcile_voyage_bl_expected_alerts`,
  `reconcile_voyage_baplie_missing_alerts`,
  `reconcile_voyage_ce_mercante_missing_alerts`). Atenção: a planilha grava
  várias linhas de audit por viagem; o custo é uma reconciliação por linha
  (anotar como `ponytail:` se aceito).
- **Aplicada na `341`.** O ramo `voyage_pod_schedule` do gatilho chama as três
  funções para qualquer campo da escala do POD. O ETD do POL
  (`voyage_pol_schedule`) continua só no detector.

### L4 — Gravar o CE Mercante não reconciliava o "CE pendente" da viagem (corrigida na `341`)

- **Escrita.** Toda gravação de CE passa por `_set_bl_ce_mercante`
  (`230`:44; o `UPDATE public.bls SET ce_mercante` está na linha 88): a
  planilha (`apply_ce_mercante_rows_atomic_legacy_189`, `212`:360), a ficha do
  B/L e as correções. O audit sai como `entity_type = 'bl'` (`230`:91), que
  nenhum gatilho de alerta lê. O número do Manifesto Mercante criado pela
  planilha sai como `entity_type = 'voyage'` (`212`:398), também ignorado.
- **Correção óbvia.** Depois do `UPDATE` em `230`:88, chamar
  `reconcile_voyage_ce_mercante_missing_alerts(<viagem do B/L>, 'ce_mercante')`.
  Alternativa sem repetição por linha: uma chamada por viagem no fim do
  envelope `apply_ce_mercante_rows_atomic` (`325`:245–266); mas a ficha do B/L
  não passa por ele, então a chamada em `_set_bl_ce_mercante` cobre mais.
- **Aplicada na `341`.** Em vez de redefinir `_set_bl_ce_mercante`, o gatilho
  de audit passou a ler o próprio audit `bl`/`ce_mercante` que ela grava e
  reconcilia a viagem do B/L (com `ponytail:` para a repetição por linha).
- **Recomendação complementar.** O "CE pendente" também lê
  `manifestos_mercante` (natureza `vazio`) e `voyage_route_ce_master`; as
  escritas nessas tabelas (Vazios de Importação, `117`/`192`; CE Master por
  rota) também não reconciliam.

### L5 — Bloqueio de cálculo e falha de emissão não fecham no servidor

- `billing_calculation_blocked` só fecha pelo navegador
  (`reviewBillingAutomation.ts` → `resolve_billing_alert`, `238`:74). O
  gatilho `resolve_auto_issue_alert_on_invoiced` (`208`:85; resolução na linha
  101) fecha só `billing_auto_issue_failed` quando o B/L é faturado, embora
  `_billing_alert_origin_resolved` (`238`:44) diga que faturado resolve os dois.
- **Correção óbvia.** Em `resolve_auto_issue_alert_on_invoiced`, resolver
  também `billing_calculation_blocked` do mesmo B/L.
- **Recomendação.** B/L cancelado (`cancel_bl`, `179`:1586) ou excluído
  (`delete_records`, `088`:241) também resolve a origem dos dois tipos pela
  regra de `238`, mas nenhum caminho de servidor fecha. Um gatilho em
  `bls.cancelled_at` e na exclusão chamando `_billing_alert_origin_resolved`
  resolveria os dois.

### L6 — Resolvedor do "exportação após ATD" com a entidade trocada

`reconcile_voyage_export_after_atd_alerts` abre e fecha o item com entidade
`voyage_pod_schedule` = `<viagem>::<porto>` (`324`:438, 450, 468, 486). No ramo
"escala excluída ou omitida", `reconcile_voyage_schedule_date_alerts` tenta
fechar com entidade `voyage_escala_terminal` = `<viagem>::<porto>::<terminal>`
(`324`:534), que nunca existe para esse tipo: a chamada não fecha nada. A
reconciliação seguinte não ajuda, porque a função de exportação olha
`voyage_export_schedules` e o ATD do terminal, que continuam lá.

- **Correção óbvia.** Em `324`:534, trocar para
  `resolve_alert_item('voyage_export_after_atd', 'voyage_pod_schedule', v_scale_entity_id, …)`,
  fora do laço de terminais.
- **Observação (Suspeita).** A mesma função é chamada uma vez por terminal
  (`002`:15571) mas grava um item por escala: com dois terminais, um com ATD e
  o outro sem, o último da iteração decide se o item fica aberto. Reproduzir
  antes de corrigir.

### L7 — Vincular o manifesto de Granito ou de Vazios não fecha o "exportação após ATD"

- **Origem afetada.** O alerta fecha quando existem `granite_manifests` e/ou
  `vazios_manifests` da viagem (`324`:453–463).
- **Escrita.** `import_granite_manifest_transactional` (envelope `325`:49) e
  `import_vazios_bookings_transactional` (envelope `274`:22, corpo
  `_legacy_189`) não chamam nenhuma reconciliação de viagem, e o audit dessas
  tabelas sai como `granite_manifests`/`vazios_manifests`, ignorado pelo
  gatilho.
- **Por que pesa mais.** O alerta só abre depois do ATD. Quando o último porto
  recebe ATD, `save_voyage_escala_terminal_state` (`002`:18873, linhas
  19862–19868) marca a viagem `completed`, e o detector só varre viagens
  `active` (`002`:6406). Manifesto vinculado depois disso não fecha o alerta
  nem pelo detector. **Suspeita** (estática; reproduzir).
- **Correção óbvia.** No fim dos dois envelopes, chamar
  `reconcile_voyage_operation_alerts(p_voyage_id, …)`.
- **Recomendação.** Mudanças só no planejamento de exportação
  (`voyage_export_schedules`, audit ignorado) e o vínculo de manifesto feito
  por outra porta pedem um gatilho de instrução em `granite_manifests`,
  `vazios_manifests` e `voyage_export_schedules`, no modelo dos gatilhos de
  cobertura do Baplie.

### L8 — "Efeito de importação bloqueado" não tem fechamento

`_record_import_effect_blocked_alert` (`025`:157) abre o item; nenhuma função
o fecha. `retry_import_effect` (`252`:5), a reabertura com justificativa que o
manual (`alertRulesCatalog.ts`, "permanece até o operador revisar e reabrir a
fila com justificativa") apresenta como fim do alerta, só muda o efeito para
`retry_wait` e grava o audit (`252`:50). O efeito concluído depois também não
fecha. O único fechamento na cadeia é o pontual da `325`.

- **Correção óbvia.** Em `retry_import_effect`, depois do `UPDATE`, chamar
  `resolve_alert_item('import_effect_blocked', 'import_effect', v_row.id::text, 'import_effect_retry', …)`.
  Se o efeito bloquear de novo, `_record_import_effect_blocked_alert` reabre o
  item com nova ocorrência.

### L9 — "Datas mudaram em Invoice de Demurrage" sem fechamento no ramo cancelada e reemitida

No ramo sem pagamento, `_reconcile_demurrage_after_dates` (`317`:533) cancela a
Invoice, tenta reemitir e abre o alerta na Invoice cancelada. O único
fechamento (`resolve_dates_changed_alert_on_restore`, `208`:163) exige que
`dunning_suspended_reason` volte a nulo, o que não acontece numa Invoice
cancelada. O manual diz "registre a conferência ao resolver o alerta", mas
`resolve_alert_item_with_justification` recusa o tipo. Nos ramos com pagamento
ou com desconto e disputa, cancelar e gerar de novo também não fecha.

- **Recomendação** (decisão de produto): incluir o tipo em
  `_alert_types_resolved_with_justification()` e em
  `ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION`, ou fechar o item quando a Invoice
  de origem é cancelada e outra Invoice viva cobre os containers.

### L10 — Viagem concluída ou cancelada congela os alertas de viagem

- `detect_voyage_operation_alerts` (`002`:6395) só varre `status = 'active'`.
  As funções `reconcile_voyage_*` não olham o status da viagem.
- `cancel_voyage` (`178`:817; `UPDATE` na linha 831) grava o audit `voyages`,
  que dispara a reconciliação uma vez; como as funções ignoram o status, os
  itens ficam como estavam e depois ninguém mais passa por eles. Só
  `billing_charge_table_missing` trata a viagem cancelada (`208`).
- Na viagem concluída, os eventos tardios (CE, B/L, Granito, Vazios) dependem
  das lacunas L2, L4 e L7.
- **Recomendação.** (a) Na `cancel_voyage`, resolver os itens ativos do
  escopo da viagem; a `341` já tem `voyage_alert_scope(viagem)`, que pode
  servir para resolver em vez de apagar. (b) No detector, varrer também a
  viagem não ativa que ainda tem item ativo de viagem.

### L11 — Promessas de justificativa sem a RPC aceitar

`alertRulesCatalog.ts` diz que `comunicado_recusado` "também pode ser encerrado
com justificativa" e que `demurrage_invoice_dates_changed` se fecha
"registrando a conferência". Nenhum dos dois está em
`_alert_types_resolved_with_justification()` (`316`:42) nem em
`ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION` (`src/services/alerts.ts`:584).
**Recomendação:** decidir com o dono e alinhar o código ou o texto do manual.

## Resumo das correções óbvias

| # | Função (última definição) | Linha | Chamada que falta |
|---|---|---|---|
| L1 | `import_baplie_staging_transactional` (`341`) | 222 | Feita: `reconcile_voyage_baplie_missing_alerts` |
| L2 | `import_bl_freight_transactional_legacy_070` (`175`) | 1116 | `reconcile_voyage_bl_expected_alerts` e `reconcile_voyage_ce_mercante_missing_alerts` |
| L3 | `reconcile_voyage_operation_alerts_on_audit` (`341`) | ramo de escala | Feita: as três reconciliações de nível viagem no audit `voyage_pod_schedule` |
| L4 | `reconcile_voyage_operation_alerts_on_audit` (`341`) | ramo `bl`/`ce_mercante` | Feita: `reconcile_voyage_ce_mercante_missing_alerts` |
| L5 | `resolve_auto_issue_alert_on_invoiced` (`208`) | 101 | `resolve_alert_item('billing_calculation_blocked', …)` |
| L6 | `reconcile_voyage_schedule_date_alerts` (`324`) | 534 | Entidade `voyage_pod_schedule`/`<viagem>::<porto>` |
| L7 | `import_granite_manifest_transactional` (`325`) e `import_vazios_bookings_transactional` (`274`) | 49 e 22 (envelopes) | `reconcile_voyage_operation_alerts` |
| L8 | `retry_import_effect` (`252`) | depois do `UPDATE` | `resolve_alert_item('import_effect_blocked', …)` |

## Riscos transversais

- **O detector fecha o que os gatilhos esquecem.** Para a viagem ativa, toda
  lacuna acima vira atraso de até 15 minutos, não alerta preso. Se o job
  `alerts-foundation-detectors`, a Edge Function ou o segredo falharem, nada
  disso fecha; o `rotina_http_falhou` avisa da falha HTTP do `pg_net`.
- **Erros engolidos.** Os gatilhos de reconciliação terminam em
  `EXCEPTION WHEN OTHERS THEN RAISE WARNING` (`341`:168, coberturas do Baplie
  em `002`). Uma reconciliação que quebra não interrompe a gravação nem deixa
  sinal na tela.
- **Audit como barramento.** Os gatilhos de alerta escolhem pelo
  `entity_type` do audit. Os gravadores usam `voyage` e `voyages`, `bl` e
  `bls` (o nome da tabela vem do gatilho genérico `audit_row_changes`), e o
  singular escrito à mão nunca dispara reconciliação. Toda nova escrita que
  mude origem de alerta precisa chamar a reconciliação direto ou entrar num
  gatilho de tabela; não confiar no audit.

## O que não foi verificado

- Nenhuma lacuna foi reproduzida em Postgres. L6 e L7 (viagem concluída) e o
  efeito dos dois terminais estão marcados **Suspeita**.
- O teste `alertasDaViagem.local-pg.test.ts` cobre L1, L1b e a abertura do
  "Baplie ausente" pelo audit de ETA (L3), e passou no PostgreSQL 16 local
  com as migrations até a `344`. L4 tem só inspeção do SQL, sem teste.
- L2 e L5–L8 ficam como recomendação para outra PR: cada uma redefine uma
  função grande de importação ou faturamento, fora do escopo da observação 3.
- O estado do banco de produção (jobs agendados, segredos, alertas abertos
  hoje) não foi consultado.
