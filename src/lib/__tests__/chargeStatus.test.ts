import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { isChargeExempt, isChargePending, isChargeReady, localChargesListState, summarizeChargeStatuses } from '../chargeStatus'

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

  it('o espelho SQL (migration 222) usa os mesmos estados financeiros', () => {
    const sql = fs.readFileSync(new URL('../../../supabase/migrations/222_estado_taxas_locais_lista_bls.sql', import.meta.url), 'utf8')
    expect(sql).toContain("WHEN lower(btrim(coalesce(p_charge_status, ''))) = 'exempt' THEN 'exempt'")
    expect(sql).toContain("IN ('invoiced', 'partially_paid', 'paid') THEN 'issued'")
    expect(sql).toContain("'chargePending', count(*) FILTER (WHERE public.bl_local_charges_state(charge_status, financial_status) = 'pending')")
  })
})
