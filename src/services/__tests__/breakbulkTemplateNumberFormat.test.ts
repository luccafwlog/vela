// Os modelos que as telas oferecem para download têm de passar pelo parser do
// qual são modelo. Não passavam: `parseNumber` lia tudo em pt-BR fixo, e
// `259.312` — a notação do modelo — é milhar em pt-BR, então o peso entrava
// multiplicado por mil, sem erro de linha, e seguia para a taxa por tonelada.
//
// Estes casos são o gate dessa classe de defeito: qualquer mexida no modelo ou
// no parser que reintroduza a escala errada quebra aqui.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBreakbulkManifestBuffer } from '../breakbulkManifestParser'

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
      expect(byBl.get('CCSV22ZJGVIT001A')?.bb_cbm).toBeCloseTo(1217.11, 2)
      expect(byBl.get('CCSV22ZJGVIT002A')?.bb_weight_ton).toBeCloseTo(135.263, 3)
      expect(byBl.get('CCSV22ZJGVIT003A')?.bb_weight_ton).toBeCloseTo(177.12, 3)
    })
  }
})

describe('modelo de manifesto BB (tela de viagem)', () => {
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
})
