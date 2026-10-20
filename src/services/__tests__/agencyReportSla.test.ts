import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({ from: vi.fn() }))
const voyageRouteSchedulesMocks = vi.hoisted(() => ({ listVoyageEscalaSchedulesByVoyageIds: vi.fn() }))

// listClosedAgencyReports/listAgencyReportSlaRows tocam o banco; as demais
// funções deste módulo são puras — mesma convenção de billingHelpers.test.ts.
vi.mock('../supabase', () => ({ supabase: { from: supabaseMocks.from } }))
vi.mock('../voyageRouteSchedules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../voyageRouteSchedules')>()
  return { ...actual, listVoyageEscalaSchedulesByVoyageIds: voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds }
})

import {
  isEscalaOmitted,
  listAgencyReportSlaRows,
  listClosedAgencyReports,
  mapClosedReportToSlaRow,
  summarizeAgencyReportSlaByDepartment,
  type ClosedAgencyReportListItem,
} from '../agencyReportSla'
import type { VoyageEscalaSchedule } from '../voyageRouteSchedules'

beforeEach(() => {
  supabaseMocks.from.mockReset()
  voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds.mockReset()
})

// Query builder encadeável mínimo (select/eq/order/gte/lte) que resolve como
// uma Promise de { data, error } — mesmo formato que o client real do
// Supabase expõe, o bastante para exercitar listClosedAgencyReports sem um
// banco real.
function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = vi.fn(chain)
  builder.eq = vi.fn(chain)
  builder.order = vi.fn(chain)
  builder.gte = vi.fn(chain)
  builder.lte = vi.fn(chain)
  builder.then = (resolve: (value: typeof result) => unknown) => resolve(result)
  return builder
}

function closedReport(overrides: Partial<ClosedAgencyReportListItem> = {}): ClosedAgencyReportListItem {
  return {
    voyage_id: 1,
    port: 'BRVIX',
    terminal: null,
    closed_at: '2026-02-10T12:00:00.000Z',
    closed_by: 'user-1',
    voyage: { voyage_number: 'V001', vessel: { name: 'NAVIO TESTE' } },
    closed_snapshot: {
      header: { unifiedAtd: '2026-02-02', deadlineDate: '2026-02-05' },
      departmentSignoffs: [
        { department: 'operacoes', signed_by: 'user-a', signed_at: '2026-02-04T10:00:00.000Z' },
        { department: 'documentacao', signed_by: 'user-b', signed_at: '2026-02-09T10:00:00.000Z' },
        { department: 'equipamentos', signed_by: 'user-c', signed_at: '2026-02-05T10:00:00.000Z' },
      ],
    },
    ...overrides,
  }
}

describe('mapClosedReportToSlaRow', () => {
  it('mapeia uma linha no prazo (assinatura antes ou no dia do prazo)', () => {
    const row = mapClosedReportToSlaRow(closedReport())
    expect(row).not.toBeNull()
    const operacoes = row!.departments.find((d) => d.department === 'operacoes')!
    expect(operacoes.state).toBe('on-time')
    expect(operacoes.hoursElapsed).toBe(55) // 2026-02-02 00:00 BRT (03:00Z) -> 2026-02-04 10:00Z
  })

  it('ADR fechado com a regra de 72 h mede pelo instante (deadlineAt)', () => {
    const row = mapClosedReportToSlaRow(closedReport({
      closed_snapshot: {
        header: { unifiedAtd: '2026-02-02T10:00:00-03:00', deadlineDate: '2026-02-05', deadlineAt: '2026-02-05T13:00:00.000Z' },
        departmentSignoffs: [{ department: 'operacoes', signed_by: 'u', signed_at: '2026-02-05T13:30:00.000Z' }],
      },
    }))
    expect(row!.departments.find((d) => d.department === 'operacoes')!.state).toBe('overdue')
  })

  it('mapeia uma linha atrasada (assinatura depois do prazo)', () => {
    const row = mapClosedReportToSlaRow(closedReport())
    const documentacao = row!.departments.find((d) => d.department === 'documentacao')!
    expect(documentacao.state).toBe('overdue')
  })

  it('exclui linhas com snapshot legado (sem header.unifiedAtd/deadlineDate — antes da vigência)', () => {
    const legacy = closedReport({
      closed_snapshot: { header: { unifiedAtd: null, deadlineDate: null }, departmentSignoffs: [] },
    })
    expect(mapClosedReportToSlaRow(legacy)).toBeNull()

    const missingHeader = closedReport({ closed_snapshot: {} })
    expect(mapClosedReportToSlaRow(missingHeader)).toBeNull()
  })

  it('exclui linhas sem closed_at (defensivo)', () => {
    expect(mapClosedReportToSlaRow(closedReport({ closed_at: null }))).toBeNull()
  })

  it('calcula o tempo total decorrido (dias corridos) do ATD ao Fechamento', () => {
    const row = mapClosedReportToSlaRow(closedReport())!
    expect(row.elapsedCalendarDaysToClosure).toBe(8) // 2026-02-02 -> 2026-02-10
  })

  it('não classifica departamento sem assinatura como no prazo', () => {
    const row = mapClosedReportToSlaRow(closedReport({
      closed_snapshot: {
        header: { unifiedAtd: '2026-02-02', deadlineDate: '2026-02-05' },
        departmentSignoffs: [],
      },
    }))!
    const operacoes = row.departments.find((d) => d.department === 'operacoes')!
    expect(operacoes.signedAt).toBeNull()
    expect(operacoes.state).not.toBe('on-time')
    // A6 (lote 5b): sai como "Não assinou", não "Sem prazo"; conta no total, nunca no prazo.
    expect(operacoes.outcome).toBe('unsigned')
    expect(operacoes.hoursLate).toBeNull()
    const summary = summarizeAgencyReportSlaByDepartment([row])[0]
    expect(summary).toMatchObject({ onTime: 0, unsigned: 1, total: 1, rate: 0 })
  })

  it('diz quantas horas a assinatura atrasou, pelo instante do prazo ou pelo fim do dia em Brasília', () => {
    const legacy = mapClosedReportToSlaRow(closedReport())!
    // Prazo 2026-02-05 (fim do dia: 06/02 02:59:59Z); assinou 09/02 10:00Z.
    expect(legacy.departments.find((d) => d.department === 'documentacao')).toMatchObject({ outcome: 'late', hoursLate: 80 })
    expect(legacy.departments.find((d) => d.department === 'operacoes')).toMatchObject({ outcome: 'on-time', hoursLate: null })

    const instant = mapClosedReportToSlaRow(closedReport({
      closed_snapshot: {
        header: { unifiedAtd: '2026-02-02T10:00:00-03:00', deadlineDate: '2026-02-05', deadlineAt: '2026-02-05T13:00:00.000Z' },
        departmentSignoffs: [{ department: 'operacoes', signed_by: 'u', signed_at: '2026-02-05T19:00:00.000Z' }],
      },
    }))!
    expect(instant.deadlineAt).toBe('2026-02-05T13:00:00.000Z')
    expect(instant.departments.find((d) => d.department === 'operacoes')).toMatchObject({ outcome: 'late', hoursLate: 6 })
  })
})

describe('isEscalaOmitted', () => {
  function escala(overrides: Partial<VoyageEscalaSchedule> = {}): VoyageEscalaSchedule {
    return {
      entityId: '1::BRVIX',
      voyageId: 1,
      port: 'BRVIX',
      eta: null, ata: null, atd: null, atracacoes: [],
      ceStatus: null, podCeStatus: null, exportCeStatus: null, linked: null, escalaNumber: null,
      omitted: false, deleted: false, temImportacao: true, temExportacao: false, temGranito: false,
      containersQty: null, movementsQty: null, dischargePorts: [], divergences: [],
      ...overrides,
    }
  }

  it('retorna true quando a escala vigente está marcada como omitida', () => {
    const map = new Map([[1, [escala({ omitted: true })]]])
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(true)
  })

  it('retorna false quando a escala vigente não está omitida', () => {
    const map = new Map([[1, [escala({ omitted: false })]]])
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(false)
  })

  it('retorna false quando a escala não é encontrada na projeção viva (não exclui por precaução)', () => {
    const map = new Map<number, VoyageEscalaSchedule[]>()
    expect(isEscalaOmitted(map, 1, 'BRVIX')).toBe(false)
  })
})

describe('summarizeAgencyReportSlaByDepartment', () => {
  it('soma cumprimento por DEPARTAMENTO, nunca por usuário/pessoa', () => {
    const rowOnTime = mapClosedReportToSlaRow(closedReport())!
    const rowOverdue = mapClosedReportToSlaRow(
      closedReport({
        voyage_id: 2,
        port: 'BRSSZ',
        closed_snapshot: {
          header: { unifiedAtd: '2026-02-02', deadlineDate: '2026-02-05' },
          departmentSignoffs: [
            { department: 'operacoes', signed_by: 'user-x', signed_at: '2026-02-09T10:00:00.000Z' },
            { department: 'documentacao', signed_by: 'user-y', signed_at: '2026-02-09T10:00:00.000Z' },
            { department: 'equipamentos', signed_by: 'user-z', signed_at: '2026-02-09T10:00:00.000Z' },
          ],
        },
      }),
    )!

    const summary = summarizeAgencyReportSlaByDepartment([rowOnTime, rowOverdue])
    const operacoes = summary.find((s) => s.department === 'operacoes')!
    expect(operacoes.onTime).toBe(1)
    expect(operacoes.overdue).toBe(1)
    expect(operacoes.total).toBe(2)
    expect(operacoes.rate).toBe(0.5)

    // nenhum campo/chave de agregação por signed_by/usuário deve existir no resultado.
    for (const entry of summary) {
      expect(Object.keys(entry)).not.toContain('signed_by')
      expect(Object.keys(entry)).not.toContain('user')
    }
  })

  it('retorna rate null quando não há linhas para o período', () => {
    const summary = summarizeAgencyReportSlaByDepartment([])
    expect(summary.every((s) => s.total === 0 && s.rate === null)).toBe(true)
  })
})

describe('listClosedAgencyReports', () => {
  it('filtra por status=closed e aplica o intervalo de datas opcional', async () => {
    const builder = makeQueryBuilder({ data: [closedReport()], error: null })
    supabaseMocks.from.mockReturnValue(builder)

    const result = await listClosedAgencyReports({ from: '2026-02-01', to: '2026-02-28' })

    expect(supabaseMocks.from).toHaveBeenCalledWith('agency_departure_reports')
    expect(builder.eq).toHaveBeenCalledWith('status', 'closed')
    expect(builder.gte).toHaveBeenCalledWith('closed_at', '2026-02-01T00:00:00-03:00')
    expect(builder.lte).toHaveBeenCalledWith('closed_at', '2026-02-28T23:59:59.999-03:00')
    expect(result).toHaveLength(1)
  })

  it('sem intervalo informado, não filtra por data', async () => {
    const builder = makeQueryBuilder({ data: [], error: null })
    supabaseMocks.from.mockReturnValue(builder)

    await listClosedAgencyReports()

    expect(builder.gte).not.toHaveBeenCalled()
    expect(builder.lte).not.toHaveBeenCalled()
  })

  it('propaga erro da consulta', async () => {
    const builder = makeQueryBuilder({ data: null, error: new Error('falhou') })
    supabaseMocks.from.mockReturnValue(builder)

    await expect(listClosedAgencyReports()).rejects.toThrow('falhou')
  })
})

describe('listAgencyReportSlaRows', () => {
  it('exclui, via checagem viva, uma escala omitida cujo snapshot congelado tem ATD/deadline presentes', async () => {
    // Regressão do caso central do módulo: uma linha que passaria pela
    // exclusão de vigência (header.unifiedAtd/deadlineDate presentes) só é
    // barrada porque a escala está omitida no estado vigente — não porque o
    // ATD está ausente.
    const omittedButWithAtd = closedReport({ voyage_id: 5, port: 'BROMT' })
    const builder = makeQueryBuilder({ data: [omittedButWithAtd], error: null })
    supabaseMocks.from.mockReturnValue(builder)
    voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds.mockResolvedValue(
      new Map([[5, [{ entityId: '5::BROMT', voyageId: 5, port: 'BROMT', omitted: true } as VoyageEscalaSchedule]]]),
    )

    const rows = await listAgencyReportSlaRows()

    expect(rows).toHaveLength(0)
  })

  it('inclui uma escala não omitida com snapshot vigente', async () => {
    const builder = makeQueryBuilder({ data: [closedReport()], error: null })
    supabaseMocks.from.mockReturnValue(builder)
    voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds.mockResolvedValue(
      new Map([[1, [{ entityId: '1::BRVIX', voyageId: 1, port: 'BRVIX', omitted: false } as VoyageEscalaSchedule]]]),
    )

    const rows = await listAgencyReportSlaRows()

    expect(rows).toHaveLength(1)
    expect(rows[0].port).toBe('BRVIX')
  })

  it('preserva o terminal no resultado para distinguir dois ADRs da mesma escala', async () => {
    const builder = makeQueryBuilder({
      data: [
        closedReport({ terminal: 'TVV' }),
        closedReport({ terminal: 'PORTMAC' }),
      ],
      error: null,
    })
    supabaseMocks.from.mockReturnValue(builder)
    voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds.mockResolvedValue(
      new Map([[1, [{ entityId: '1::BRVIX', voyageId: 1, port: 'BRVIX', omitted: false } as VoyageEscalaSchedule]]]),
    )

    const rows = await listAgencyReportSlaRows()

    expect(rows.map((row) => row.terminal).sort()).toEqual(['PORTMAC', 'TVV'])
    expect(new Set(rows.map((row) => `${row.voyageId}::${row.port}::${row.terminal ?? 'legacy'}`)).size).toBe(2)
  })

  it('não consulta a projeção de escalas quando não há linhas mapeadas (snapshots todos legados)', async () => {
    const legacy = closedReport({
      closed_snapshot: { header: { unifiedAtd: null, deadlineDate: null }, departmentSignoffs: [] },
    })
    const builder = makeQueryBuilder({ data: [legacy], error: null })
    supabaseMocks.from.mockReturnValue(builder)

    const rows = await listAgencyReportSlaRows()

    expect(rows).toHaveLength(0)
    expect(voyageRouteSchedulesMocks.listVoyageEscalaSchedulesByVoyageIds).not.toHaveBeenCalled()
  })
})
