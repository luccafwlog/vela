import { beforeEach, describe, expect, it, vi } from 'vitest'

// Leitura da rota para o EDI Mercante (issue 560): qual frente dá o terminal do
// manifesto, como a exceção de terminal do B/L chega ao gerador e quais vazios
// entram na linha VAZIOS. O dublê filtra as linhas por eq/in como o PostgREST.
type Row = Record<string, unknown>

const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, orders: {} as Record<string, string[]> }))

vi.mock('../supabase', () => {
  const read = (row: Row, column: string): unknown => column.split('.').reduce<unknown>((value, key) => (value as Row | null)?.[key], row)
  function query(table: string) {
    let rows = [...(db.tables[table] ?? [])]
    let head = false
    const orders: string[] = []
    const builder = {
      select: (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder },
      eq: (column: string, value: unknown) => { rows = rows.filter((row) => read(row, column) === value); return builder },
      in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(read(row, column))); return builder },
      // Guarda a ordem pedida (o teste confere que é uma chave única) e a aplica.
      order: (column: string) => { orders.push(column); db.orders[table] = [...orders]; return builder },
      range: (from: number, to: number) => {
        const compare = (left: Row, right: Row) => {
          for (const column of orders) {
            const a = read(left, column) as string | number
            const b = read(right, column) as string | number
            if (a !== b) return a < b ? -1 : 1
          }
          return 0
        }
        rows = [...rows].sort(compare).slice(from, to + 1)
        return builder
      },
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
  db.orders = {}
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
      // Manifesto BB no layout resumido: só os totais do B/L, sem linha de item.
      { id: 'BL5', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'carga_solta', cancelled_at: null, terminal_id: null, ncm_codes: [], shipper: 'SANY', cargo_description: 'Maquinas: 8 | Packages: 24', bb_weight_ton: 259.312, bb_packages_total: 32, bb_cbm: 1217.109 },
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
    expect(input.skippedBls).toEqual([{ id: 'BL3', reason: 'carga solta' }, { id: 'BL4', reason: 'B/L misto (contêiner e carga solta)' }, { id: 'BL5', reason: 'carga solta' }])
  })
})

describe('loadMercanteBreakbulkInput', () => {
  it('lê carga solta e misto da rota, com a frente de carga solta, os itens e os veículos fora de contêiner', async () => {
    const input = await loadMercanteBreakbulkInput(169, 'CNTAC', 'BRVIX')

    expect(input.header).toMatchObject({ terminalCode: 'BRVIX006', terminalDepot: 'PORTMAC' })
    expect(input.bls.map((bl) => bl.id)).toEqual(['BL3', 'BL4', 'BL5'])
    const [cargaSolta, misto, resumido] = input.bls
    // Manifesto BB só tem o nome curto das partes: ele vai no lugar do bloco.
    expect(cargaSolta).toMatchObject({ consigneeBlock: 'ACME LTDA', shipperBlock: 'SANY', notifyBlock: null, totalCbm: 120.5, totalPackages: 3 })
    expect(cargaSolta.breakbulkItems).toEqual([{ description: 'EXCAVATOR', quantity: 2, unit: 'UNITS', grossKg: 43800, cbm: 120.5, marks: 'SANY' }])
    expect(cargaSolta.vehicles).toEqual([{ chassis: 'SYS11021TT3C60990', grossKg: 21900, brand: 'SANY', model: 'SY215C' }])
    // Sem linha de item: um item com os totais do B/L e o embarcador como marca.
    expect(resumido.breakbulkItems).toEqual([{ description: 'Maquinas: 8 | Packages: 24', quantity: 32, unit: null, grossKg: 259312, cbm: 1217.109, marks: 'SANY', fromTotals: true }])
    // Misto: contêiner + carga solta na cubagem; o veículo dentro do contêiner não vira item.
    expect(misto).toMatchObject({ totalCbm: 78, vehicles: [] })
    expect(misto.containers.map((container) => container.number)).toEqual(['ABCU1234567'])
  })
})

describe('revisão da PR 1173', () => {
  it('IMO só sai confirmado pelo Baplie ou corrigido à mão; a declaração do B/L sozinha não vai ao manifesto', async () => {
    db.tables.baplie_containers = [{ id: 1, voyage_id: 169, container_number: 'BAPU0000001' }]
    db.tables.bl_containers = [
      // Declarado no B/L (o importador grava em todos os contêineres) e fora do Baplie.
      { id: 1, bl_id: 'BL1', container_number: 'DECL0000001', is_imo: true, imo_class: '3', un_number: '1263', profile_source: 'bl' },
      // Declarado no B/L e presente no Baplie, que concordou.
      { id: 2, bl_id: 'BL1', container_number: 'BAPU0000001', is_imo: true, imo_class: '3', un_number: '1263', profile_source: 'bl' },
      // Gravado pelo Baplie e corrigido à mão.
      { id: 3, bl_id: 'BL1', container_number: 'BAPU0000002', is_imo: true, imo_class: '9', un_number: '3166', profile_source: 'baplie' },
      { id: 4, bl_id: 'BL1', container_number: 'MANU0000001', is_imo: true, imo_class: '8', un_number: '1789', profile_source: 'manual' },
    ]
    const [bl1] = (await loadMercanteCargoInput(169, 'CNTAC', 'BRVIX')).bls
    expect(bl1.containers.map((container) => [container.number, container.isImo, container.unNumber, Boolean(container.imoUnconfirmed)])).toEqual([
      ['DECL0000001', false, null, true],
      ['BAPU0000001', true, '1263', false],
      ['BAPU0000002', true, '3166', false],
      ['MANU0000001', true, '1789', false],
    ])
  })

  it('Frete & Despesas são lidos por chave única (B/L + sequência), sem repetir nem pular linha entre páginas', async () => {
    db.tables.bls = Array.from({ length: 210 }, (_, index) => ({
      id: `BLF${String(index).padStart(3, '0')}`, voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'container', cancelled_at: null, terminal_id: null, ncm_codes: [],
    }))
    db.tables.bl_freight_lines = db.tables.bls.flatMap((bl) => Array.from({ length: 6 }, (_, seq) => ({
      bl_id: bl.id, seq: seq + 1, category: seq === 0 ? 'OCEAN_FREIGHT' : 'THD', description: null, currency: seq === 0 ? 'USD' : 'BRL', amount: '100.50', payment: 'PREPAID',
    })))
    const input = await loadMercanteCargoInput(169, 'CNTAC', 'BRVIX')
    expect(db.orders.bl_freight_lines).toEqual(['bl_id', 'seq'])
    expect(input.bls).toHaveLength(210)
    // 200 B/Ls × 6 linhas = 1.200 linhas no 1º bloco: duas páginas, cada linha uma vez.
    for (const bl of input.bls) {
      expect(bl.freightLines.map((line) => line.category)).toEqual(['OCEAN_FREIGHT', 'THD', 'THD', 'THD', 'THD', 'THD'])
      expect(bl.freightLines[0].amount).toBe(100.5) // valor numérico vindo como texto do PostgREST
    }
  })

  it('B/L misto sem linha de item leva a carga solta pelos totais; com frentes em terminais diferentes, o terminal fica pendente', async () => {
    db.tables.voyage_escala_operation_fronts.push({ voyage_id: 169, port: 'BRVIX', sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 't-tvv' })
    db.tables.bls = [{ id: 'MIX1', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'misto', cancelled_at: null, terminal_id: null, ncm_codes: [], shipper: 'SANY', total_cbm: 68, bb_cbm: '17', bb_weight_ton: '85', bb_packages_total: 3 }]
    db.tables.bl_containers = [{ id: 1, bl_id: 'MIX1', container_number: 'ABCU1234567', type: '40HC', cbm: 68 }]
    db.tables.bl_breakbulk_items = []
    db.tables.vehicles = []
    const [misto] = (await loadMercanteBreakbulkInput(169, 'CNTAC', 'BRVIX')).bls
    expect(misto.breakbulkItems).toEqual([expect.objectContaining({ grossKg: 85000, quantity: 3, cbm: 17, fromTotals: true })])
    expect(misto.totalCbm).toBe(85)
    expect(misto.terminalIssue).toContain('carga cheia (TVV) e a de carga solta (PORTMAC)')
  })

  it('com veículos fora de contêiner, os totais não viram item (não duplica o peso) e há aviso', async () => {
    db.tables.bls = [{ id: 'BB1', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'carga_solta', cancelled_at: null, terminal_id: null, ncm_codes: [], bb_weight_ton: 43.8, bb_packages_total: 2 }]
    db.tables.bl_breakbulk_items = []
    db.tables.vehicles = [{ id: 1, bl_id: 'BB1', container_id: null, chassis: 'XUG0001', weight_kg: 21900, brand: 'XCMG', model: 'XE215' }]
    const [bb] = (await loadMercanteBreakbulkInput(169, 'CNTAC', 'BRVIX')).bls
    expect(bb.breakbulkItems).toEqual([])
    expect(bb.vehicles).toHaveLength(1)
    expect(bb.warnings).toEqual([expect.stringContaining('não viraram item porque o B/L tem veículos')])
  })

  it('sem cubagem do B/L, usa a soma dos contêineres', async () => {
    db.tables.bls = [{ id: 'C1', voyage_id: 169, pol: 'CNTAC', pod: 'BRVIX', cargo_mode: 'container', cancelled_at: null, terminal_id: null, ncm_codes: [], total_cbm: null, bb_cbm: null }]
    db.tables.bl_containers = [{ id: 1, bl_id: 'C1', container_number: 'ABCU1234567', cbm: '30.5' }, { id: 2, bl_id: 'C1', container_number: 'ABCU7654321', cbm: 20 }]
    const [c1] = (await loadMercanteCargoInput(169, 'CNTAC', 'BRVIX')).bls
    expect(c1.totalCbm).toBe(50.5)
  })
})

describe('loadMercanteVaziosInput', () => {
  it('usa a frente de vazios e a mesma régua de porto da linha VAZIOS', async () => {
    const input = await loadMercanteVaziosInput(169, 'CNTAC', 'BRVIX')

    expect(input.header).toMatchObject({ terminalCode: 'BRVIX006', terminalDepot: 'PORTMAC' })
    expect(input.vazios).toEqual([{ number: 'FBIU4825306', type: '40FH', tareKg: 5200 }])
  })
})
