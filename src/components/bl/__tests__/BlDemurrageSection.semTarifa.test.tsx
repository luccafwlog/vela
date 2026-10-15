// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BlDemurrageSection } from '../BlDemurrageSection'
import { __setDemurrageRateGroupsForTest } from '../../../services/demurrage/demurrageRates'
import type { BLDetail } from '../../../types/database'

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../../hooks/useCustomerDemurrageAgreements', () => ({ useCustomerDemurrageAgreements: () => ({ data: [] }) }))
vi.mock('../../../services/demurrage/demurrageRates', async (original) => ({
  ...(await original() as object),
  ensureDemurrageRatesLoaded: () => Promise.resolve(),
}))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))

// Tabela real de tarifas só com 40HC: um contêiner sem tipo, ou de tipo sem
// tarifa, não pode derrubar a aba Faturamento (a ficha inteira ia para a tela
// de erro); o erro fica na linha e o bloco de condições diz "Sem tarifa".
function renderSection(containers: Array<{ type: string | null; ownership: string | null; return_date?: string | null }>) {
  __setDemurrageRateGroupsForTest([{ aliases: ['40HC'], freeUntil: 10, p1: { range: [11, 20], usd: 50 }, p2: { range: [21, 9999], usd: 80 } }])
  const bl = {
    id: 'BL-SEM-TARIFA',
    bl_containers: containers.map((container, index) => ({
      id: index + 1,
      container_number: `MSCU${String(1234560 + index)}`,
      discharge_date: '2026-05-01',
      return_date: null,
      ...container,
    })),
  } as unknown as BLDetail
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><BlDemurrageSection bl={bl} /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BlDemurrageSection — contêiner sem tarifa', () => {
  afterEach(() => __setDemurrageRateGroupsForTest(null))

  it('contêiner sem tipo mostra "Sem tarifa" nas condições e não calcula a Demurrage', async () => {
    renderSection([{ type: null, ownership: 'COC' }, { type: '40HC', ownership: 'COC', return_date: '2026-05-05' }])
    expect(await screen.findByText('Condições de Demurrage deste B/L')).toBeTruthy()
    expect(screen.getByText('Sem tarifa de Demurrage para este tipo')).toBeTruthy()
    expect(screen.getByText('Demurrage não calculada para 1 de 2 contêineres')).toBeTruthy()
    expect(screen.getByText('10 dias · US$ 50,00 por dia (dias 11 a 20) · US$ 80,00 por dia a partir do dia 21', { exact: false })).toBeTruthy()
  })

  it('SOC de tipo sem tarifa não entra nas condições', async () => {
    renderSection([{ type: 'XX99', ownership: 'SOC' }])
    expect(await screen.findByText('Condições de Demurrage deste B/L')).toBeTruthy()
    expect(screen.queryByText('Sem tarifa de Demurrage para este tipo')).toBeNull()
  })
})
