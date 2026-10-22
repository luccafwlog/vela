import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, updateMock, recordAuditEntriesMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  updateMock: vi.fn(),
  recordAuditEntriesMock: vi.fn(async () => undefined),
}))

vi.mock('../supabase', () => ({ supabase: { from: fromMock } }))
// A agenda grava o Histórico pela RPC `record_audit_entries` (migration 403).
vi.mock('../auditEntries', () => ({ recordAuditEntries: recordAuditEntriesMock }))

import {
  listVoyagePodSchedules,
  listVoyagePolSchedules,
  projectVoyageEscalaSchedules,
  saveVoyagePodSchedule,
  saveVoyagePolSchedule,
} from '../voyageRouteSchedules'

beforeEach(() => {
  fromMock.mockReset()
  updateMock.mockReset()
  recordAuditEntriesMock.mockClear()
})

describe('projectVoyageEscalaSchedules', () => {
  it('atracação sem agenda do POD ainda forma a escala, com o ATD', () => {
    const [escala] = projectVoyageEscalaSchedules({
      terminalStates: [{
        voyageId: 10, port: 'BRSSZ', stateId: 's1', terminalId: 't1', terminalCode: 'SBSA',
        terminalEtb: null, terminalAtb: '2026-10-08T03:00:00+00:00', terminalEtd: null,
        terminalAtd: '2026-10-09T03:00:00+00:00', terminalRtw: 2, revision: 0,
      }],
    })
    expect(escala).toMatchObject({ port: 'BRSSZ', atd: '2026-10-09T03:00:00+00:00' })
    expect(escala.atracacoes).toHaveLength(1)
  })

  it('projeta escala brasileira com somente linha POD', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pod: 'BRSSZ',
        eta: '2026-08-01',
        etb: '2026-08-02',
        ata: '2026-08-03',
        atb: '2026-08-04',
        etd: '2026-08-05',
        atd: '2026-08-06',
        rtw: 7,
        ceStatus: 'received',
        linked: true,
        escalaNumber: '001',
        deleted: false,
        omitted: false,
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      voyageId: 12,
      port: 'BRSSZ',
      eta: '2026-08-01',
      ata: '2026-08-03',
      atd: null,
      atracacoes: [],
      ceStatus: 'received',
      linked: true,
      escalaNumber: '001',
      omitted: false,
      deleted: false,
      temImportacao: true,
      temExportacao: false,
      temGranito: false,
      containersQty: null,
      movementsQty: null,
      divergences: [],
    })])
  })

  it('mantem aguardando no POD quando a exportacao tem status proprio', () => {
    const [escala] = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pod: 'BRVIX',
        eta: '2026-08-26',
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        temImportacao: true,
        deleted: false,
        omitted: false,
      }],
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: 'export-1',
          voyageId: 12,
          pol: 'BRVIX',
          temExportacao: true,
          hasGranite: false,
          hasEmpty: true,
          containersQty: 12,
          movementsQty: 12,
          ceStatus: 'received',
          linked: false,
        }],
      ]),
    })

    expect(escala).toMatchObject({
      ceStatus: null,
      podCeStatus: null,
      exportCeStatus: 'received',
      temImportacao: true,
      temExportacao: true,
    })
  })

  it('projeta escala brasileira com somente linha POL', () => {
    const escalas = projectVoyageEscalaSchedules({
      polSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pol: 'BRVIX',
        atd: '2026-08-06',
        etd: '2026-08-05',
        escalaNumber: '002',
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      voyageId: 12,
      port: 'BRVIX',
      eta: null,
      ata: null,
      atd: null,
      escalaNumber: '002',
      temImportacao: false,
      // Linha de POL é registro documental (ADR 0025): não declara exportação.
      temExportacao: false,
      divergences: [],
    })])
  })

  it('mantem a Escala sem fundir o ETD documental do POL', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pod: 'BRVIX',
        eta: null,
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        deleted: false,
        omitted: false,
      }],
      polSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pol: 'BRVIX',
        atd: null,
        etd: '2026-08-07',
        escalaNumber: null,
      }],
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRVIX',
      atd: null,
      temImportacao: true,
      temExportacao: false,
      divergences: [],
    })])
  })

  it('remove POL estrangeiro e normaliza porto brasileiro por extenso', () => {
    const escalas = projectVoyageEscalaSchedules({
      polSchedules: [
        {
          entityId: '12::CNSHA',
          voyageId: 12,
          pol: 'CNSHA',
          atd: '2026-08-01',
          etd: '2026-07-30',
          escalaNumber: '001',
        },
        {
          entityId: '12::Vitoria',
          voyageId: 12,
          pol: 'Vitoria',
          atd: '2026-08-06',
          etd: '2026-08-05',
          escalaNumber: '002',
        },
      ],
    })

    expect(escalas).toHaveLength(1)
    expect(escalas[0]).toEqual(expect.objectContaining({ port: 'BRVIX' }))
  })

  it('inclui somente EXP brasileira e preserva marcadores de exportacao', () => {
    const escalas = projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map([
        ['BRSSA', {
          id: 'exp-1',
          voyageId: 12,
          pol: 'SALVADOR',
          temExportacao: true,
          hasGranite: true,
          hasEmpty: false,
          containersQty: 10,
          movementsQty: 14,
          ceStatus: 'waiting',
          linked: true,
        }],
        ['CNSHA', {
          id: 'exp-2',
          voyageId: 12,
          pol: 'CNSHA',
          temExportacao: true,
          hasGranite: false,
          hasEmpty: true,
          containersQty: 99,
          movementsQty: 99,
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRSSA',
      ceStatus: 'waiting',
      linked: true,
      temImportacao: false,
          temExportacao: true,
      temGranito: true,
      temVazios: false,
      containersQty: 10,
      movementsQty: 14,
    })])
  })

  it('preserva datas do portador POD sem marcar importacao ao editar escala somente de exportacao', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRVIX',
        voyageId: 12,
        pod: 'BRVIX',
        eta: '2026-08-01',
        etb: '2026-08-02',
        ata: '2026-08-03',
        atb: '2026-08-04',
        etd: '2026-08-05',
        atd: null,
        rtw: null,
        ceStatus: 'waiting',
        linked: false,
        escalaNumber: null,
        temImportacao: false,
        deleted: false,
        omitted: false,
      }],
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: 'exp-1',
          voyageId: 12,
          pol: 'BRVIX',
          temExportacao: true,
          hasGranite: false,
          hasEmpty: false,
          containersQty: 4,
          movementsQty: 2,
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escalas).toEqual([expect.objectContaining({
      port: 'BRVIX',
      eta: '2026-08-01',
      ata: '2026-08-03',
      atd: null,
      atracacoes: [],
      temImportacao: false,
          temExportacao: true,
      containersQty: 4,
      movementsQty: 2,
    })])
  })

  it.each([
    ['somente granito', true, false],
    ['somente vazios', false, true],
    ['granito e vazios', true, true],
  ])('projeta %s sem depender de quantidades', (_label, hasGranite, hasEmpty) => {
    const [escala] = projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: `exp-${String(hasGranite)}-${String(hasEmpty)}`,
          voyageId: 12,
          pol: 'BRVIX',
          temExportacao: true,
          hasGranite,
          hasEmpty,
          containersQty: null,
          movementsQty: null,
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escala).toEqual(expect.objectContaining({
      temExportacao: true,
      temGranito: hasGranite,
      temVazios: hasEmpty,
      containersQty: null,
      movementsQty: null,
    }))
  })

  it('mantem a escala sem operação quando a declaração existe mas não há quantidades', () => {
    const [escala] = projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: 'exp-declarada',
          voyageId: 12,
          pol: 'BRVIX',
          temExportacao: true,
          hasGranite: false,
          hasEmpty: true,
          containersQty: null,
          movementsQty: null,
          ceStatus: 'waiting',
          linked: false,
        }],
      ]),
    })

    expect(escala).toEqual(expect.objectContaining({
      temExportacao: true,
      temGranito: false,
      temVazios: true,
      containersQty: null,
      movementsQty: null,
    }))
  })

  it('não cria vazios de exportação quando a declaração está desligada', () => {
    const [escala] = projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map([
        ['BRVIX', {
          id: 'exp-desligada', voyageId: 12, pol: 'BRVIX', temExportacao: false,
          hasGranite: false, hasEmpty: true, containersQty: 10, movementsQty: 2,
          ceStatus: 'waiting', linked: false,
        }],
      ]),
    })

    expect(escala.temExportacao).toBe(false)
    expect(escala.temVazios).toBe(false)
  })

  it('ordena a projeção de exportações de forma determinística', () => {
    const build = (entries: Array<[string, string]>) => projectVoyageEscalaSchedules({
      exportSchedulesByPort: new Map(entries.map(([port, id]) => [port, {
        id,
        voyageId: 12,
        pol: port,
        temExportacao: true,
        hasGranite: false,
        hasEmpty: true,
        containersQty: null,
        movementsQty: null,
        ceStatus: 'waiting' as const,
        linked: false,
      }])),
    }).map(({ port, temVazios }) => ({ port, temVazios }))

    expect(build([['BRSSZ', 'exp-2'], ['BRVIX', 'exp-1']]))
      .toEqual(build([['BRVIX', 'exp-1'], ['BRSSZ', 'exp-2']]))
  })

  it('preserva a escala pela linha de POL quando o POD foi soft-deletado', () => {
    const escalas = projectVoyageEscalaSchedules({
      podSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pod: 'BRSSZ',
        eta: '2026-08-01',
        etb: null,
        ata: null,
        atb: null,
        etd: null,
        atd: null,
        rtw: null,
        ceStatus: null,
        linked: null,
        escalaNumber: null,
        deleted: true,
        omitted: false,
      }],
      polSchedules: [{
        entityId: '12::BRSSZ',
        voyageId: 12,
        pol: 'BRSSZ',
        atd: null,
        etd: '2026-08-05',
        escalaNumber: '001',
      }],
    })

    expect(escalas).toMatchObject([{ port: 'BRSSZ', temImportacao: false, temExportacao: false }])
  })

  // Migration 318: a mesma regra de customer_communication_scale_schedules.
  describe('grafias do mesmo porto (BRVIT e BRVIX)', () => {
    const pod = (spelling: string, overrides: Record<string, unknown>) => ({
      entityId: `12::${spelling}`, voyageId: 12, pod: spelling, eta: null, etb: null, ata: null, atb: null,
      etd: null, atd: null, rtw: null, ceStatus: null, linked: null, escalaNumber: null, deleted: false, omitted: false,
      ...overrides,
    })

    it('"Excluir escala" grava na grafia normalizada e exclui a escala de dados em BRVIT', () => {
      expect(projectVoyageEscalaSchedules({
        podSchedules: [
          pod('BRVIT', { eta: '2026-11-01T08:00:00Z', lastChangedAt: '2026-10-19T09:00:00Z' }),
          pod('BRVIX', { deleted: true, lastChangedAt: '2026-10-19T10:00:00Z' }),
        ],
      })).toEqual([])
    })

    it('a grafia ativa gravada depois da exclusão vence e fornece as datas', () => {
      const escalas = projectVoyageEscalaSchedules({
        podSchedules: [
          pod('BRVIX', { deleted: true, eta: '2026-10-30T08:00:00Z', lastChangedAt: '2026-10-19T09:00:00Z' }),
          pod('BRVIT', { eta: '2026-11-01T08:00:00Z', omitted: false, lastChangedAt: '2026-10-19T10:00:00Z' }),
        ],
      })
      expect(escalas).toEqual([expect.objectContaining({ port: 'BRVIX', eta: '2026-11-01T08:00:00Z', deleted: false })])
      expect(escalas[0]?.podDeleted).toBeUndefined()
      // Sem data de gravação (empate), a ativa vence.
      expect(projectVoyageEscalaSchedules({
        podSchedules: [pod('BRVIX', { deleted: true }), pod('BRVIT', { eta: '2026-11-01T08:00:00Z' })],
      })).toEqual([expect.objectContaining({ eta: '2026-11-01T08:00:00Z' })])
    })

    it('POD excluído com a escala viva pela POL fica marcado para a régua', () => {
      const escalas = projectVoyageEscalaSchedules({
        podSchedules: [pod('BRVIX', { deleted: true, eta: '2026-11-01T08:00:00Z' })],
        polSchedules: [{ entityId: '12::BRVIX', voyageId: 12, pol: 'BRVIX', atd: null, etd: '2026-11-03', escalaNumber: null }],
      })
      expect(escalas).toEqual([expect.objectContaining({ port: 'BRVIX', eta: null, deleted: false, podDeleted: true })])
    })
  })

  it('GREEN CHASE deriva o ATD da última Atracação somente com completude', () => {
    const base = {
      podSchedules: [{
        entityId: '12::BRVIX', voyageId: 12, pod: 'BRVIX', eta: '2026-08-25',
        etb: null, ata: '2026-08-26', atb: null, etd: null, atd: null, rtw: null,
        ceStatus: null, linked: null, escalaNumber: null, deleted: false, omitted: false,
      }],
      terminalStates: [
        { voyageId: 12, port: 'BRVIX', terminalId: 'tvv', terminalCode: 'TVV', terminalEtb: '2026-08-26', terminalAtb: '2026-08-26', terminalEtd: '2026-08-28', terminalAtd: '2026-08-29', terminalRtw: 1, revision: 1 },
        { voyageId: 12, port: 'BRVIX', terminalId: 'portmac', terminalCode: 'PORTMAC', terminalEtb: '2026-08-28', terminalAtb: '2026-08-29', terminalEtd: '2026-09-01', terminalAtd: '2026-09-02', terminalRtw: 2, revision: 1 },
      ],
    }

    expect(projectVoyageEscalaSchedules(base)[0]).toMatchObject({
      atd: '2026-09-02',
      atracacoes: [
        expect.objectContaining({ terminalId: 'tvv', atd: '2026-08-29' }),
        expect.objectContaining({ terminalId: 'portmac', atd: '2026-09-02' }),
      ],
    })
    expect(projectVoyageEscalaSchedules({
      ...base,
      terminalStates: base.terminalStates.map((state) => state.terminalId === 'tvv' ? { ...state, terminalAtd: null } : state),
    })[0]).toMatchObject({ atd: null })
  })
})

it('mantem a linha da escala quando as colunas novas de Atracacao ainda nao existem', async () => {
  const auditQuery = {
    entityType: null as string | null,
    select: vi.fn(() => auditQuery),
    eq: vi.fn((column: string, value: string) => {
      if (column === 'entity_type') auditQuery.entityType = value
      return auditQuery
    }),
    or: vi.fn(() => auditQuery),
    order: vi.fn(() => auditQuery),
    range: vi.fn(async () => ({
      data: auditQuery.entityType === 'voyage_pod_schedule'
        ? [{ entity_id: '12::BRVIX', field_name: 'eta', new_value: '2026-08-01', changed_at: '2026-07-01T00:00:00Z' }]
        : [],
      error: null,
    })),
  }
  const exportQuery = {
    select: vi.fn(() => exportQuery),
    in: vi.fn(async () => ({ data: [], error: null })),
  }
  const terminalQuery = {
    select: vi.fn(() => terminalQuery),
    in: vi.fn(async () => ({
      data: null,
      error: { code: '42703', message: 'column terminal_etb does not exist' },
    })),
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') return auditQuery
    if (table === 'voyage_export_schedules') return exportQuery
    if (table === 'voyage_escala_terminal_state') return terminalQuery
    throw new Error(`Tabela inesperada: ${table}`)
  })

  const { listVoyageEscalaSchedulesByVoyageIds } = await import('../voyageRouteSchedules')
  const result = await listVoyageEscalaSchedulesByVoyageIds([12])

  expect(result.get(12)).toEqual([expect.objectContaining({ port: 'BRVIX', eta: '2026-08-01' })])
})

it('a leitura do Histórico guarda a última gravação de cada grafia para decidir a exclusão', async () => {
  const auditQuery = {
    entityType: null as string | null,
    select: vi.fn(() => auditQuery),
    eq: vi.fn((column: string, value: string) => {
      if (column === 'entity_type') auditQuery.entityType = value
      return auditQuery
    }),
    or: vi.fn(() => auditQuery),
    order: vi.fn(() => auditQuery),
    range: vi.fn(async () => ({
      data: auditQuery.entityType === 'voyage_pod_schedule'
        ? [
          { entity_id: '12::BRVIX', field_name: 'deleted', new_value: 'true', changed_at: '2026-10-19T10:00:00Z' },
          { entity_id: '12::BRVIT', field_name: 'eta', new_value: '2026-11-01T08:00:00Z', changed_at: '2026-10-19T09:00:00Z' },
        ]
        : [],
      error: null,
    })),
  }
  const emptyQuery = {
    select: vi.fn(() => emptyQuery),
    in: vi.fn(async () => ({ data: [], error: null })),
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') return auditQuery
    if (table === 'voyage_export_schedules' || table === 'voyage_escala_terminal_state') return emptyQuery
    throw new Error(`Tabela inesperada: ${table}`)
  })

  const { listVoyageEscalaSchedulesByVoyageIds } = await import('../voyageRouteSchedules')
  expect((await listVoyageEscalaSchedulesByVoyageIds([12])).get(12)).toEqual([])
})

it('nao reverte uma viagem cancelada quando o ATD muda', async () => {
  let auditSelects = 0
  const auditLogs = {
    select: vi.fn(() => {
      auditSelects += 1
      if (auditSelects === 1) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })) })),
          })),
        }
      }
      return {
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [{ entity_id: '12::BRSSZ', field_name: 'atd', new_value: null, changed_at: null }],
              error: null,
            })),
          })),
        })),
      }
    }),
    insert: vi.fn(async () => ({ error: null })),
  }
  const voyages = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { status: 'cancelled' }, error: null })) })),
    })),
    update: updateMock.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) }),
  }

  fromMock.mockImplementation((table: string) => {
    if (table === 'audit_logs') return auditLogs
    if (table === 'voyage_export_schedules' || table === 'voyage_escala_terminal_state') {
      return { select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })) }
    }
    return voyages
  })

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    etb: null,
    ata: null,
    atd: '2026-07-10',
    rtw: null,
    ceStatus: null,
    linked: null,
    changedBy: 'user-1',
  })

  expect(updateMock).not.toHaveBeenCalled()
})

it('hidrata o ATD mais recente ao listar schedules de POL', async () => {
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::CNSHA', field_name: 'atd', new_value: '2026-07-10', changed_at: '2026-07-10T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'atd', new_value: '2026-07-09', changed_at: '2026-07-09T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'etd', new_value: '2026-07-08', changed_at: '2026-07-08T12:00:00Z' },
                { entity_id: '12::CNSHA', field_name: 'escala_number', new_value: '001', changed_at: '2026-07-07T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  }

  fromMock.mockImplementation((table: string) => {
    expect(table).toBe('audit_logs')
    return auditLogs
  })

  const schedules = await listVoyagePolSchedules(['12::CNSHA'])

  expect(schedules.get('12::CNSHA')).toEqual({
    entityId: '12::CNSHA',
    voyageId: 12,
    pol: 'CNSHA',
    atd: '2026-07-10',
    etd: '2026-07-08',
    escalaNumber: '001',
  })
})

it('lê a agenda de POL de muitas viagens em lotes que cabem na URL', async () => {
  // Com ~200 viagens a lista inteira passava do limite do servidor (HTTP 431).
  const entityIds = Array.from({ length: 120 }, (_, index) => `${index + 1}::CNSHA`)
  const chunks: string[][] = []
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        in: (_column: string, ids: string[]) => {
          chunks.push(ids)
          return {
            order: () => ({
              range: async () => ({
                data: ids.map((id) => ({ entity_id: id, field_name: 'etd', new_value: '2026-07-08', changed_at: '2026-07-08T12:00:00Z' })),
                error: null,
              }),
            }),
          }
        },
      }),
    }),
  }))

  const schedules = await listVoyagePolSchedules(entityIds)

  expect(Math.max(...chunks.map((ids) => ids.length))).toBeLessThanOrEqual(50)
  expect(chunks.flat()).toEqual(entityIds)
  expect(schedules.size).toBe(120)
  expect(schedules.get('120::CNSHA')?.etd).toBe('2026-07-08')
})

it('lote com mais de 1.000 linhas de auditoria lê a página seguinte e não perde o trecho com menos edições', async () => {
  // 1.000 edições recentes do trecho 1 enchem a primeira página; a data do trecho 2 só vem na segunda.
  const busy = Array.from({ length: 1000 }, (_, index) => ({ entity_id: '1::BRSSZ', field_name: 'eta', new_value: '2026-08-01', changed_at: `2026-08-01T00:00:${String(index % 60).padStart(2, '0')}Z` }))
  const quiet = [{ entity_id: '2::BRSSZ', field_name: 'eta', new_value: '2026-07-01', changed_at: '2026-07-01T00:00:00Z' }]
  const ranges: number[] = []
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        in: () => ({
          order: () => ({
            range: async (from: number) => {
              ranges.push(from)
              return { data: from === 0 ? busy : quiet, error: null }
            },
          }),
        }),
      }),
    }),
  }))

  const schedules = await listVoyagePodSchedules(['1::BRSSZ', '2::BRSSZ'])

  expect(ranges).toEqual([0, 1000])
  expect(schedules.get('2::BRSSZ')?.eta).toBe('2026-07-01')
})

it('grava audit row de ATD por POL sem quebrar callers antigos', async () => {
  const insertMock = recordAuditEntriesMock
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::CNSHA', field_name: 'etd', new_value: '2026-07-08', changed_at: '2026-07-08T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
    insert: insertMock,
  }

  fromMock.mockImplementation((table: string) => {
    expect(table).toBe('audit_logs')
    return auditLogs
  })

  await saveVoyagePolSchedule({
    voyageId: 12,
    pol: 'CNSHA',
    etd: '2026-07-08',
    atd: '2026-07-10',
    changedBy: 'user-1',
    justification: 'ATD documental',
  })

  expect(insertMock).toHaveBeenCalledWith([
    {
      entity_type: 'voyage_pol_schedule',
      entity_id: '12::CNSHA',
      field_name: 'atd',
      old_value: null,
      new_value: '2026-07-10',
      changed_by: 'user-1',
      justification: 'ATD documental',
    },
  ])
})

it('preserva a alteração de schedule quando o caller não informa changedBy', async () => {
  const insertMock = recordAuditEntriesMock
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
        })),
      })),
    })),
    insert: insertMock,
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyage_export_schedules' || table === 'voyage_escala_terminal_state') {
      return { select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })) }
    }
    return auditLogs
  })

  await saveVoyagePolSchedule({
    voyageId: 12,
    pol: 'CNSHA',
    etd: '2026-07-08',
    changedBy: null,
  })

  expect(insertMock).toHaveBeenCalledWith([
    expect.objectContaining({ field_name: 'etd', changed_by: null }),
  ])
})

it('hidrata ATB e ETD mais recentes ao listar schedules de POD', async () => {
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(async () => ({
              data: [
                { entity_id: '12::BRSSZ', field_name: 'atb', new_value: '2026-07-10T08:00', changed_at: '2026-07-10T08:00:00Z' },
                { entity_id: '12::BRSSZ', field_name: 'atb', new_value: '2026-07-09T08:00', changed_at: '2026-07-09T08:00:00Z' },
                { entity_id: '12::BRSSZ', field_name: 'etd', new_value: '2026-07-12', changed_at: '2026-07-08T12:00:00Z' },
              ],
              error: null,
            })),
          })),
        })),
      })),
    })),
  }
  fromMock.mockReturnValue(auditLogs)

  const schedules = await listVoyagePodSchedules(['12::BRSSZ'])

  expect(schedules.get('12::BRSSZ')).toMatchObject({
    atb: '2026-07-10T08:00',
    etd: '2026-07-12',
  })
})

it('grava audit rows de ATB e ETD por POD', async () => {
  const insertMock = recordAuditEntriesMock
  let selectCalls = 0
  const auditLogs = {
    select: vi.fn(() => {
      selectCalls += 1
      if (selectCalls === 1) {
        return {
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
            })),
          })),
        }
      }
      return {
        eq: vi.fn(() => ({
          order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })),
        })),
      }
    }),
    insert: insertMock,
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyage_export_schedules' || table === 'voyage_escala_terminal_state') {
      return { select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })) }
    }
    return auditLogs
  })

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    etb: null,
    ata: null,
    atb: '2026-07-10T08:00',
    etd: '2026-07-12',
    atd: null,
    rtw: null,
    ceStatus: null,
    linked: null,
    changedBy: 'user-1',
  })

  expect(insertMock).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({
      field_name: 'atb',
      new_value: '2026-07-10T08:00',
      justification: 'Atualizacao manual de ATB por POD',
    }),
    expect.objectContaining({
      field_name: 'etd',
      new_value: '2026-07-12',
      justification: 'Atualizacao manual de ETD por POD',
    }),
  ]))
})

it.each([
  { previous: null, next: 'waiting' },
  { previous: 'approved', next: undefined },
] as const)('preserva o status $previous ao salvar sem alteração documental', async ({ previous, next }) => {
  const insertMock = recordAuditEntriesMock
  const auditLogs = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({ range: vi.fn(async () => ({
            data: previous ? [{ entity_id: '12::BRSSZ', field_name: 'ces', new_value: previous }] : [], error: null,
          })) })),
        })),
      })),
    })),
    insert: insertMock,
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyage_export_schedules' || table === 'voyage_escala_terminal_state') {
      return { select: vi.fn(() => ({ in: vi.fn(async () => ({ data: [], error: null })) })) }
    }
    return auditLogs
  })

  await saveVoyagePodSchedule({
    voyageId: 12,
    pod: 'BRSSZ',
    eta: null,
    ata: null,
    ceStatus: next,
    linked: null,
    changedBy: 'user-1',
  })

  expect(insertMock).not.toHaveBeenCalled()
})
