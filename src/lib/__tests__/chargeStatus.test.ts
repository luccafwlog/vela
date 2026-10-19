import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  REPORT_LOCAL_CHARGES_STATE_LABELS,
  isChargeExempt,
  isChargePending,
  isChargeReady,
  localChargesListState,
  reportLocalChargesState,
  summarizeChargeStatuses,
} from '../chargeStatus'

describe('chargeStatus', () => {
  it('agrupa pendente / pronto / isento', () => {
    const rows = [
      { charge_status: 'review_required' },
      { charge_status: 'not_calculated' },
      { charge_status: 'ready_for_billing' },
      { charge_status: 'exempt' },
      { charge_status: 'calculated' },
      { charge_status: null },
    ]
    expect(summarizeChargeStatuses(rows)).toEqual({ pending: 2, ready: 1, exempt: 1 })
  })

  it('predicados não se sobrepõem', () => {
    for (const status of ['not_calculated', 'calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt']) {
      const hits = [isChargePending(status), isChargeReady(status), isChargeExempt(status)].filter(Boolean)
      expect(hits.length).toBeLessThanOrEqual(1)
    }
  })

  it('Taxas Locais da lista: Isenta vence, fatura emitida ou paga é Emitida, o resto é Pendente', () => {
    expect(localChargesListState('exempt', 'pending')).toBe('exempt')
    expect(localChargesListState('ready_for_billing', 'invoiced')).toBe('issued')
    expect(localChargesListState('review_required', 'partially_paid')).toBe('issued')
    expect(localChargesListState('ready_for_billing', 'paid')).toBe('issued')
    // Calculado ou pronto sem fatura ainda impede a emissão: é Pendente.
    expect(localChargesListState('calculated', 'pending')).toBe('pending')
    expect(localChargesListState('ready_for_billing', 'cancelled')).toBe('pending')
    expect(localChargesListState(null, null)).toBe('pending')
  })

  it('B/L cancelado não é Pendente nem Emitida (migration 226)', () => {
    expect(localChargesListState('ready_for_billing', 'pending', '2026-10-01T00:00:00Z')).toBe('cancelled')
    expect(localChargesListState('calculated', 'invoiced', '2026-10-01T00:00:00Z')).toBe('cancelled')
  })

  it('o espelho SQL (migration 226) usa os mesmos estados', () => {
    const sql = fs.readFileSync(new URL('../../../supabase/migrations/226_taxas_pendentes_sem_bl_cancelado.sql', import.meta.url), 'utf8')
    expect(sql).toContain("WHEN p_cancelled_at IS NOT NULL THEN 'cancelled'")
    expect(sql).toContain("WHEN lower(btrim(coalesce(p_charge_status, ''))) = 'exempt' THEN 'exempt'")
    expect(sql).toContain("IN ('invoiced', 'partially_paid', 'paid') THEN 'issued'")
    expect(sql).toContain("'chargePending', count(*) FILTER (WHERE public.bl_local_charges_state(charge_status, financial_status, cancelled_at) = 'pending')")
  })
})

describe('reportLocalChargesState (coluna "Taxas locais" do relatório Operacional)', () => {
  it('separa Paga de Emitida e mantém os estados da lista de BLs', () => {
    expect(reportLocalChargesState('ready_for_billing', 'paid')).toBe('paid')
    expect(reportLocalChargesState('ready_for_billing', 'invoiced')).toBe('issued')
    expect(reportLocalChargesState('ready_for_billing', 'partially_paid')).toBe('issued')
    expect(reportLocalChargesState('exempt', 'paid')).toBe('exempt')
    expect(reportLocalChargesState('review_required', 'pending')).toBe('pending')
    expect(reportLocalChargesState(null, null)).toBe('pending')
    expect(reportLocalChargesState('ready_for_billing', 'paid', '2026-10-01T00:00:00Z')).toBe('cancelled')
  })

  it('escreve os rótulos da lista de BLs, com "Paga"', () => {
    expect(REPORT_LOCAL_CHARGES_STATE_LABELS).toEqual({
      pending: 'Pendente',
      issued: 'Emitida',
      exempt: 'Isenta',
      cancelled: 'B/L cancelado',
      paid: 'Paga',
    })
  })
})
