// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'report-operational') {
      return {
        data: {
          kpis: { totalBls: 5, totalContainers: 8, totalVoyages: 2, totalWeightKg: 1000, totalCbm: 50, truncated: false },
          rows: [{
            id: 'BL-OP-1', voyage: { vessel: { name: 'NAV' }, voyage_number: 'V9' }, pol: 'BRSSZ', pod: 'BRVIT',
            customer: { name: 'Cliente Op' }, bl_containers: [], total_weight_kg: 1000, bb_weight_ton: 2.5, total_cbm: 50,
            review_status: 'reviewed', financial_status: 'pending',
          }],
        },
        isLoading: false,
        error: null,
      }
    }
    if (queryKey[0] === 'demurrage-report') {
      return {
        data: [
          {
            id: 'd1', doc_number: 'DEM-1', bl_id: 'BL-9', status: 'issued', total_usd: 100,
            current_total_brl: 500, doc_date: '2026-05-10', due_date: null, customer: { name: 'Cliente Dem' },
          },
          {
            id: 'd2', doc_number: 'DEM-2', bl_id: 'BL-8', status: 'cancelled', total_usd: 900,
            current_total_brl: 4500, doc_date: '2026-05-11', due_date: null, customer: { name: 'Cliente Cancelado' },
          },
        ],
        isLoading: false,
        error: null,
      }
    }
    return { data: undefined, isLoading: false, error: null }
  },
}))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../services/supabase', () => ({ supabase: { from: vi.fn() } }))

import { Relatorios } from '../Relatorios'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('US-139: consulta operacional exibe KPIs e linhas do relatorio', () => {
  render(<Relatorios />)

  expect(screen.getByText('B/Ls')).toBeTruthy()
  expect(screen.getByText('Containers distintos')).toBeTruthy()
  expect(screen.getByText('BL-OP-1')).toBeTruthy()
  expect(screen.getByText('Cliente Op')).toBeTruthy()
  expect(screen.getByText('3.500')).toBeTruthy()
})

it('US-142: consulta demurrage lista as invoices do periodo', () => {
  render(<Relatorios />)

  fireEvent.click(screen.getByRole('tab', { name: 'Demurrage' }))

  expect(screen.getByText('DEM-1')).toBeTruthy()
  expect(screen.getByText('BL-9')).toBeTruthy()
  expect(screen.getByText('Cliente Dem')).toBeTruthy()
  expect(screen.getAllByText('Total USD').length).toBeGreaterThan(0)
})

// Faturas canceladas continuam listadas, mas somá-las inflaria os indicadores.
it('US-142: totais de demurrage ignoram faturas canceladas', () => {
  render(<Relatorios />)

  fireEvent.click(screen.getByRole('tab', { name: 'Demurrage' }))

  expect(screen.getByText('DEM-2')).toBeTruthy()
  expect(screen.getByText('Total USD (exceto canceladas)').nextSibling?.textContent).toContain('100,00')
  expect(screen.getByText('Faturado (BRL)').nextSibling?.textContent).toContain('500,00')
  expect(screen.getByText('Recebido (BRL)').nextSibling?.textContent).toContain('0,00')
})
