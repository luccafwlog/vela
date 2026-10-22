# 2026-10-21 — Testes de contrato financeiros sobre SQL arquivado

Relatório de levantamento (F-42 do plano da frente financeira). Nasce
histórico: registra o que valia nesta data.

## O que é

`src/test/setup.ts` desvia a leitura de `supabase/migrations/<arquivo>` para
`supabase/migrations_archive/` quando o arquivo não existe mais na cadeia viva.
Os testes `*Migration.test.ts` abaixo leem o texto de migrations arquivadas
(pré-squash) e passam sobre esse SQL histórico: verificam um contrato que pode
já ter sido substituído por definições posteriores (squash `002` e migrations
`3xx`). Não provam o comportamento atual. O comportamento financeiro atual é
verificado pelas suítes local-pg, que aplicam a cadeia viva num Postgres 16
descartável (`npm run test:local-pg`).

## Fonte

Busca nesta data, em `src/**/*.test.ts` fora das suítes local-pg, por
referências `migrations/NNN_*.sql` que só existem em `migrations_archive`,
filtradas por termos financeiros (fatura, Pix, pagamento, recebível,
restituição, Demurrage, cobrança, faturamento, ledger, COD).

## Lista (44 arquivos)

| Teste | Migrations arquivadas lidas |
|---|---|
| `src/services/__tests__/blDemurrageConfigAtomic.test.ts` | `147_save_bl_demurrage_config_atomic.sql` |
| `src/services/__tests__/bloco522Task5Migration.test.ts` | `327_bloco_522_task5_demurrage_alerts.sql` |
| `src/services/__tests__/brazilDemurrageRatesMigration.test.ts` | `279_seed_brazil_demurrage_rates.sql` |
| `src/services/__tests__/chargeLinesTabelaMigration.test.ts` | `151_guard_definer_rpcs_active_user.sql`, `369_charge_lines_expoem_tabela_de_cobranca.sql` |
| `src/services/__tests__/chargeTableValidityInformationalMigration.test.ts` | `274_charge_table_validity_is_informational.sql` |
| `src/services/__tests__/codAdjustmentsMigration.test.ts` | `313_cod_adjustment_settlement.sql` |
| `src/services/__tests__/codJustificationMigration.test.ts` | `310_cod_justification.sql` |
| `src/services/__tests__/consolidatedInvoiceBreakdownMigration.test.ts` | `090_restrict_consolidated_invoice_breakdown.sql` |
| `src/services/__tests__/createDemurrageInvoiceMigration.test.ts` | `132_create_demurrage_invoice_atomic.sql` |
| `src/services/__tests__/customerCommunicationReadinessMigration.test.ts` | `376_customer_local_charges_communication_readiness.sql` |
| `src/services/__tests__/customerDemurrageAgreementsMigration.test.ts` | `366_customer_demurrage_agreements.sql` |
| `src/services/__tests__/customerReceivablesReadRpcMigration.test.ts` | `216_customer_receivables_read_rpc.sql` |
| `src/services/__tests__/demurrageInvoiceHistoryRlsMigration.test.ts` | `160_demurrage_invoice_history_rls_active.sql` |
| `src/services/__tests__/demurrageInvoiceUniqueActiveMigration.test.ts` | `169_demurrage_invoice_unique_active.sql` |
| `src/services/__tests__/demurrageRecalcAndPixWindowMigration.test.ts` | `155_demurrage_recalculate_rpcs.sql`, `158_demurrage_pix_window_conciliation.sql` |
| `src/services/__tests__/escalaUnificadaMigration.test.ts` | `250_voyage_export_schedules_por_escala.sql`, `251_agency_report_pending_escala_unificada.sql`, `254_voyage_export_schedules_discharge_ports.sql` |
| `src/services/__tests__/fixReview501FaturamentoMigration.test.ts` | `270_fix_review_501_faturamento.sql` |
| `src/services/__tests__/freezeConsolidatedInvoiceItemsMigration.test.ts` | `261_freeze_consolidated_invoice_items.sql` |
| `src/services/__tests__/guardInvoiceableReadyStateMigration.test.ts` | `127_guard_invoiceable_ready_state.sql` |
| `src/services/__tests__/guardManualChargesMigration.test.ts` | `108_guard_manual_charges_and_clear_pix_on_reversal.sql` |
| `src/services/__tests__/ledgerBackfillExceptionReportMigration.test.ts` | `072_ledger_backfill_exception_report.sql` |
| `src/services/__tests__/ledgerConsolidatedReissueMigration.test.ts` | `076_ledger_consolidated_reissue_links.sql` |
| `src/services/__tests__/ledgerIndividualRpcMigration.test.ts` | `070_ledger_individual_invoice_rpc.sql`, `268_local_charges_usd_conversion_at_emission.sql` |
| `src/services/__tests__/ledgerObsoleteConsolidatedLinksMigration.test.ts` | `073_ledger_obsolete_consolidated_links.sql` |
| `src/services/__tests__/ledgerPartialPaymentsMigration.test.ts` | `104_register_ledger_partial_payments.sql` |
| `src/services/__tests__/ledgerPhase4dMigration.test.ts` | `069_ledger_portal_reports_phase4d.sql` |
| `src/services/__tests__/ledgerPixPayloadMigration.test.ts` | `074_ledger_invoice_pix_payload.sql` |
| `src/services/__tests__/ledgerPixSettlementTxidMigration.test.ts` | `075_ledger_pix_txid_single_settlement_row.sql` |
| `src/services/__tests__/ledgerSettlementGuardsMigration.test.ts` | `071_ledger_settlement_uniqueness_guards.sql` |
| `src/services/__tests__/localChargesUsdConversionMigration.test.ts` | `268_local_charges_usd_conversion_at_emission.sql` |
| `src/services/__tests__/lockRecalcInvoicedBlMigration.test.ts` | `262_lock_recalc_invoiced_bl.sql` |
| `src/services/__tests__/manifestImportBillingReasonMigration.test.ts` | `126_preserve_customer_billing_block_reason.sql` |
| `src/services/__tests__/markBlsReadyAndCreateInvoiceMigration.test.ts` | `133_mark_bls_ready_and_create_invoice_atomic.sql` |
| `src/services/__tests__/overdueInvoiceAlertsMigration.test.ts` | `168_overdue_invoice_alerts_ptbr_entity.sql` |
| `src/services/__tests__/overdueInvoiceDetectorServerOnlyMigration.test.ts` | `329_financeiro_overdue_detector_server_only.sql` |
| `src/services/__tests__/pixExactAndRefundsMigration.test.ts` | `111_pix_exact_and_manual_overpayment_refunds.sql` |
| `src/services/__tests__/pixUnreconciledMigration.test.ts` | `328_pix_unreconciled_persistence.sql` |
| `src/services/__tests__/portalInvoiceConsolidatedBreakdownMigration.test.ts` | `120_portal_invoice_consolidated_breakdown.sql` |
| `src/services/__tests__/portalInvoiceExceptionAudienceMigration.test.ts` | `377_portal_invoice_exception_audience.sql` |
| `src/services/__tests__/portalInvoiceHistoryLinksMigration.test.ts` | `105_portal_invoice_history_links.sql` |
| `src/services/__tests__/reversalJustificationMigration.test.ts` | `113_require_justification_on_payment_reversal.sql` |
| `src/services/__tests__/settleInvoiceRefundsMigration.test.ts` | `112_settle_invoice_refunds.sql` |
| `src/services/__tests__/stopAndFlagUncalculableChargesMigration.test.ts` | `264_stop_and_flag_uncalculable_charges.sql` |
| `src/services/demurrage/__tests__/demurrageInvoiceItemConsistency.test.ts` | `204_demurrage_invoice_item_consistency.sql` |

## Encaminhamento

- Contrato financeiro novo vai para suíte local-pg sobre o catálogo vivo, como
  as suítes das migrations `354` a `377`.
- Os testes listados continuam como registro do SQL que introduziu cada regra;
  não devem ser lidos como prova do comportamento atual. Trocá-los por suítes
  local-pg é trabalho à parte, sem plano aberto nesta data.
