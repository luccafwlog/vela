import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'

import { formatPolDeparture } from '../../components/voyages/voyageCardHelpers'
import { buildBlFreightPayload, buildBlFreightPreview } from '../blFreightImport'
import { parseBLBuffer } from '../blParser'

function buildCoscoBlBuffer(blNumber: string, ladenOnBoard: string, containerNumber: string) {
  const rows: Array<Array<string | number>> = Array.from({ length: 60 }, () => [])
  rows[5][0] = 'EXPORTADORA TESTE LTDA\nRUA DO PORTO, 10'
  rows[5][28] = blNumber
  rows[9][0] = 'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95'
  rows[13][0] = 'NOTIFY TESTE LTDA'
  rows[17][0] = 'GREEN SANTOS   14'
  rows[17][6] = 'CNSHA'
  rows[19][0] = 'BRSSZ'
  rows[19][6] = 'SANTOS'
  rows[34][27] = ladenOnBoard
  rows[37][0] = '2026-07-10'
  rows[42][9] = 'Description of Goods (If Dangerous Goods, See Clause 21)'
  rows[43][9] = '10 UNITS OF TEST CARGO'
  rows[45][0] = 'TOTAL:'
  rows[45][2] = '10 UNITS'
  rows[46][0] = `${containerNumber} / SEAL001 / 3900 / COC / 10 PKG / 40HC / 28000 KGS / 68.500 CBM`

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Page 1')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('WS1 functional smoke', () => {
  it('liga XLSX, payload documental, menor Laden on Board e exibicao do ATD sem acesso externo', async () => {
    const documents = await Promise.all([
      parseBLBuffer(buildCoscoBlBuffer('WS1-SMOKE-001', '2026-07-09', 'TCLU1234567')),
      parseBLBuffer(buildCoscoBlBuffer('WS1-SMOKE-002', '2026-07-08', 'CSNU7654321')),
    ])
    const payloads = documents.map((document) => buildBlFreightPayload(document, 390))

    expect(documents.map((document) => document.dates.ladenOnBoard)).toEqual(['2026-07-09', '2026-07-08'])
    expect(payloads.map((payload) => payload.consignee)).toEqual([
      'IMPORTADORA FUNCIONAL LTDA',
      'IMPORTADORA FUNCIONAL LTDA',
    ])
    expect(payloads.map((payload) => payload.consignee_block)).toEqual([
      'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95',
      'IMPORTADORA FUNCIONAL LTDA\nRUA DAS FLORES, 100\nCNPJ: 12.345.678/0001-95',
    ])

    const preview = buildBlFreightPreview({
      documents,
      selectedVoyage: { id: 390, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
    })
    expect(preview.rows.map((row) => row.ladenOnBoard)).toEqual(['2026-07-09', '2026-07-08'])
    expect(preview.rows.map((row) => row.payload)).toEqual(payloads)

    // ADR 0095, decisão 23 (migration 401): o servidor grava o menor Laden on
    // Board dos B/Ls ativos como ATD do POL; com o ATD corrigido à mão, a
    // prévia avisa na linha do menor Laden on Board do arquivo e o ATD não muda.
    const withManual = buildBlFreightPreview({
      documents,
      selectedVoyage: { id: 390, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      manualPolAtds: new Map([['CNSHA', '2026-07-10']]),
    })
    expect((withManual.rows[0]?.warnings ?? []).join(' ')).not.toContain('corrigido à mão')
    expect(withManual.rows[1]?.warnings).toContain(
      'ATD do POL CNSHA corrigido à mão em 10/07/2026: o Laden on Board do arquivo é 08/07/2026 e o ATD não muda.',
    )
    const sameDate = buildBlFreightPreview({
      documents,
      selectedVoyage: { id: 390, vesselName: 'GREEN SANTOS', voyageNumber: '14' },
      manualPolAtds: new Map([['CNSHA', '2026-07-08']]),
    })
    expect(sameDate.rows.flatMap((row) => row.warnings).join(' ')).not.toContain('corrigido à mão')

    expect(formatPolDeparture('2026-07-15', '2026-07-08')).toEqual({
      value: '2026-07-08',
      isActual: true,
    })
  })
})
