// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlDetalhe, deleteRefusalGuidance } from '../BlDetalhe'

const { useBlDetailMock, cancelBlMock, authState, checkBlDependenciesMock, deleteBlsMock, confirmWithReasonMock } = vi.hoisted(() => ({
  useBlDetailMock: vi.fn(),
  cancelBlMock: vi.fn(),
  authState: { isAdmin: false },
  checkBlDependenciesMock: vi.fn(),
  deleteBlsMock: vi.fn(),
  confirmWithReasonMock: vi.fn(),
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
  useAuth: () => ({ user: { id: 'u1' }, profile: { id: 'u1' }, isAdmin: authState.isAdmin }),
}))

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
  useConfirmWithReason: () => confirmWithReasonMock,
}))

vi.mock('../../services/bls', () => ({
  checkBlDependencies: checkBlDependenciesMock,
  deleteBls: deleteBlsMock,
}))

vi.mock('../../components/shared/ImportResultPanel', () => ({
  ImportResultPanel: ({ entityId, title = 'Processamento pós-importação' }: { entityId?: string | null; title?: string }) => (
    <section aria-label={title} data-entity-id={entityId ?? ''}>{title}</section>
  ),
}))

vi.mock('../../services/blState', () => ({
  cancelBl: cancelBlMock,
  reactivateBl: vi.fn(),
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

    expect(screen.queryByRole('region', { name: 'Processamento físico da viagem' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Processamento pós-importação' })).toBeNull()

    // Título / Modalidade
    // Rótulo único: a lista, o export e o detalhe escreviam nomes diferentes
    // para a mesma modalidade.
    expect(screen.getAllByText('Misto').length).toBeGreaterThan(0)

    // Volta para a lista pelo breadcrumb (o botão "Voltar aos BLs" repetia o caminho)
    const backLinks = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/bls'))
    expect(backLinks.length).toBeGreaterThanOrEqual(1)

    // Indicação do terminal de descarga unificado
    expect(screen.getByText('Terminal TVV')).toBeTruthy()
  })

  it('não expõe painéis técnicos de processamento na ficha do B/L', () => {
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

    expect(screen.queryByRole('region', { name: 'Processamento físico da viagem' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Processamento pós-importação' })).toBeNull()
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
    expect(screen.getByRole('heading', { name: 'Containers' })).toBeTruthy()
    expect(screen.getByText('MSKU1234567')).toBeTruthy()

    expect(screen.getByRole('heading', { name: 'Carga solta' })).toBeTruthy()
    expect(screen.getByText('Tubos de aço')).toBeTruthy()
  })

  it('renderiza as abas oficiais e atualiza a aba ativa ao selecionar Histórico', () => {
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

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Visão geral',
      'Carga',
      'Detalhes do B/L',
      'Faturamento',
      'Histórico',
    ])

    const historyTab = screen.getByRole('tab', { name: 'Histórico' })
    fireEvent.click(historyTab)
    expect(historyTab.getAttribute('aria-selected')).toBe('true')
  })
})

describe('BlDetalhe - cancelamento bloqueado', () => {
  beforeEach(() => {
    authState.isAdmin = true
    cancelBlMock.mockReset()
    cancelBlMock.mockResolvedValue({ cancelled: false, reasons: ['fatura em aberto'] })
    useBlDetailMock.mockReturnValue({
      data: { id: 'BL-BLOQ-1', cargo_mode: 'container', ce_mercante: '152605123456701', pol: 'CNSHA', pod: 'BRSSZ', voyage_id: null, bl_containers: [], bl_breakbulk_items: [] },
      isLoading: false,
      error: null,
    })
  })

  it('explica o bloqueio na ficha, não só num toast', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-BLOQ-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do B/L' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancelar B\/L/ }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('não pode ser cancelado agora')
    expect(alert.textContent).toContain('fatura em aberto')
    expect(cancelBlMock).toHaveBeenCalledWith('BL-BLOQ-1', '', { dryRun: true })
  })

  // Migration 530: B/L sem Cliente (ou tipo sem tarifa e sem free time) com
  // sobreestadia; sai pela dispensa na Demurrage, não pela fatura.
  it('Demurrage travada leva à divisão Travado, sem mandar cancelar fatura', async () => {
    cleanup()
    cancelBlMock.mockResolvedValue({ cancelled: false, reasons: ['Demurrage travada: vincule o Cliente ou cadastre a tarifa e emita a Invoice, ou dispense a cobrança na Demurrage'] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-BLOQ-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do B/L' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancelar B\/L/ }))

    // A ficha pode ter outro aviso (situação do Portal): o do cancelamento é o que diz o motivo.
    const alert = (await screen.findByText(/não pode ser cancelado agora/)).closest('[role="alert"]') as HTMLElement
    expect(alert.textContent).toContain('Demurrage travada')
    expect(alert.textContent).not.toContain('Administrativo cancela a fatura')
    expect(within(alert).getByRole('link', { name: 'Abrir em Demurrage' }).getAttribute('href')).toBe('/demurrage?divisao=travado&busca=BL-BLOQ-1')
  })

  // Migration 569 (decisão de 2026-11-03): "Demurrage correndo ou a emitir"; o
  // começo antigo, "Demurrage a faturar", vale até a 569 chegar ao banco.
  it.each([
    'Demurrage correndo ou a emitir: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage',
    'Demurrage a faturar: devolva o container e emita a Invoice, ou dispense a cobrança na Demurrage',
  ])('"%s" leva à busca na Demurrage, sem mandar cancelar fatura', async (reason) => {
    cleanup()
    cancelBlMock.mockResolvedValue({ cancelled: false, reasons: [reason] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-BLOQ-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações do B/L' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancelar B\/L/ }))

    const alert = (await screen.findByText(/não pode ser cancelado agora/)).closest('[role="alert"]') as HTMLElement
    expect(alert.textContent).not.toContain('Administrativo cancela a fatura')
    expect(within(alert).getByRole('link', { name: 'Abrir em Demurrage' }).getAttribute('href')).toBe('/demurrage?busca=BL-BLOQ-1')
  })
})

// Pedido de 2026-11-04: o B/L sem CE importado por engano se exclui na própria
// ficha, ao lado de Reimportar B/L, pela mesma prévia de `delete_records`.
describe('BlDetalhe - Excluir B/L na ficha', () => {
  const blSemCe = { id: 'BL-ERRADO-1', cargo_mode: 'container', ce_mercante: null, pol: 'CNSHA', pod: 'BRIGI', voyage_id: 170, bl_containers: [], bl_breakbulk_items: [] }

  function renderFicha() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/bls/BL-ERRADO-1']}>
          <Routes>
            <Route path="/bls/:blId" element={<BlDetalhe />} />
            <Route path="/bls" element={<p>Lista de B/Ls</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  beforeEach(() => {
    cleanup()
    authState.isAdmin = true
    checkBlDependenciesMock.mockReset()
    deleteBlsMock.mockReset()
    confirmWithReasonMock.mockReset()
    useBlDetailMock.mockReturnValue({ data: blSemCe, isLoading: false, error: null })
  })

  it('exclui com motivo e volta para a lista', async () => {
    checkBlDependenciesMock.mockResolvedValue({ deletableIds: ['BL-ERRADO-1'], blockedIds: [] })
    confirmWithReasonMock.mockResolvedValue('POD não atendido')
    deleteBlsMock.mockResolvedValue({ deletableIds: ['BL-ERRADO-1'], blockedIds: [] })
    renderFicha()

    fireEvent.click(screen.getByRole('button', { name: /Excluir B\/L/ }))

    expect(await screen.findByText('Lista de B/Ls')).toBeTruthy()
    expect(checkBlDependenciesMock).toHaveBeenCalledWith(['BL-ERRADO-1'])
    expect(deleteBlsMock).toHaveBeenCalledWith(['BL-ERRADO-1'], 'POD não atendido')
  })

  it('Voltar no diálogo não exclui', async () => {
    checkBlDependenciesMock.mockResolvedValue({ deletableIds: ['BL-ERRADO-1'], blockedIds: [] })
    confirmWithReasonMock.mockResolvedValue(null)
    renderFicha()

    fireEvent.click(screen.getByRole('button', { name: /Excluir B\/L/ }))

    await vi.waitFor(() => expect(confirmWithReasonMock).toHaveBeenCalled())
    expect(deleteBlsMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Lista de B/Ls')).toBeNull()
  })

  it('a trava do banco aparece na ficha, sem abrir o diálogo', async () => {
    checkBlDependenciesMock.mockResolvedValue({ deletableIds: [], blockedIds: [{ id: 'BL-ERRADO-1', reasons: ['documento financeiro emitido'] }] })
    renderFicha()

    fireEvent.click(screen.getByRole('button', { name: /Excluir B\/L/ }))

    const alert = (await screen.findByText(/não pode ser excluído/)).closest('[role="alert"]') as HTMLElement
    expect(alert.textContent).toContain('documento financeiro emitido')
    expect(confirmWithReasonMock).not.toHaveBeenCalled()
    expect(deleteBlsMock).not.toHaveBeenCalled()
  })

  it('não aparece fora do Administrativo nem no B/L cancelado', () => {
    authState.isAdmin = false
    renderFicha()
    expect(screen.queryByRole('button', { name: /Excluir B\/L/ })).toBeNull()

    cleanup()
    authState.isAdmin = true
    useBlDetailMock.mockReturnValue({ data: { ...blSemCe, cancelled_at: '2026-11-04T12:00:00Z' }, isLoading: false, error: null })
    renderFicha()
    expect(screen.queryByRole('button', { name: /Excluir B\/L/ })).toBeNull()
  })

  it('B/L com CE e sem fatura: manda remover o CE e abre Detalhes do B/L', async () => {
    useBlDetailMock.mockReturnValue({ data: { ...blSemCe, ce_mercante: '152605123456701' }, isLoading: false, error: null })
    checkBlDependenciesMock.mockResolvedValue({ deletableIds: [], blockedIds: [{ id: 'BL-ERRADO-1', reasons: ['B/L com CE Mercante'] }] })
    renderFicha()

    fireEvent.click(screen.getByRole('button', { name: /Excluir B\/L/ }))

    const alert = (await screen.findByText(/não pode ser excluído/)).closest('[role="alert"]') as HTMLElement
    expect(alert.textContent).toContain('Remover CE')
    expect(alert.textContent).not.toContain('Cancelar B/L')
    fireEvent.click(within(alert).getByRole('button', { name: 'Abrir Detalhes do B/L' }))
    expect(screen.getByRole('tab', { name: 'Detalhes do B/L' }).getAttribute('aria-selected')).toBe('true')
    expect(confirmWithReasonMock).not.toHaveBeenCalled()
  })

  it('B/L com CE e fatura: diz o que fazer com a fatura e leva ao Cancelar B/L', async () => {
    useBlDetailMock.mockReturnValue({ data: { ...blSemCe, ce_mercante: '152605123456701' }, isLoading: false, error: null })
    checkBlDependenciesMock.mockResolvedValue({ deletableIds: [], blockedIds: [{ id: 'BL-ERRADO-1', reasons: ['B/L com CE Mercante', 'documento financeiro emitido'] }] })
    cancelBlMock.mockReset()
    cancelBlMock.mockResolvedValue({ cancelled: false, reasons: ['fatura em aberto'] })
    renderFicha()

    fireEvent.click(screen.getByRole('button', { name: /Excluir B\/L/ }))

    const alert = (await screen.findByText(/não pode ser excluído/)).closest('[role="alert"]') as HTMLElement
    expect(alert.textContent).toContain('Cancelar fatura')
    expect(alert.textContent).toContain('Restituição')
    expect(alert.textContent).not.toContain('Remover CE')
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancelar B/L' }))

    // O Cancelar B/L faz a própria conferência e mostra o que ainda segura.
    expect(await screen.findByText(/não pode ser cancelado agora/)).toBeTruthy()
    expect(cancelBlMock).toHaveBeenCalledWith('BL-ERRADO-1', '', { dryRun: true })
    expect(screen.queryByText(/não pode ser excluído/)).toBeNull()
  })
})

describe('deleteRefusalGuidance', () => {
  it.each([
    [['B/L com CE Mercante'], 'remove-ce'],
    [['B/L com CE Mercante', 'documento financeiro emitido'], 'cancel'],
    [['documento financeiro emitido'], null],
    [['o B/L não foi encontrado; ele pode já ter sido excluído'], null],
  ])('%j → %s', (reasons, expected) => {
    expect(deleteRefusalGuidance(reasons)).toBe(expected)
  })
})
