import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ from: vi.fn(), or: vi.fn(), eq: vi.fn(), range: vi.fn(), pages: [] as unknown[][] }))

vi.mock('../supabase', () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    order: () => builder,
    or: (arg: string) => { calls.or(arg); return builder },
    eq: (column: string, value: unknown) => { calls.eq(column, value); return builder },
    range: (from: number, to: number) => { calls.range(from, to); return builder },
    then: (resolve: (value: { data: unknown[]; error: null; count: number }) => unknown) => {
      const data = calls.pages.shift() ?? []
      return resolve({ data, error: null, count: data.length })
    },
  })
  return { supabase: { from: (table: string) => { calls.from(table); return builder } } }
})

import {
  fetchGraniteCargoRows,
  formatGraniteTons,
  graniteLegLabel,
  graniteWeightKg,
  listGraniteBls,
  summarizeGraniteCargo,
  type GraniteBlRow,
} from '../graniteCargo'

// A planilha e o banco ainda guardam o peso declarado (`shipper_weight_kg`); a
// linha de teste o carrega para provar que ele não conta.
type RowWithDeclared = GraniteBlRow & { shipper_weight_kg: number | null }

function bl(overrides: Partial<RowWithDeclared>): RowWithDeclared {
  return {
    id: 'g1',
    bl_number: 'COSU1',
    shipper_name: 'Shipper',
    vessel_voyage: 'COSCO SHIPPING ARIES/088E',
    loading_port: 'BRVIX',
    discharge_port: 'CNXMN',
    blocks_qty: 1,
    real_weight_kg: 1000,
    shipper_weight_kg: 900,
    manifest: { voyage_id: 7, voyage: { id: 7, voyage_number: '088E', vessel: { name: 'COSCO SHIPPING ARIES' } } },
    ...overrides,
  }
}

beforeEach(() => {
  calls.from.mockReset()
  calls.or.mockReset()
  calls.eq.mockReset()
  calls.range.mockReset()
  calls.pages = []
})

// Regra decidida em 2026-10-19 (lote 5b): só o peso real; o declarado pelo shipper é ruído.
describe('peso do B/L de Granito', () => {
  it('usa o peso real, mesmo com um declarado diferente', () => {
    expect(graniteWeightKg(bl({ real_weight_kg: 104000, shipper_weight_kg: 98000 }))).toBe(104000)
  })

  it('sem peso real (ausente ou zero), não usa o declarado pelo shipper', () => {
    expect(graniteWeightKg(bl({ real_weight_kg: null, shipper_weight_kg: 98000 }))).toBeNull()
    expect(graniteWeightKg(bl({ real_weight_kg: 0, shipper_weight_kg: 98000 }))).toBeNull()
  })

  it('aceita o número que o PostgREST devolve como texto', () => {
    expect(graniteWeightKg({ real_weight_kg: '80100.000' as unknown as number })).toBe(80100)
  })

  it('sem peso real, não inventa zero', () => {
    expect(graniteWeightKg({ real_weight_kg: null })).toBeNull()
    expect(graniteWeightKg({ real_weight_kg: 0 })).toBeNull()
  })

  it('mostra toneladas com uma casa', () => {
    expect(formatGraniteTons(610200)).toBe('610,2 t')
    expect(formatGraniteTons(0)).toBe('0,0 t')
  })
})

describe('resumo da carga por viagem', () => {
  it('totaliza o recorte e agrupa por navio, viagem e trecho, só com o peso real', () => {
    const rows = [
      bl({ id: 'a', blocks_qty: 6, real_weight_kg: 104000 }),
      bl({ id: 'b', blocks_qty: 7, real_weight_kg: null, shipper_weight_kg: 111900 }),
      bl({ id: 'c', blocks_qty: null, real_weight_kg: 5000, discharge_port: 'ITMDX' }),
      bl({
        id: 'd', blocks_qty: 2, real_weight_kg: 2000,
        manifest: { voyage_id: 9, voyage: { id: 9, voyage_number: '012S', vessel: { name: 'XIN PU DONG' } } },
      }),
    ]

    const { totals, byVoyage } = summarizeGraniteCargo(rows)

    // O B/L "b" não tem peso real: o declarado (111,9 t) não entra.
    expect(totals).toEqual({ bls: 4, blocks: 15, weightKg: 111000 })
    expect(byVoyage.map(({ voyageId, voyageLabel, leg, bls, blocks, weightKg }) => ({ voyageId, voyageLabel, leg, bls, blocks, weightKg }))).toEqual([
      { voyageId: 7, voyageLabel: 'COSCO SHIPPING ARIES / 088E', leg: 'BRVIX → CNXMN', bls: 2, blocks: 13, weightKg: 104000 },
      { voyageId: 7, voyageLabel: 'COSCO SHIPPING ARIES / 088E', leg: 'BRVIX → ITMDX', bls: 1, blocks: 0, weightKg: 5000 },
      { voyageId: 9, voyageLabel: 'XIN PU DONG / 012S', leg: 'BRVIX → CNXMN', bls: 1, blocks: 2, weightKg: 2000 },
    ])
  })

  it('sem Viagem cadastrada no manifesto, usa o navio e a viagem da planilha', () => {
    const { byVoyage } = summarizeGraniteCargo([bl({ manifest: { voyage_id: null, voyage: null } })])
    expect(byVoyage[0]).toMatchObject({ voyageId: null, voyageLabel: 'COSCO SHIPPING ARIES/088E' })
  })

  it('recorte vazio tem total zero e nenhuma linha', () => {
    expect(summarizeGraniteCargo([])).toEqual({ totals: { bls: 0, blocks: 0, weightKg: 0 }, byVoyage: [] })
  })

  it('o trecho marca o porto que falta', () => {
    expect(graniteLegLabel({ loading_port: 'BRVIX', discharge_port: null })).toBe('BRVIX → —')
    expect(graniteLegLabel({ loading_port: null, discharge_port: null })).toBeNull()
  })
})

describe('consulta dos B/Ls de Granito', () => {
  it('busca por B/L ou shipper, com o termo escapado (sem CNPJ)', async () => {
    await listGraniteBls({ search: 'ACME,ME' })
    expect(calls.or).toHaveBeenCalledWith('bl_number.ilike.%ACME ME%,shipper_name.ilike.%ACME ME%')
  })

  it('filtra a Viagem pelo manifesto e o POD exato, e pagina', async () => {
    await listGraniteBls({ voyageId: '7', dischargePort: 'CNXMN', page: 2, pageSize: 20 })
    expect(calls.eq).toHaveBeenCalledWith('manifest.voyage_id', 7)
    expect(calls.eq).toHaveBeenCalledWith('discharge_port', 'CNXMN')
    expect(calls.range).toHaveBeenCalledWith(20, 39)
  })

  it('não filtra quando o termo vira vazio', async () => {
    await listGraniteBls({ search: '%%' })
    expect(calls.or).not.toHaveBeenCalled()
  })

  it('lê o recorte inteiro em páginas de 1.000 para os totais', async () => {
    calls.pages = [Array.from({ length: 1000 }, (_, index) => ({ id: `a${index}` })), [{ id: 'b0' }]]
    const rows = await fetchGraniteCargoRows({ voyageId: '7' })
    expect(rows).toHaveLength(1001)
    expect(calls.range.mock.calls).toEqual([[0, 999], [1000, 1999]])
    expect(calls.eq).toHaveBeenCalledWith('manifest.voyage_id', 7)
  })
})
