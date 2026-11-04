// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Painel } from '../Painel'

const { showToast, writeWorkbookMock } = vi.hoisted(() => ({
  showToast: vi.fn(),
  writeWorkbookMock: vi.fn<(spec: unknown) => Promise<void>>(async () => {}),
}))

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../../services/exportWorkbook', () => ({ writeWorkbook: writeWorkbookMock, exportTimestamp: () => '202611031432' }))
vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (previous: unknown) => previous,
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'dashboard') {
      return {
        data: {
          totalBls: 42,
          totalContainers: 7,
          pendingReview: 3,
          chargeReviewRequired: 2,
          readyForBilling: 9,
          pendingFinancial: 1,
          openInvoices: 5,
          openInvoicesAmount: 1000,
          invoicesAccessDenied: false,
          openAlerts: 0,
          blsWithoutCustomer: 0,
          podsWithoutChargeTable: 0,
        },
        isLoading: false,
        error: null,
      }
    }
    return {
      data: {
        rows: [{
          id: '1::SSZ',
          voyageId: 1,
          voyageNumber: 'V1',
          voyageStatus: 'active',
          vesselName: 'Navio ativo',
          pod: 'SSZ',
          eta: '2026-07-09',
          etb: null,
          ata: '2026-07-10',
          atb: '2026-07-10',
          rowType: 'import',
          importTerminal: 'TVV',
          exportTerminal: 'TBC',
          vin: 1,
          car: 0,
          cg: 1,
          total: 1,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: null,
          ceStatus: 'waiting',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        }, {
          id: '2::RIO',
          voyageId: 2,
          voyageNumber: 'V2',
          voyageStatus: 'cancelled',
          vesselName: 'Navio cancelado',
          pod: 'RIO',
          eta: null,
          etb: null,
          ata: null,
          atb: '2026-07-10',
          rowType: 'import',
          importTerminal: 'TBC',
          exportTerminal: 'TBC',
          vin: 0,
          car: 0,
          cg: 1,
          total: 1,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: '2026-07-11',
          ceStatus: 'waiting',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
        }, {
          id: 'exp::3',
          voyageId: 3,
          voyageNumber: 'V3',
          voyageStatus: 'active',
          vesselName: 'Navio exportação',
          pod: 'SSZ',
          eta: null,
          etb: null,
          ata: null,
          atb: null,
          rowType: 'export',
          importTerminal: 'TBC',
          exportTerminal: 'PORTMAC',
          vin: 0,
          car: 0,
          cg: 0,
          total: 0,
          mty: 0,
          rtw: null,
          bbMachines: 0,
          bbPackages: 0,
          bbTotal: 0,
          atd: null,
          ceStatus: 'missing',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: 'approved',
          exportLinked: true,
        }, {
          // Revisão de 2026-11-04 (D5): B/Ls de carga solta e nenhuma frente com terminal.
          id: '4::VIX',
          voyageId: 4,
          voyageNumber: 'V4',
          voyageStatus: 'active',
          vesselName: 'Navio sem terminal',
          pod: 'VIX',
          eta: '2026-11-12',
          etb: null,
          ata: null,
          atb: null,
          rowType: 'import',
          importTerminal: 'TBC',
          exportTerminal: 'TBC',
          vin: 0,
          car: 0,
          cg: 0,
          total: 0,
          mty: 0,
          rtw: null,
          bbMachines: 2,
          bbPackages: 0,
          bbTotal: 2,
          atd: null,
          ceStatus: 'received',
          linked: false,
          exportHasGranite: null,
          exportContainersQty: null,
          exportMovementsQty: null,
          exportCeStatus: null,
          exportLinked: null,
          pendingTerminalFronts: ['importacao:carga_solta'],
        }],
        unassignedMty: [{ voyageId: 1, voyageNumber: 'V1', vesselName: 'Navio ativo', pod: 'BRRIO', count: 2 }],
        lastChangedAt: '2026-06-23T00:00:00Z',
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    }
  },
}))

beforeEach(() => {
  showToast.mockReset()
  writeWorkbookMock.mockReset()
})

afterEach(cleanup)

it('informa falha e encerra loading quando a exportacao do Line-Up falha', async () => {
  writeWorkbookMock.mockRejectedValue(new Error('disk full'))

  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))

  await waitFor(() => expect(showToast).toHaveBeenCalledWith('Falha ao exportar o Line-Up.', 'error'))
  expect(screen.getByRole('button', { name: 'Exportar' }).hasAttribute('disabled')).toBe(false)
})

it('exporta CEs e Linked da programação de exportação', async () => {
  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))

  await waitFor(() => expect(writeWorkbookMock).toHaveBeenCalled())
  const spec = writeWorkbookMock.mock.calls[0][0] as unknown as { sheets: Array<{ rows: unknown[] }> }
  expect(spec.sheets[0].rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ Navio: 'Navio exportação', CEs: 'approved', Linked: 'Sim' }),
  ]))
})

function renderPainel() {
  render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  )
}

// Busca, Escalas, Período e CEs ficam abertos; os de presença de carga vivem
// em "Mais filtros", que nasce recolhido. Quem for mexer neles abre primeiro.
function abrirMaisFiltros() {
  fireEvent.click(screen.getByRole('button', { name: /Mais filtros/ }))
}

it('US-120: as celulas do Line-Up navegam para os destinos corretos', () => {
  renderPainel()

  // Os KPI cards do dashboard foram removidos; a navegacao migrou para as celulas
  // do Line-Up (commit "transform Painel table cells into navigation links").
  expect(screen.getByRole('link', { name: 'Navio ativo' }).getAttribute('href')).toBe('/viagens/1')
})

it('US-121: carrega o snapshot do Line-Up com a escala', () => {
  renderPainel()

  expect(screen.getAllByText('Navio ativo').length).toBeGreaterThan(0)
})

it('US-121: CE aguardando em texto âmbar, sem selo (regra 5)', () => {
  renderPainel()

  const waiting = screen.getAllByText('Aguardando')
  expect(waiting.some((element) => element.classList.contains('app-status-text--warning'))).toBe(true)
  expect(waiting.some((element) => element.closest('.app-badge'))).toBe(false)
})

it('exibe terminal por sentido na mesma linha da escala e preserva TBC', () => {
  renderPainel()

  expect(screen.getByText('TVV')).toBeTruthy()
  expect(screen.getByText('PORTMAC')).toBeTruthy()
  expect(screen.getByText(/TBC: terminal sem atribuição/)).toBeTruthy()
})

// Revisão de 2026-11-04 (D5): o TBC da carga sem terminal fica em âmbar, com
// as frentes no título; o TBC do planejamento sem carga continua em texto comum.
it('destaca em âmbar o TBC da carga sem terminal e filtra por Terminal › Sem terminal', () => {
  renderPainel()

  const pendingRow = screen.getByRole('link', { name: 'Navio sem terminal' }).closest('tr')!
  const amber = pendingRow.querySelector('.app-status-text--warning')
  expect(amber?.textContent).toBe('TBC')
  expect(amber?.closest('[title]')?.getAttribute('title')).toBe('Sem terminal: carga solta. Atribua o terminal em Editar escala.')
  const exportRow = screen.getByRole('link', { name: 'Navio exportação' }).closest('tr')!
  expect(exportRow.querySelector('.app-status-text--warning')).toBeNull()

  fireEvent.change(screen.getByLabelText('Terminal'), { target: { value: 'pending' } })
  expect(screen.getByRole('link', { name: 'Navio sem terminal' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Navio ativo' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Navio exportação' })).toBeNull()
})

it('usa ATA na coluna ETA, ATB na coluna ETB e destaca somente a escala atracada', () => {
  renderPainel()
  fireEvent.change(screen.getByLabelText('Escalas'), { target: { value: 'all' } })

  // ATA aparece com ✓ e cor de concluído, não só pela cor.
  const actualArrival = screen.getByTitle('ATA registrada')
  expect(actualArrival.textContent).toBe('✓ 10/07')
  expect(actualArrival.classList.contains('app-date--actual')).toBe(true)

  // ATB registrado substitui o ETB, também com ✓ (decisão do lote 5a).
  const berthedRowCells = screen.getByRole('link', { name: 'Navio ativo' }).closest('tr')?.querySelectorAll('td')
  expect(berthedRowCells?.[5].textContent).toBe('✓ 10/07')

  const berthedRow = screen.getByRole('link', { name: 'Navio ativo' }).closest('tr')
  const completedRow = screen.getByRole('link', { name: 'Navio cancelado' }).closest('tr')
  expect(berthedRow?.classList.contains('app-lineup-row--berthed')).toBe(true)
  expect(completedRow?.classList.contains('app-lineup-row--berthed')).toBe(false)
})

it('US-122: filtra o Line-Up por status de escala', () => {
  renderPainel()

  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Escalas'), { target: { value: 'completed' } })
  expect(screen.queryByRole('link', { name: 'Navio ativo' })).toBeNull()
  // A linha de exportação também segue o filtro (decisão do dono de 2026-11-03).
  expect(screen.queryByRole('link', { name: 'Navio exportação' })).toBeNull()

  fireEvent.change(screen.getByLabelText('Escalas'), { target: { value: 'active' } })
  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Navio exportação' })).toBeTruthy()
})

it('não oferece filtro de escalas canceladas, que não entram no Line-Up', () => {
  renderPainel()

  const status = screen.getByLabelText('Escalas') as HTMLSelectElement
  expect(Array.from(status.options).map((option) => option.value)).toEqual(['active', 'completed', 'all'])
})

it('combina busca por navio e filtro de veículos no Line-Up', () => {
  renderPainel()
  abrirMaisFiltros()

  fireEvent.change(screen.getByLabelText('Busca'), { target: { value: 'navio' } })
  fireEvent.change(screen.getByLabelText('Veículos'), { target: { value: 'with' } })

  expect(screen.getByRole('link', { name: 'Navio ativo' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Navio cancelado' })).toBeNull()
})

it('vazios sem escala seguem os filtros do Line-Up pela Viagem', () => {
  renderPainel()
  expect(screen.getByText(/vazios de importação sem escala/)).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Escalas'), { target: { value: 'completed' } })
  expect(screen.queryByText(/vazios de importação sem escala/)).toBeNull()
})

it('US-123: oferece os atalhos para Chegadas/Saidas e para a tela TV', () => {
  renderPainel()

  expect(screen.getByRole('link', { name: /Chegadas e Sa/ }).getAttribute('href')).toBe('/chegadas-saidas')
  expect(screen.getByRole('link', { name: /Tela TV/ }).getAttribute('href')).toBe('/line-up-tv/display')
})

it('exportação ocupa as colunas de carga em cinza, sem fundo de aviso', () => {
  renderPainel()
  fireEvent.change(screen.getByLabelText('Escalas'), { target: { value: 'all' } })

  const exportRow = screen.getByRole('link', { name: 'Navio exportação' }).closest('tr')
  expect(exportRow?.className ?? '').not.toContain('app-lineup-export-row')
  expect(exportRow?.textContent).toContain('Exportação')
})
