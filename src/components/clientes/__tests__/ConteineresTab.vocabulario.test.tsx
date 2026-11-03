// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { __setDemurrageRateGroupsForTest } from '../../../services/demurrage/demurrageRates'
import type { DemurrageContainerRow } from '../../../services/demurrage/demurrageContainers'

const rows: DemurrageContainerRow[] = []

vi.mock('../../../hooks/useCustomerFicha', () => ({
  useCustomerContainers: () => ({ data: rows, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

const { ConteineresTab } = await import('../ConteineresTab')

function row(overrides: Partial<DemurrageContainerRow>): DemurrageContainerRow {
  return {
    id: 1,
    bl_id: 'BL-1',
    container_number: 'TGHU0000001',
    type: '40HC',
    discharge_date: '2026-09-01',
    return_date: null,
    demurrage_status: 'overdue',
    ownership: 'COC',
    bl: { id: 'BL-1', pol: 'CNSHA', pod: 'BRSSZ', free_time_override: null, demurrage_rate_override_p1_usd: null, demurrage_rate_override_p2_usd: null, demurrage_roe_manual: null, demurrage_roe: null, voyage_id: 10, customer: { id: 7, name: 'Cliente', cnpj_cpf: '1' }, voyage: null },
    customer_agreement: null,
    billed_in: [],
    ...overrides,
  } as DemurrageContainerRow
}

afterEach(() => {
  __setDemurrageRateGroupsForTest(null)
  rows.length = 0
})

describe('ficha do Cliente › Containers: vocabulário da Demurrage (decisão de 2026-11-03)', () => {
  it('diz "correndo" e "a emitir", como a página Demurrage, e nunca "em curso" nem "a faturar"', () => {
    __setDemurrageRateGroupsForTest([{ aliases: ['40HC'], freeUntil: 21, p1: { range: [22, 30], usd: 70 }, p2: { range: [31, Infinity], usd: 140 } }])
    rows.push(row({ id: 1, container_number: 'TGHU0000001' }), row({ id: 2, container_number: 'TGHU0000002', return_date: '2026-09-28' }))

    render(<MemoryRouter><ConteineresTab data={{ id: 7 } as never} /></MemoryRouter>)

    const running = screen.getByText('TGHU0000001').closest('tr')!
    const toIssue = screen.getByText('TGHU0000002').closest('tr')!
    expect(within(running).getByText('correndo')).toBeTruthy()
    expect(within(toIssue).getByText('a emitir')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Demurrage correndo' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Demurrage a emitir' })).toBeTruthy()
    expect(screen.queryByText(/em curso|a faturar/)).toBeNull()
  })
})
