// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BlDemurrageSection } from '../BlDemurrageSection'
import { __setDemurrageRateGroupsForTest } from '../../../services/demurrage/demurrageRates'
import type { BLDetail } from '../../../types/database'

const coverage = vi.hoisted(() => ({ map: new Map<string, Array<{ id: number; doc_number: string; status: string; bl_id: string }>>() }))

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useCustomerDemurrageAgreements', () => ({ useCustomerDemurrageAgreements: () => ({ data: [] }) }))
vi.mock('../../../services/demurrage/demurrageRates', async (original) => ({
  ...(await original() as object),
  ensureDemurrageRatesLoaded: () => Promise.resolve(),
}))
vi.mock('../../../services/demurrage/demurrageContainers', () => ({
  readDemurrageGroupAnchor: async (blId: string) => blId,
  updateContainerReturnDate: vi.fn(),
  listBlDemurrageCoverage: async () => coverage.map,
  listBlDemurrageWaivers: async () => new Map(),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))

afterEach(() => __setDemurrageRateGroupsForTest(null))

// B/L que não é o âncora do grupo: a Invoice do grupo nasceu no outro B/L
// (bl_id diferente) e cobre a caixa paga; a outra caixa voltou e falta emitir.
function renderSection() {
  __setDemurrageRateGroupsForTest([{ aliases: ['40HC'], freeUntil: 10, p1: { range: [11, 20], usd: 50 }, p2: { range: [21, 9999], usd: 80 } }])
  coverage.map = new Map([['MSCU0000001', [{ id: 9, doc_number: 'DEM-2026-0009', status: 'paid', bl_id: 'BL-ANCORA' }]]])
  const bl = {
    id: 'BL-SEGUNDO',
    voyage_id: 5,
    customer_id: 7,
    bl_containers: [
      { id: 1, container_number: 'mscu0000001 ', type: '40HC', ownership: 'COC', discharge_date: '2026-05-01', return_date: '2026-05-20' },
      { id: 2, container_number: 'MSCU0000002', type: '40HC', ownership: 'COC', discharge_date: '2026-05-01', return_date: '2026-05-16' },
    ],
  } as unknown as BLDetail
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><BlDemurrageSection bl={bl} invoices={[]} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ficha do B/L › Demurrage com a Invoice do grupo', () => {
  it('a caixa paga mostra a Invoice, não "a faturar", e o dado principal separa cobrado e a emitir', async () => {
    renderSection()

    const paidRow = (await screen.findAllByText('DEM-2026-0009', { selector: 'td a' }))[0].closest('tr')!
    expect(within(paidRow).queryByText('a faturar')).toBeNull()
    expect(within(paidRow).getByText(/Pago/)).toBeTruthy()

    // A outra caixa voltou com 5 dias de sobreestadia sem Invoice: a emitir.
    expect(screen.getByText('US$ 250,00 a emitir')).toBeTruthy()
    expect(screen.getByText(/1 cobrado · 1 a emitir de 2/)).toBeTruthy()
    // A Invoice do grupo aparece nas faturas do B/L, mesmo emitida no outro B/L.
    expect(screen.getByText('Fatura de Demurrage')).toBeTruthy()
  })
})
