import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveAgencyReportSections,
  deriveOperationFronts,
  EscalaTerminalBlockedError,
  fetchEscalaTerminalState,
  fetchEscalaTerminalRevision,
  graniteLoadingPorts,
  groupAgencyReportsByTerminal,
  saveEscalaTerminalState,
} from '../escalaTerminalAllocation'

const { rpcMock, fromMock, exportSchedulesMock, depotsMock, schedulesMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  exportSchedulesMock: vi.fn(),
  depotsMock: vi.fn(),
  schedulesMock: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}))
vi.mock('../voyageExportSchedules', () => ({ fetchExportSchedulesByVoyageIds: exportSchedulesMock }))
vi.mock('../depots', () => ({ listDepots: depotsMock }))
vi.mock('../voyageRouteSchedules', () => ({ listVoyageEscalaSchedulesByVoyageIds: schedulesMock }))

describe('escalaTerminalAllocation', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
    exportSchedulesMock.mockResolvedValue(new Map())
    depotsMock.mockResolvedValue([])
    schedulesMock.mockResolvedValue(new Map())
  })

  it('captura a revisão existente para o caminho legado sem state carregado', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { revision: 7 }, error: null }),
    }
    fromMock.mockReturnValue(query)

    await expect(fetchEscalaTerminalRevision(12, 'brvix')).resolves.toBe(7)
    expect(fromMock).toHaveBeenCalledWith('voyage_escala_revision_state')
    expect(query.eq).toHaveBeenNthCalledWith(1, 'voyage_id', 12)
    expect(query.eq).toHaveBeenNthCalledWith(2, 'port', 'BRVIX')
  })

  it('pagina B/Ls derivados e não perde uma frente depois do limite do PostgREST', async () => {
    const makeQuery = (tableName: string) => {
      const query: Record<string, unknown> & { page?: number } = { page: 0 }
      query.select = () => query
      query.eq = () => query
      query.in = () => query
      query.order = () => query
      query.is = () => query
      query.range = (_from: number, to: number) => {
        query.page = to >= 1000 ? 1000 : 0
        return query
      }
      query.maybeSingle = () => Promise.resolve({ data: { revision: 0, port_id: 99 }, error: null })
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
        tableName === 'voyage_escala_operation_fronts'
          ? { data: [], error: null }
          : tableName === 'voyage_escala_terminal_state'
            ? { data: [], error: null }
            : tableName === 'ports'
              ? { data: [{ id: 99, locode: 'BRSSZ' }], error: null }
              : tableName === 'agency_departure_reports'
                ? { data: [], error: null }
                : tableName === 'bls'
                  ? query.page === 0
                    ? { data: Array.from({ length: 1000 }, () => ({ cargo_mode: 'container', pod: 'BRSSZ' })), error: null }
                    : { data: [{ cargo_mode: 'carga_solta', pod: 'BRSSZ' }], error: null }
                  : { data: [], error: null },
      ).then(resolve)
      return query
    }
    fromMock.mockImplementation((tableName: string) => makeQuery(tableName))
    schedulesMock.mockResolvedValue(new Map([[12, [{ port: 'BRSSZ', temImportacao: false }]]]))

    const state = await fetchEscalaTerminalState(12, 'BRSSZ')

    expect(state.fronts.map((front) => front.modalidade)).toEqual(expect.arrayContaining(['carga_cheia', 'carga_solta']))
  })

  // Decisão do dono (2026-10-30): o veículo viaja em container e segue a
  // frente de Carga cheia; não há frente nem terminal próprio de veículo.
  it('não cria frente de Veículos: a seção Veículos é atendida pela Carga cheia', () => {
    const fronts = deriveOperationFronts({
      existing: [{ id: 'f1', sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' }],
      importKinds: ['carga_cheia'],
    })
    const [report] = groupAgencyReportsByTerminal([
      { reportId: 'adr-tvv', voyageId: 9, port: 'BRVIX', terminalId: 'tvv', terminal: 'TVV', status: 'open' },
    ], fronts)

    expect(fronts.map((front) => `${front.sentido}:${front.modalidade}`)).toEqual(['importacao:carga_cheia'])
    expect(report.sections.find((section) => section.section === 'veiculos')).toMatchObject({
      state: 'operated', fronts: ['carga_cheia'], frontKeys: ['importacao:carga_cheia'],
    })
  })

  it('deriva as frentes da escala de descarga também dos B/Ls em transbordo de escala omitida', async () => {
    const makeQuery = (tableName: string) => {
      const query: Record<string, unknown> & { byId?: boolean } = {}
      query.select = () => query
      query.eq = () => query
      query.in = (column: string) => {
        if (column === 'id') query.byId = true
        return query
      }
      query.order = () => query
      query.is = () => query
      query.range = () => query
      query.maybeSingle = () => Promise.resolve({ data: { revision: 0, port_id: 99 }, error: null })
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
        tableName === 'ports'
          ? { data: [{ id: 99, locode: 'BRVIX' }], error: null }
          : tableName === 'voyage_omissions'
            ? { data: [{ id: 5 }], error: null }
            : tableName === 'bl_transshipments'
              ? { data: [{ bl_id: 'BL-T' }], error: null }
              // O B/L em transbordo mantém o POD do porto omitido: só a
              // consulta por id o encontra.
              : tableName === 'bls' && query.byId
                ? { data: [{ id: 'BL-T', cargo_mode: 'carga_solta' }], error: null }
                : { data: [], error: null },
      ).then(resolve)
      return query
    }
    fromMock.mockImplementation((tableName: string) => makeQuery(tableName))

    const state = await fetchEscalaTerminalState(12, 'BRVIX')

    expect(state.fronts.map((front) => `${front.sentido}:${front.modalidade}`)).toEqual(['importacao:carga_solta'])
    expect(state.tbcFronts[0]).toMatchObject({ section: 'carga_descarregada', terminalId: null })
  })

  it('deriva a frente de Granito do Granito importado no porto, sem a declaração de exportação', async () => {
    const makeQuery = (tableName: string) => {
      const query: Record<string, unknown> = {}
      query.select = () => query
      query.eq = () => query
      query.in = () => query
      query.order = () => query
      query.is = () => query
      query.range = () => query
      query.maybeSingle = () => Promise.resolve({ data: { revision: 0, port_id: 99 }, error: null })
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
        tableName === 'ports'
          ? { data: [{ id: 99, locode: 'BRVIX' }], error: null }
          : tableName === 'granite_bls'
            ? { data: [
                // Porto do B/L vence o do manifesto; sem ele, vale o do manifesto.
                { id: 'g1', loading_port: 'BRSSZ', manifest: { voyage_id: 12, loading_port: 'BRVIX' } },
                { id: 'g2', loading_port: null, manifest: { voyage_id: 12, loading_port: 'BRVIT' } },
              ], error: null }
            : { data: [], error: null },
      ).then(resolve)
      return query
    }
    fromMock.mockImplementation((tableName: string) => makeQuery(tableName))

    const state = await fetchEscalaTerminalState(12, 'BRVIX')

    expect(state.fronts.map((front) => `${front.sentido}:${front.modalidade}`)).toEqual(['exportacao:granito'])
    expect(state.tbcFronts[0]).toMatchObject({ source: 'export_declaration', section: 'carga_carregada', terminalId: null })
  })

  // Revisão da PR #1121: a janela da escala declarava o Granito pelo porto do
  // manifesto, e a frente nascia pelo porto de cada B/L.
  it('marca como porto com Granito o do manifesto e o efetivo de cada B/L', () => {
    const ports = graniteLoadingPorts([
      { loading_port: 'BRSSZ', granite_bls: [{ loading_port: 'Vitoria, Brazil' }, { loading_port: null }] },
      { loading_port: 'BRVIT', granite_bls: null },
    ])

    expect([...ports].sort()).toEqual(['BRSSZ', 'BRVIX'])
  })

  it('preserva frente persistida mesmo quando a fonte operacional deixou de aparecer', () => {
    const fronts = deriveOperationFronts({
      existing: [{ id: 'front-1', sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' }],
      exportSchedule: { temExportacao: true, hasGranite: true, hasEmpty: false },
    })

    expect(fronts.map((front) => `${front.sentido}:${front.modalidade}`)).toEqual([
      'exportacao:granito',
      'importacao:carga_cheia',
    ])
    expect(fronts.find((front) => front.modalidade === 'carga_cheia')).toMatchObject({ terminalId: 'tvv', hasData: true })
  })

  it('preserva terminal e identidade de frente quando a fonte operacional continua presente', () => {
    const fronts = deriveOperationFronts({
      existing: [
        { id: 'front-import', sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' },
        { id: 'front-export', sentido: 'exportacao', modalidade: 'granito', terminalId: 'portmac', source: 'export_declaration' },
      ],
      importKinds: ['carga_cheia'],
      exportSchedule: { temExportacao: true, hasGranite: true, hasEmpty: false },
    })

    expect(fronts.find((front) => front.modalidade === 'carga_cheia')).toMatchObject({ id: 'front-import', terminalId: 'tvv' })
    expect(fronts.find((front) => front.modalidade === 'granito')).toMatchObject({ id: 'front-export', terminalId: 'portmac' })
  })

  it('projeta seção Nada operado para uma frente ausente de um ADR terminalizado', () => {
    const sections = deriveAgencyReportSections([
      { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data', hasData: false, section: 'carga_descarregada' },
    ], 'vbr')
    expect(sections.find((section) => section.section === 'carga_descarregada')).toEqual({
      section: 'carga_descarregada', state: 'nothing_operated', fronts: [], frontKeys: [],
    })
  })

  it('agrupa quatro frentes em dois ADRs e mantém TBC fora dos dois', () => {
    const fronts = deriveOperationFronts({
      existing: [
        { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'tvv', source: 'operational_data' },
        { sentido: 'importacao', modalidade: 'carga_solta', terminalId: 'tvv', source: 'operational_data' },
        { sentido: 'importacao', modalidade: 'vazio', terminalId: 'vbr', source: 'operational_data' },
        { sentido: 'exportacao', modalidade: 'granito', terminalId: 'vbr', source: 'export_declaration' },
      ],
    })
    const reports = groupAgencyReportsByTerminal([
      { reportId: 'adr-tvv', voyageId: 9, port: 'BRVIX', terminalId: 'tvv', terminal: 'TVV', status: 'open' },
      { reportId: 'adr-vbr', voyageId: 9, port: 'BRVIX', terminalId: 'vbr', terminal: 'VBR', status: 'open' },
    ], fronts)
    expect(reports[0].sections.find((section) => section.section === 'carga_descarregada')).toMatchObject({ state: 'operated', fronts: ['carga_cheia', 'carga_solta'] })
    expect(reports[1].sections.find((section) => section.section === 'vazios_descarregados')).toMatchObject({ state: 'operated', fronts: ['vazio'] })

    const tbc = deriveOperationFronts({ existing: [{ sentido: 'exportacao', modalidade: 'vazio', terminalId: null, source: 'export_declaration' }] })
    expect(tbc[0].terminalId).toBeNull()
    const reportInputs = reports.map((report) => ({ reportId: report.reportId, voyageId: report.voyageId, port: report.port, terminalId: report.terminalId, terminal: report.terminal, status: report.status }))
    expect(groupAgencyReportsByTerminal(reportInputs, tbc)[0].sections.every((section) => section.state === 'nothing_operated')).toBe(true)
  })

  it('mantém escala sem frentes como estado vazio, com todas as seções Nada operado', () => {
    expect(deriveOperationFronts({})).toEqual([])
    expect(deriveAgencyReportSections([], 'tvv').every((section) => section.state === 'nothing_operated')).toBe(true)
  })

  it('preserva sentido e modalidade na projeção das seções, inclusive para vazio', () => {
    const sections = deriveAgencyReportSections([
      { sentido: 'importacao', modalidade: 'vazio', terminalId: 'tvv', source: 'operational_data', hasData: true, section: 'vazios_descarregados' },
      { sentido: 'exportacao', modalidade: 'vazio', terminalId: 'portmac', source: 'export_declaration', hasData: true, section: 'vazios_embarcados' },
    ], 'tvv')

    expect(sections.find((section) => section.section === 'vazios_descarregados')).toMatchObject({
      fronts: ['vazio'],
      frontKeys: ['importacao:vazio'],
    })
    expect(sections.find((section) => section.section === 'vazios_embarcados')).toMatchObject({
      fronts: [],
      frontKeys: [],
    })
  })

  it('salva somente pela RPC transacional e traduz bloqueio de ADR fechado', async () => {
    rpcMock.mockResolvedValue({
      data: { blocked: true, revision: 4, fronts: [], terminals: [], closed_blockers: [{ terminal_code: 'TVV', report_id: 'report-1', reason: 'ADR fechado' }] },
      error: null,
    })

    await expect(saveEscalaTerminalState({
      voyageId: 9,
      port: 'BRVIX',
      expectedRevision: 3,
      fronts: [{ sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'terminal-1' }],
      terminals: [{ terminalId: 'terminal-1', atb: null, atd: null, restow: null }],
      exportExpectation: { tem_exportacao: false, granito: false, has_empty: false },
    })).rejects.toMatchObject({ code: 'ADR_CLOSED_BLOCKED' })

    expect(rpcMock).toHaveBeenCalledWith('save_voyage_escala_terminal_state_v2', expect.objectContaining({
      p_voyage_id: 9,
      p_port: 'BRVIX',
      p_expected_revision: 3,
    }))
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('retorna a revisão e invalida as superfícies quando a RPC confirma', async () => {
    rpcMock.mockResolvedValue({ data: { blocked: false, revision: 4, fronts: [], terminals: [], closed_blockers: [] }, error: null })
    const invalidateQueries = vi.fn()
    const result = await saveEscalaTerminalState({
      voyageId: 9,
      port: 'BRVIX',
      expectedRevision: 3,
      fronts: [],
      terminals: [],
      exportExpectation: { tem_exportacao: false, granito: false, has_empty: false },
      queryClient: { invalidateQueries },
    })

    expect(result.revision).toBe(4)
    expect(rpcMock.mock.calls[0][1].p_export_expectation).toEqual({ tem_exportacao: false, granito: false, has_empty: false })
    expect(rpcMock.mock.calls[0][1].p_export_expectation).not.toBeNull()
    expect(invalidateQueries).toHaveBeenCalled()
    expect(invalidateQueries.mock.calls.map(([input]) => input.queryKey[0])).toEqual(expect.arrayContaining([
      'voyage-escala-schedules', 'voyage-timeline', 'agency-report', 'lineup-tv-v3', 'painel', 'tv',
    ]))
    expect(invalidateQueries.mock.calls).toContainEqual([{ queryKey: ['voyage-escala-schedules'] }])
    expect(invalidateQueries.mock.calls).toContainEqual([{ queryKey: ['voyage-timeline', '9'] }])
  })
})

it('expõe a classe de domínio para consumidores sem depender do texto do PostgREST', () => {
  const error = new EscalaTerminalBlockedError([{ reportId: 'r1', terminalId: 't1', terminalCode: 'TVV', reason: 'fechado' }])
  expect(error).toMatchObject({ name: 'EscalaTerminalBlockedError', code: 'ADR_CLOSED_BLOCKED', blockers: [{ terminalCode: 'TVV' }] })
  expect(error.message).toContain('Reabra o ADR')
})

describe('02-viagens-adr:6: recusa da escala', () => {
  it('só a revisão obsoleta é conflito; "Atracação travada" mostra o próprio motivo', async () => {
    const { isRevisionConflictError } = await import('../escalaTerminalAllocation')
    expect(isRevisionConflictError({ code: 'P0001', message: 'REVISAO_OBSOLETA: esperada 1, atual 2.' })).toBe(true)
    expect(isRevisionConflictError({ code: 'P0001', message: 'Atracação travada: B/L com CE Mercante.' })).toBe(false)
  })
})

describe('EscalaTerminalBlockedError', () => {
  it('não mostra o identificador interno do ADR ao operador', () => {
    const error = new EscalaTerminalBlockedError([
      { reportId: '10::BRVIX', terminalId: 't1', terminalCode: 'TVV', reason: null },
      { reportId: '10::BRSSZ', terminalId: null, terminalCode: null, reason: null },
    ])
    expect(error.message).toBe('A alteração está bloqueada por ADR fechado: TVV, terminal sem código. Reabra o ADR antes de continuar.')
  })
})
