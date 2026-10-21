import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBaplieVoyageRules } from '../baplieImport'
import { parseBaplieText } from '../baplieParser'
import { hasBlockingIssues } from '../importValidation'

// Correções do leitor de Baplie (F-09, F-44, B11b/F-08, B12d): arquivo
// truncado, peso VGM × WT, caractere de liberação, EQD seguinte sem campos e
// portos de 3 letras do SMDG 1.5.

const fixture = readFileSync(resolve(__dirname, '../../../test-fixtures/qa-baplie-3cntr.edi'), 'utf8')

/** Intercâmbio completo com as contagens certas em volta dos segmentos. */
function envelope(lines: string[]) {
  return [
    "UNB+UNOA:2+X+Y+261021:1200+1'",
    "UNH+1+BAPLIE:D:95B:UN:SMDG15'",
    "TDT+20+14N+++:::GREEN SANTOS'",
    ...lines,
    `UNT+${lines.length + 3}+1'`,
    "UNZ+1+1'",
  ].join('\n')
}

const unit = (number: string, extra: string[] = [], slot = '010101') => [
  `LOC+147+${slot}'`,
  "LOC+6+CNTAC'",
  "LOC+12+BRSSZ'",
  "MEA+WT++KGM:10000'",
  ...extra,
  `EQD+CN+${number}+45G1+++5'`,
]

const trailerErrors = (text: string) => parseBaplieText(text).issues.filter((i) => i.field === 'eof' && i.severity === 'error')

describe('F-09: UNT e UNZ obrigatórios, com as contagens conferidas', () => {
  it('o arquivo completo da fixture passa sem erro de trailer', () => {
    expect(trailerErrors(fixture)).toEqual([])
    expect(parseBaplieText(fixture).containers).toHaveLength(3)
  })

  it('arquivo cortado ao meio é erro no arquivo, mesmo com os containers lidos até ali', () => {
    const lines = fixture.trim().split('\n')
    const truncated = lines.slice(0, 14).join('\n')
    const parsed = parseBaplieText(truncated)
    expect(parsed.containers.length).toBeGreaterThan(0)
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'eof', severity: 'error', message: expect.stringMatching(/Falta o trailer UNT/) }),
      expect.objectContaining({ field: 'eof', severity: 'error', message: expect.stringMatching(/Falta o trailer UNZ/) }),
    ]))
    expect(hasBlockingIssues(parsed.issues)).toBe(true)
  })

  it('UNT com contagem de segmentos diferente do que chegou bloqueia', () => {
    const cut = fixture.replace("LOC+147+0020082:9711:5'\n", '')
    expect(trailerErrors(cut)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/UNT declara 26 segmentos, mas a mensagem tem 25/) }),
    ])
  })

  it('UNZ com contagem de mensagens diferente bloqueia; sem UNZ também', () => {
    expect(trailerErrors(fixture.replace("UNZ+1+1'", "UNZ+2+1'"))).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/UNZ declara 2 mensagens, mas o arquivo tem 1/) }),
    ])
    expect(trailerErrors(fixture.replace("UNZ+1+1'", ''))).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/Falta o trailer UNZ/) }),
    ])
  })
})

describe('B12d / F-44: peso do container', () => {
  it.each([
    ['VGM antes do WT', ["MEA+VGM++KGM:12500'", "MEA+WT++KGM:12000'"]],
    ['WT antes do VGM', ["MEA+WT++KGM:12000'", "MEA+VGM++KGM:12500'"]],
  ])('usa o VGM quando existe (%s)', (_label, meas) => {
    const parsed = parseBaplieText(envelope(["LOC+147+010101'", "LOC+6+CNTAC'", "LOC+12+BRSSZ'", ...meas, "EQD+CN+TEMU1234567+45G1+++5'"]))
    expect(parsed.containers[0]?.weight_kg).toBe(12500)
  })

  it('sem VGM, usa o WT', () => {
    const parsed = parseBaplieText(envelope(unit('TEMU1234567')))
    expect(parsed.containers[0]?.weight_kg).toBe(10000)
  })
})

describe('F-44: caractere de liberação e EQD seguinte no mesmo slot', () => {
  it('aplica o ? uma vez só: AB?+12?:34 vira AB+12:34', () => {
    const parsed = parseBaplieText(envelope(unit('TEMU1234567', ["RFF+BM:AB?+12?:34'"])))
    expect(parsed.containers[0]?.bl_ref).toBe('AB+12:34')
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })

  it('peso com ? liberado ainda é lido', () => {
    const parsed = parseBaplieText(envelope(["LOC+147+010101'", "LOC+6+CNTAC'", "LOC+12+BRSSZ'", "MEA+VGM++KGM:12?.5'", "EQD+CN+TEMU1234567+45G1+++5'"]))
    expect(parsed.containers[0]?.weight_kg).toBe(12.5)
  })

  it('segundo EQD no mesmo LOC+147 sem POL, POD e peso gera aviso', () => {
    const parsed = parseBaplieText(envelope([...unit('TEMU1234567'), "EQD+CN+TGHU7654325+45G1+++5'"]))
    expect(parsed.containers.map((c) => c.container_number)).toEqual(['TEMU1234567', 'TGHU7654325'])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/TGHU7654325: 2º EQD do slot 010101 .* sem POL, POD e peso/) }),
    ]))
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })

  it('segundo EQD com os próprios campos não gera aviso', () => {
    const parsed = parseBaplieText(envelope([
      ...unit('TEMU1234567'),
      // O trecho depois de cada EQD seguinte pertence a ele.
      "EQD+CN+TGHU7654325+45G1+++5'", "LOC+6+CNTAC'", "LOC+12+BRSSZ'", "MEA+WT++KGM:9000'",
    ]))
    expect(parsed.issues.filter((i) => /EQD do slot/.test(i.message))).toEqual([])
  })
})

describe('B11b / F-08: portos de 3 letras do SMDG 1.5', () => {
  it.each([
    ['SSZ', 'BRSSZ'], ['ITJ', 'BRITJ'], ['PNG', 'BRPNG'], ['RIG', 'BRRIG'],
    ['SSA', 'BRSSA'], ['PEC', 'BRPEC'], ['SUA', 'BRSUA'], ['NVT', 'BRNVT'],
  ])('LOC+12+%s vira %s', (short, locode) => {
    const parsed = parseBaplieText(envelope(["LOC+147+010101'", "LOC+6+SSZ'", `LOC+12+${short}'`, "MEA+WT++KGM:10000'", "EQD+CN+TEMU1234567+45G1+++5'"]))
    expect(parsed.containers[0]).toMatchObject({ pol: 'BRSSZ', pod: locode })
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })

  it('Navegantes não vira Itajaí, nem Recife vira Suape: POD fora das escalas fica de fora, listado', () => {
    const parsed = parseBaplieText(envelope([
      "LOC+147+010101'", "LOC+6+SSZ'", "LOC+12+NVT'", "MEA+WT++KGM:10000'", "EQD+CN+TEMU1234567+45G1+++5'",
      "LOC+147+010102'", "LOC+6+SSZ'", "LOC+12+BRREC'", "MEA+WT++KGM:10000'", "EQD+CN+TGHU7654325+45G1+++5'",
      "LOC+147+010103'", "LOC+6+SSZ'", "LOC+12+ITJ'", "MEA+WT++KGM:10000'", "EQD+CN+CSNU2049996+45G1+++5'",
    ]))
    expect(parsed.containers.map((c) => c.pod)).toEqual(['BRNVT', 'BRREC', 'BRITJ'])
    const ruled = applyBaplieVoyageRules(parsed, { voyageNumber: '14N', vesselName: 'GREEN SANTOS', eligiblePods: ['BRITJ', 'BRSUA'] })
    expect(ruled.containers.map((c) => c.container_number)).toEqual(['CSNU2049996'])
    expect(ruled.podsOutside).toEqual([
      { container_number: 'TEMU1234567', pod: 'BRNVT', reason: 'outside_calls' },
      { container_number: 'TGHU7654325', pod: 'BRREC', reason: 'outside_calls' },
    ])
    expect(hasBlockingIssues(ruled.issues)).toBe(false)
  })

  it('POD não reconhecido entra na lista de fora das escalas, como aviso', () => {
    const parsed = parseBaplieText(envelope([
      "LOC+147+010101'", "LOC+6+SSZ'", "LOC+12+UYMVD'", "MEA+WT++KGM:10000'", "EQD+CN+TEMU1234567+45G1+++5'",
      ...unit('TGHU7654325', [], '010102'),
    ]))
    const ruled = applyBaplieVoyageRules(parsed, { voyageNumber: '14N', vesselName: 'GREEN SANTOS', eligiblePods: ['BRSSZ'] })
    expect(ruled.podsOutside).toEqual([{ container_number: 'TEMU1234567', pod: 'UYMVD', reason: 'unrecognized' }])
    expect(hasBlockingIssues(ruled.issues)).toBe(false)
  })
})
