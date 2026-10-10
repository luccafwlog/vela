import { describe, expect, it } from 'vitest'
import { financialAlertAction } from '../financialAlertAction'
import type { AlertQueueRow } from '../../../services/alerts'

const alert = (fields: Partial<AlertQueueRow>) => ({ type: '', entity_type: null, entity_id: null, metadata: null, ...fields }) as AlertQueueRow

describe('financialAlertAction', () => {
  it('abre a fatura no lugar, sem trocar a URL inteira', () => {
    expect(financialAlertAction(alert({ type: 'fatura_desatualizada', entity_type: 'invoice', entity_id: '42' }))).toEqual({ kind: 'invoice', invoiceId: 42 })
  })

  it('leva o bloqueio de cobrança do B/L para a Validação filtrada', () => {
    expect(financialAlertAction(alert({ type: 'billing_auto_issue_failed', entity_type: 'bl', entity_id: 'BL-78' }))).toEqual({ kind: 'validacao', blId: 'BL-78' })
  })

  it('mantém a rota de correção própria do alerta', () => {
    expect(financialAlertAction(alert({ type: 'billing_calculation_blocked', entity_type: 'bl', entity_id: 'BL-77', metadata: { correction_route: '/taxas-locais/tabelas' } }))).toEqual({ kind: 'link', to: '/taxas-locais/tabelas' })
  })
})
