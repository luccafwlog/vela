// Prévia da Programação por planilha (migrations 188 e 193): a prévia diz o
// que a gravação vai fazer. Viagem oculta é publicada, Viagem cancelada é erro
// da linha, IMO distinto nunca funde, IMO sem 7 dígitos não identifica navio e
// a mesma Viagem e porto com datas diferentes em duas linhas é recusada.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  findVoyage: vi.fn(),
  listPod: vi.fn(),
  listPol: vi.fn(),
  vessels: { byImo: [] as Array<{ id: number; imo: string | null }>, byName: [] as Array<{ id: number; imo: string | null }> },
  voyages: [] as Array<{ id: number; status: string; show_on_portal: boolean }>,
  rpc: vi.fn(),
}))

vi.mock('../voyages', () => ({
  createVoyage: vi.fn(),
  setVoyageShowOnPortal: vi.fn(),
  findVoyageByNumberAndVessel: calls.findVoyage,
}))

vi.mock('../voyageRouteSchedules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../voyageRouteSchedules')>()),
  listVoyagePodSchedules: calls.listPod,
  listVoyagePolSchedules: calls.listPol,
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: calls.rpc,
    from: (table: string) => {
      if (table === 'vessels') {
        return {
          select: () => ({
            ilike: () => ({ limit: async () => ({ data: calls.vessels.byImo, error: null }) }),
            eq: () => ({ limit: async () => ({ data: calls.vessels.byName, error: null }) }),
          }),
        }
      }
      if (table === 'voyages') {
        return { select: () => ({ in: async (_column: string, ids: number[]) => ({ data: calls.voyages.filter((voyage) => ids.includes(voyage.id)), error: null }) }) }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    },
  },
}))

import { applyScheduleSheetPlan, isScheduleSheetWrite, planScheduleSheet, type VoyageScheduleInput } from '../voyageFromSchedule'

const sheetRow = (overrides: Partial<VoyageScheduleInput> = {}): VoyageScheduleInput => ({
  vesselName: 'GREEN PECEM',
  vesselImo: '9976501',
  voyageNumber: '6',
  lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-22' }],
  ...overrides,
})

const podOnDate = (voyageId: number, eta: string) => new Map([[`${voyageId}::BRSSA`, {
  entityId: `${voyageId}::BRSSA`, voyageId, pod: 'BRSSA', temImportacao: true, eta, etb: null, ata: null, atb: null,
  etd: null, atd: null, rtw: null, ceStatus: null, linked: false, escalaNumber: null, deleted: false,
}]])

describe('planScheduleSheet', () => {
  beforeEach(() => {
    calls.findVoyage.mockReset()
    calls.listPod.mockReset().mockResolvedValue(new Map())
    calls.listPol.mockReset().mockResolvedValue(new Map())
    calls.rpc.mockReset().mockResolvedValue({ data: { created: 0, updated: 1, changes: 0, voyage_ids: [42] }, error: null })
    calls.vessels = { byImo: [], byName: [] }
    calls.voyages = []
  })

  it('Viagem existente oculta, com a mesma data, é publicada no Portal e entra na gravação', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(podOnDate(42, '2026-01-22'))
    calls.voyages = [{ id: 42, status: 'active', show_on_portal: false }]

    const [row] = await planScheduleSheet([sheetRow()], 'user-1')

    expect(row).toMatchObject({ voyageId: 42, createsVoyage: false, publishes: true, changes: [], error: null })
    expect(isScheduleSheetWrite(row)).toBe(true)
    await applyScheduleSheetPlan([row])
    expect(calls.rpc).toHaveBeenCalledWith('apply_schedule_sheet_atomic', expect.objectContaining({
      p_rows: [expect.objectContaining({ voyage_id: 42, changes: [] })],
    }))
  })

  it('Viagem já publicada com a mesma data fica "sem mudança" e não é enviada', async () => {
    calls.findVoyage.mockResolvedValue(42)
    calls.listPod.mockResolvedValue(podOnDate(42, '2026-01-22'))
    calls.voyages = [{ id: 42, status: 'active', show_on_portal: true }]

    const [row] = await planScheduleSheet([sheetRow()], 'user-1')

    expect(row.publishes).toBe(false)
    expect(isScheduleSheetWrite(row)).toBe(false)
  })

  it('Viagem cancelada é erro da linha e não entra na gravação', async () => {
    calls.findVoyage.mockResolvedValue(43)
    calls.voyages = [{ id: 43, status: 'cancelled', show_on_portal: false }]

    const [row] = await planScheduleSheet([sheetRow()], 'user-1')

    expect(row.error).toMatch(/GREEN PECEM \/ 6 cancelada/)
    expect(isScheduleSheetWrite(row)).toBe(false)
  })

  it('Viagem nova: navio de mesmo nome com outro IMO é conflito, não "Cria a viagem"', async () => {
    calls.findVoyage.mockResolvedValue(null)
    calls.vessels = { byImo: [], byName: [{ id: 1, imo: '9235004' }] }

    const [row] = await planScheduleSheet([sheetRow({ vesselImo: 'IMO 9235005' })], 'user-1')

    expect(row).toMatchObject({ createsVoyage: false, error: 'Navio GREEN PECEM com IMO conflitante (9235004 vs 9235005). Corrija antes de importar.' })
  })

  it('IMO sem 7 dígitos não identifica navio: busca pelo nome e avisa', async () => {
    calls.findVoyage.mockResolvedValue(null)
    calls.vessels = { byImo: [], byName: [] }

    const [row] = await planScheduleSheet([sheetRow({ vesselImo: 'TBA' })], 'user-1')

    expect(calls.findVoyage).toHaveBeenCalledWith('6', '', 'GREEN PECEM')
    expect(row).toMatchObject({ vesselImo: null, ignoredImo: 'TBA', createsVoyage: true, error: null })
  })

  it('mesma Viagem e porto em duas linhas com datas diferentes recusa as duas; datas iguais passam', async () => {
    calls.findVoyage.mockResolvedValue(44)
    calls.voyages = [{ id: 44, status: 'active', show_on_portal: true }]

    const conflicting = await planScheduleSheet([
      sheetRow(),
      sheetRow({ lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-25' }] }),
    ], 'user-1')
    expect(conflicting.map((row) => row.error)).toEqual([
      'Viagem em 2 linhas com datas diferentes (BRSSA ETA: 2026-01-22, 2026-01-25). Deixe uma linha por viagem.',
      'Viagem em 2 linhas com datas diferentes (BRSSA ETA: 2026-01-22, 2026-01-25). Deixe uma linha por viagem.',
    ])
    expect(conflicting.some(isScheduleSheetWrite)).toBe(false)

    const repeated = await planScheduleSheet([sheetRow(), sheetRow()], 'user-1')
    expect(repeated.map((row) => row.error)).toEqual([null, null])
  })

  // A gravação acha o navio da Viagem nova pelo IMO ou pelo nome: as duas
  // linhas são a mesma Viagem mesmo que só uma traga o IMO.
  it('Viagem nova em duas linhas, uma com IMO e outra sem, com datas diferentes recusa as duas', async () => {
    calls.findVoyage.mockResolvedValue(null)

    const mixed = await planScheduleSheet([
      sheetRow(),
      sheetRow({ vesselImo: '', lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-25' }] }),
    ], 'user-1')
    expect(mixed.map((row) => row.error)).toEqual([
      'Viagem em 2 linhas com datas diferentes (BRSSA ETA: 2026-01-22, 2026-01-25). Deixe uma linha por viagem.',
      'Viagem em 2 linhas com datas diferentes (BRSSA ETA: 2026-01-22, 2026-01-25). Deixe uma linha por viagem.',
    ])

    // Mesmo navio novo com dois IMOs válidos: a gravação desfaria o arquivo;
    // a prévia recusa as duas linhas, mesmo com datas iguais.
    const twoImos = await planScheduleSheet([sheetRow(), sheetRow({ vesselImo: '9976502' })], 'user-1')
    expect(twoImos.map((row) => row.error)).toEqual([
      'Navio GREEN PECEM com IMOs diferentes no arquivo (9976501, 9976502). Deixe um IMO por navio.',
      'Navio GREEN PECEM com IMOs diferentes no arquivo (9976501, 9976502). Deixe um IMO por navio.',
    ])

    // Outro navio com o mesmo número de viagem continua sendo outra Viagem.
    const otherVessel = await planScheduleSheet([
      sheetRow(),
      sheetRow({ vesselName: 'GREEN SANTOS', vesselImo: '', lanes: [{ code: 'BRSSA', kind: 'pod', date: '2026-01-25' }] }),
    ], 'user-1')
    expect(otherVessel.map((row) => row.error)).toEqual([null, null])
  })
})
