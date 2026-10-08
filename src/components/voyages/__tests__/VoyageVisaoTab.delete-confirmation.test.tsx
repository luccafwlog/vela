// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

const { confirm, deleteEscala } = vi.hoisted(() => ({
  confirm: vi.fn(),
  deleteEscala: vi.fn(),
}))

vi.mock('../../ui/ConfirmDialog', () => ({ useConfirmWithReason: () => confirm }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin-1' }, can: () => true, isAdmin: true }) }))
vi.mock('../../../hooks/useVoyageTimeline', () => ({ useVoyageTimeline: () => ({ data: undefined }) }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../services/voyageRouteSchedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyageRouteSchedules')>()),
  deleteEscala,
}))

import { VoyageVisaoTab } from '../VoyageVisaoTab'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('pede confirmação uma vez por escala antes de excluir o planejamento', async () => {
  confirm.mockResolvedValue(null)
  deleteEscala.mockResolvedValue({ deleted: false, reasons: [], dry_run: true })
  const user = userEvent.setup()
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        { port: 'BRSSZ', eta: '2026-07-20', etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, linked: true, temImportacao: true, temExportacao: false, temGranito: false, containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false } as never,
        { port: 'BRVIX', eta: null, etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, linked: false, temImportacao: false, temExportacao: true, temGranito: false, containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 9, pol: 'BRVIX', eta: null, etb: null, linked: false } as never]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  // Uma escala, uma ação de excluir — inclusive na escala que só exporta.
  await user.click(screen.getByRole('button', { name: 'Excluir escala BRSSZ' }))
  await user.click(screen.getByRole('button', { name: 'Excluir escala BRVIX' }))

  expect(confirm).toHaveBeenCalledTimes(2)
  // Só a prévia (dryRun) foi pedida; nada foi excluído.
  expect(deleteEscala).toHaveBeenCalledTimes(2)
  for (const call of deleteEscala.mock.calls) expect(call[2]).toEqual({ dryRun: true })
})

it('escala travada pelo CE não abre confirmação e não é excluída', async () => {
  deleteEscala.mockResolvedValue({ deleted: false, reasons: ['B/L com CE Mercante'], dry_run: true })
  const user = userEvent.setup()
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        { port: 'BRSSZ', eta: '2026-07-20', etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null, linked: true, temImportacao: true, temExportacao: false, temGranito: false, containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false } as never,
      ]}
      importBatches={[]}
      exportSchedules={[]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Excluir escala BRSSZ' }))

  expect(confirm).not.toHaveBeenCalled()
  expect(deleteEscala).toHaveBeenCalledTimes(1)
})

it('renderiza uma escala mista em uma linha com marcadores de importação e exportação', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[
        {
          port: 'BRVIX',
          eta: '2026-07-20',
          etb: '2026-07-21',
          ata: null,
          atb: null,
          etd: '2026-07-22',
          atd: null,
          rtw: null,
          ceStatus: 'received',
          linked: true,
          escalaNumber: null,
          temImportacao: true,
          temExportacao: true,
          temGranito: true,
          containersQty: 12,
          movementsQty: 14,
          divergences: [],
          omitted: false,
          deleted: false,
        } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 'exp-1', voyageId: 7, pol: 'BRVIX', eta: '2026-07-20', etb: '2026-07-21', linked: true } as never]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getByText('BRVIX')).toBeTruthy()
  expect(within(table).getByText('Importação')).toBeTruthy()
  expect(within(table).getByText('Exportação')).toBeTruthy()
  // "Opera" diz sentido, não modalidade: granito não é uma terceira operação.
  expect(within(table).queryByText('Granito')).toBeNull()
  expect(within(table).queryByText('12 CNTRS')).toBeNull()
  expect(within(table).queryByText('14 MOVES')).toBeNull()
})

it('exibe divergencia com os valores POD e POL na linha da escala', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 7, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[{
        port: 'BRVIX',
        eta: null,
        etb: null,
        ata: null,
        atb: null,
        etd: '2026-08-02',
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        temImportacao: true,
        temExportacao: true,
        temGranito: false,
        containersQty: null,
        movementsQty: null,
        divergences: [{
          field: 'etd',
          podValue: '2026-08-02',
          source: 'pol',
          sourceValue: '2026-08-03',
        }],
        omitted: false,
        deleted: false,
      } as never]}
      importBatches={[]}
      exportSchedules={[]}
      divergenceCount={1}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  expect(screen.getByText('ETD divergente')).toBeTruthy()
  expect(screen.getByTitle('Divergência ETD: POD 2026-08-02 / POL 2026-08-03')).toBeTruthy()
})

it('renderiza viagem só de exportação em uma linha sem marcador de importação', () => {
  render(
    <VoyageVisaoTab
      voyage={{ id: 8, status: 'planning', bls: [], granite_manifests: [], vazios_manifests: [] } as never}
      voyageLabel="NAVIO / 02N"
      escalaRows={[
        {
          port: 'BRSSZ',
          eta: '2026-08-01',
          etb: null,
          ata: null,
          atb: null,
          etd: null,
          atd: null,
          rtw: null,
          ceStatus: 'waiting',
          linked: false,
          escalaNumber: null,
          temImportacao: false,
          temExportacao: true,
          temGranito: false,
          containersQty: 4,
          movementsQty: null,
          divergences: [],
          omitted: false,
          deleted: false,
        } as never,
      ]}
      importBatches={[]}
      exportSchedules={[{ id: 'exp-2', voyageId: 8, pol: 'BRSSZ', eta: '2026-08-01', etb: null, linked: false } as never]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={vi.fn()}
      onOmitPod={vi.fn()}
    />,
  )

  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getByText('BRSSZ')).toBeTruthy()
  expect(within(table).getByText('Exportação')).toBeTruthy()
  expect(within(table).queryByText('Importação')).toBeNull()
})

it('trava a retirada da exportação apenas na escala que tem carga, não na viagem inteira', async () => {
  const user = userEvent.setup()
  const onEditEscala = vi.fn()
  const escala = (port: string) => ({
    port, eta: null, etb: null, ata: null, atb: null, etd: null, atd: null, rtw: null,
    linked: false, temImportacao: true, temExportacao: false, temGranito: false,
    containersQty: null, movementsQty: null, divergences: [], omitted: false, deleted: false,
  })

  render(
    <VoyageVisaoTab
      voyage={{
        id: 7,
        status: 'planning',
        bls: [],
        // Granito embarca só em Vitória; Salvador não tem carga de exportação.
        granite_manifests: [{ id: 'g1', voyage_id: 7, loading_port: 'BRVIX', granite_bls: [] }],
        vazios_manifests: [],
      } as never}
      voyageLabel="NAVIO / 01N"
      escalaRows={[escala('BRVIX'), escala('BRSSA')] as never}
      importBatches={[]}
      exportSchedules={[]}
      divergenceCount={0}
      ceCoverage={{ filled: 0, total: 0 }}
      onEditEscala={onEditEscala}
      onOmitPod={vi.fn()}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Editar planejamento da escala BRVIX' }))
  expect(onEditEscala).toHaveBeenLastCalledWith(expect.objectContaining({ port: 'BRVIX', exportLocked: true }))

  await user.click(screen.getByRole('button', { name: 'Editar planejamento da escala BRSSA' }))
  expect(onEditEscala).toHaveBeenLastCalledWith(expect.objectContaining({ port: 'BRSSA', exportLocked: false }))
})
