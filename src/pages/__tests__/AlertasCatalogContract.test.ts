import { describe, expect, it } from 'vitest'
import { readSqlAlertCatalog } from '../../services/__tests__/alertCatalogSql'
import { ENTITY_TYPE_LABELS, TYPE_LABELS } from '../../services/alerts'

describe('Contrato do catálogo de alertas e tipos de entidade', () => {
  it('todo tipo do alert_type_catalog possui rótulo definido em TYPE_LABELS', () => {
    const catalog = readSqlAlertCatalog()

    expect(catalog).toHaveLength(34)
    expect(catalog.filter((entry) => entry.active)).toHaveLength(30)

    for (const entry of catalog) {
      expect(TYPE_LABELS[entry.type], `Tipo catalogado ${entry.type} não possui rótulo em TYPE_LABELS`).toBeDefined()
      expect(TYPE_LABELS[entry.type].length).toBeGreaterThan(0)
    }
  })

  it('mantém aposentados os tipos sem produtor (migrations 327, 347, 348 e 085)', () => {
    const inactive = readSqlAlertCatalog().filter((entry) => !entry.active).map((entry) => entry.type)

    expect(inactive.sort()).toEqual(['invoice_cancel_blocked', 'invoice_overdue', 'invoice_payment_invalid', 'review_customer_email_missing'])
  })

  it('todos os entity_types da §4 e do domínio possuem rótulo em ENTITY_TYPE_LABELS', () => {
    const requiredEntityTypes = [
      'invoice',
      'container',
      'bl',
      'granite_bl',
      'agency_departure_report',
      'voyage',
      'voyage_pod_schedule',
      'voyage_escala_terminal',
      'customer',
      'demurrage_invoice',
      'exchange_rate_reference',
      'import_effect',
      'pix_transaction',
    ]

    for (const entityType of requiredEntityTypes) {
      expect(ENTITY_TYPE_LABELS[entityType], `Entity type ${entityType} não possui rótulo`).toBeDefined()
    }
  })
})
