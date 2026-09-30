import { describe, expect, it } from 'vitest'
import { normalizePortCode, portCodeVariants, resolvePortCode } from '../portCode'

describe('normalizePortCode - portos-vitrine do servico CSSC', () => {
  const cases: Array<[string, string]> = [
    ['QINGDAO', 'CNTAO'],
    ['QINDGAO', 'CNTAO'],
    ['qindgao', 'CNTAO'],
    ['SHANGHAI', 'CNSHA'],
    ['NINGBO', 'CNNGB'],
    ['NANSHA', 'CNNSA'],
    ['PECEM', 'BRPEC'],
    ['PECÉM', 'BRPEC'],
    ['CNTAG', 'CNTAC'],
    ['TAICANG', 'CNTAC'],
    ['TAIKANG', 'CNTAC'],
    ['CNTAI', 'CNTAC'],
    ['CNNBO', 'CNNGB'],
    ['ZOS', 'CNNGB'],
    ['CNSHG', 'CNSHA'],
    ['CNQDG', 'CNTAO'],
    ['SANTOS', 'BRSSZ'],
    ['PARANAGUÁ', 'BRPNG'],
    ['ITAJAÍ', 'BRITJ'],
    ['NAVEGANTES', 'BRITJ'],
    ['VITÓRIA', 'BRVIX'],
    ['SINGAPORE', 'SGSIN'],
    ['NEW YORK', 'USNYC'],
    ['HAMBURG', 'DEHAM'],
  ]

  it.each(cases)('mapeia %s -> %s', (name, code) => {
    expect(normalizePortCode(name)).toBe(code)
  })

  it('mantem os codigos ja suportados', () => {
    expect(normalizePortCode('SALVADOR')).toBe('BRSSA')
    expect(normalizePortCode('TAICANG')).toBe('CNTAC')
    expect(normalizePortCode('CNTAG')).toBe('CNTAC')
    expect(normalizePortCode('CNSHA')).toBe('CNSHA')
  })

  it('reconhece codigos ja usados no cadastro de escalas', () => {
    expect(resolvePortCode('ITGOA')).toEqual({ code: 'ITGOA', recognized: true })
    expect(resolvePortCode('NLRTM')).toEqual({ code: 'NLRTM', recognized: true })
    expect(resolvePortCode('BRIGI')).toEqual({ code: 'BRIGI', recognized: true })
    expect(resolvePortCode('BRSEP')).toEqual({ code: 'BRSEP', recognized: true })
  })

  it('reconhece códigos curtos do Baplie da COSCO só por valor inteiro', () => {
    expect(resolvePortCode('CNCAN')).toEqual({ code: 'CNNSA', recognized: true })
    expect(resolvePortCode('TAO')).toEqual({ code: 'CNTAO', recognized: true })
    expect(resolvePortCode('VIX')).toEqual({ code: 'BRVIX', recognized: true })
    expect(resolvePortCode('SPB')).toEqual({ code: 'BRSEP', recognized: true })
    expect(resolvePortCode('BRSPB')).toEqual({ code: 'BRSEP', recognized: true })
    expect(resolvePortCode('CNTCA')).toEqual({ code: 'CNTAC', recognized: true })
    expect(resolvePortCode('SEP')).toEqual({ code: 'BRSEP', recognized: true })
    expect(resolvePortCode('SEPTEMBER')).toEqual({ code: null, recognized: false })
  })

  it('reconhece LOCODE embutido nas descrições operacionais', () => {
    expect(resolvePortCode('Port of Singapore (SGSIN)')).toEqual({ code: 'SGSIN', recognized: true })
    expect(resolvePortCode('New York / USNYC')).toEqual({ code: 'USNYC', recognized: true })
  })

  it('não devolve texto desconhecido para persistência', () => {
    expect(resolvePortCode('PORTO INEXISTENTE')).toEqual({ code: null, recognized: false })
    expect(normalizePortCode('PORTO INEXISTENTE')).toBeNull()
  })

  it('retorna aliases persistidos para consultas sem duplicar o porto', () => {
    expect(portCodeVariants('BRVIX')).toEqual(expect.arrayContaining(['BRVIX', 'VITORIA', 'BRVIT']))
    expect(portCodeVariants('CNTAO')).toEqual(expect.arrayContaining(['CNTAO', 'QINGDAO', 'QINDGAO']))
    expect(portCodeVariants('PECEM')).toEqual(expect.arrayContaining(['BRPEC', 'PECEM']))
    expect(portCodeVariants('CNTAC')).toEqual(expect.arrayContaining(['CNTAC', 'TAICANG', 'CNTAG']))
    expect(portCodeVariants('CNNGB')).toEqual(expect.arrayContaining(['CNNGB', 'ZOS']))
  })
})
