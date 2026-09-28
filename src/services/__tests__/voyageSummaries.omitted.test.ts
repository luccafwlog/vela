import { describe, expect, it } from 'vitest'
import { collectVoyagePorts, computeAdrEscalaPods, getBlsAffectedByOmittedPod, getProximaEscala } from '../voyageSummaries'

describe('getProximaEscala com PODs omitidos', () => {
  it('ignora o POD omitido ao escolher a proxima escala', () => {
    const rows = [
      { pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true },
      { pod: 'VITORIA', eta: '2026-07-20', ata: null },
    ]
    expect(getProximaEscala(rows)?.pod).toBe('VITORIA')
  })

  it('retorna null quando o unico POD pendente esta omitido', () => {
    const rows = [{ pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true }]
    expect(getProximaEscala(rows)).toBeNull()
  })
})

describe('computeAdrEscalaPods', () => {
  it('deduplicates aliases and exposes the canonical port code', () => {
    expect(computeAdrEscalaPods([
      { pod: 'PECEM' },
      { pod: 'BRPEC' },
    ], [])).toEqual([{ pod: 'BRPEC', omitted: false }])
  })
  it('inclui as escalas não omitidas', () => {
    const rows = [{ pod: 'VITORIA', omitted: false }, { pod: 'RIO GRANDE', omitted: false }]
    expect(computeAdrEscalaPods(rows, [])).toEqual([
      { pod: 'BRVIX', omitted: false },
      { pod: 'BRRIG', omitted: false },
    ])
  })

  it('exclui a escala omitida sem ADR fechado', () => {
    const rows = [{ pod: 'SALVADOR', omitted: true }, { pod: 'VITORIA', omitted: false }]
    expect(computeAdrEscalaPods(rows, [])).toEqual([{ pod: 'BRVIX', omitted: false }])
  })

  it('inclui a escala omitida que já tem ADR fechado, marcada como omitida', () => {
    const rows = [{ pod: 'SALVADOR', omitted: true }, { pod: 'VITORIA', omitted: false }]
    expect(computeAdrEscalaPods(rows, ['SALVADOR'])).toEqual([
      { pod: 'BRSSA', omitted: true },
      { pod: 'BRVIX', omitted: false },
    ])
  })

  it('casa o porto do ADR fechado normalizado (case/espaços)', () => {
    const rows = [{ pod: 'Salvador', omitted: true }]
    expect(computeAdrEscalaPods(rows, [' salvador '])).toEqual([{ pod: 'BRSSA', omitted: true }])
  })
})

describe('getBlsAffectedByOmittedPod', () => {
  it('matches the omission RPC raw trimmed case-insensitive POD predicate', () => {
    const bls = [
      { id: 'BL-1', pod: ' brvix ' },
      { id: 'BL-2', pod: 'VITORIA' },
      { id: 'BL-3', pod: null },
    ]
    expect(getBlsAffectedByOmittedPod(bls, 'BRVIX').map((bl) => bl.id)).toEqual(['BL-1'])
  })
})

describe('collectVoyagePorts', () => {
  it('normalizes city names and LOCODE aliases before deduplicating', () => {
    expect(collectVoyagePorts([
      { pol: 'SHANGHAI', pod: 'PECEM' },
      { pol: 'CNSHA', pod: 'BRPEC' },
    ], 'pod', null)).toEqual(['BRPEC'])
  })
})
