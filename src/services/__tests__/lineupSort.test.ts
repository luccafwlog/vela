import { describe, expect, it, vi } from 'vitest'

// lineup.ts importa o cliente Supabase no topo do módulo; o comparador puro
// testado aqui não o toca, então um stub vazio basta.
vi.mock('../supabase', () => ({ supabase: {} }))

import { compareDateValues, compareLineUpRows, type LineUpRow } from '../lineup'

describe('compareDateValues (ordenação do Line-Up)', () => {
  it('ordena datas em ordem crescente', () => {
    expect(compareDateValues('2026-01-01', '2026-01-02')).toBeLessThan(0)
    expect(compareDateValues('2026-01-02', '2026-01-01')).toBeGreaterThan(0)
  })

  it('coloca valores nulos no fim (nulo é "maior")', () => {
    expect(compareDateValues('2026-01-01', null)).toBeLessThan(0)
    expect(compareDateValues(null, '2026-01-01')).toBeGreaterThan(0)
  })

  it('dois nulos são iguais — NÃO retorna NaN (preserva desempate posterior)', () => {
    const result = compareDateValues(null, null)
    expect(Number.isNaN(result)).toBe(false)
    expect(result).toBe(0)
  })

  it('duas datas iguais retornam 0', () => {
    expect(compareDateValues('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('usado como comparador, mantém o desempate quando as ETAs são nulas', () => {
    // Regressão: quando ambas as ETAs são nulas, o comparador de eta deve
    // devolver 0 para que o critério seguinte (ex.: nome do navio) decida.
    type Row = { eta: string | null; vessel: string }
    const rows: Row[] = [
      { eta: null, vessel: 'ZEUS' },
      { eta: null, vessel: 'ARES' },
    ]
    const sorted = [...rows].sort((a, b) => {
      const byEta = compareDateValues(a.eta, b.eta)
      if (byEta !== 0) return byEta
      return a.vessel.localeCompare(b.vessel, 'pt-BR')
    })
    expect(sorted.map((r) => r.vessel)).toEqual(['ARES', 'ZEUS'])
  })
})

describe('compareLineUpRows', () => {
  function makeRow(overrides: Partial<LineUpRow>): LineUpRow {
    return {
      id: 'row-1',
      voyageId: 1,
      voyageNumber: '100A',
      vesselName: 'ALPHA',
      rowType: 'import',
      pod: 'BRSSZ',
      eta: '2026-06-01',
      etb: null,
      ata: null,
      atb: null,
      atd: null,
      omitted: false,
      voyageStatus: 'active',
      ...overrides,
    } as LineUpRow
  }

  it('coloca viagens canceladas no final da fila operacional após ativas e omitidas', () => {
    const atBerth = makeRow({ id: 'berth', atb: '2026-06-01', voyageStatus: 'active' })
    const pendingEta = makeRow({ id: 'eta', eta: '2026-06-02', voyageStatus: 'active' })
    const omitted = makeRow({ id: 'omitted', omitted: true, voyageStatus: 'active' })
    const cancelled = makeRow({ id: 'cancelled', atb: '2026-05-30', voyageStatus: 'cancelled' })

    const rows = [cancelled, omitted, pendingEta, atBerth]
    const sorted = [...rows].sort(compareLineUpRows)

    expect(sorted.map((r) => r.id)).toEqual(['berth', 'eta', 'omitted', 'cancelled'])
  })
})
