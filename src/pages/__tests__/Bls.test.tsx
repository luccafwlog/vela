// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bls } from '../Bls'

const { useBlsMock, useBlSummaryMock, showToastMock, checkBlDependenciesMock } = vi.hoisted(() => ({
  useBlsMock: vi.fn(),
  useBlSummaryMock: vi.fn(),
  showToastMock: vi.fn(),
  checkBlDependenciesMock: vi.fn(),
}))

const railItemsMock = vi.hoisted(() => vi.fn(() => ({ items: [] as unknown[], isLoading: false })))
// Cards de navio/viagem: o teste próprio está em VoyageRail.behavior.test.tsx.
vi.mock('../../hooks/useVoyageRailItems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useVoyageRailItems')>()),
  useVoyageRailItems: () => railItemsMock(),
}))
vi.mock('../../services/bls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/bls')>()),
  checkBlDependencies: checkBlDependenciesMock,
}))

vi.mock('../../hooks/useBls', () => ({
  useBls: useBlsMock,
  useBlSummary: useBlSummaryMock,
  usePortOptions: () => ({ data: { pols: [], pods: [] } }),
  useVoyageOptions: () => ({ data: [] }),
  fetchAllBls: vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../components/shared/CeMercanteImportModal', () => ({ CeMercanteImportModal: () => null }))
vi.mock('../../components/shared/BlImportModal', () => ({ BlImportModal: () => null }))
vi.mock('../../components/shared/FileImportModal', () => ({ FileImportModal: () => null }))
vi.mock('../../components/shared/BlDocumentImportModal', () => ({ BlDocumentImportModal: () => null }))
vi.mock('../../components/shared/BulkActionsBar', () => ({
  BulkActionsBar: ({ count, onDelete }: { count: number; onDelete: () => void }) => (
    <div>Selecionados: {count}<button type="button" onClick={onDelete}>Excluir selecionados</button></div>
  ),
}))

describe('Página Bls (unificada)', () => {
  beforeEach(() => {
    useBlsMock.mockReset()
    useBlSummaryMock.mockReset()
    showToastMock.mockReset()

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

    // Seis cartões de total do recorte; só Taxas pendentes e Isentos filtram.
    const totals = within(screen.getByRole('group', { name: 'Totais do recorte' }))
    expect(totals.getByText('B/Ls').parentElement?.textContent).toContain('3')
    expect(totals.getByText('Carga solta').parentElement?.textContent).toContain('50,0 t')
    expect(totals.getByRole('button', { name: /Taxas pendentes/ })).toBeTruthy()
    expect(totals.getByRole('button', { name: /Isentos/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Pendentes de revisão/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Prontos para faturar/ })).toBeNull()
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

  it('reúne as importações num menu e deixa Exportar com rótulo', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Importar' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'B/L de contêiner (.xlsx)',
      'B/L de carga solta (.pdf, .docx)',
      'Manifesto de carga solta (BB)',
      'CE Mercante',
    ])
    expect(screen.queryByRole('link', { name: 'Containers' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy()
  })

  it('aplica o filtro do card e o desfaz no segundo clique', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const card = screen.getByRole('button', { name: /Taxas pendentes/ })
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ chargeStatus: 'pending', page: 1 }))
    expect(card.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ chargeStatus: '' }))
  })

  // Revisão de 2026-10-22 (C2): os cards de navio/viagem também em BLs.
  it('o card de navio/viagem filtra a lista pela viagem e o segundo clique tira o filtro', async () => {
    railItemsMock.mockReturnValue({
      isLoading: false,
      items: [{
        id: 11, estado: 'incompleto', vesselName: 'GREEN ITAJAI', voyageNumber: '11', carrierName: 'COSCO',
        originPorts: [], destinationPorts: ['BRVIX'], proximaEscala: null, escalasBrasileiras: [],
        modules: { container: true, cargaSolta: false, veiculos: false, vazios: false, granito: false },
      }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const card = screen.getByText('GREEN ITAJAI / 11').closest('button') as HTMLButtonElement
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ voyageId: '11', page: 1 }))
    expect(card.getAttribute('aria-current')).toBe('true')
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ voyageId: '' }))
    railItemsMock.mockReturnValue({ items: [], isLoading: false })
  })

  it('alterna a lente de modalidade [Todos, Contêiner, Carga solta, Misto]', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Clica em Misto
    const btnMisto = screen.getByRole('radio', { name: 'Misto' })
    fireEvent.click(btnMisto)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'misto', page: 1 })
    })

    // Clica em Carga Solta
    const btnCargaSolta = screen.getByRole('radio', { name: 'Carga solta' })
    fireEvent.click(btnCargaSolta)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'carga_solta', page: 1 })
    })

    // Clica em Contêiner
    const btnCntr = screen.getByRole('radio', { name: 'Contêiner' })
    fireEvent.click(btnCntr)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: 'container', page: 1 })
    })

    // Clica em Todos
    const btnTodos = screen.getByRole('radio', { name: 'Todos' })
    fireEvent.click(btnTodos)

    await waitFor(() => {
      expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ cargoMode: '', page: 1 })
    })
  })

  it('mostra erro quando não consegue copiar o número do B/L', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permissão negada'))
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Bls />
          </MemoryRouter>
        </QueryClientProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Copiar número do B/L BL-CNTR' }))

      expect(writeText).toHaveBeenCalledWith('BL-CNTR')
      expect(await screen.findByText('Não foi possível copiar o número do B/L')).toBeTruthy()
      expect(screen.queryByText('número do B/L copiado')).toBeNull()
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })


  it('a linha não tem menu nem coluna de ações; a ficha abre pelo número', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: /Ações para B\/L/ })).toBeNull()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent).slice(1)).toEqual([
      'B/L', 'Cliente', 'Navio', 'Viagem', 'Trecho', 'Carga', 'CE Mercante', 'Taxas locais',
    ])
    expect(screen.getByRole('link', { name: 'BL-CNTR' }).getAttribute('href')).toBe('/bls/BL-CNTR')
  })

  it('Taxas locais mostra só Pendente, Emitida ou Isenta', () => {
    useBlsMock.mockImplementation(() => ({
      data: {
        rows: [
          { id: 'BL-A', cargo_mode: 'container', charge_status: 'calculated', financial_status: 'pending', bl_containers: [] },
          { id: 'BL-B', cargo_mode: 'container', charge_status: 'ready_for_billing', financial_status: 'paid', bl_containers: [] },
          { id: 'BL-C', cargo_mode: 'container', charge_status: 'exempt', financial_status: 'pending', bl_containers: [] },
        ],
        count: 3,
      },
      isLoading: false,
      error: null,
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const stateOf = (id: string) => screen.getByRole('link', { name: id }).closest('tr')!.lastElementChild!.textContent
    expect(stateOf('BL-A')).toBe('Pendente')
    expect(stateOf('BL-B')).toBe('Emitida')
    expect(stateOf('BL-C')).toBe('Isenta')
    expect(screen.queryByText('Calculado')).toBeNull()
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

  it('mostra estritamente o peso de carga solta no cartão, ignorando peso de contêiner', () => {
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

    // O cartão mostra 0 t de carga solta (breakbulkWeightTon), não 85 t (totalWeightTon);
    // aparece mesmo zerado.
    const totals = within(screen.getByRole('group', { name: 'Totais do recorte' }))
    const card = totals.getByText('Carga solta').parentElement!
    expect(card.textContent).toContain('0,0 t')
    expect(card.textContent).not.toContain('85')
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
    expect(screen.getAllByText('Contêineres').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 contêiner · 1 COC · 24\.000 kg · 67,0 m³ · 0 de 1 devolvidos/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Abrir na ficha do B/L' })[0].getAttribute('href')).toBe('/bls/BL-MISTO')
    expect(screen.getAllByText('Carga solta').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bobina').length).toBeGreaterThan(0)
    // Tara é capturada e persistida desde sempre, e não era exibida em lugar nenhum.
    expect(screen.getAllByText('3.800').length).toBeGreaterThan(0)
    // O painel vive dos dados que a RPC já trouxe. Expandir é estado de
    // visualização: os filtros da consulta não mudam, então não há refetch.
    expect(useBlsMock.mock.calls.at(-1)?.[0]).toEqual(filtersBefore)

    const openToggle = screen.getByRole('button', { name: 'Recolher carga do B/L BL-MISTO' })
    expect(openToggle.getAttribute('aria-expanded')).toBe('true')
    const detailId = openToggle.getAttribute('aria-controls')
    expect(detailId).toBe('bl-detail-BL-MISTO')
    expect(document.getElementById(detailId!)).toBeTruthy()
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
    await waitFor(() => expect(within(document.getElementById('bl-detail-BL-CNTR')!).getAllByText('Contêineres').length).toBeGreaterThan(0))
    expect(within(document.getElementById('bl-detail-BL-CNTR')!).queryByText('Carga solta')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-BB' }))
    await waitFor(() => expect(document.getElementById('bl-detail-BL-BB')).toBeTruthy())
    const detail = within(document.getElementById('bl-detail-BL-BB')!)
    expect(detail.getByText('Carga solta')).toBeTruthy()
    expect(detail.queryByText('Contêineres')).toBeNull()
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

    // totalMachines, totalPackages e totalCbm eram buscados e descartados.
    const totals = within(screen.getByRole('group', { name: 'Totais do recorte' }))
    expect(totals.getByText('Carga solta').parentElement?.textContent).toContain('máquinas')
    expect(totals.getByText('Carga solta').parentElement?.textContent).toContain('packages')
    expect(totals.getByText('Volume')).toBeTruthy()
  })

  it('exclusão bloqueada explica o motivo na lista, não só no toast, e não abre a confirmação', async () => {
    checkBlDependenciesMock.mockResolvedValue({
      deletableIds: [],
      blockedIds: [{ id: 'BL-CNTR', reasons: ['fatura emitida', 'recebível em aberto'] }],
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Excluir fica só na seleção em lote.
    fireEvent.click(screen.getByLabelText('Selecionar B/L BL-CNTR'))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir selecionados' }))

    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toMatch(/Este B\/L não pode ser excluído/)
    expect(notice.textContent).toMatch(/BL-CNTR: fatura emitida, recebível em aberto/)
    expect(showToastMock).not.toHaveBeenCalled()
    fireEvent.click(within(notice).getByRole('button', { name: 'Fechar aviso' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('?page= além do total leva à última página existente e corrige a URL', async () => {
    const baseRows = useBlsMock.getMockImplementation()!({}).data.rows
    useBlsMock.mockImplementation((filters: { page: number; pageSize: number }) => ({
      data: { rows: filters.page > 2 ? [] : baseRows, count: filters.pageSize * 2 },
      isLoading: false,
      error: null,
    }))
    function LocationProbe() {
      return <output data-testid="search">{useLocation().search}</output>
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls?page=99']}>
          <Bls />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('page=2'))
    expect(screen.queryByText('Nenhum B/L cadastrado ainda.')).toBeNull()
    expect(screen.getAllByText('BL-CNTR').length).toBeGreaterThan(0)
  })
})
