// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn(), useConfirmWithReason: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' }, can: () => false }) }))
vi.mock('../../../hooks/useVoyageTimeline', () => ({ useVoyageTimeline: () => ({ data: undefined }) }))
const { escalasSemTerminal } = vi.hoisted(() => ({ escalasSemTerminal: vi.fn() }))
vi.mock('../../../hooks/useEscalasSemTerminal', () => ({ useEscalasSemTerminal: (ids: number[]) => escalasSemTerminal(ids) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

import { VoyageVisaoTab } from '../VoyageVisaoTab'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function escala(port: string, atracacoes: Array<{ terminalId: string; terminalCode: string; etb: string | null; atb: string | null }>) {
  return {
    voyageId: 7, port, eta: '2026-11-12', ata: null, atd: null,
    atracacoes: atracacoes.map((atracacao) => ({ ...atracacao, etd: null, atd: null, rtw: null })),
    ceStatus: null, podCeStatus: null, exportCeStatus: null, linked: null, escalaNumber: null,
    omitted: false, deleted: false, temImportacao: true, temExportacao: false, temGranito: false, temVazios: false,
    containersQty: null, movementsQty: null, dischargePorts: [], divergences: [],
  }
}

// Revisão de 2026-11-04 (D5): a linha da escala diz o terminal das atracações
// e, em âmbar, o TBC da frente com carga ainda sem terminal.
it('mostra a coluna Terminal com os terminais da escala e o TBC em âmbar das frentes sem terminal', () => {
  escalasSemTerminal.mockReturnValue({ data: new Map([['7::BRVIX', ['importacao:carga_solta', 'importacao:vazio']]]) })
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        escala('BRVIX', [{ terminalId: 't-tvv', terminalCode: 'TVV', etb: '2026-11-13T12:00:00-03:00', atb: null }]),
        escala('BRSSZ', []),
      ] as never}
      importBatches={[]}
      exportSchedules={[]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(escalasSemTerminal).toHaveBeenCalledWith([7])
  const table = screen.getByRole('table', { name: 'Planejamento por escala' })
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)
  const terminalColumn = headers.indexOf('Terminal')
  expect(terminalColumn).toBeGreaterThan(0)

  const vixCell = screen.getByText('BRVIX').closest('tr')!.querySelectorAll('td')[terminalColumn]!
  expect(vixCell.textContent).toContain('TVV / TBC')
  const amber = vixCell.querySelector('.app-status-text--warning')
  expect(amber?.textContent).toBe('TBC')
  expect(amber?.closest('[title]')?.getAttribute('title')).toBe('Sem terminal: carga solta, vazios de importação. Atribua o terminal em Editar escala.')

  const sszCell = screen.getByText('BRSSZ').closest('tr')!.querySelectorAll('td')[terminalColumn]!
  expect(sszCell.querySelector('.app-status-text--warning')).toBeNull()
  expect(sszCell.textContent).toContain('Sem terminal')
})

// A falha da leitura das frentes não parece "toda frente com terminal".
it('diz que não conferiu as frentes quando a leitura falha', () => {
  escalasSemTerminal.mockReturnValue({ data: undefined, isError: true })
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[escala('BRVIX', [{ terminalId: 't-tvv', terminalCode: 'TVV', etb: null, atb: null }])] as never}
      importBatches={[]}
      exportSchedules={[]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  const table = screen.getByRole('table', { name: 'Planejamento por escala' })
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent)
  const cell = screen.getByText('BRVIX').closest('tr')!.querySelectorAll('td')[headers.indexOf('Terminal')]!
  expect(cell.textContent).toContain('TVV · não conferido')
  expect(cell.querySelector('[title]')?.getAttribute('title')).toBe('Não foi possível conferir as frentes sem terminal agora; recarregue a página.')
})
