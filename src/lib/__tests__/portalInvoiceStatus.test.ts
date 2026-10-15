import { describe, expect, it } from 'vitest'
import { demurrageSituation } from '../portalInvoiceStatus'

describe('demurrageSituation', () => {
  it('Demurrage não vence (B29): o estado legado overdue aparece como Emitida', () => {
    expect(demurrageSituation({ status: 'overdue' })).toEqual({ label: 'Emitida', tone: 'default' })
  })
  it('disputa aberta pede ação; paga e cancelada encerram', () => {
    expect(demurrageSituation({ status: 'overdue', dispute_open: true })).toEqual({ label: 'Em disputa', tone: 'warning' })
    expect(demurrageSituation({ status: 'covered' }).label).toBe('Paga')
    expect(demurrageSituation({ status: 'obsolete' }).tone).toBe('muted')
  })
})
