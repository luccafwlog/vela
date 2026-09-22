// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlDetalhe } from '../BlDetalhe'

const { useBlDetailMock } = vi.hoisted(() => ({
  useBlDetailMock: vi.fn(),
}))

vi.mock('../../hooks/useBls', () => ({
  useBlDetail: useBlDetailMock,
}))

vi.mock('../../hooks/useBlCockpit', () => ({
  useBlCockpit: () => ({ data: null }),
}))

vi.mock('../../hooks/useBilling', () => ({
  useInvoiceLinks: () => ({ data: {} }),
}))

vi.mock('../../hooks/useVoyageReconciliation', () => ({
  useVoyageReconciliation: () => ({ data: null, isLoading: false, isError: false }),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, profile: { id: 'u1' } }),
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
}))

vi.mock('../../components/shared/ImportResultPanel', () => ({
  ImportResultPanel: ({ entityId, title = 'Processamento pós-importação' }: { entityId?: string | null; title?: string }) => (
    <section aria-label={title} data-entity-id={entityId ?? ''}>{title}</section>
  ),
}))

vi.mock('../../hooks/useTransshipments', () => ({
  useSetBlDisposition: () => ({
    setTransshipment: { mutate: vi.fn(), isPending: false },
    setCod: { mutate: vi.fn(), isPending: false },
  }),
}))

describe('BlDetalhe - B/L Misto e Rota Canônica', () => {
  beforeEach(() => {
    useBlDetailMock.mockReset()
    useBlDetailMock.mockReturnValue({
      data: {
        id: 'BL-MISTO-1',
        cargo_mode: 'misto',
        terminal_id: 12,
        terminal: { id: 12, name: 'Terminal TVV' },
        pol: 'BRSSZ',
        pod: 'BRVIX',
        voyage_id: 10,
        voyage: {
          id: 10,
          voyage_number: '001',
          vessel: { name: 'Navio Alfa', carrier: { name: 'Armador X' } },
        },
        bl_containers: [
          {
            id: 1,
            container_number: 'MSKU1234567',
            type: '40HC',
            gross_weight_kg: 22000,
            cbm: 60,
          },
        ],
        bl_breakbulk_items: [
          {
            id: 2,
            item_description: 'Tubos de aço',
            package_qty: 10,
            package_unit: 'UN',
            gross_weight_kg: 15000,
            cbm: 30,
          },
        ],
        bb_weight_ton: 15,
        bb_packages_qty: 10,
        charge_status: 'ready_for_billing',
        financial_status: 'pending',
      },
      isLoading: false,
      error: null,
    })
  })

  it('exibe badge de modalidade Misto e botão voltar para /bls', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-MISTO-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Título / Modalidade
    // Rótulo único: a lista, o export e o detalhe escreviam nomes diferentes
    // para a mesma modalidade.
    expect(screen.getAllByText('Misto').length).toBeGreaterThan(0)

    // Botão Voltar para /bls
    const backLinks = screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/bls')
    expect(backLinks.length).toBeGreaterThanOrEqual(1)

    // Indicação do terminal de descarga unificado
    expect(screen.getByText('Terminal TVV')).toBeTruthy()
  })

  it('mantém a vitrine do processamento físico da viagem para B/L com containers', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-MISTO-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const panel = screen.getByRole('region', { name: 'Processamento físico da viagem' })
    expect(panel.getAttribute('data-entity-id')).toBe('10')
  })

  it('renderiza painel conjunto de containers e carga solta na aba Carga', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-MISTO-1?tab=carga']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Ambos os blocos de carga devem estar presentes simultaneamente para B/L misto
    expect(screen.getByText('Containers vinculados')).toBeTruthy()
    expect(screen.getByText('MSKU1234567')).toBeTruthy()

    expect(screen.getByText('Resumo da carga solta')).toBeTruthy()
    expect(screen.getByText('Tubos de aço')).toBeTruthy()
  })
})
