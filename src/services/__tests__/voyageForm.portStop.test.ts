import { describe, expect, it } from 'vitest'
import { resolveVoyagePortStop, voyagePortLabel, VOYAGE_PORT_SUGGESTIONS } from '../voyageForm'

// Seletor de portos da Nova Viagem: porto brasileiro vira escala (ETA) com
// qualquer LOCODE BR; origem só entre os portos que o sistema reconhece, porque
// LOCODE de origem desconhecido seria gravado como "-" (buildVoyagePolEntityId).
describe('resolveVoyagePortStop', () => {
  it('porto brasileiro é chegada no Brasil, inclusive fora de Chegadas e Saídas', () => {
    expect(resolveVoyagePortStop('salvador')).toEqual({ code: 'BRSSA', kind: 'pod' })
    expect(resolveVoyagePortStop('Santos')).toEqual({ code: 'BRSSZ', kind: 'pod' })
    expect(resolveVoyagePortStop('BRXYZ')).toEqual({ code: 'BRXYZ', kind: 'pod' })
    expect(resolveVoyagePortStop(' brvit ')).toEqual({ code: 'BRVIX', kind: 'pod' })
  })

  it('porto conhecido fora do Brasil é saída na origem', () => {
    expect(resolveVoyagePortStop('qingdao')).toEqual({ code: 'CNTAO', kind: 'pol' })
    expect(resolveVoyagePortStop('HAMBURG')).toEqual({ code: 'DEHAM', kind: 'pol' })
    expect(resolveVoyagePortStop('NLRTM')).toEqual({ code: 'NLRTM', kind: 'pol' })
  })

  it('recusa origem que o sistema não reconhece e LOCODE brasileiro malformado', () => {
    expect(resolveVoyagePortStop('KRPUS')).toEqual({ error: expect.stringMatching(/fora da lista de portos/) })
    expect(resolveVoyagePortStop('BR1')).toEqual({ error: expect.stringMatching(/Porto brasileiro inválido/) })
    expect(resolveVoyagePortStop('  ')).toEqual({ error: 'Informe o porto.' })
  })

  it('sugere todos os portos reconhecidos, com nome quando há', () => {
    const codes = VOYAGE_PORT_SUGGESTIONS.map((port) => port.code)
    expect(codes).toEqual(expect.arrayContaining(['CNTAO', 'BRSSA', 'BRSSZ', 'DEHAM', 'BRIGI']))
    expect(codes).not.toContain('BRVIT')
    expect(voyagePortLabel('CNTAO')).toBe('Qingdao (CNTAO)')
    expect(voyagePortLabel('BRXYZ')).toBe('BRXYZ')
  })
})
