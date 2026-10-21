import { describe, expect, it } from 'vitest'
import { consigneesNearEta, hasNearEtaMark, type AlertQueueRow } from '../alerts'

function etaItem(status: 'active' | 'resolved', consignees: (string | null)[]): AlertQueueRow {
  return {
    type: 'bl_sem_cliente_perto_eta', item_type: 'bl_sem_cliente_perto_eta', item_status: status,
    entity_id: '10::BRSSZ', metadata: { bls: consignees.map((consignee, i) => ({ bl_id: `B${i}`, consignee })) },
  } as unknown as AlertQueueRow
}

function review(type: string, consignee: string): AlertQueueRow {
  return { type, item_type: type, item_status: 'active', entity_id: consignee, metadata: { consignee } } as unknown as AlertQueueRow
}

describe('selo "ETA próximo" na Revisão de cliente não vinculado', () => {
  it('aparece quando o consignatário tem B/L num alerta ativo de B/L sem Cliente perto do ETA', () => {
    const near = consigneesNearEta([etaItem('active', [' ACME LTDA ', 'OUTRA'])])
    expect(hasNearEtaMark(review('review_customer_unlinked', 'ACME LTDA'), near)).toBe(true)
  })

  it('B/L sem consignatário cruza com a Revisão "sem_cliente"', () => {
    const near = consigneesNearEta([etaItem('active', [null])])
    expect(hasNearEtaMark(review('review_customer_unlinked', 'sem_cliente'), near)).toBe(true)
  })

  it('não aparece quando o alerta de ETA está resolvido', () => {
    const near = consigneesNearEta([etaItem('resolved', ['ACME LTDA'])])
    expect(hasNearEtaMark(review('review_customer_unlinked', 'ACME LTDA'), near)).toBe(false)
  })

  it('não aparece quando o consignatário não está no alerta de ETA', () => {
    const near = consigneesNearEta([etaItem('active', ['OUTRA'])])
    expect(hasNearEtaMark(review('review_customer_unlinked', 'ACME LTDA'), near)).toBe(false)
  })

  it('não aparece em outro tipo de alerta da Revisão', () => {
    const near = consigneesNearEta([etaItem('active', ['ACME LTDA'])])
    expect(hasNearEtaMark(review('review_customer_email_missing', 'ACME LTDA'), near)).toBe(false)
  })
})
