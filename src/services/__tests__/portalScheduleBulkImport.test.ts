import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readSheet } from '../importCore'
import { assertNoRepeatedScheduleColumns, parseScheduleRows, scheduleSheetIssues, scheduleTemplateColumns } from '../portalScheduleBulkImport'

describe('parseScheduleRows', () => {
  it('gera colunas do template a partir da constante de lanes', () => {
    expect(scheduleTemplateColumns()).toEqual(
      expect.arrayContaining(['VESSEL NAME', 'VOY', 'IMO', 'QINGDAO ETD', 'SALVADOR ETA']),
    )
  })

  it('converte linha em input, tratando X/vazio como nao escala e DD/MM/AAAA em ISO', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'QINGDAO ETD': '04/01/2026',
      'SHANGHAI ETD': 'X',
      'SALVADOR ETA': '2026-01-22',
    }])

    expect(row.vesselName).toBe('GREEN PECEM')
    expect(row.lanes).toContainEqual({ code: 'CNTAO', kind: 'pol', date: '2026-01-04' })
    expect(row.lanes.find((lane) => lane.code === 'CNSHA')?.date).toBe(null)
    expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe('2026-01-22')
  })

  it('aceita a célula de data do Excel, que o leitor comum entrega como AAAA-MM-DD', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'QINGDAO ETD': '2026-01-04',
    }])
    expect(row.lanes.find((lane) => lane.code === 'CNTAO')?.date).toBe('2026-01-04')
  })

  it('reporta celula nao-vazia e nao-parseavel como aviso, sem sumir', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'SALVADOR ETA': 'quarta-feira',
    }])
    expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe(null)
    expect(row.invalidCells).toContain('SALVADOR ETA')
  })

  it('rejeita data de calendário impossível (e.g. 31/02 ou 2026-02-31) e aponta como inválida', () => {
    const [row] = parseScheduleRows([{
      'VESSEL NAME': 'GREEN PECEM',
      VOY: '6',
      IMO: '9976501',
      'SALVADOR ETA': '31/02/2026',
      'QINGDAO ETD': '2026-02-31',
    }])
    expect(row.lanes.find((lane) => lane.code === 'BRSSA')?.date).toBe(null)
    expect(row.lanes.find((lane) => lane.code === 'CNTAO')?.date).toBe(null)
    expect(row.invalidCells).toEqual(expect.arrayContaining(['SALVADOR ETA', 'QINGDAO ETD']))
  })
})

describe('parseScheduleRows: linha incompleta (ADR 0092)', () => {
  it('navio sem VOY, VOY sem navio ou linha com dado sem os dois recusam a planilha, com a linha de cada uma', () => {
    expect(() => parseScheduleRows([
      { 'VESSEL NAME': 'NAVIO A', VOY: '1', 'SALVADOR ETA': '22/01/2026', rowNumber: 2 },
      { 'VESSEL NAME': 'NAVIO B', VOY: '', 'SALVADOR ETA': '22/01/2026', rowNumber: 3 },
      { 'VESSEL NAME': '', VOY: '205', rowNumber: 4 },
      { 'VESSEL NAME': '', VOY: '', 'SALVADOR ETA': '22/01/2026', rowNumber: 5 },
    ])).toThrow('Linha 3: VOY vazio para o navio NAVIO B. Linha 4: VESSEL NAME vazio para a VOY 205. Linha 5: tem dados, mas está sem VESSEL NAME e VOY. Preencha VESSEL NAME e VOY em cada linha com dados e escolha o arquivo de novo.')
  })

  it('linha vazia e a linha de exemplo do modelo continuam ignoradas', () => {
    const rows = parseScheduleRows([
      { 'VESSEL NAME': '', VOY: '', IMO: '', rowNumber: 2 },
      { 'VESSEL NAME': 'EXEMPLO NAVIO', VOY: '', rowNumber: 3 },
      { 'VESSEL NAME': 'EXEMPLO NAVIO', VOY: '1', rowNumber: 4 },
      { 'VESSEL NAME': 'NAVIO A', VOY: '1', rowNumber: 5 },
    ])
    expect(rows.map((row) => row.rowNumber)).toEqual([5])
  })
})

describe('assertNoRepeatedScheduleColumns', () => {
  it('recusa a mesma coluna duas vezes (o leitor comum dá sufixo à repetição)', () => {
    expect(() => assertNoRepeatedScheduleColumns(['VESSEL NAME', 'VOY', 'SALVADOR ETA', 'SALVADOR ETA_1']))
      .toThrow(/"SALVADOR ETA" aparece mais de uma vez/)
  })

  it('aceita cabeçalho sem repetição e ignora colunas que o parser não lê', () => {
    expect(() => assertNoRepeatedScheduleColumns(['VESSEL NAME', 'VOY', 'IMO', 'OBS', 'OBS_1'])).not.toThrow()
  })
})

// A5 do lote 6a: o modelo para baixar passa pelo leitor e pelo parser reais.
describe('modelo da programação por planilha', () => {
  for (const extension of ['xlsx', 'csv'] as const) {
    it(`modelo .${extension} traz as colunas do parser e datas legíveis`, async () => {
      const raw = readFileSync(`public/templates/programacao-navios-modelo.${extension}`)
      const { headers, rows } = await readSheet(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
      expect(headers).toEqual(scheduleTemplateColumns())
      expect(() => assertNoRepeatedScheduleColumns(headers)).not.toThrow()
      // A linha de exemplo ("EXEMPLO NAVIO") nunca é importada; com outro nome,
      // é lida sem data ilegível.
      expect(parseScheduleRows(rows)).toEqual([])
      const [example] = parseScheduleRows(rows.map((row) => ({ ...row, 'VESSEL NAME': 'NAVIO TESTE' })))
      expect(example.invalidCells).toEqual([])
      expect(example.lanes.filter((lane) => lane.date).map((lane) => lane.date)).toEqual(['2026-01-04', '2026-01-22', '2026-01-25'])
    })
  }
})

describe('scheduleSheetIssues (regra de 2026-10-19)', () => {
  it('data ilegível e linha que a prévia recusa são erros, apontados pela linha da planilha', () => {
    const rows = parseScheduleRows([
      { 'VESSEL NAME': 'NAVIO A', VOY: '1', 'SALVADOR ETA': 'amanhã', rowNumber: 4 },
      { 'VESSEL NAME': 'NAVIO B', VOY: '2', 'SALVADOR ETA': '22/01/2026', rowNumber: 5 },
    ])
    const plan = [
      { label: 'NAVIO A / 1', error: null },
      { label: 'NAVIO B / 2', error: 'Viagem cancelada.' },
    ] as unknown as Parameters<typeof scheduleSheetIssues>[1]
    expect(scheduleSheetIssues(rows, plan)).toEqual([
      expect.objectContaining({ row: 4, severity: 'error', message: 'NAVIO A / 1: data ilegível em SALVADOR ETA.' }),
      expect.objectContaining({ row: 5, severity: 'error', message: 'NAVIO B / 2: Viagem cancelada.' }),
    ])
  })
})
