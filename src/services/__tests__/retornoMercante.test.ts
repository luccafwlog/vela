import { describe, expect, it } from 'vitest'
import { parseRetornoMercanteBuffer } from '../ceMercanteImport'
import { parseRetornoMercanteText } from '../retornoMercante'

// Linhas sintéticas no layout dos retornos conferidos em 2026-11-05 (1226
// posições): M5 com o Nº em 6–18 e POL/POD em 1167–1176; C5 com o Nº em 6–18,
// CE em 21–35 e B/L a partir da 1182; I5 e V5 não são lidos.
function record(parts: Array<[number, string]>, length = 1226): string {
  const chars = Array<string>(length).fill(' ')
  for (const [position, value] of parts) {
    for (let index = 0; index < value.length; index += 1) chars[position - 1 + index] = value[index]
  }
  return chars.join('')
}
const m5 = (numero: string, pol = 'CNQIN', pod = 'BRVIX') => record([[1, 'M5000'], [6, numero], [1167, `${pol}${pod}CN001321`], [1191, '1095014'], [1201, '6'], [1211, '20261109']])
const c5 = (numero: string, ce: string, bl: string) => record([[1, 'C5000'], [6, numero], [21, ce], [1182, bl]])
const i5 = (numero: string, ce: string, bl: string) => record([[1, 'I51'], [4, '0001'], [8, '000'], [11, numero], [26, ce], [1187, bl], [1205, '0001']])
const v5 = (numero: string, seq: number) => record([[1, 'V5'], [3, String(seq).padStart(4, '0')], [7, '000'], [10, numero]])
const buffer = (lines: string[]) => new TextEncoder().encode(`${lines.join('\n')}\n`).buffer

describe('Retorno Mercante', () => {
  it('lê o Nº do Manifesto, a rota do Mercante e um B/L + CE por conhecimento', () => {
    const parsed = parseRetornoMercanteBuffer(buffer([
      m5('1226502020077'),
      c5('1226502020077', '122605363113416', 'CSC45640602Q00'),
      i5('1226502020077', '122605363113416', 'CSC45640602Q00'),
      c5('1226502020077', '122605363113505', 'csc45640603p00'),
      i5('1226502020077', '122605363113505', 'CSC45640603P00'),
    ]))
    expect(parsed.retorno).toEqual({ manifesto: '1226502020077', pol: 'CNQIN', pod: 'BRVIX' })
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.rows).toEqual([
      { rowNumber: 2, bl_id: 'CSC45640602Q00', ce_mercante: '122605363113416' },
      { rowNumber: 4, bl_id: 'CSC45640603P00', ce_mercante: '122605363113505' },
    ])
  })

  it('aceita CRLF e BOM, e B/L de carga solta com sufixo', () => {
    const text = `\uFEFF${[m5('1226502044464', 'CNTAG'), c5('1226502044464', '122605367558943', 'GGZV6SANY004A')].join('\r\n')}\r\n`
    expect(parseRetornoMercanteText(text).entries).toEqual([
      { line: 2, manifesto: '1226502044464', ce: '122605367558943', bl: 'GGZV6SANY004A' },
    ])
  })

  it('aplica as regras da planilha: CE fora de 15 dígitos, B/L e CE repetidos e conhecimento de outro manifesto', () => {
    const parsed = parseRetornoMercanteBuffer(buffer([
      m5('1226502020077'),
      c5('1226502020077', '12260536311341', 'BL-CURTO'),
      c5('1226502020077', '122605363113416', 'BL-1'),
      c5('1226502020077', '122605363113505', 'BL-1'),
      c5('1226502020077', '122605363113416', 'BL-2'),
      c5('1226502099999', '122605363113999', 'BL-3'),
    ]))
    expect(parsed.rows).toEqual([{ rowNumber: 3, bl_id: 'BL-1', ce_mercante: '122605363113416' }])
    expect(parsed.rowErrors.map((error) => [error.row, error.message])).toEqual([
      [2, 'CE Mercante inválido para o BL BL-CURTO: esperado 15 dígitos, recebido 14.'],
      [4, 'BL BL-1 repetido no Retorno Mercante.'],
      [5, 'CE Mercante 122605363113416 repetido no Retorno: já está na linha 3 (BL BL-1). Um CE só pode estar em um B/L.'],
      [6, 'B/L BL-3: o conhecimento é do manifesto 1226502099999, diferente do manifesto do Retorno (1226502020077).'],
    ])
  })

  it('recusa o Retorno de vazios, que não tem CE', () => {
    expect(() => parseRetornoMercanteText([m5('1226502044642', 'CNTAG'), v5('1226502044642', 1), v5('1226502044642', 2)].join('\n')))
      .toThrow('Retorno do manifesto de vazios 1226502044642 (2 contêineres): vazio não tem CE')
  })

  it('recusa arquivo sem M5, com mais de um manifesto ou com C5 sem o B/L', () => {
    expect(() => parseRetornoMercanteText('BL;CE\nX;1')).toThrow('O arquivo não é um Retorno Mercante')
    expect(() => parseRetornoMercanteText([m5('1226502020077'), m5('1226502044464')].join('\n')))
      .toThrow('O Retorno tem mais de um manifesto (1226502020077, 1226502044464)')
    expect(() => parseRetornoMercanteText([m5('1226502020077'), c5('1226502020077', '122605363113416', '').slice(0, 40)].join('\n')))
      .toThrow('Linha 2 do Retorno sem o número do B/L')
  })
})
