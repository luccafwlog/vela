import { beforeEach, describe, expect, it, vi } from 'vitest'

// Leitura da rota para o EDI Mercante (issue 560): qual frente dá o terminal do
// manifesto, como a exceção de terminal do B/L chega ao gerador e quais vazios
// entram na linha VAZIOS. O dublê filtra as linhas por eq/in como o PostgREST.
type Row = Record<string, unknown>

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))

vi.mock('../supabase', () => {
  const read = (row: Row, column: string): unknown => column.split('.').reduce<unknown>((value, key) => (value as Row | null)?.[key], row)
  function query(table: string) {
    let rows = [...(db.tables[table] ?? [])]
    let head = false
    const builder = {
      select: (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder },
      eq: (column: string, value: unknown) => { rows = rows.filter((row) => read(row, column) === value); return builder },
      in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(read(row, column))); return builder },
      order: () => builder,
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return builder },
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(head ? { count: rows.length, error: null } : { data: rows, error: null }).then(resolve),
    }
    return builder
  }
  return { supabase: { from: query } }
})

vi.mock('../voyageRouteSchedules', () => ({
  buildVoyagePolEntityId: (voyageId: number, pol: string) => `${voyageId}:${pol}`,
  buildVoyagePodEntityId: (voyageId: number, pod: string) => `${voyageId}:${pod}`,
  listVoyagePolSchedules: async ([entity]: string[]) => new Map([[entity, { atd: '2026-09-30' }]]),
  listVoyagePodSchedules: async ([entity]: string[]) => new Map([[entity, { eta: '2026-11-09' }]]),
}))

import { loadMercanteBreakbulkInput, loadMercanteCargoInput, loadMercanteVaziosInput } from '../mercanteEdiData'

beforeEach(() => {
  db.tables = {
    voyages: [{ id: 169, voyage_number: '6', vessel: { name: 'GREEN GUANGZHOU', imo: '1095014', carrier: { scac: 'CSSC' } } }],
    depots: [{ id: 't-tvv', code: 'TVV' }, { id: 't-pmac', code: 'PORTMAC' }, { id: 't-novo', code: 'NOVO' }],
    // A frente de vazios vem antes da de carga cheia: o terminal tem de sair pela modalidade, não pela ordem.
    voyage_escala_operation_fronts: [
      { voyage_id: 169, port: 'BRVIX', sentido: 'importacao', modalidade: 'vazio', terminal_id: 't-pmac' },
      { voyage_id: 169, port: 'BRVIX', sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 't-tvv' },
      { voyage_id: 169, port: 'BRVIX', sentido: 'importacao', modalidade: 'carga_solta', terminal_id: 't-pmac' },
    ],
    baplie_containers: [],
    bls: [
      { id: 'BL1', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIT', cargo_mode: 'container', cancelled_at: null, terminal_id: null, ncm_codes: [] },
      { id: 'BL2', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'container', cancelled_at: null, terminal_id: 't-novo', ncm_codes: [] },
      { id: 'BL3', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'carga_solta', cancelled_at: null, terminal_id: null, ncm_codes: [], consignee: 'ACME LTDA', consignee_block: null, shipper: 'SANY', notify_party: null, total_cbm: null, bb_cbm: 120.5, bb_packages_total: 3 },
      { id: 'BL4', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'misto', cancelled_at: null, terminal_id: null, ncm_codes: [], total_cbm: 68, bb_cbm: 10 },
    ],
    bl_containers: [{ id: 1, bl_id: 'BL4', container_number: 'ABCU1234567', type: '40HC' }],
    bl_breakbulk_items: [{ id: 1, bl_id: 'BL3', item_description: 'EXCAVATOR', package_qty: 2, package_unit: 'UNITS', gross_weight_kg: 43800, cbm: 120.5, marks: 'SANY' }],
    vehicles: [
      { id: 1, bl_id: 'BL3', container_id: null, chassis: 'SYS11021TT3C60990', weight_kg: 21900, brand: 'SANY', model: 'SY215C' },
      { id: 2, bl_id: 'BL4', container_id: 1, chassis: 'INSIDE00000000001', weight_kg: 1500, brand: 'BYD', model: 'DOLPHIN' },
    ],
    bl_freight_lines: [],
    vazios_importacao_containers: [
      { id: 1, container_number: 'fbiu4825306', container_type: '40FH', tare_kg: 5200, pol: 'TAICANG', pod: 'VITORIA', manifest: { voyage_id: 169 } },
      { id: 2, container_number: 'FBIU4003330', container_type: '40FR', tare_kg: 5800, pol: 'CNTAC', pod: 'BRSSZ', manifest: { voyage_id: 169 } },
    ],
  }
})

describe('loadMercanteCargoInput', () => {
  it('usa a frente de carga cheia do POD e leva a exceção de terminal do B/L ao gerador', async () => {
    const input = await loadMercanteCargoInput(169, 'CNTAC', 'BRVIX')

    expect(input.header).toMatchObject({ terminalCode: 'BRVIX004', terminalDepot: 'TVV', closingDate: '2026-09-30', operationDate: '2026-11-09', carrierCode: 'CN001321' })
    expect(input.bls.map((bl) => bl.id)).toEqual(['BL1', 'BL2'])
    expect(input.bls[1]).toMatchObject({ terminalCode: null, terminalDepot: 'NOVO' })
    expect(input.skippedBls).toEqual([{ id: 'BL3', reason: 'carga solta' }, { id: 'BL4', reason: 'B/L misto (contêiner e carga solta)' }])
  })
})

describe('loadMercanteBreakbulkInput', () => {
  it('lê carga solta e misto da rota, com a frente de carga solta, os itens e os veículos fora de contêiner', async () => {
    const input = await loadMercanteBreakbulkInput(169, 'CNTAC', 'BRVIX')

    expect(input.header).toMatchObject({ terminalCode: 'BRVIX006', terminalDepot: 'PORTMAC' })
    expect(input.bls.map((bl) => bl.id)).toEqual(['BL3', 'BL4'])
    const [cargaSolta, misto] = input.bls
    // Manifesto BB só tem o nome curto das partes: ele vai no lugar do bloco.
    expect(cargaSolta).toMatchObject({ consigneeBlock: 'ACME LTDA', shipperBlock: 'SANY', notifyBlock: null, totalCbm: 120.5, totalPackages: 3 })
    expect(cargaSolta.breakbulkItems).toEqual([{ description: 'EXCAVATOR', quantity: 2, unit: 'UNITS', grossKg: 43800, cbm: 120.5, marks: 'SANY' }])
    expect(cargaSolta.vehicles).toEqual([{ chassis: 'SYS11021TT3C60990', grossKg: 21900, brand: 'SANY', model: 'SY215C' }])
    // Misto: contêiner + carga solta na cubagem; o veículo dentro do contêiner não vira item.
    expect(misto).toMatchObject({ totalCbm: 78, vehicles: [] })
    expect(misto.containers.map((container) => container.number)).toEqual(['ABCU1234567'])
  })
})

describe('loadMercanteVaziosInput', () => {
  it('usa a frente de vazios e a mesma régua de porto da linha VAZIOS', async () => {
    const input = await loadMercanteVaziosInput(169, 'CNTAC', 'BRVIX')

    expect(input.header).toMatchObject({ terminalCode: 'BRVIX006', terminalDepot: 'PORTMAC' })
    expect(input.vazios).toEqual([{ number: 'FBIU4825306', type: '40FH', tareKg: 5200 }])
  })
})
