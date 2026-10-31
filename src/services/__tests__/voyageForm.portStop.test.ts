import { describe, expect, it } from 'vitest'
import { resolveVoyagePortStop, voyagePortLabel, VOYAGE_PORT_SUGGESTIONS } from '../voyageForm'

// Seletores de porto da Nova Viagem: o operador escolhe o lado. Destino cria a
// escala (sempre no Brasil, qualquer LOCODE BR); Origem grava o ETD que aparece
// em Chegadas e Saídas e só aceita porto do exterior que o sistema reconhece,
// porque LOCODE de origem desconhecido seria gravado como "-".
describe('resolveVoyagePortStop', () => {
  it('destino é porto brasileiro, inclusive fora de Chegadas e Saídas', () => {
    expect(resolveVoyagePortStop('salvador', 'pod')).toEqual({ code: 'BRSSA' })
    expect(resolveVoyagePortStop('Santos', 'pod')).toEqual({ code: 'BRSSZ' })
    expect(resolveVoyagePortStop('BRXYZ', 'pod')).toEqual({ code: 'BRXYZ' })
    expect(resolveVoyagePortStop(' brvit ', 'pod')).toEqual({ code: 'BRVIX' })
  })

  it('destino no exterior é recusado e aponta para Origem', () => {
    expect(resolveVoyagePortStop('qingdao', 'pod')).toEqual({ error: expect.stringMatching(/^CNTAO não é porto brasileiro.*vai em Origem/) })
    expect(resolveVoyagePortStop('BR1', 'pod')).toEqual({ error: expect.stringMatching(/Porto brasileiro não reconhecido/) })
  })

  it('origem é porto do exterior que o sistema reconhece', () => {
    expect(resolveVoyagePortStop('qingdao', 'pol')).toEqual({ code: 'CNTAO' })
    expect(resolveVoyagePortStop('HAMBURG', 'pol')).toEqual({ code: 'DEHAM' })
    expect(resolveVoyagePortStop('NLRTM', 'pol')).toEqual({ code: 'NLRTM' })
  })

  it('origem recusa porto brasileiro e porto que o sistema não reconhece', () => {
    expect(resolveVoyagePortStop('salvador', 'pol')).toEqual({ error: 'Porto brasileiro vai em Destino: ele cria a escala da viagem.' })
    expect(resolveVoyagePortStop('BRXYZ', 'pol')).toEqual({ error: 'Porto brasileiro vai em Destino: ele cria a escala da viagem.' })
    expect(resolveVoyagePortStop('KRPUS', 'pol')).toEqual({ error: expect.stringMatching(/fora da lista de portos/) })
    expect(resolveVoyagePortStop('  ', 'pol')).toEqual({ error: 'Informe o porto.' })
  })

  it('cada lado sugere só os seus portos', () => {
    const origins = VOYAGE_PORT_SUGGESTIONS.pol.map((port) => port.code)
    const destinations = VOYAGE_PORT_SUGGESTIONS.pod.map((port) => port.code)
    expect(origins).toEqual(expect.arrayContaining(['CNTAO', 'DEHAM', 'NLRTM']))
    expect(origins.some((code) => code.startsWith('BR'))).toBe(false)
    expect(destinations).toEqual(expect.arrayContaining(['BRSSA', 'BRSSZ', 'BRIGI']))
    expect(destinations.every((code) => code.startsWith('BR'))).toBe(true)
    expect(destinations).not.toContain('BRVIT')
    expect(voyagePortLabel('CNTAO')).toBe('Qingdao (CNTAO)')
    expect(voyagePortLabel('BRXYZ')).toBe('BRXYZ')
  })
})
