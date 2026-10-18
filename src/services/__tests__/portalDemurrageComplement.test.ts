import { describe, expect, it } from 'vitest'
import { joinDemurrageDocNumbers, portalDemurrageComplementOf } from '../portalBilling'

const row = (id: number, doc_date: string | null, status = 'issued', bl_id = 'BL-1') => ({ id, doc_number: `DEM-${id}`, doc_date, status, bl_id })

describe('portalDemurrageComplementOf (Invoice complementar no Portal)', () => {
  it('é complementar a Invoice com outra viva anterior do mesmo B/L', () => {
    const original = row(17, '2026-09-23')
    const complement = row(18, '2026-09-30')
    const otherBl = row(16, '2026-09-01', 'issued', 'BL-2')
    expect(portalDemurrageComplementOf(complement, [original, complement, otherBl]).map((r) => r.doc_number)).toEqual(['DEM-17'])
    expect(portalDemurrageComplementOf(original, [original, complement, otherBl])).toEqual([])
  })

  it('ignora a cancelada, aceita a paga e desempata o mesmo dia pelo id', () => {
    const cancelled = row(1, '2026-09-01', 'cancelled')
    const paid = row(2, '2026-09-01', 'paid')
    const sameDay = row(3, '2026-09-01')
    expect(portalDemurrageComplementOf(sameDay, [sameDay, cancelled, paid]).map((r) => r.id)).toEqual([2])
    expect(portalDemurrageComplementOf(paid, [sameDay, cancelled, paid])).toEqual([])
  })

  it('escreve os números numa frase', () => {
    expect(joinDemurrageDocNumbers(['DEM-1'])).toBe('DEM-1')
    expect(joinDemurrageDocNumbers(['DEM-1', 'DEM-2'])).toBe('DEM-1 e a DEM-2')
    expect(joinDemurrageDocNumbers(['DEM-1', 'DEM-2', 'DEM-3'])).toBe('DEM-1, a DEM-2 e a DEM-3')
  })
})
