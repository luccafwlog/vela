import { describe, expect, it } from 'vitest'
import { normalizePortCode, normalizeStoredPortCode, portCodeVariants, resolvePortCode, storedPortAliases } from '../portCode'

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
    ['NAVEGANTES', 'BRNVT'],
    ['RECIFE', 'BRREC'],
    ['SUAPE', 'BRSUA'],
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
    expect(resolvePortCode('VIT')).toEqual({ code: 'BRVIX', recognized: true })
    expect(resolvePortCode('SPB')).toEqual({ code: 'BRSEP', recognized: true })
    expect(resolvePortCode('BRSPB')).toEqual({ code: 'BRSEP', recognized: true })
    expect(resolvePortCode('CNTCA')).toEqual({ code: 'CNTAC', recognized: true })
    expect(resolvePortCode('TCA')).toEqual({ code: 'CNTAC', recognized: true })
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
    expect(portCodeVariants('BRVIX')).toEqual(expect.arrayContaining(['BRVIX', 'VITORIA', 'BRVIT', 'VIX', 'VIT']))
    expect(portCodeVariants('CNTAO')).toEqual(expect.arrayContaining(['CNTAO', 'QINGDAO', 'QINDGAO']))
    expect(portCodeVariants('PECEM')).toEqual(expect.arrayContaining(['BRPEC', 'PECEM']))
    expect(portCodeVariants('CNTAC')).toEqual(expect.arrayContaining(['CNTAC', 'TAICANG', 'CNTAG']))
    expect(portCodeVariants('CNNGB')).toEqual(expect.arrayContaining(['CNNGB', 'ZOS']))
  })
})

// ADR 0095, decisão 12 (Lote 3, migration 391): Navegantes ≠ Itajaí e Recife ≠
// Suape, no import e na régua do banco. Antes, a régua do banco (cópia de
// `normalize_port_code`) levava BRNVT a BRITJ e BRREC a BRSUA.
describe('Navegantes, Itajaí, Recife e Suape são quatro portos', () => {
  it.each([
    ['BRNVT', 'BRNVT'], ['NVT', 'BRNVT'], ['NAVEGANTES', 'BRNVT'],
    ['BRITJ', 'BRITJ'], ['ITJ', 'BRITJ'], ['ITAJAÍ', 'BRITJ'],
    ['BRREC', 'BRREC'], ['REC', 'BRREC'], ['RECIFE', 'BRREC'],
    ['BRSUA', 'BRSUA'], ['SUA', 'BRSUA'], ['SUAPE', 'BRSUA'],
  ])('régua do banco: %s -> %s', (value, code) => {
    expect(normalizeStoredPortCode(value)).toBe(code)
  })

  it('o import não junta os pares', () => {
    expect(normalizePortCode('BRNVT')).toBe('BRNVT')
    expect(normalizePortCode('BRREC')).toBe('BRREC')
    expect(normalizePortCode('Navegantes, Brazil')).toBe('BRNVT')
    expect(normalizePortCode('Recife')).toBe('BRREC')
  })

  it('filtro por porto não traz as grafias do outro porto do par', () => {
    expect(storedPortAliases('BRITJ')).not.toContain('BRNVT')
    expect(storedPortAliases('BRITJ')).not.toContain('NAVEGANTES')
    expect(storedPortAliases('BRSUA')).not.toContain('BRREC')
    expect(storedPortAliases('BRNVT')).toEqual(['NAVEGANTES', 'BRNVT', 'NVT'])
    expect(storedPortAliases('BRREC')).toEqual(['RECIFE', 'BRREC', 'REC'])
    expect(portCodeVariants('BRITJ')).not.toContain('NAVEGANTES')
  })

  // Uma régua só: os apelidos exatos do import valem igual na cópia do banco.
  it.each(['CNCAN', 'TAO', 'VIX', 'VIT', 'BRVIT', 'SPB', 'BRSPB', 'SEP', 'CNTCA', 'TCA'])(
    'apelido exato %s é o mesmo porto no import e no banco',
    (alias) => {
      expect(normalizeStoredPortCode(alias)).toBe(resolvePortCode(alias).code)
    },
  )
})
