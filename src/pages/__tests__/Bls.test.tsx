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
vi.mock('../../hooks/useBilling', () => ({ useInvoiceLinks: () => ({ data: {} }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, user: { id: 'user-1' }, profile: { id: 'user-1' } }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
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

    // Três cards decisórios que filtram; os volumes vão para a faixa de resumo.
    expect(screen.getByRole('button', { name: /Pendentes de revisão/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Prontos para faturar/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sem faturamento/ })).toBeTruthy()
    const strip = screen.getByLabelText('Resumo do recorte')
    expect(strip.textContent).toContain('B/Ls3')
    expect(strip.textContent).toContain('de carga solta50 t')
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

    const card = screen.getByRole('button', { name: /Pendentes de revisão/ })
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ reviewStatus: 'pending_review', page: 1 }))
    expect(card.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(card)
    await waitFor(() => expect(useBlsMock.mock.calls.at(-1)?.[0]).toMatchObject({ reviewStatus: '' }))
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

  it('abre o menu pelo primeiro item, navega com as setas e devolve o foco ao acionador', () => {
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

    const copyItem = screen.getByRole('menuitem', { name: 'Copiar número do B/L' })
    const deleteItem = screen.getByRole('menuitem', { name: 'Excluir B/L' })
    expect(document.activeElement).toBe(copyItem)
    // "Abrir detalhes" saiu: o número do B/L já é o link para a ficha.
    expect(screen.queryByRole('menuitem', { name: 'Abrir detalhes' })).toBeNull()

    fireEvent.keyDown(copyItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(deleteItem)
    fireEvent.keyDown(deleteItem, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(copyItem)
    fireEvent.keyDown(copyItem, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(deleteItem)
    fireEvent.keyDown(deleteItem, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
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

      fireEvent.click(screen.getByRole('button', { name: 'Ações para B/L BL-CNTR' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar número do B/L' }))

      await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Não foi possível copiar o número do B/L.', 'error'))
      expect(showToastMock).not.toHaveBeenCalledWith(expect.stringContaining('copiado'), 'success')
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })


  it('abre o menu de ações ao clicar nos três pontinhos; a ficha abre pelo número', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Bls />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Ações para B/L BL-CNTR' })
    fireEvent.click(trigger)

    expect(screen.getByRole('menuitem', { name: 'Copiar número do B/L' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Excluir B/L' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'BL-CNTR' }).getAttribute('href')).toBe('/bls/BL-CNTR')
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

  it('exibe estritamente o peso de carga solta na faixa de resumo, ignorando peso de contêiner', () => {
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

    // A faixa mostra 0 t de carga solta (breakbulkWeightTon), não 85 t (totalWeightTon)
    const strip = screen.getByLabelText('Resumo do recorte')
    expect(strip.textContent).toContain('de carga solta0 t')
    expect(strip.textContent).not.toContain('85 t')
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
    await waitFor(() => expect(screen.getAllByText('Contêineres (2)').length).toBeGreaterThan(0))
    expect(within(document.getElementById('bl-detail-BL-CNTR')!).queryByText('Carga solta')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expandir carga do B/L BL-BB' }))
    await waitFor(() => expect(document.getElementById('bl-detail-BL-BB')).toBeTruthy())
    const detail = within(document.getElementById('bl-detail-BL-BB')!)
    expect(detail.getByText('Carga solta')).toBeTruthy()
    expect(detail.queryByText(/^Contêineres \(/)).toBeNull()
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
    const strip = within(screen.getByLabelText('Resumo do recorte'))
    expect(strip.getByText('máquinas')).toBeTruthy()
    expect(strip.getByText('packages')).toBeTruthy()
    expect(strip.getByText('no total')).toBeTruthy()
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

    fireEvent.click(screen.getAllByRole('button', { name: 'Ações para B/L BL-CNTR' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir B/L' }))

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
