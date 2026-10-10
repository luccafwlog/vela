import { describe, expect, it } from 'vitest'
import { parseBaplieText } from '../baplieParser'
import { hasBlockingIssues } from '../importValidation'

// Etapa 9 do plano de correção das importações (ADR 0078, item 21): o que o
// arquivo do Baplie não deve marcar nem importar.
function unit(lines: string[]): string[] {
  return ["LOC+147+010101'", "LOC+6+CNTAC'", "LOC+12+BRVIX'", "MEA+WT++KGM:10000'", ...lines]
}

function parse(lines: string[]) {
  return parseBaplieText(["TDT+20+14+++COS:172:20:GREEN SANTOS'", ...lines, "UNT+10+1'"].join('\n'))
}

describe('Baplie — regras da etapa 9', () => {
  it('container em transbordo (EQD 8249 = 6) é ignorado com aviso', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1++6+5'"]),
      ...unit(["EQD+CN+MSCU7654329+45G1++3+5'"]),
    ])
    expect(parsed.containers.map((c) => c.container_number)).toEqual(['MSCU7654329'])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/MSCU1234566: em transbordo/) }),
    ]))
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })

  it('container de outro operador (NAD+CA diferente do TDT) é ignorado com aviso', () => {
    const parsed = parse([
      ...unit(["EQD+CN+TGHU1000018+45G1+++5'", "NAD+CA+COS:172:20'"]),
      ...unit(["EQD+CN+TGHU1000023+45G1+++5'", "NAD+CA+MSC:172:20'"]),
    ])
    expect(parsed.operator).toBe('COS')
    expect(parsed.containers.map((c) => c.container_number)).toEqual(['TGHU1000018'])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/TGHU1000023: de outro operador \(MSC\)/) }),
    ]))
  })

  it('OOG só com excesso de dimensão maior que zero', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1+++5'", "DIM+5+CMT:0:0'"]),
      ...unit(["EQD+CN+MSCU7654329+45G1+++5'", "DIM+7+CMT:20'"]),
    ])
    expect(parsed.containers.map((c) => [c.container_number, c.is_oog])).toEqual([['MSCU1234566', false], ['MSCU7654329', true]])
  })

  it('carga LQ é carga normal, sem IMO', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1+++5'", "DGS+IMD+3+1263+++++LQ'"]),
      ...unit(["EQD+CN+MSCU7654329+45G1+++5'", "DGS+IMD+3+1263'"]),
    ])
    expect(parsed.containers.map((c) => [c.container_number, c.is_imo])).toEqual([['MSCU1234566', false], ['MSCU7654329', true]])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/carga LQ/) }),
    ]))
  })

  it('dígito verificador errado vira aviso e não bloqueia', () => {
    const parsed = parse([...unit(["EQD+CN+MSCU1234567+45G1+++5'"])])
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: 'warning', code: 'invalid_iso' })])
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })
})
