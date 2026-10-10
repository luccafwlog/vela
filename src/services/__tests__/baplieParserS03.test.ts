import { describe, expect, it } from 'vitest'
import { parseBaplieBuffer, parseBaplieText } from '../baplieParser'
import { hasBlockingIssues } from '../importValidation'

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe('baplie S03 vetores', () => {
  it('LOC→EQD associa POL/POD/peso ao container', () => {
    const parsed = parseBaplieText([
      "UNB+UNOA:2+X+Y+260701:1200+1'",
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ container_number: 'TCLU1234567', pol: 'CNTAC', pod: 'BRVIX', weight_kg: 10000 })
  })

  it('EQD→LOC associa campos após o EQD no mesmo conjunto', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+VGM++KGM:12000'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ pol: 'CNTAC', pod: 'BRVIX', weight_kg: 12000 })
  })

  it('EQDs consecutivos não herdam POL/POD/peso', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "EQD+CN+TCLU1111111+45G1+++5'",
      "EQD+CN+TCLU2222222+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers).toHaveLength(2)
    expect(parsed.containers[0]).toMatchObject({ pol: 'CNTAC', weight_kg: 10000 })
    expect(parsed.containers[1]).toMatchObject({ pol: null, pod: null, weight_kg: null })
  })

  it('bloqueia conjunto físico sem EQD', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "UNT+10+1'",
    ].join('\n'))

    expect(parsed.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_group',
      severity: 'error',
    }))
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
  })

  it('DGS marca IMO e DIM não-zero marca OOG', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "DIM+9+10:20:30'",
      "DGS+IMD+9+3166'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers[0]).toMatchObject({ is_imo: true, imo_class: '9', un_number: '3166', is_oog: true })
  })

  it('isola DGS e DIM de cada EQD no mesmo conjunto físico', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:10000'",
      "EQD+CN+TCLU1111111+45G1+++5'",
      "DGS+IMD+3+1993'",
      "DIM+9+10:20:30'",
      "EQD+CN+TCLU2222222+45G1+++5'",
      "DGS+IMD+8+3082'",
      "DIM+9+0:0:0'",
      "UNT+10+1'",
    ].join('\n'))

    expect(parsed.containers).toHaveLength(2)
    expect(parsed.containers[0]).toMatchObject({
      container_number: 'TCLU1111111',
      pol: 'CNTAC',
      pod: 'BRVIX',
      weight_kg: 10000,
      is_imo: true,
      imo_class: '3',
      un_number: '1993',
      is_oog: true,
    })
    expect(parsed.containers[1]).toMatchObject({
      container_number: 'TCLU2222222',
      pol: null,
      pod: null,
      weight_kg: null,
      is_imo: true,
      imo_class: '8',
      un_number: '3082',
      is_oog: false,
    })
  })

  it('EOF sem terminador final ainda emite o último container', () => {
    const parsed = parseBaplieText(
      "TDT+20+14+++:::GREEN SANTOS'\nLOC+147+010101'\nLOC+6+CNTAC'\nLOC+12+BRVIX'\nEQD+CN+TCLU1234567+45G1+++5",
    )
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0].container_number).toBe('TCLU1234567')
  })

  it('não reabre grupos depois do trailer e sinaliza conteúdo após EOF', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+6+1'",
      "UNZ+1+1'",
      "LOC+147+010102'",
      "EQD+CN+TCLU7654321+45G1+++5'",
    ].join('\n'))

    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0]?.container_number).toBe('TCLU1234567')
    expect(parsed.issues).toContainEqual(expect.objectContaining({
      field: 'eof',
      code: 'invalid_group',
      severity: 'error',
    }))
  })

  it('duplicata gera issue bloqueante por conjunto físico', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "LOC+147+010102'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))
    expect(parsed.containers).toHaveLength(1)
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
    expect(parsed.issues.some((i) => i.code === 'invalid_group' && i.severity === 'error')).toBe(true)
  })

  it('respeita UNA, separadores e release character', () => {
    // UNA: componente ':', elemento ';', release '?', terminador '*'.
    // "?*" dentro do dado não quebra segmento.
    const text = "UNA:;.? *TDT;20;14***:::GREEN SANTOS*LOC;147;010101*RFF;BM:ABC?*DEF*EQD;CN;TCLU1234567;45G1***5*"
    const parsed = parseBaplieText(text)
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0]).toMatchObject({ container_number: 'TCLU1234567', slot: '010101', bl_ref: 'ABC*DEF' })
  })

  it('usa o separador de componente da UNA para peso e dimensões', () => {
    // UNA: componente '^', elemento ';', decimal '.', release '!', terminador '*'.
    const text = 'UNA^;. !*LOC;147;010101*LOC;6;CNTAC*LOC;12;BRVIX*MEA;WT;;KGM^10000*EQD;CN;TCLU1234567;45G1;;;5*DIM;9;0^0^0*'
    const parsed = parseBaplieText(text)

    expect(parsed.containers[0]).toMatchObject({ weight_kg: 10000, is_oog: false })
  })

  it('parseBaplieBuffer round-trip UTF-8 sem BOM com Vitória', () => {
    const text = "TDT+20+12+++:172:20+++5LFD3:103::GREEN VITÓRIA'\nLOC+147+010101'\nLOC+11+BRVIX'\nEQD+CN+SEGU7664016+42P3+++5'\n"
    const parsed = parseBaplieBuffer(toBuffer(text))
    expect(parsed.vessel_name).toBe('GREEN VITÓRIA')
    expect(parsed.containers[0].pod).toBe('BRVIX')
  })

  it('bloqueia peso textual inválido em vez de aceitar prefixo numérico', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "MEA+WT++KGM:12abc'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))

    expect(parsed.containers[0]?.weight_kg).toBeNull()
    expect(parsed.issues).toContainEqual(expect.objectContaining({ field: 'weight_kg', code: 'invalid_number', severity: 'error' }))
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
  })

  it('bloqueia conjunto sem POL/POD ou com LOCODE desconhecido', () => {
    const parsed = parseBaplieText([
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+XXXXX'",
      "EQD+CN+TCLU1234567+45G1+++5'",
      "UNT+10+1'",
    ].join('\n'))

    expect(parsed.issues.filter((issue) => issue.code === 'unknown_port')).toHaveLength(2)
    // O dígito verificador de TCLU1234567 não confere: aviso à parte (etapa 9).
    expect(parsed.issues.filter((issue) => issue.code === 'unknown_port').every((issue) => issue.severity === 'error')).toBe(true)
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
  })
})
