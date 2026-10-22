import { describe, expect, it } from 'vitest'
import { parseBaplieText } from '../baplieParser'
import { hasBlockingIssues } from '../importValidation'

// Etapa 9 do plano de correção das importações (ADR 0078, item 21): o que o
// arquivo do Baplie não deve marcar nem importar.
function unit(lines: string[]): string[] {
  return ["LOC+147+010101'", "LOC+6+CNTAC'", "LOC+12+BRVIX'", "MEA+WT++KGM:10000'", ...lines]
}

function parse(lines: string[]) {
  return parseBaplieText([
    "UNB+UNOA:2+X+Y+260101:0000+1'",
    "UNH+1+BAPLIE:D:95B:UN:SMDG22'",
    "TDT+20+14+++COS:172:20:GREEN SANTOS'",
    ...lines,
    `UNT+${lines.length + 3}+1'`,
    "UNZ+1+1'",
  ].join('\n'))
}

describe('Baplie — regras da etapa 9', () => {
  // ADR 0095, decisão 15 (B12c): o transbordo entra marcado, sem levar marcas.
  it('container em transbordo (EQD 8249 = 6) entra marcado, com aviso', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1++6+5'", "DGS+IMD+3+1263'"]),
      ...unit(["EQD+CN+MSCU7654329+45G1++3+5'"]),
    ])
    expect(parsed.containers.map((c) => [c.container_number, Boolean(c.transshipment)])).toEqual([['MSCU1234566', true], ['MSCU7654329', false]])
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: 'Container MSCU1234566: em transbordo (EQD 8249 = 6); entra no Baplie marcado como transbordo e não leva IMO, OOG nem SOC/COC aos B/Ls.' }),
    ]))
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })

  // ADR 0079, decisão 6: o parser só lê o operador; quem ignora é a regra da Viagem.
  it('guarda o NAD+CA de cada container e o operador do cabeçalho, sem filtrar', () => {
    const parsed = parse([
      ...unit(["EQD+CN+TGHU1000018+45G1+++5'", "NAD+CA+COS:172:20'"]),
      ...unit(["EQD+CN+TGHU1000023+45G1+++5'", "NAD+CA+MSC:172:20'"]),
    ])
    expect(parsed.operator).toBe('COS')
    expect(parsed.containers.map((c) => [c.container_number, c.operator])).toEqual([['TGHU1000018', 'COS'], ['TGHU1000023', 'MSC']])
    expect(parsed.issues.filter((issue) => /operador/.test(issue.message))).toEqual([])
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

  // E9-05: só DIM de excesso (5 a 9) marca OOG; DIM+1 são as dimensões brutas.
  it('dimensão bruta (DIM+1) não marca OOG', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1+++5'", "DIM+1+CMT:1219:244:290'"]),
      ...unit(["EQD+CN+MSCU7654329+45G1+++5'", "DIM+1+CMT:1219:244:290'", "DIM+9+CMT:::35'"]),
    ])
    expect(parsed.containers.map((c) => [c.container_number, c.is_oog])).toEqual([['MSCU1234566', false], ['MSCU7654329', true]])
  })

  // E9-04: o LQ apaga só o DGS em quantidade limitada, não o IMO do container.
  it('DGS em LQ não apaga o outro DGS do mesmo container', () => {
    const parsed = parse([
      ...unit(["EQD+CN+MSCU1234566+45G1+++5'", "DGS+IMD+3+1263+++++LQ'", "DGS+IMD+8+1830'"]),
    ])
    expect(parsed.containers[0]).toMatchObject({ is_imo: true, imo_class: '8', un_number: '1830' })
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/LQ\) desconsiderado; o IMO vem dos demais DGS \(classe 8\)/) }),
    ]))
  })

  // E9-03: só o nome no C222 identifica o navio; o resto é palpite.
  it.each([
    ['C222 com nome', "TDT+20+12+++HLC:172:20+++5LFD3:103::GREEN SANTOS'", 'GREEN SANTOS', 'identification'],
    ['C222 fora do 8º elemento (COSCO)', "TDT+20+22++BPCF5:103::COSCO SHIPPING FAN RONG++COT:172:20'", 'COSCO SHIPPING FAN RONG', 'identification'],
    ['C222 só com call sign', "TDT+20+0012N+++HLC:172:20+++DGXX:103'", 'DGXX', 'heuristic'],
    ['nome do armador no C040', "TDT+20+14+++COS:172:20:COSCO SHIPPING LINES'", 'COSCO SHIPPING LINES', 'heuristic'],
  ])('origem do nome do navio: %s', (_case, tdt, vessel, source) => {
    const parsed = parseBaplieText([tdt, "UNT+2+1'"].join('\n'))
    expect(parsed).toMatchObject({ vessel_name: vessel, vessel_name_source: source })
  })

  it('dígito verificador errado vira aviso e não bloqueia', () => {
    const parsed = parse([...unit(["EQD+CN+MSCU1234567+45G1+++5'"])])
    expect(parsed.containers).toHaveLength(1)
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: 'warning', code: 'invalid_iso' })])
    expect(hasBlockingIssues(parsed.issues)).toBe(false)
  })
})
