// Os modelos que as telas oferecem para download têm de passar pelo parser do
// qual são modelo. Não passavam: `parseNumber` lia tudo em pt-BR fixo, e
// `259.312` — a notação do modelo — é milhar em pt-BR, então o peso entrava
// multiplicado por mil, sem erro de linha, e seguia para a taxa por tonelada.
//
// Estes casos são o gate dessa classe de defeito: qualquer mexida no modelo ou
// no parser que reintroduza a escala errada quebra aqui. O modelo traz os
// valores na precisão que o B/L declara (três casas); ele importa limpo porque
// usa vírgula decimal, e em pt-BR a vírgula NÃO é separador de milhar — nenhuma
// célula fica com a forma ambígua `259.312`.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { hasBlockingRowErrors, parseBreakbulkManifestBuffer } from '../breakbulkManifestParser'

function readTemplate(relativePath: string): ArrayBuffer {
  const raw = readFileSync(relativePath)
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

describe('modelo de manifesto de carga solta (tela /bls)', () => {
  for (const extension of ['csv', 'xlsx'] as const) {
    it(`importa o modelo .${extension} inteiro, sem rejeitar linha nem avisar`, async () => {
      const parsed = await parseBreakbulkManifestBuffer(
        readTemplate(`public/templates/carga-solta-modelo.${extension}`),
      )

      expect(parsed.layout).toBe('summary')
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.bls).toHaveLength(3)
    })

    it(`preserva o peso e a cubagem do modelo .${extension}, sem escalar por mil`, async () => {
      const parsed = await parseBreakbulkManifestBuffer(
        readTemplate(`public/templates/carga-solta-modelo.${extension}`),
      )
      const byBl = new Map(parsed.bls.map((bl) => [bl.bl_id, bl]))

      expect(byBl.get('CCSV22ZJGVIT001A')?.bb_weight_ton).toBeCloseTo(259.312, 3)
      expect(byBl.get('CCSV22ZJGVIT001A')?.bb_cbm).toBeCloseTo(1217.109, 3)
      expect(byBl.get('CCSV22ZJGVIT002A')?.bb_weight_ton).toBeCloseTo(135.263, 3)
      expect(byBl.get('CCSV22ZJGVIT002A')?.bb_cbm).toBeCloseTo(564.803, 3)
      expect(byBl.get('CCSV22ZJGVIT003A')?.bb_weight_ton).toBeCloseTo(177.12, 3)
      expect(byBl.get('CCSV22ZJGVIT003A')?.bb_cbm).toBeCloseTo(810.106, 3)
    })
  }
})

describe('modelo de manifesto BB (tela de viagem)', () => {
  it('importa o modelo .xlsx oferecido pela tela da Viagem', async () => {
    const parsed = await parseBreakbulkManifestBuffer(readTemplate('public/templates/manifesto-bb-modelo.xlsx'))

    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bls).toHaveLength(1)
    expect(parsed.bls[0]?.bb_weight_ton).toBeCloseTo(12.5, 3)
  })

  it('lê peso e cubagem digitados como número no XLSX sem escalar por mil', async () => {
    // O leitor comum entrega a célula numérica tipada. 135,263 t digitado no
    // Excel é o número 135.263: relê-lo como texto em pt-BR daria 135263 t.
    const sheet = XLSX.utils.aoa_to_sheet([
      ['BL', 'MAQUINAS', 'PACKAGES', 'PACKAGES TOTAL', 'WEIGHT (TON)', 'CBM (M3)', 'SHIPPER', 'CONSIGNEE', 'NOTIFY'],
      ['BL-NUMERO', 1, 2, 2, 135.263, 64.803, 'EMBARCADOR', 'CONSIGNATARIO', 'NOTIFY'],
    ])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Manifesto')
    const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const parsed = await parseBreakbulkManifestBuffer(out)

    expect(parsed.rowErrors.filter((error) => (error.severity ?? 'error') === 'error')).toEqual([])
    expect(parsed.bls[0]?.bb_weight_ton).toBeCloseTo(135.263, 3)
    expect(parsed.bls[0]?.bb_cbm).toBeCloseTo(64.803, 3)
  })

  it('importa o modelo com ponto decimal', async () => {
    // `12.5` tem uma casa decimal: prova que o ponto é decimal neste arquivo, e
    // com isso a coluna inteira é lida certo. Sob o pt-BR fixo anterior, este
    // modelo era rejeitado — `12.5` não casa com o formato pt-BR.
    const parsed = await parseBreakbulkManifestBuffer(readTemplate('public/templates/manifesto-bb-modelo.csv'))

    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bls).toHaveLength(1)
    expect(parsed.bls[0]?.bb_weight_ton).toBeCloseTo(12.5, 3)
    expect(parsed.bls[0]?.bb_cbm).toBeCloseTo(34.8, 3)
  })
})

describe('layout carrier: peso e cubagem ilegíveis', () => {
  const carrierCsv = [
    'SHIPPER,MARKS,POL,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
    'B/L NO.,MARKS AND NUMBERS,POD,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
    'ABCD1234567,MARCA X,BRVIX,10 PACKAGES OF MACHINERY,10,N/A,N/A',
  ].join('\n')

  function carrierBuffer(): ArrayBuffer {
    return new TextEncoder().encode(carrierCsv).buffer as ArrayBuffer
  }

  it('reporta issue quando o peso do B/L não pôde ser lido', async () => {
    const parsed = await parseBreakbulkManifestBuffer(carrierBuffer())

    // Os layouts resumido e legado rejeitam a linha sem peso; o carrier aceitava
    // em silêncio e o peso sumia sem deixar rastro.
    const weightIssue = parsed.rowErrors.find((error) => /peso/i.test(error.message))
    expect(weightIssue).toBeDefined()
    expect(weightIssue?.severity ?? 'error').toBe('error')
  })

  it('reporta a cubagem ausente como aviso, não como bloqueio', async () => {
    const parsed = await parseBreakbulkManifestBuffer(carrierBuffer())

    const cbmIssue = parsed.rowErrors.find((error) => /cubagem/i.test(error.message))
    expect(cbmIssue?.severity).toBe('warning')
  })

  it('zera o peso no modelo do B/L quando há erro de ambiguidade não declarada no carrier', async () => {
    const ambiguousCarrierCsv = [
      'SHIPPER,MARKS,POL,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'B/L NO.,MARKS AND NUMBERS,POD,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'ABCD1234567,MARCA X,BRVIX,10 PACKAGES OF MACHINERY,10,"259,312","120.5"',
    ].join('\n')

    const parsed = await parseBreakbulkManifestBuffer(
      new TextEncoder().encode(ambiguousCarrierCsv).buffer as ArrayBuffer,
    )

    const weightIssue = parsed.rowErrors.find((error) => /peso/i.test(error.message) || /PESO_KG/i.test(error.message))
    expect(weightIssue).toBeDefined()
    expect(weightIssue?.severity).toBe('error')

    // Quando há erro bloqueante no peso, o peso não pode ser mantido nem multiplicado por mil
    expect(parsed.bls[0]?.bb_weight_ton).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Ambiguidade de separador: o que bloqueia, o que avisa e o que o operador faz
// ---------------------------------------------------------------------------

const SUMMARY_HEADER =
  'BL,MAQUINAS,PACKAGES,PACKAGES TOTAL,WEIGHT (TON),CBM (M3),SHIPPER,CONSIGNEE,NOTIFY,CNPJ,POL,POD'

function summaryCsv(...rows: string[]): ArrayBuffer {
  return new TextEncoder().encode([SUMMARY_HEADER, ...rows].join('\n')).buffer as ArrayBuffer
}

describe('separador decimal ambiguo no manifesto de carga solta', () => {
  // O achado P0 da revisao da PR 703. `"259.312 TON"` tem a unidade colada:
  // nao casava a forma ambigua (testada no valor cru) e nao entrava na
  // evidencia do arquivo (descartada por conter letras), mas era parseado sem
  // a unidade. `"1217,11"` "provava" pt-BR, e o peso entrava como 259.312
  // toneladas, sem erro nem aviso, alimentando a taxa por tonelada.
  const mixedLocaleRow =
    'BLD1,8,24,32,"259.312 TON","1217,11",SANY,TIMBRO,NOTIFY,12345678000195,CNNSA,BRVIT'

  it('bloqueia a celula ambigua com unidade colada, mesmo com o resto do arquivo "provando" pt-BR', async () => {
    const parsed = await parseBreakbulkManifestBuffer(summaryCsv(mixedLocaleRow))

    expect(parsed.bls).toHaveLength(0)
    const issue = parsed.rowErrors.find((error) => /WEIGHT \(TON\)/.test(error.message))
    expect(issue).toBeDefined()
    expect(issue?.severity ?? 'error').toBe('error')
  })

  it('a mensagem mostra as DUAS leituras, e nao o mesmo numero duas vezes', async () => {
    // `(177120).toLocaleString('pt-BR')` e a string `177.120` — identica ao
    // valor cru. O aviso anterior dizia `"177.120" foi lido como 177.120`.
    const parsed = await parseBreakbulkManifestBuffer(
      summaryCsv('BLE1,8,16,24,177.120,810.106,S,C,N,12345678000195,CNQDG,BRSSA'),
    )

    const message = parsed.rowErrors.map((error) => error.message).join(' ')
    expect(message).toContain('177 mil')
    expect(message).toContain('177,12')
    expect(message).toMatch(/[Dd]eclare o formato/)
  })

  it('declarar o formato resolve a ambiguidade e importa a linha', async () => {
    const parsed = await parseBreakbulkManifestBuffer(
      summaryCsv('BLE1,8,16,24,177.120,810.106,S,C,N,12345678000195,CNQDG,BRSSA'),
      { numberFormat: 'en-US' },
    )

    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bls[0]?.bb_weight_ton).toBeCloseTo(177.12, 3)
    expect(parsed.bls[0]?.bb_cbm).toBeCloseTo(810.106, 3)
  })

  it('recusa quando o formato declarado contradiz o arquivo, em vez de corrigir sozinho', async () => {
    const parsed = await parseBreakbulkManifestBuffer(
      summaryCsv('BLG1,8,24,32,"12,5","30,25",S,C,N,12345678000195,CNNSA,BRVIT'),
      { numberFormat: 'en-US' },
    )

    expect(parsed.bls).toHaveLength(0)
    expect(parsed.rowErrors.some((error) => /contradiz o arquivo/.test(error.message))).toBe(true)
  })

  it('recusa o numero acima do maximo plausivel para um B/L, seja qual for o separador', async () => {
    // Rede que nao depende de heuristica: mesmo com o formato declarado, 259
    // mil toneladas num B/L so nao descrevem um B/L.
    const parsed = await parseBreakbulkManifestBuffer(
      summaryCsv('BLH1,8,24,32,"259312,5","1217,11",S,C,N,12345678000195,CNNSA,BRVIT'),
      { numberFormat: 'pt-BR' },
    )

    expect(parsed.bls).toHaveLength(0)
    expect(parsed.rowErrors.some((error) => /maximo plausivel/.test(error.message))).toBe(true)
  })
})

// F-30: a leitura que ENCOLHE por mil também bloqueia quando ninguém declarou o
// formato e o arquivo não desempata. Antes, só a que inflava bloqueava.
describe('separador ambiguo na direcao que encolhe por mil', () => {
  const LEGACY_HEADER = 'BL,CONSIGNATARIO,CNPJ,POL,POD,DESCRICAO,VOLUMES,PESO_KG,CBM'

  function csv(...lines: string[]): ArrayBuffer {
    return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer
  }

  it('legado en-US: "12,500" kg no padrao pt-BR bloqueia em vez de virar 12,5 kg', async () => {
    const parsed = await parseBreakbulkManifestBuffer(
      csv(LEGACY_HEADER, 'BLL1,TIMBRO,12345678000195,CNNSA,BRVIT,MAQUINA,10,"12,500",30'),
    )

    expect(parsed.bls).toHaveLength(0)
    const issue = parsed.rowErrors.find((error) => /PESO_KG/.test(error.message))
    expect(issue?.severity ?? 'error').toBe('error')
    expect(issue?.message).toContain('12.500 (13 mil)')
    expect(issue?.message).toContain('12,5')
    expect(hasBlockingRowErrors(parsed.rowErrors)).toBe(true)
  })

  it('legado: declarar en-US resolve "12,500" como 12 500 kg', async () => {
    const parsed = await parseBreakbulkManifestBuffer(
      csv(LEGACY_HEADER, 'BLL1,TIMBRO,12345678000195,CNNSA,BRVIT,MAQUINA,10,"12,500",30'),
      { numberFormat: 'en-US' },
    )

    expect(hasBlockingRowErrors(parsed.rowErrors)).toBe(false)
    expect(parsed.bls[0]?.items[0]?.gross_weight_kg).toBe(12500)
  })

  it('carrier pt-BR: "12.500" kg no padrao en-US bloqueia em vez de virar 12,5 kg', async () => {
    const parsed = await parseBreakbulkManifestBuffer(csv(
      'SHIPPER,MARKS,POL,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'B/L NO.,MARKS AND NUMBERS,POD,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'ABCD1234567,MARCA X,BRVIX,10 PACKAGES OF MACHINERY,10,12.500,30',
    ))

    const issue = parsed.rowErrors.find((error) => /GROSS WEIGHT|PESO_KG|peso/i.test(error.message))
    expect(issue?.severity).toBe('error')
    expect(parsed.bls[0]?.bb_weight_ton).toBeNull()
  })

  it('carrier: a leitura decimal passa quando outra celula do arquivo prova o ponto decimal', async () => {
    const parsed = await parseBreakbulkManifestBuffer(csv(
      'SHIPPER,MARKS,POL,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'B/L NO.,MARKS AND NUMBERS,POD,DESCRIPTION OF GOODS,NUMBER OF PIECES,GROSS WEIGHT,MEASUREMENT',
      'ABCD1234567,MARCA X,BRVIX,10 PACKAGES OF MACHINERY,10,47740.00,52.000',
    ))

    expect(parsed.rowErrors.filter((error) => /CBM|MEASUREMENT|cubagem/i.test(error.message))).toEqual([])
    expect(parsed.bls[0]?.bb_cbm).toBe(52)
  })
})

describe('hasBlockingRowErrors', () => {
  it('só o erro impede a importação; o aviso de conferência viaja junto', async () => {
    // Com o formato declarado, a célula ambígua vira aviso: o operador afirmou
    // o separador daquele arquivo, e o parser registra o que entrou.
    const parsed = await parseBreakbulkManifestBuffer(
      summaryCsv('BLI1,8,16,24,177.120,"810,11",S,C,N,12345678000195,CNQDG,BRSSA'),
      { numberFormat: 'pt-BR' },
    )

    expect(parsed.bls).toHaveLength(1)
    expect(parsed.rowErrors.every((error) => error.severity === 'warning')).toBe(true)
    expect(hasBlockingRowErrors(parsed.rowErrors)).toBe(false)
  })
})
