// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' }, can: () => false }) }))
vi.mock('../../../hooks/useVoyageTimeline', () => ({ useVoyageTimeline: () => ({ data: undefined }) }))
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

it('mostra apenas os 3 eventos mais recentes da linha do tempo, com opção de expandir', async () => {
  const user = userEvent.setup()
  const importBatches = [1, 2, 3, 4, 5].map((n) => ({
    id: n,
    uploaded_at: `2026-07-0${n}T10:00:00Z`,
    cargo_mode: 'container',
    filename: `manifesto-${n}.txt`,
    route: null,
  }))

  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[]}
      importBatches={importBatches as never}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.getAllByText('Manifesto importado')).toHaveLength(3)

  await user.click(screen.getByRole('button', { name: 'Mostrar todos os 5 eventos' }))

  expect(screen.getAllByText('Manifesto importado')).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Mostrar menos' })).toBeTruthy()
})

it('não mostra atracação TBC completamente vazia no planejamento', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        voyageId: 7,
        port: 'BRVIX',
        eta: '2026-08-26',
        ata: null,
        atd: null,
        atracacoes: [{ terminalId: null, terminalCode: 'TBC', etb: null, atb: null, etd: null, atd: null, rtw: null }],
        ceStatus: null,
        podCeStatus: null,
        exportCeStatus: null,
        linked: null,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: true,
        temExportacao: false,
        temGranito: false,
        temVazios: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.queryByText('Atracações')).toBeNull()
})

it('marca a escala omitida com OMIT no planejamento interno', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        voyageId: 7,
        port: 'BRSSA',
        eta: '2026-08-26',
        ata: null,
        atd: null,
        atracacoes: [],
        ceStatus: null,
        podCeStatus: null,
        exportCeStatus: null,
        linked: null,
        escalaNumber: null,
        omitted: true,
        deleted: false,
        temImportacao: true,
        temExportacao: false,
        temGranito: false,
        temVazios: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.getByText('OMIT')).toBeTruthy()
})

it('recolhe e expande o painel próprio de atracações sem perder os dados da escala', async () => {
  const user = userEvent.setup()
  const onEditEscala = vi.fn()
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        voyageId: 7,
        port: 'BRSSZ',
        eta: '2026-08-26',
        ata: null,
        atd: null,
        atracacoes: [{ terminalId: 'terminal-1', terminalCode: 'BTP', etb: '2026-08-26', atb: null, etd: null, atd: null, rtw: 26 }],
        ceStatus: null,
        podCeStatus: null,
        exportCeStatus: null,
        linked: null,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: true,
        temExportacao: false,
        temGranito: false,
        temVazios: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={onEditEscala}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.getByRole('table', { name: 'Atracações de BRSSZ' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Adicionar atracação na escala BRSSZ' }))
  expect(onEditEscala).toHaveBeenLastCalledWith(expect.objectContaining({ port: 'BRSSZ', focusTerminalId: null }))

  await user.click(screen.getByRole('button', { name: 'Editar atracação BTP da escala BRSSZ' }))
  expect(onEditEscala).toHaveBeenLastCalledWith(expect.objectContaining({ port: 'BRSSZ', focusTerminalId: 'terminal-1' }))

  await user.click(screen.getByRole('button', { name: 'Recolher atracações de BRSSZ' }))
  expect(screen.queryByRole('table', { name: 'Atracações de BRSSZ' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Expandir atracações de BRSSZ' }))
  expect(screen.getByRole('table', { name: 'Atracações de BRSSZ' })).toBeTruthy()
  expect(screen.getByText('BTP')).toBeTruthy()
})

it('não usa status de exportação ao reabrir uma escala que também tem importação', async () => {
  const user = userEvent.setup()
  const onEditEscala = vi.fn()

  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        voyageId: 7,
        port: 'BRSSA',
        eta: null,
        ata: null,
        atd: null,
        atracacoes: [],
        ceStatus: 'received',
        podCeStatus: null,
        exportCeStatus: 'received',
        linked: null,
        escalaNumber: null,
        omitted: false,
        deleted: false,
        temImportacao: true,
        temExportacao: true,
        temGranito: true,
        temVazios: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
        divergences: [],
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      isAdmin={false}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={onEditEscala}
      onOmitPod={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Editar planejamento da escala BRSSA' }))

  expect(onEditEscala).toHaveBeenCalledWith(expect.objectContaining({ ceStatus: null }))
})
