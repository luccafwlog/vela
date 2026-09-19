# Auditoria documental — 2026-09-19

## Escopo e evidência

Revisão estática dos roteadores, contratos de services/hooks, cadeia ativa de migrations,
69 decisões e documentação viva. **Código** não demonstra aplicação remota, grants
efetivos no ambiente ou execução de jobs. **Teste de contrato SQL** lê SQL;
não substitui replay. Os resultados dos checks locais ficam na seção final.

O [inventário extraído](2026-09-19-overhaul-documental.json) registra cada arquivo
de service/hook com chamadas literais e declarações SQL de cada migration.
Ele não resolve SQL dinâmico, chamadas indiretas nem sobrecargas por assinatura;
a autoridade final continua sendo o código e, para estado aplicado, o catálogo
obtido por replay controlado. Não foi consultado nem modificado banco remoto.

## Achados corrigidos

- AGENTS absorve integralmente as regras anteriores; arquivo legado da raiz removido.
- Node 24; duas SPAs; PIX Itaú direto continua futuro, não integração ativa.
- Terminal é exceção em bls.terminal_id e herança de frentes; não altera preço.
- B/L misto, pesos/cubagens disjuntos (061/064), CE/gates, NCM persistido e cinco abas alinhados.
- Redirects, catch-all, console interno e inspeção descritos conforme roteadores.
- 33 decisões marcadas parcialmente supersedidas, sem apagar o texto histórico.
- Módulos com sete seções ordenadas e catálogos de oito colunas.
- Índices de planos/specs deixam de anunciar snapshots e execução intermediária como trabalho vivo.

## Divergências e limites preservados

- deriveEscalaState retorna Atracada entre duas atracações se alguma tem ATB,
  mesmo já tendo ATD. Registrado em CONTEXT; sem alteração de aplicação.
- Runners e PTAX requerem configuração/ativação e prova remota; existência não prova rollout.
- API Itaú dinâmica permanece spec futura.
- Os três planos ativos ainda têm gates e tarefas pendentes; nenhum foi arquivado
  como concluído. As notas do índice foram movidas para relatório histórico.
- Testes de SQL arquivado mantêm o limite de evidência descrito pela ADR 0062.

## Decisões: resultado e âncora executável

A coluna de fonte é o ponto inicial do confronto, não uma alegação de cobertura
de cada frase por esse arquivo. Supersessões e limites estão nos cabeçalhos/índice.

| ADR | Resultado | Fonte conferida |
|---|---|---|
| [0001](../../adr/0001-portal-login-supabase-auth.md) | supersedida parcialmente | `supabase/functions/portal-login/index.ts` |
| [0002](../../adr/0002-portal-self-service-reconsolidation.md) | supersedida parcialmente | `src/services/portalBilling.ts` |
| [0003](../../adr/0003-spa-react-rotas-lazy-camadas-page-hook-service.md) | aceito | `src/AppInterno.tsx` |
| [0004](../../adr/0004-supabase-rls-rpc-fronteira-seguranca.md) | supersedida parcialmente | `supabase/migrations/002_business_logic_and_security.sql` |
| [0005](../../adr/0005-pipeline-importacao-viagem-staging-reconciliacao.md) | supersedida parcialmente | `src/services/blFreightImport.ts` |
| [0006](../../adr/0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md) | supersedida parcialmente | `src/services/reviewBillingAutomation.ts` |
| [0007](../../adr/0007-ledger-local-ciclo-vida-invoices.md) | supersedida parcialmente | `src/services/billingLedger.ts` |
| [0008](../../adr/0008-demurrage-integrado-sem-unificar-persistencia.md) | supersedida parcialmente | `src/services/demurrage/demurrageInvoices.ts` |
| [0009](../../adr/0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md) | aceito | `src/services/deleteDependencies.ts` |
| [0010](../../adr/0010-validacao-testes-deploy-gates.md) | supersedida parcialmente | `.github/workflows/ci.yml` |
| [0011](../../adr/0011-revogacao-anon-security-definer-default-deny.md) | supersedida parcialmente | `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql` |
| [0012](../../adr/0012-viagens-master-detail-rota-dedicada.md) | aceito | `src/pages/Viagens.tsx` |
| [0013](../../adr/0013-portal-auth-identificador-resolvido-e-excecao-anon.md) | supersedida parcialmente | `supabase/functions/portal-login/index.ts` |
| [0014](../../adr/0014-demurrage-recalculo-diario-substitui-roe-congelado.md) | supersedida parcialmente | `supabase/functions/recalc-demurrage-ptax/index.ts` |
| [0015](../../adr/0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md) | aceito | `src/services/reconciliacao.ts` |
| [0016](../../adr/0016-migrations-nomenclatura-numerada-sequencial.md) | supersedida parcialmente | `WORKFLOW.md` |
| [0017](../../adr/0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md) | supersedida parcialmente | `src/services/blFreightImport.ts` |
| [0018](../../adr/0018-selecao-viagem-busca-preditiva-combobox.md) | aceito | `src/components/ui/Combobox.tsx` |
| [0019](../../adr/0019-politica-de-senha-e-signup-fechado.md) | supersedida parcialmente | `supabase/config.toml` |
| [0020](../../adr/0020-ce-mercante-gatilho-calculo-taxas-locais.md) | supersedida parcialmente | `supabase/migrations/051_ce_mercante_auto_billing.sql` |
| [0021](../../adr/0021-cadastro-unico-navio-viagem-programacao-projeta-viagem.md) | aceito | `src/services/voyageFromSchedule.ts` |
| [0022](../../adr/0022-omissao-escala-transbordo-cod-registro-operacional.md) | supersedida parcialmente | `src/services/transshipments.ts` |
| [0023](../../adr/0023-distribuicao-skills-fonte-unica-instalador-node.md) | aceito | `scripts/skills/install-skills.mjs` |
| [0024](../../adr/0024-cancelamento-viagem-estado-retido-exclusao-hard-delete.md) | aceito | `src/services/voyages.ts` |
| [0025](../../adr/0025-bl-fonte-documental-unica-container-atd-pol.md) | aceito | `src/services/blFreightImport.ts` |
| [0026](../../adr/0026-demurrage-validacao-item-rpc-veto.md) | aceito | `supabase/migrations/023_demurrage_calculation_snapshot.sql` |
| [0027](../../adr/0027-agency-departure-report-agregado-escala-snapshot.md) | supersedida parcialmente | `src/services/agencyDepartureReport.ts` |
| [0028](../../adr/0028-adr-signoff-historico-justificativa-audit-logs.md) | aceito | `src/hooks/useAgencyReport.ts` |
| [0029](../../adr/0029-adr-signoff-departamental-fases-ciclo.md) | supersedida parcialmente | `src/components/voyages/VoyageAgencyReportTab.tsx` |
| [0030](../../adr/0030-adr-observacoes-por-secao-substitui-ocorrencias.md) | supersedida parcialmente | `src/components/voyages/VoyageAgencyReportTab.tsx` |
| [0031](../../adr/0031-vazios-exp-grao-container-cadastro-depot-tarifas.md) | supersedida parcialmente | `src/services/vaziosExportOperations.ts` |
| [0032](../../adr/0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md) | supersedida parcialmente | `src/services/depots.ts` |
| [0033](../../adr/0033-embarque-vazios-unidades-importadas-servicos-lancados.md) | aceito | `src/services/vaziosExportOperations.ts` |
| [0034](../../adr/0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md) | supersedida parcialmente | `src/services/alerts.ts` |
| [0035](../../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md) | supersedida parcialmente | `src/services/agencyDepartureReport.ts` |
| [0036](../../adr/0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md) | aceito | `src/components/voyages/VoyageAgencyReportTab.tsx` |
| [0037](../../adr/0037-usuario-interno-criado-pelo-admin-com-senha-definida.md) | aceito | `supabase/functions/admin-users/index.ts` |
| [0038](../../adr/0038-taxa-local-valor-congelado-ancorado-na-escala.md) | supersedida parcialmente | `src/services/charges/chargeOperationsService.ts` |
| [0039](../../adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md) | supersedida parcialmente | `src/services/agencyReportDeadline.ts` |
| [0040](../../adr/0040-vigencia-da-tabela-de-taxas-e-informativa.md) | aceito | `src/services/charges/chargeTableService.ts` |
| [0041](../../adr/0041-validacao-fila-de-bloqueios-ce-como-confirmacao.md) | supersedida parcialmente | `src/components/billing/ValidacaoTab.tsx` |
| [0042](../../adr/0042-ce-mercante-confirma-calculo-em-todos-os-modos.md) | aceito | `src/services/graniteBillingWorkflow.ts` |
| [0043](../../adr/0043-vinculo-de-cliente-somente-por-documento.md) | aceito | `src/services/customerReconciliation.ts` |
| [0044](../../adr/0044-leitura-interna-global-departamento-restringe-escrita.md) | supersedida parcialmente | `supabase/migrations/002_business_logic_and_security.sql` |
| [0045](../../adr/0045-inspecao-do-portal.md) | aceito | `src/services/portalScope.ts` |
| [0046](../../adr/0046-escrita-interna-global-com-rastro-obrigatorio.md) | supersedida parcialmente | `src/hooks/useAuth.tsx` |
| [0047](../../adr/0047-grants-de-funcao-fechados-por-padrao.md) | aceito | `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql` |
| [0048](../../adr/0048-confirmacao-de-email-do-portal-em-rota-publica.md) | aceito | `src/pages/PortalConfirmarEmail.tsx` |
| [0049](../../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md) | aceito | `supabase/functions/portal-password-recovery/index.ts` |
| [0050](../../adr/0050-financeiro-segregado-por-processo-faturavel.md) | aceito | `src/lib/routeRedirects.ts` |
| [0051](../../adr/0051-cod-reprecifica-no-destino-final.md) | aceito | `src/services/blChangeOfDestinationService.ts` |
| [0052](../../adr/0052-escala-omitida-visivel-na-programacao.md) | aceito | `src/services/portalScheduleVoyages.ts` |
| [0053](../../adr/0053-ciclo-de-vida-alerta-dispensa-temporaria.md) | aceito | `src/services/alerts.ts` |
| [0054](../../adr/0054-portal-como-gate-de-faturamento.md) | supersedida parcialmente | `supabase/migrations/051_ce_mercante_auto_billing.sql` |
| [0055](../../adr/0055-taxa-local-sem-vencimento-praticado.md) | aceito | `src/components/billing/InvoiceDetailModal.tsx` |
| [0056](../../adr/0056-branching-automatico-supabase-vercel.md) | aceito | `.github/workflows/provision-preview-admin.yml` |
| [0057](../../adr/0057-ncm-como-campo-proprio-do-bl.md) | aceito | `src/hooks/useBlEditForm.ts` |
| [0058](../../adr/0058-canal-de-comunicado-ao-cliente.md) | supersedida parcialmente | `supabase/functions/_shared/email.ts` |
| [0059](../../adr/0059-chave-global-de-envio-desligada-por-padrao.md) | aceito | `src/services/appSettings.ts` |
| [0060](../../adr/0060-primeira-permissao-do-perfil-equipamentos.md) | aceito | `src/hooks/useAuth.tsx` |
| [0061](../../adr/0061-conciliacao-de-cliente-com-casa-unica-na-revisao.md) | supersedida parcialmente | `src/services/reviewCustomerGroup.ts` |
| [0062](../../adr/0062-consolidacao-migrations-schema-1-0.md) | supersedida parcialmente | `src/test/setup.ts` |
| [0063](../../adr/0063-configuracao-de-jobs-cron-no-vault.md) | aceito | `supabase/migrations/007_cron_secrets_no_vault.sql` |
| [0064](../../adr/0064-caixas-de-comunicacao-e-auditoria-de-contatos.md) | aceito | `src/services/customerContactConfiguration.ts` |
| [0065](../../adr/0065-inbox-efeitos-e-autoridade-financeira.md) | aceito | `src/services/importEffects.ts` |
| [0066](../../adr/0066-transicao-marca-vela.md) | aceito | `vite.config.ts` |
| [0067](../../adr/0067-nob-automatico-ancorado-na-frente-de-operacao.md) | supersedida parcialmente | `supabase/migrations/062_pr698_audit_remediations.sql` |
| [0068](../../adr/0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md) | aceito | `src/services/blTerminal.ts` |
| [0069](../../adr/0069-resolucao-de-tabela-de-taxas-e-funcao-unica-compartilhada.md) | aceito | `supabase/migrations/062_pr698_audit_remediations.sql` |

## Cadeia ativa de migrations

Contagens de declarações encontradas, não de objetos vivos: redefinições e
DROP posteriores exigem replay para resolver o catálogo final. As migrations
001/002 consolidam o histórico; 003+ refinam o estado. A lacuna 014 é preservada.

| Migration | Tabelas declaradas | Funções declaradas | Policies | Triggers |
|---|---|---|---|---|
| `001_initial_schema.sql` | 106 | 0 | 0 | 0 |
| `002_business_logic_and_security.sql` | 0 | 394 | 273 | 144 |
| `003_pos_squash_objetos_fora_do_dump.sql` | 0 | 0 | 3 | 0 |
| `004_vazios_delete_baplie_grant.sql` | 0 | 0 | 0 | 0 |
| `005_pg_net_jobs_rls_guard.sql` | 1 | 1 | 0 | 0 |
| `006_operational_contract_hardening.sql` | 1 | 1 | 0 | 0 |
| `007_cron_secrets_no_vault.sql` | 0 | 1 | 0 | 0 |
| `008_portal_contact_boxes.sql` | 4 | 17 | 4 | 2 |
| `009_rpc_entry_security.sql` | 0 | 4 | 0 | 0 |
| `010_contact_routing_and_dunning_eligibility.sql` | 0 | 5 | 0 | 0 |
| `011_dunning_group_membership.sql` | 2 | 2 | 0 | 0 |
| `012_demurrage_mutation_guards.sql` | 1 | 6 | 0 | 0 |
| `013_portal_disputes_inspection.sql` | 0 | 3 | 0 | 0 |
| `015_import_dates_and_flags_atomic.sql` | 1 | 2 | 1 | 0 |
| `016_import_metadata_and_omission_conflicts.sql` | 0 | 5 | 0 | 0 |
| `017_import_effects_outbox.sql` | 1 | 7 | 1 | 1 |
| `018_exchange_rate_provenance.sql` | 1 | 7 | 1 | 0 |
| `019_local_billing_integrity.sql` | 0 | 7 | 0 | 0 |
| `020_operational_read_pages.sql` | 0 | 3 | 0 | 0 |
| `021_portal_billing_pages.sql` | 0 | 6 | 0 | 0 |
| `022_email_inbox_and_dispatch_state.sql` | 1 | 4 | 0 | 1 |
| `023_demurrage_calculation_snapshot.sql` | 1 | 4 | 0 | 2 |
| `024_demurrage_ptax_alert.sql` | 0 | 0 | 0 | 0 |
| `025_import_effect_worker.sql` | 0 | 4 | 0 | 0 |
| `026_import_effect_alert.sql` | 0 | 0 | 0 | 0 |
| `027_demurrage_money_fixes.sql` | 0 | 2 | 0 | 0 |
| `028_demurrage_roe_integrity.sql` | 0 | 4 | 0 | 2 |
| `029_alert_item_upsert_idempotence.sql` | 0 | 1 | 0 | 0 |
| `030_fix_demurrage_snapshot_ptax_column.sql` | 0 | 1 | 0 | 0 |
| `031_import_effect_consumers.sql` | 0 | 10 | 0 | 0 |
| `032_customer_communication_partial_status.sql` | 0 | 2 | 0 | 1 |
| `033_customer_communication_readiness_guards.sql` | 0 | 3 | 0 | 2 |
| `034_pix_static_payload_normative_fixes.sql` | 0 | 1 | 0 | 0 |
| `035_operational_voyage_summaries.sql` | 0 | 1 | 0 | 0 |
| `036_operational_breakbulk_summary_metrics.sql` | 0 | 1 | 0 | 0 |
| `037_operational_voyage_summary_null_status.sql` | 0 | 1 | 0 | 0 |
| `038_customer_communication_status_recipient_latest.sql` | 0 | 1 | 0 | 0 |
| `039_customer_communication_status_identity.sql` | 0 | 2 | 0 | 1 |
| `040_operational_breakbulk_drift_tolerance.sql` | 0 | 1 | 0 | 0 |
| `041_dunning_partial_claim_recovery.sql` | 0 | 1 | 0 | 0 |
| `042_preview_admin_service_role_grant.sql` | 0 | 0 | 0 | 0 |
| `043_security_and_indexes_hardening.sql` | 0 | 3 | 0 | 0 |
| `044_restore_app_settings_singleton.sql` | 0 | 0 | 0 | 0 |
| `045_comunicados_caixas_e_nob_automatico.sql` | 0 | 2 | 0 | 0 |
| `046_renomeia_avisos_operacionais.sql` | 0 | 0 | 0 | 0 |
| `047_bl_documental_gates.sql` | 0 | 6 | 0 | 3 |
| `048_customer_base_primary_contact.sql` | 0 | 1 | 0 | 0 |
| `049_terminalized_schedule_persistence.sql` | 0 | 1 | 0 | 0 |
| `050_portal_provisioning_active_contact_candidates.sql` | 0 | 1 | 0 | 0 |
| `051_ce_mercante_auto_billing.sql` | 0 | 10 | 0 | 2 |
| `052_financial_battery_guards.sql` | 0 | 7 | 0 | 1 |
| `053_manifestos_mercante_dominio.sql` | 1 | 0 | 2 | 0 |
| `054_bl_cargo_mode_misto_trigger.sql` | 0 | 5 | 0 | 3 |
| `055_terminal_bl_heranca_excecao.sql` | 0 | 3 | 0 | 0 |
| `056_resolucao_taxas_duas_tabelas.sql` | 0 | 5 | 0 | 0 |
| `057_cod_manifesto_pendency.sql` | 0 | 1 | 0 | 0 |
| `058_operational_voyage_summaries_misto.sql` | 0 | 2 | 0 | 0 |
| `059_pr698_integrity_hardening.sql` | 0 | 18 | 0 | 4 |
| `060_pr698_claude_review_followup.sql` | 0 | 13 | 0 | 8 |
| `061_bl_weight_semantics_and_triggers.sql` | 0 | 1 | 0 | 3 |
| `062_pr698_audit_remediations.sql` | 0 | 5 | 3 | 2 |
| `063_operational_bl_summary_breakbulk_weight.sql` | 0 | 1 | 0 | 0 |
| `064_bl_cbm_semantics_and_cargo_signal.sql` | 0 | 5 | 0 | 1 |

`public` contém o domínio exposto com RLS/grants; `ops` guarda o dispatcher
privado dos jobs, SECURITY INVOKER, com segredos no Vault. Storage e cron têm
objetos fora do dump de public, mantidos em migrations próprias.

## Contratos frontend

| Arquivo | RPCs literais | Relações/buckets literais | Edge Functions literais |
|---|---|---|---|
| `src/hooks/useAuth.tsx` |  | `user_profiles` |  |
| `src/hooks/useBlEditForm.ts` | `save_bl_review` |  |  |
| `src/hooks/useBls.ts` |  | `audit_logs`, `bl_containers`, `bls`, `vehicles`, `voyages` |  |
| `src/hooks/useCustomers.ts` |  | `customers`, `invoices` |  |
| `src/hooks/useOperationalAlerts.ts` |  | `bl_containers` |  |
| `src/hooks/useOperationalCounts.ts` |  | `bls` |  |
| `src/hooks/usePortalAuth.tsx` | `portal_get_session_overview_v2` |  | `portal-login` |
| `src/hooks/usePortalProvisioning.ts` | `portal_admin_change_cnpj`, `portal_assisted_email_change`, `portal_cancel_invite` |  | `portal-account-suspend` |
| `src/hooks/useReview.ts` |  | `bls`, `granite_bls` |  |
| `src/hooks/useVaziosImportacaoStats.ts` |  | `vazios_importacao_containers`, `vazios_importacao_manifests` |  |
| `src/hooks/useVehicles.ts` |  | `vehicles`, `voyages` |  |
| `src/services/adminObservability.ts` |  | `audit_logs`, `invoices`, `user_profiles`, `voyages` |  |
| `src/services/adminUsers.ts` | `admin_list_users` | `user_profiles` | `admin-users` |
| `src/services/agencyDepartureReport.ts` | `add_agency_report_occurrence`, `close_agency_departure_report`, `reopen_agency_departure_report`, `set_agency_report_department_signoff`, `set_agency_report_section_observation`, `set_agency_report_signoff`, `set_agency_report_terminal` | `agency_departure_reports`, `audit_logs`, `baplie_containers`, `bl_containers`, `bl_transshipments`, `bls`, `depot_services`, `granite_bls`, `vazios_bookings`, `vazios_export_operations`, `vazios_export_service_lines`, `vazios_importacao_containers`, `vehicles`, `voyage_omissions` |  |
| `src/services/agencyReportSla.ts` |  | `agency_departure_reports` |  |
| `src/services/alerts.ts` | `count_alert_queue`, `count_unread_internal_notifications`, `dismiss_alert_item`, `list_alert_queue_page`, `list_internal_notifications`, `mark_all_internal_notifications_read`, `mark_internal_notification_read`, `resolve_billing_alert`, `summarize_alert_queue_by_department`, `upsert_billing_alert` |  |  |
| `src/services/appSettings.ts` | `set_communications_enabled`, `set_demurrage_dunning_interval_days` | `app_settings` |  |
| `src/services/baplieImport.ts` | `import_baplie_staging_transactional` |  |  |
| `src/services/baplieReadModel.ts` |  | `baplie_containers`, `bls` |  |
| `src/services/baplieReconciliation.ts` | `apply_baplie_physical_flags_atomic`, `get_voyage_first_brazilian_eta` | `baplie_containers`, `bl_containers`, `bls` |  |
| `src/services/billing.ts` | `add_manual_invoice_charge`, `cancel_invoice`, `create_invoice_from_bls_with_ledger`, `delete_manual_invoice_charge`, `get_consolidated_invoice_item_breakdown`, `list_invoice_details`, `mark_bl_ready_and_create_invoice`, `mark_bls_ready_and_create_invoice`, `register_invoice_payment` | `bls`, `customers`, `invoice_bls`, `invoice_granite_bls`, `invoice_receivable_links`, `invoices`, `payments`, `voyages` |  |
| `src/services/billingLedger.ts` | `create_local_consolidated_invoice`, `list_consolidatable_receivables`, `list_invoice_refunds`, `reconcile_invoice_payment_by_txid`, `register_ledger_invoice_payment`, `settle_cod_adjustment`, `settle_invoice_refund` | `cod_adjustments` |  |
| `src/services/blChangeOfDestinationService.ts` | `set_bl_cod` | `bls` |  |
| `src/services/blDemurrageConfig.ts` | `save_bl_demurrage_config` |  |  |
| `src/services/blDocumentImport.ts` |  | `voyages` |  |
| `src/services/blFreightImport.ts` | `import_bl_freight_transactional`, `import_bl_freight_with_metadata` | `bl_containers`, `bl_receivables`, `bls`, `charge_calculations`, `customers`, `demurrage_invoices`, `invoice_bls`, `invoices`, `voyages` |  |
| `src/services/blPortalStatus.ts` | `get_bl_portal_status` |  |  |
| `src/services/blTerminal.ts` | `set_bl_terminal_override` |  |  |
| `src/services/blTimeline.ts` | `bl_timeline` |  |  |
| `src/services/bls.ts` |  | `bl_receivables`, `bls`, `demurrage_invoices`, `invoice_bls`, `invoice_receivable_links`, `invoices`, `vehicles` |  |
| `src/services/breakbulkImport.ts` | `import_breakbulk_manifest_transactional` | `voyages` |  |
| `src/services/ceMercanteImport.ts` | `apply_ce_mercante_manifest`, `apply_ce_mercante_update`, `apply_granite_ce_mercante_update` | `bls`, `granite_bls`, `manifestos_mercante` |  |
| `src/services/charges/chargeOperationsService.ts` | `add_manual_bl_charge`, `calculate_bl_local_charges`, `delete_manual_bl_charge`, `list_bl_local_charge_lines`, `list_manual_charge_items_for_bl`, `mark_bl_charges_reviewed`, `mark_bl_ready_for_billing`, `update_manual_bl_charge` | `audit_logs`, `bl_containers`, `bls`, `charge_calculations`, `granite_bl_charges`, `granite_bls`, `invoice_bls`, `invoice_receivable_links` |  |
| `src/services/charges/chargeRateService.ts` |  | `charge_table_items`, `customer_rate_overrides`, `customers` |  |
| `src/services/charges/chargeReconciliationService.ts` | `list_customer_reconciliation_queue` |  |  |
| `src/services/charges/chargeTableService.ts` |  | `charge_table_items`, `charge_tables` |  |
| `src/services/containerDatesImport.ts` | `apply_container_dates_atomic` | `bl_containers` |  |
| `src/services/containers.ts` |  | `bl_containers`, `charge_calculations`, `demurrage_invoice_items`, `vehicles` |  |
| `src/services/customerBase.ts` | `apply_customer_base_row_atomic` |  |  |
| `src/services/customerCommunicationDispatches.ts` |  |  | `send-customer-communication` |
| `src/services/customerCommunicationReadiness.ts` | `customer_local_charges_communication_readiness` |  |  |
| `src/services/customerCommunications.ts` |  | `bls`, `customer_communication_bls`, `customer_communications`, `customer_contact_box_links`, `customer_contacts`, `voyage_escala_operation_fronts`, `voyage_escala_terminal_state`, `voyages` |  |
| `src/services/customerContactConfiguration.ts` | `internal_save_customer_contact_configuration` | `customer_communication_boxes`, `customer_communication_suppressions`, `customer_contact_box_links`, `customer_contacts`, `portal_suppressed_emails` |  |
| `src/services/customerFicha.ts` | `get_customer_receivables` | `audit_logs`, `bl_containers`, `bls`, `charge_calculations`, `customer_contact_change_events`, `customer_rate_overrides`, `demurrage_invoices`, `invoices`, `payments`, `portal_provisioning_events` |  |
| `src/services/customerFinanceCommunications.ts` |  | `bls`, `customer_communication_suppressions`, `customer_communications`, `customer_contact_box_links`, `customer_contacts`, `invoice_bls`, `invoice_receivable_links`, `portal_suppressed_emails` |  |
| `src/services/customerReconciliation.ts` |  | `customers` |  |
| `src/services/customers.ts` | `create_customer_with_contacts`, `ensure_customer_contact_email`, `update_customer_with_audit` | `billing_batches`, `bl_receivables`, `bls`, `customer_contacts`, `customer_rate_overrides`, `customers`, `demurrage_invoices`, `invoices` |  |
| `src/services/deleteAudit.ts` |  | `audit_logs` |  |
| `src/services/demurrage/customerDemurrageAgreements.ts` |  | `customer_demurrage_agreements` |  |
| `src/services/demurrage/demurrageContainers.ts` |  | `audit_logs`, `bl_containers`, `demurrage_invoice_items` |  |
| `src/services/demurrage/demurrageDisputes.ts` | `add_demurrage_dispute_attachment`, `add_demurrage_dispute_message`, `list_demurrage_disputes_internal`, `reopen_demurrage_dispute` | `demurrage-disputes` |  |
| `src/services/demurrage/demurrageInvoices.ts` | `apply_demurrage_discount`, `cancel_demurrage_invoice`, `create_demurrage_invoice_authoritative`, `register_demurrage_payment`, `reopen_demurrage_invoice` | `bl_containers`, `bls`, `demurrage_invoice_items`, `demurrage_invoices` |  |
| `src/services/demurrage/demurrageKpis.ts` | `recalculate_demurrage_invoices_manual`, `save_exchange_rate_reference_v2` | `bl_containers`, `demurrage_invoice_history`, `demurrage_invoices` |  |
| `src/services/demurrage/demurrageRates.ts` |  | `demurrage_rates` |  |
| `src/services/demurrageDunning.ts` | `list_demurrage_dunning_claim_statuses` | `app_settings`, `customer_communication_suppressions`, `customer_contact_box_links`, `customer_contacts`, `portal_suppressed_emails` |  |
| `src/services/depots.ts` | `preflight_depots_terminal_port_mapping` | `bls`, `depot_services`, `depots`, `ports` |  |
| `src/services/escalaTerminalAllocation.ts` | `save_voyage_escala_terminal_state_v2` |  |  |
| `src/services/graniteCharges.ts` | `calculate_granite_bl_charges` | `granite_bls`, `granite_manifests`, `granite_rates` |  |
| `src/services/graniteImport.ts` | `import_granite_manifest_transactional` |  |  |
| `src/services/importEffects.ts` | `claim_import_effects`, `complete_import_effect`, `enqueue_import_effect`, `list_import_effects`, `retry_import_effect` |  |  |
| `src/services/lineup.ts` |  | `audit_logs`, `bl_containers`, `bls`, `vazios_importacao_containers`, `vehicles`, `voyages` |  |
| `src/services/manifestImport.ts` | `set_import_batch_ce_master` |  |  |
| `src/services/manifestosMercanteService.ts` |  | `bls`, `manifestos_mercante` |  |
| `src/services/operationalEvents.ts` |  | `audit_logs` |  |
| `src/services/operationalLists.ts` | `operational_list_bl_summary`, `operational_list_bls`, `operational_list_containers`, `operational_list_voyage_summaries` | `bls` |  |
| `src/services/portalBilling.ts` | `portal_resolve_login` | `demurrage-disputes` |  |
| `src/services/portalProvisioning.ts` | `portal_list_provisioning_console`, `portal_list_provisioning_events`, `portal_release_suppressed_email`, `portal_return_to_analysis` |  | `portal-invite-send` |
| `src/services/portalScope.ts` | `portal_open_inspection` |  |  |
| `src/services/reconciliacao.ts` | `confirm_unified_pix_matches`, `reverse_demurrage_payment`, `reverse_invoice_payment` | `demurrage_invoice_history`, `demurrage_invoices`, `invoices` |  |
| `src/services/reports.ts` |  | `bls`, `invoice_receivable_links`, `invoices` |  |
| `src/services/review.ts` | `save_bl_review`, `save_granite_bl_review` |  |  |
| `src/services/reviewBillingAutomation.ts` |  | `bls` |  |
| `src/services/reviewCustomerGroup.ts` | `complete_review_customer_group` |  |  |
| `src/services/transshipments.ts` | `omit_voyage_escala`, `revert_voyage_omission`, `set_bl_cod`, `set_bl_transshipment`, `update_voyage_omission` | `bl_transshipments`, `voyage_omissions` |  |
| `src/services/vaziosExportOperations.ts` | `create_manual_vazios_booking`, `delete_manual_vazios_booking`, `update_manual_vazios_booking` | `vazios_bookings`, `vazios_export_operations`, `vazios_export_service_lines` |  |
| `src/services/vaziosImport.ts` | `import_vazios_bookings_transactional` | `vazios_bookings` |  |
| `src/services/vaziosImportacaoImport.ts` | `delete_baplie_manifest_for_voyage`, `import_vazios_importacao_transactional`, `replace_vazios_from_baplie_transactional` | `vazios_importacao_containers`, `vazios_importacao_manifests` |  |
| `src/services/vaziosNatureza.ts` |  | `bl_containers`, `vazios_importacao_containers`, `vazios_importacao_manifests` |  |
| `src/services/vehicleImport.ts` | `import_vehicle_rows_transactional` | `bl_containers`, `bls`, `vehicles` |  |
| `src/services/vehicles.ts` |  | `vehicles` |  |
| `src/services/vesselScheduleAdmin.ts` | `archive_vessel_schedule`, `reorder_vessel_schedules` |  |  |
| `src/services/voyageExportSchedules.ts` | `save_voyage_escala_terminal_state` | `voyage_escala_operation_fronts`, `voyage_escala_terminal_state`, `voyage_export_schedules` |  |
| `src/services/voyageFromSchedule.ts` |  | `bls`, `voyage_escala_revision_state` |  |
| `src/services/voyageRouteSchedules.ts` | `set_voyage_route_ce_master` | `audit_logs`, `voyage_route_ce_master`, `voyages` |  |
| `src/services/voyageTimeline.ts` |  | `audit_logs`, `baplie_containers`, `baplie_reconciliation_resolutions`, `import_batches`, `user_profiles` |  |
| `src/services/voyages.ts` |  | `audit_logs`, `bls`, `carriers`, `granite_manifests`, `import_batches`, `vazios_manifests`, `vessels`, `voyages` |  |

## Recuperação e arquivamento

O trabalho de 18/09 estava preservado no stash `d99f8d1d`. Foi recuperado em
worktree isolado sobre `a0fa5001`, incluindo as correções da PR 703. O stash e
o checkout de origem foram preservados. Antes da PR, a branch foi atualizada
sobre `212b568d` da main, que já contém a PR 703 e a governança de skills.
Essa base mantém três planos ativos; todos permanecem abertos.

- [Notas antigas do índice de planos](../reports/2026-09-18-notas-historicas-indice-planos.md).
- [Notas cronológicas da rastreabilidade](../reports/2026-09-19-notas-historicas-rastreabilidade.md).
- Nenhum plano incompleto ou spec futura foi arquivado como concluído.
- Exemplos históricos de documentação de skills e cabeçalhos das migrations
  preservam o nome antigo. Diretrizes vivas apontam para AGENTS.

## Validação local — 2026-09-19

- Transferência integral: corpo do antigo arquivo canônico comparado com AGENTS,
  com apenas o título alterado; assertion de 2026-09-18 preservada.
- Gate documental: links relativos vivos, 69 ADRs indexadas, 11 módulos com
  sete seções ordenadas e oito colunas, rotas extraídas por AST.
  O total conta padrões de caminho resolvidos únicos; inclui índices e wildcard,
  sem contar `billing`, `operacao` e `perfil` relativos como rotas adicionais.
- Autotestes: gate documental (caso válido e sete rejeições), extrator de rotas
  (índice, composição, wildcard, expressão literal e rejeição de caminho dinâmico),
  gate de migrations (10 cenários, AGENTS e compatibilidade histórica).
- ESLint focado e `npm run lint` integral após atualização da base: passaram.
- Após atualizar a base: gates repetidos e 32 testes passaram em seis arquivos
  (modalidades, escala, redirects, referências legadas e páginas de B/L).
- Vitest focado: 13 arquivos passaram; 61 testes passaram e 6 ficaram skipped.
  Abrange modalidades/pesos/cubagem, estado da escala, redirects financeiros,
  contratos SQL de terminal/tarifas/CE/pesos, referências legadas e páginas de B/L.
  Não equivale à suíte integral, a replay de SQL ou a teste em produção.
- `migrations:check`: 63 migrations; 11 destrutivas; 10 anteriores à regra da
  061 mantidas como histórico pelo próprio gate. Nenhuma migration foi editada.
- `git diff --check`: sem saída, exit 0.

Saída final de `npm run docs:check`:

```text
> vela@0.0.0 docs:check
> node scripts/check-docs.mjs

Documentation checks passed: 154 Markdown files, 55 routes, and ADR index coverage verified.
```
