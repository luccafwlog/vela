// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bls } from '../Bls'

const { useBlsMock, useBlSummaryMock } = vi.hoisted(() => ({
  useBlsMock: vi.fn(),
  useBlSummaryMock: vi.fn(),
}))

vi.mock('../../hooks/useBls', () => ({
  useBls: useBlsMock,
  useBlSummary: useBlSummaryMock,
  usePortOptions: () => ({ data: { pols: [], pods: [] } }),
  useVoyageOptions: () => ({ data: [] }),
  fetchAllBls: vi.fn(),
}))
vi.mock('../../hooks/useBilling', () => ({ useInvoiceLinks: () => ({ data: {} }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/shared/CeMercanteImportModal', () => ({ CeMercanteImportModal: () => null }))
vi.mock('../../components/shared/BlImportModal', () => ({ BlImportModal: () => null }))
vi.mock('../../components/shared/FileImportModal', () => ({ FileImportModal: () => null }))
vi.mock('../../components/shared/BlDocumentImportModal', () => ({ BlDocumentImportModal: () => null }))
vi.mock('../../components/shared/BulkActionsBar', () => ({
  BulkActionsBar: ({ count }: { count: number }) => <div>Selecionados: {count}</div>,
}))

describe('Página Bls (unificada)', () => {
  beforeEach(() => {
    useBlsMock.mockReset()
    useBlSummaryMock.mockReset()

    useBlSummaryMock.mockReturnValue({
      data: {
        totalBls: 3,
        totalDistinctContainers: 3,
        breakbulkWeightTon: 50,
        totalWeightTon: 95,
        pendingReview: 1,
        pendingFinancial: 1,
        chargePending: 1,
        chargeReady: 2,
        chargeExempt: 0,
      },
      isLoading: false,
    })

    useBlsMock.mockImplementation(() => ({
      data: {
        rows: [
          {
            id: 'BL-CNTR',
            cargo_mode: 'container',
            consignee: 'Cliente A',
            pol: 'SHA',
            pod: 'SSZ',
            charge_status: 'ready_for_billing',
            bl_containers: [
              { container_number: 'CNTR-1' },
              { container_number: 'CNTR-2' },
            ],
            voyage: { voyage_number: 'V001', vessel: { name: 'Navio A' } },
          },
          {
            id: 'BL-BB',
            cargo_mode: 'carga_solta',
            consignee: 'Cliente B',
            pol: 'ANT',
            pod: 'VIX',
            charge_status: 'review_required',
            bb_weight_ton: 38,
            bl_breakbulk_items: [{ id: 1, gross_weight_kg: 38000 }],
            voyage: { voyage_number: 'V002', vessel: { name: 'Navio B' } },
          },
          {
            id: 'BL-MISTO',
            cargo_mode: 'misto',
            consignee: 'Cliente C',
            pol: 'HAM',
            pod: 'SSZ',
            charge_status: 'ready_for_billing',
            bb_weight_ton: 12,
            bb_machine_qty: 3,
            bb_packages_qty: 9,
            bb_cbm: 45,
            bl_containers: [{
              id: 33,
              container_number: 'CNTR-3',
              type: '40HC',
              seal_number: 'SEAL-3',
              tare_weight_kg: 3800,
              gross_weight_kg: 24000,
              cbm: 67,
              is_imo: true,
              imo_class: '3',
              discharge_date: '2026-03-04',
            }],
            bl_breakbulk_items: [{ id: 2, item_description: 'Bobina', package_qty: 9, package_unit: 'PKG', gross_weight_kg: 12000, cbm: 45, marks: 'MARCA-9' }],
            voyage: { voyage_number: 'V003', vessel: { name: 'Navio C' } },
          },
        ],
        count: 3,
      },
      isLoading: false,
      error: null,
    }))
  })

  it('renderiza os KPI cards com totais consolidados', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('BLs filtrados')).toBeTruthy()
    expect(screen.getByText('CNTRS')).toBeTruthy()
    expect(screen.getAllByText('Carga Solta').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('50 ton')).toBeTruthy()
  })

  it('renderiza os badges de modalidade corretos (contêiner, carga solta e misto)', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Badges na coluna Carga
    expect(screen.getByText('2 CNTR')).toBeTruthy()
    expect(screen.getByText('38 ton')).toBeTruthy()
    expect(screen.getByText('1 CNTR + 12 ton')).toBeTruthy()

    // Links apontando para a rota canônica /bls/:blId
    const linkCntr = screen.getByRole('link', { name: 'BL-CNTR' })
    expect(linkCntr.getAttribute('href')).toBe('/bls/BL-CNTR')

    const linkMisto = screen.getByRole('link', { name: 'BL-MISTO' })
    expect(linkMisto.getAttribute('href')).toBe('/bls/BL-MISTO')
  })

  it('organiza os atalhos de importação e deixa a exportação apenas como ícone', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const actionLabels = ['B/L CNTR', 'B/L Carga Solta', 'Manifesto Carga solta', 'CE Mercante']
    const actionButtons = actionLabels.map((label) => screen.getByRole('button', { name: label }))

    actionButtons.slice(1).forEach((button, index) => {
      expect(actionButtons[index].compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
    expect(screen.queryByRole('link', { name: 'Containers' })).toBeNull()

    const exportButton = screen.getByRole('button', { name: 'Exportar B/Ls' })
    expect(exportButton.getAttribute('title')).toBe('Exportar B/Ls')
    expect(exportButton.textContent).toBe('')
    expect(exportButton.querySelector('svg')).toBeTruthy()
  })

  it('alterna o filtro rápido de modalidade [Todos, Contêiner, Carga Solta, Misto]', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Clica em Misto
    const btnMisto = screen.getByRole('button', { name: 'Misto' })
    fireEvent.click(btnMisto)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'misto', page: 1 })
    })

    // Clica em Carga Solta
    const btnCargaSolta = screen.getByRole('button', { name: 'Carga Solta' })
    fireEvent.click(btnCargaSolta)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'carga_solta', page: 1 })
    })

    // Clica em Contêiner
    const btnCntr = screen.getByRole('button', { name: 'Contêiner' })
    fireEvent.click(btnCntr)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'container', page: 1 })
    })

    // Clica em Todos
    const btnTodos = screen.getByRole('button', { name: 'Todos' })
    fireEvent.click(btnTodos)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: '', page: 1 })
    })
  })

  it('remove os listeners globais do menu de ações ao desmontar', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ações para B/L BL-CNTR' }))
    removeSpy.mockClear()
    unmount()

    const removed = removeSpy.mock.calls.map(([type]) => type)
    expect(removed).toEqual(expect.arrayContaining(['scroll', 'resize', 'keydown', 'mousedown']))
    removeSpy.mockRestore()
  })

  it('abre o menu de ações pelo teclado e devolve o foco ao acionador', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Ações para B/L BL-CNTR' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const menuItem = screen.getByRole('menuitem', { name: 'Excluir B/L' })
    expect(document.activeElement).toBe(menuItem)
    fireEvent.keyDown(menuItem, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
  })

  it('aplica o POL recebido na URL junto com viagem e POD', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls?voyage=7&pol=CNTAC&pod=BRVIX&cargoMode=misto']}>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({
      voyageId: '7',
      pol: 'CNTAC',
      pod: 'BRVIX',
      cargoMode: 'misto',
    })
  })

  it('exibe estritamente o peso de carga solta no card Carga Solta, ignorando peso de contêiner', () => {
    useBlSummaryMock.mockReturnValue({
      data: {
        totalBls: 2,
        totalDistinctContainers: 4,
        breakbulkWeightTon: 0,
        totalWeightTon: 85,
        pendingReview: 0,
        pendingFinancial: 0,
        chargePending: 0,
        chargeReady: 2,
        chargeExempt: 0,
      },
      isLoading: false,
    })

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // O card Carga Solta deve exibir 0 ton (breakbulkWeightTon), não 85 ton (totalWeightTon)
    expect(screen.getByText('0 ton')).toBeTruthy()
    expect(screen.queryByText('85 ton')).toBeNull()
  })

  it('expande a linha e mostra contêiner e carga solta do B/L misto, sem nova consulta', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const toggle = screen.getByRole('button', { name: 'Expandir carga do B/L BL-MISTO' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByText('SEAL-3')).toHaveLength(0)

    const filtersBefore = useBlsMock.mock.calls.at(-1)?.[0]
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getAllByText('SEAL-3').length).toBeGreaterThan(0))
    // Um B/L misto satisfaz os dois predicados: as duas seções aparecem.
    expect(screen.getAllByText('Contêineres (1)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Carga solta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bobina').length).toBeGreaterThan(0)
    // Tara é capturada e persistida desde sempre, e não era exibida em lugar nenhum.
    expect(screen.getAllByText('3.800').length).toBeGreaterThan(0)
    // O painel vive dos dados que a RPC já trouxe. Expandir é estado de
    // visualização: os filtros da consulta não mudam, então não há refetch.
    expect(useBlsMock.mock.calls.at(-1)?.[0]).toEqual(filtersBefore)

    const openToggle = screen.getByRole('button', { name: 'Recolher carga do B/L BL-MISTO' })
    expect(openToggle.getAttribute('aria-expanded')).toBe('true')
    expect(openToggle.getAttribute('aria-controls')).toBe('bl-detail-BL-MISTO')
  })

  it('recolhe a linha e devolve o painel ao estado fechado', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-MISTO' }))
    await waitFor(() => expect(screen.getAllByText('SEAL-3').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: 'Recolher carga do B/L BL-MISTO' }))
    await waitFor(() => expect(screen.queryAllByText('SEAL-3')).toHaveLength(0))
  })

  it('expandir uma linha não mexe na seleção em massa', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByLabelText('Selecionar B/L BL-CNTR'))
    expect(screen.getByText('Selecionados: 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-MISTO' }))
    await waitFor(() => expect(screen.getAllByText('SEAL-3').length).toBeGreaterThan(0))

    // O toggle é um botão próprio, não um clique na linha: a seleção continua.
    expect(screen.getByText('Selecionados: 1')).toBeTruthy()
    expect((screen.getByLabelText('Selecionar B/L BL-CNTR') as HTMLInputElement).checked).toBe(true)
  })

  it('B/L de contêiner expande só a seção de contêineres; carga solta só a dela', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-CNTR' }))
    await waitFor(() => expect(screen.getAllByText('Contêineres (2)').length).toBeGreaterThan(0))
    expect(screen.queryByText('Carga solta')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-BB' }))
    await waitFor(() => expect(screen.getAllByText('Carga solta').length).toBeGreaterThan(0))
    expect(screen.queryByText(/^Contêineres \(/)).toBeNull()
  })

  it('renderiza os KPIs de carga solta que a RPC já devolvia', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // totalMachines, totalPackages e breakbulkCbm eram buscados e descartados.
    expect(screen.getByText('Máquinas')).toBeTruthy()
    expect(screen.getByText('Total de volumes')).toBeTruthy()
    expect(screen.getByText('CBM carga solta')).toBeTruthy()
  })
})
