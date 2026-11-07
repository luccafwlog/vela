import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeReportByReportId,
  deriveAgencyReportByTerminal,
  getAgencyReportOwnDataByReportId,
  getAgencyReportOwnDataByTerminal,
  listAgencyReportOwnDataByScale,
  reopenReportByReportId,
  setDepartmentSignoffByReportId,
  setSectionObservationByReportId,
  setSignoffByReportId,
  TerminalizedAgencyReportRpcUnavailableError,
} from '../agencyDepartureReport'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
vi.mock('../voyageRouteSchedules', () => ({
  buildVoyagePodEntityId: (voyageId: number, port: string) => `${voyageId}::${port}`,
  listVoyagePodSchedules: vi.fn(),
  listVoyageEscalaSchedulesByVoyageIds: vi.fn().mockResolvedValue(new Map()),
  getVoyageUnifiedAtd: vi.fn().mockResolvedValue({ atd: null, atdSource: null, atdRegisteredAt: null }),
}))
vi.mock('../vaziosExportOperations', async (importOriginal) => ({
  computeStorageTotals: vi.fn(() => ({ containers: 0, days: 0 })),
  summarizeEmptyExportRoutes: (await importOriginal<typeof import('../vaziosExportOperations')>()).summarizeEmptyExportRoutes,
}))

function builder(data: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  }
  return query
}

describe('agencyDepartureReport terminalizado', () => {
  beforeEach(() => rpcMock.mockReset().mockResolvedValue({ data: null, error: null }))

  it('lê por reportId e não depende de voyage+port como identidade única', async () => {
    const report = { id: 'report-1', voyage_id: 9, port: 'BRVIX', terminal_id: 'terminal-1', terminal: 'TVV', status: 'open', closed_by: 'actor-1', signoffs: [], departmentSignoffs: [], occurrences: [] }
    fromMock.mockReturnValue(builder(report))
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: 'actor-1', full_name: 'Ana Ribeiro' }], error: null })
    await expect(getAgencyReportOwnDataByReportId('report-1')).resolves.toMatchObject({ id: 'report-1', terminal_id: 'terminal-1', actor_names: { 'actor-1': 'Ana Ribeiro' }, closed_by_name: 'Ana Ribeiro' })
    expect(fromMock).toHaveBeenCalledWith('agency_departure_reports')
    expect(rpcMock).toHaveBeenCalledWith('get_agency_report_actor_names_by_report_id', { p_report_id: 'report-1' })
  })

  it('lê terminal e escala em caminhos distintos e mantém a lista legada', async () => {
    const report = { id: 'report-1', voyage_id: 9, port: 'BRVIX', terminal_id: 'terminal-1', terminal: 'TVV', status: 'open', signoffs: [], departmentSignoffs: [], occurrences: [] }
    fromMock.mockReturnValue(builder(report))
    await expect(getAgencyReportOwnDataByTerminal(9, 'BRVIX', 'terminal-1')).resolves.toMatchObject({ terminal_id: 'terminal-1' })
    fromMock.mockReturnValue(builder([report]))
    await expect(listAgencyReportOwnDataByScale(9, 'BRVIX')).resolves.toHaveLength(1)
  })

  it('separa as quatro frentes entre ADRs e mantém Nada operado', () => {
    const report = { id: 'report-1', voyage_id: 9, port: 'BRVIX', terminal_id: 'terminal-1', terminal: 'TVV', status: 'open' }
    const result = deriveAgencyReportByTerminal(report, [
      { sentido: 'importacao', modalidade: 'carga_cheia', terminalId: 'terminal-1', source: 'operational_data', hasData: true, section: 'carga_descarregada' },
      { sentido: 'importacao', modalidade: 'vazio', terminalId: 'terminal-2', source: 'operational_data', hasData: true, section: 'vazios_descarregados' },
      { sentido: 'exportacao', modalidade: 'granito', terminalId: 'terminal-1', source: 'export_declaration', hasData: false, section: 'carga_carregada' },
      { sentido: 'exportacao', modalidade: 'vazio', terminalId: 'terminal-2', source: 'export_declaration', hasData: false, section: 'vazios_embarcados' },
    ])
    expect(result.sections.find((section) => section.section === 'carga_descarregada')).toMatchObject({ state: 'operated', fronts: ['carga_cheia'] })
    expect(result.sections.find((section) => section.section === 'vazios_descarregados')).toMatchObject({ state: 'nothing_operated', fronts: [] })
    expect(result.sections.find((section) => section.section === 'carga_carregada')).toMatchObject({ state: 'nothing_operated', fronts: ['granito'] })
  })

  it('roteia sign-off, observação, departamento, fechamento e reabertura por report_id', async () => {
    const common = { reportId: 'report-1', voyageId: 9, port: 'BRVIX' }
    await setSignoffByReportId({ ...common, section: 'datas', state: 'confirmed' })
    await setSectionObservationByReportId({ ...common, section: 'datas', observation: 'ok' })
    await setDepartmentSignoffByReportId({ ...common, department: 'operacoes', signed: true })
    await closeReportByReportId({ ...common, snapshot: {} })
    await reopenReportByReportId({ ...common, justification: 'corrigir' })

    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual([
      'set_agency_report_signoff_by_report_id',
      'set_agency_report_section_observation_by_report_id',
      'set_agency_report_department_signoff_by_report_id',
      'close_agency_departure_report_by_report_id',
      'reopen_agency_departure_report_by_report_id',
    ])
    expect(rpcMock.mock.calls.every(([, args]) => args.p_report_id === 'report-1')).toBe(true)
  })

  it('não cai no RPC legado quando o contrato report_id-aware ainda não foi migrado', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } })
    await expect(setSignoffByReportId({ reportId: 'report-1', voyageId: 9, port: 'BRVIX', section: 'datas', state: 'confirmed' }))
      .rejects.toBeInstanceOf(TerminalizedAgencyReportRpcUnavailableError)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock.mock.calls[0][0]).toBe('set_agency_report_signoff_by_report_id')
  })
})
