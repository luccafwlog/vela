import { describe, expect, it } from 'vitest'
import { describeTimelineEvent, familyLabel, isAudited } from '../blTimelinePresentation'

describe('describeTimelineEvent', () => {
  it('nomeia o container e o campo vindos da auditoria por coluna (migration 079)', () => {
    const devolucao = { family: 'container', entity_type: 'bl_container', field_name: 'return_date|TCLU1234567', old_value: null, new_value: '2026-10-20', justification: null } as never
    expect(describeTimelineEvent(devolucao)).toBe('Container TCLU1234567 · Devolução: - → 20/10/2026')
    const imo = { family: 'container', entity_type: 'bl_container', field_name: 'is_imo|TCLU1234567', old_value: 'false', new_value: 'true', justification: null } as never
    expect(describeTimelineEvent(imo)).toBe('Container TCLU1234567 · IMO: Não → Sim')
  })
  it('humanizes a field edit', () => {
    const e = { family: 'edicao', entity_type: 'bl', field_name: 'notify_party', old_value: 'X', new_value: 'Y', justification: 'ajuste' } as never
    expect(describeTimelineEvent(e)).toBe('Notify Party: X → Y')
  })
  it('normalizes multiple NCM values without splitting each character', () => {
    const eNcm = { family: 'edicao', entity_type: 'bl', field_name: 'ncm_codes', old_value: '{8703|8471}', new_value: '["8703","8471"]', justification: 'ajuste' } as never
    expect(describeTimelineEvent(eNcm)).toBe('NCM: 8703, 8471 → 8703, 8471')
  })

  it('translates status values only in their own fields', () => {
    const review = { family: 'edicao', entity_type: 'bl', field_name: 'review_status', old_value: 'pending_review', new_value: 'ok', justification: 'ok' } as never
    expect(describeTimelineEvent(review)).toBe('Status de revisão: Pendente → OK')

    const charge = { family: 'taxas', entity_type: 'bl', field_name: 'charge_status', old_value: 'null', new_value: 'ready_for_billing', justification: null } as never
    expect(describeTimelineEvent(charge)).toBe('Status das taxas: - → Pronto para faturar')

    const financial = { family: 'fatura', entity_type: 'bl', field_name: 'financial_status', old_value: 'pending', new_value: 'partially_paid', justification: null } as never
    expect(describeTimelineEvent(financial)).toBe('Status financeiro: Pendente → Parcialmente pago')

    const notes = { family: 'edicao', entity_type: 'bl', field_name: 'notes', old_value: null, new_value: 'ok', justification: 'ajuste' } as never
    expect(describeTimelineEvent(notes)).toBe('Notas: - → ok')
  })
  it('humanizes an invoice event', () => {
    const e = { family: 'fatura', entity_type: 'invoice', field_name: 'create_invoice', old_value: null, new_value: 'INV-2026-0103', justification: null } as never
    expect(describeTimelineEvent(e)).toMatch(/Fatura/i)
  })
  it('maps family labels', () => {
    expect(familyLabel('taxas')).toBe('Taxas')
  })
  it('flags audited entries (with justification)', () => {
    expect(isAudited({ justification: 'motivo' } as never)).toBe(true)
    expect(isAudited({ justification: null } as never)).toBe(false)
  })
})
