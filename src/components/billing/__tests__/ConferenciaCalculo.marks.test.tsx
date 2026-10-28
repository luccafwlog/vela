// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const lines = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('../../../hooks/useLocalCharges', () => ({
  useBlLocalChargeLines: () => ({ data: lines.data, isLoading: false, isError: false }),
  useInvoicedSubtotalForBl: () => ({ data: null }),
}))

import { ConferenciaCalculo } from '../ConferenciaCalculo'

afterEach(cleanup)

describe('Conferência do cálculo com taxa alterada à mão (ADR 0111)', () => {
  it('marca alterada (valor da tabela no título) e excluída', () => {
    lines.data = [
      { id: 1, charge_name: 'THD', source: 'auto', status: 'calculated', charge_table_id: 9, currency: 'BRL', quantity: 2,
        unit_value_brl: 1200, total_value_brl: 2400, table_unit_value_brl: 1420, table_total_value_brl: 2840,
        application_basis: 'container_distinct_voyage', adjustment_id: 3, adjustment_kind: 'unit' },
      { id: 2, charge_name: 'Taxa X', source: 'auto', status: 'excluded', charge_table_id: 9, currency: 'BRL', quantity: 1,
        unit_value_brl: 300, total_value_brl: 0, table_unit_value_brl: 300, table_total_value_brl: 300, adjustment_id: 4, adjustment_kind: 'excluded' },
    ]
    render(<ConferenciaCalculo blId="BL-1" financialStatus="pending" />)
    expect(screen.getByText('alterada').closest('span[title]')?.getAttribute('title')).toMatch(/^Tabela: R\$\s1\.420,00 por container/)
    expect(screen.getByText('excluída')).toBeTruthy()
  })
})
