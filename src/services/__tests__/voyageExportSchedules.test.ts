import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

import {
  saveVoyageExportScheduleTransactional,
  VoyageExportScheduleBlockedError,
} from '../voyageExportSchedules'

function queryResult<T>(data: T, error: Error | null = null) {
  const result = { data, error }
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

function configureState() {
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyage_escala_operation_fronts') {
      return queryResult([
        { sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 'terminal-import', source: 'operational_data' },
        { sentido: 'exportacao', modalidade: 'granito', terminal_id: 'terminal-granite', source: 'export_declaration' },
        { sentido: 'exportacao', modalidade: 'vazio', terminal_id: null, source: 'export_declaration' },
      ])
    }
    if (table === 'voyage_escala_terminal_state') {
      return queryResult([
        { terminal_id: 'terminal-import', terminal_atb: '2026-08-01T08:00:00Z', terminal_atd: null, terminal_rtw: 2 },
        { terminal_id: 'terminal-granite', terminal_atb: null, terminal_atd: null, terminal_rtw: null },
      ])
    }
    if (table === 'voyage_escala_revision_state') return queryResult({ revision: 7 })
    throw new Error(`Tabela inesperada: ${table}`)
  })
}

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

describe('saveVoyageExportScheduleTransactional', () => {
  it('omite status documental não editado, preservando a aprovação ocorrida enquanto o editor estava aberto', async () => {
    configureState()
    rpcMock.mockResolvedValue({ data: { revision: 8, fronts: [], terminals: [], closed_blockers: [], blocked: false }, error: null })
    await saveVoyageExportScheduleTransactional({
      voyageId: 12, pol: 'BRVIX', temExportacao: true, hasGranite: true, hasEmpty: false,
      containersQty: null, movementsQty: null, dischargePorts: [], linked: false, expectedRevision: 7,
    })
    expect(rpcMock.mock.lastCall?.[1].p_export_expectation).not.toHaveProperty('ce_status')
  })
  it('preserva importação, terminais e revisão e altera somente frentes exportadoras', async () => {
    configureState()
    rpcMock.mockResolvedValue({
      data: { revision: 8, fronts: [], terminals: [], closed_blockers: [], blocked: false },
      error: null,
    })

    await saveVoyageExportScheduleTransactional({
      existingId: 'export-1',
      voyageId: 12,
      pol: 'BRVIX',
      temExportacao: true,
      hasGranite: false,
      hasEmpty: true,
      containersQty: null,
      movementsQty: null,
      dischargePorts: ['nlrtm'],
      ceStatus: 'waiting',
      linked: false,
      expectedRevision: 7,
    })

    expect(rpcMock).toHaveBeenCalledWith('save_voyage_escala_terminal_state', expect.objectContaining({
      p_expected_revision: 7,
      p_terminals: [
        { terminal_id: 'terminal-import', terminal_atb: '2026-08-01T08:00:00Z', terminal_atd: null, terminal_rtw: 2 },
        { terminal_id: 'terminal-granite', terminal_atb: null, terminal_atd: null, terminal_rtw: null },
      ],
      p_export_expectation: {
        tem_exportacao: true,
        granito: false,
        vazios: true,
        has_empty: true,
        containers_qty: null,
        movements_qty: null,
        discharge_ports: ['NLRTM'],
        ce_status: 'waiting',
        linked: false,
        existing_id: 'export-1',
      },
    }))
    const payload = rpcMock.mock.calls[0][1] as { p_fronts: Array<Record<string, unknown>> }
    expect(payload.p_fronts).toEqual([
      { sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 'terminal-import', source: 'operational_data' },
      { sentido: 'exportacao', modalidade: 'vazio', terminal_id: null, source: 'export_declaration' },
    ])
  })

  it('mantém Restow inteiro e nulo no round-trip do payload transacional', async () => {
    configureState()
    rpcMock.mockResolvedValue({
      data: { revision: 8, fronts: [], terminals: [], closed_blockers: [], blocked: false },
      error: null,
    })

    await saveVoyageExportScheduleTransactional({
      existingId: 'export-1',
      voyageId: 12,
      pol: 'BRVIX',
      temExportacao: true,
      hasGranite: true,
      hasEmpty: false,
      containersQty: null,
      movementsQty: null,
      dischargePorts: [],
      ceStatus: 'waiting',
      linked: false,
      expectedRevision: 7,
    })

    const payload = rpcMock.mock.calls[0][1] as {
      p_terminals: Array<{ terminal_id: string; terminal_rtw: number | null }>
    }
    expect(payload.p_terminals).toEqual([
      { terminal_id: 'terminal-import', terminal_atb: '2026-08-01T08:00:00Z', terminal_atd: null, terminal_rtw: 2 },
      { terminal_id: 'terminal-granite', terminal_atb: null, terminal_atd: null, terminal_rtw: null },
    ])
    expect(payload.p_terminals[0].terminal_rtw).toBeTypeOf('number')
    expect(payload.p_terminals[1].terminal_rtw).toBeNull()
  })

  it('retorna bloqueio estruturado e não faz upsert direto', async () => {
    configureState()
    rpcMock.mockResolvedValue({
      data: {
        revision: 7,
        fronts: [],
        terminals: [],
        closed_blockers: [{ terminal_code: 'TVV', report_id: 'report-1', reason: 'closed' }],
        blocked: true,
      },
      error: null,
    })

    await expect(saveVoyageExportScheduleTransactional({
      existingId: 'export-1',
      voyageId: 12,
      pol: 'BRVIX',
      temExportacao: false,
      hasGranite: false,
      hasEmpty: false,
      containersQty: null,
      movementsQty: null,
      dischargePorts: [],
      ceStatus: 'waiting',
      linked: false,
      expectedRevision: 7,
    })).rejects.toBeInstanceOf(VoyageExportScheduleBlockedError)

    expect(fromMock).not.toHaveBeenCalledWith('voyage_export_schedules')
  })

  it('recusa nova declaração sem frente explícita antes de ler estado', async () => {
    await expect(saveVoyageExportScheduleTransactional({
      voyageId: 12,
      pol: 'BRVIX',
      temExportacao: true,
      hasGranite: false,
      hasEmpty: false,
      containersQty: null,
      movementsQty: null,
      dischargePorts: [],
      ceStatus: 'waiting',
      linked: false,
      expectedRevision: 0,
    })).rejects.toThrow(/granito ou vazios/i)

    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
