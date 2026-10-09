// Checagens de aceitação da revisão das importações (2026-10-09; docs/archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md).
// As referências `arquivo:linha` apontam para o checkout `fa5f238` da revisão; as regras decididas depois estão na ADR 0078.
// Cada it.fails documenta um defeito confirmado; quando a correção entrar, troque it.fails por it (arquivo unitário: já roda em `npm test`, portanto no CI).
//
// Problema-raiz M05 (+ CE numérico de P2): o leitor comum `readSheet`
// (src/services/importCore.ts:73-137) não entrega o valor da célula.
// - Modo padrão/'texto' (cellText + raw:false, importCore.ts:83-102): uma data
//   curta do Excel (numFmtId 14) chega como o texto 'm/d/yy' que o SheetJS
//   renderiza; um número chega com a máscara inglesa ('#,##0' → '2,200';
//   Geral → '1.52605E+14').
// - Modos 'cru'/'date' (raw:true, importCore.ts:74-75): o CSV é reinterpretado
//   pelo SheetJS antes do parser ('12,5' → 125; '05/03/2026' → 3 de maio) e a
//   data/hora vira Date no fuso do navegador (22:48 de Brasília → dia seguinte).
// Os parsers abaixo recebem esse valor já deformado. As células são geradas
// em memória como o Excel grava (serial numérico + numFmtId 14 para "Data
// abreviada"; a pré-condição confere o formato lido de volta).
//
// Este arquivo é unitário (sem banco): roda em `npm test`. Namespace A205 /
// 205 nos identificadores sintéticos.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCeMercanteBuffer } from '../ceMercanteImport'
import { parseContainerDatesFile } from '../containerDatesImport'
import { parseCustomerBaseFile } from '../customerBase'
import { parsePixExtract } from '../demurrage/demurrageKpis'
import { readSheet } from '../importCore'
import { parseScheduleRows } from '../portalScheduleBulkImport'
import { parseVaziosManifestBuffer } from '../vaziosImport'
import { parseVaziosImportacaoBuffer } from '../vaziosImportacaoImport'
import { parseVehicleImportBuffer } from '../vehicleImport'

// Nenhum parser abaixo consulta o banco durante a leitura; o cliente é
// substituído só para o import do módulo não exigir ambiente Supabase.
vi.mock('../supabase', () => ({ supabase: {} }))

type CellSpec = string | { n: number; z?: string }

/** Serial do Excel (sistema 1900) para a data/hora civil informada. */
function excelSerial(iso: string, hours = 0, minutes = 0) {
  const [year, month, day] = iso.split('-').map(Number)
  return (Date.UTC(year, month - 1, day, hours, minutes) - Date.UTC(1899, 11, 30)) / 86_400_000
}

/** XLSX em memória: string vira célula de texto; {n, z} vira célula numérica com o formato z. */
async function xlsxBuffer(rows: CellSpec[][]): Promise<ArrayBuffer> {
  const XLSX = await import('@e965/xlsx')
  const sheet: Record<string, unknown> = {}
  rows.forEach((row, r) => row.forEach((cell, c) => {
    const ref = XLSX.utils.encode_cell({ r, c })
    sheet[ref] = typeof cell === 'string' ? { t: 's', v: cell } : { t: 'n', v: cell.n, ...(cell.z ? { z: cell.z } : {}) }
  }))
  const width = Math.max(...rows.map((row) => row.length))
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: width - 1 } })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet as import('@e965/xlsx').WorkSheet, 'Planilha1')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

/** Lê de volta a célula gravada (tipo, valor e formato), para a pré-condição do fixture. */
async function storedCell(buffer: ArrayBuffer, ref: string) {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellNF: true })
  const cell = workbook.Sheets[workbook.SheetNames[0]][ref] as { t?: string; v?: unknown; z?: unknown } | undefined
  return { t: cell?.t, v: cell?.v, z: cell?.z }
}

function csvBuffer(lines: string[]): ArrayBuffer {
  return new TextEncoder().encode(lines.join('\n') + '\n').buffer as ArrayBuffer
}

function fileBuffer(path: string): ArrayBuffer {
  const file = readFileSync(resolve(process.cwd(), path))
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
}

/**
 * Executa com o fuso do operador (Brasília) e restaura o fuso do processo.
 * Depende do pool padrão do Vitest (forks): em worker_threads a troca de TZ
 * não vale, e a pré-condição de fuso do cenário falha em vermelho.
 */
async function inBrasilia<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ
  process.env.TZ = 'America/Sao_Paulo'
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
}

const SHORT_DATE = 'm/d/yy' // numFmtId 14: "Data abreviada" do Excel (exibida dd/mm/aaaa no Excel pt-BR)

const observed: {
  containerDates?: Awaited<ReturnType<typeof parseContainerDatesFile>>
  containerDatesThreeDigitYear?: Awaited<ReturnType<typeof parseContainerDatesFile>>
  emptyShipments?: Awaited<ReturnType<typeof parseVaziosManifestBuffer>>
  vehiclesCsv?: Awaited<ReturnType<typeof parseVehicleImportBuffer>>
  ceNumeric?: Awaited<ReturnType<typeof parseCeMercanteBuffer>>
  pixAmounts?: Awaited<ReturnType<typeof parsePixExtract>>
  pixPaidAt?: Awaited<ReturnType<typeof parsePixExtract>>
  scheduleCsv?: ReturnType<typeof parseScheduleRows>
  emptyImportTare?: Awaited<ReturnType<typeof parseVaziosImportacaoBuffer>>
} = {}

describe('M05 — leitor comum de planilhas: datas, números e identificadores', () => {
  describe('Importar Datas de Descarga e Devolução (parseContainerDatesFile)', () => {
    it('cenário: XLSX com a data curta do Excel (numFmt 14) em 01/08, 03/12 e 15/08/2026', async () => {
      const XLSX = await import('@e965/xlsx')
      expect(XLSX.SSF.get_table()[14]).toBe(SHORT_DATE)
      const buffer = await xlsxBuffer([
        ['BL', 'Container', 'Descarga', 'Devolucao'],
        ['A205BL01', 'AZCU2050011', { n: excelSerial('2026-08-01'), z: SHORT_DATE }, ''],
        ['A205BL01', 'AZCU2050012', { n: excelSerial('2026-12-03'), z: SHORT_DATE }, ''],
        ['A205BL01', 'AZCU2050013', { n: excelSerial('2026-08-15'), z: SHORT_DATE }, ''],
      ])
      // Pré-condição: a célula é numérica (serial) com o formato 14, como o Excel grava.
      for (const ref of ['C2', 'C3', 'C4']) {
        const cell = await storedCell(buffer, ref)
        expect(cell.t).toBe('n')
        expect(cell.z).toBe(SHORT_DATE)
      }
      expect((await storedCell(buffer, 'C2')).v).toBe(46235)

      const parsed = await parseContainerDatesFile(new File([buffer], 'datas-a205.xlsx'))
      expect(parsed.rows.length + parsed.rowErrors.length).toBe(3)
      observed.containerDates = parsed
    })

    it.fails('esperado: a data curta do Excel é lida como a data da célula (2026-08-01, 2026-12-03, 2026-08-15), sem linha recusada [DAT-01, INF-01] — regra: ContainerDatesImportModal.tsx:92 ("Datas em DD/MM/AAAA ou AAAA-MM-DD"), containerDatesImport.ts:37-41 (contrato DD/MM/AAAA) e CONTEXT.md:1335-1336 (Demurrage conta da descarga à devolução)', () => {
      const parsed = observed.containerDates!
      expect(parsed.rows.map((row) => [row.container_number, row.discharge_date])).toEqual([
        ['AZCU2050011', '2026-08-01'],
        ['AZCU2050012', '2026-12-03'],
        ['AZCU2050013', '2026-08-15'],
      ])
      expect(parsed.rowErrors).toEqual([])
    })

    it('controle: texto 01/08/2026 (XLSX e CSV) e célula numérica com formato dd/mm/yyyy já são lidos como 1º de agosto', async () => {
      const textXlsx = await xlsxBuffer([
        ['BL', 'Container', 'Descarga', 'Devolucao'],
        ['A205BL01', 'AZCU2050011', '01/08/2026', ''],
        ['A205BL01', 'AZCU2050012', { n: excelSerial('2026-08-01'), z: 'dd/mm/yyyy' }, ''],
      ])
      const fromXlsx = await parseContainerDatesFile(new File([textXlsx], 'datas-a205.xlsx'))
      expect(fromXlsx.rowErrors).toEqual([])
      expect(fromXlsx.rows.map((row) => row.discharge_date)).toEqual(['2026-08-01', '2026-08-01'])

      const csv = csvBuffer(['BL;Container;Descarga;Devolucao', 'A205BL01;AZCU2050011;01/08/2026;'])
      const fromCsv = await parseContainerDatesFile(new File([csv], 'datas-a205.csv', { type: 'text/csv' }))
      expect(fromCsv.rowErrors).toEqual([])
      expect(fromCsv.rows[0]?.discharge_date).toBe('2026-08-01')
    })

    it('cenário: CSV com ano de três dígitos (01/08/126), digitação fora de DD/MM/AAAA', async () => {
      const csv = csvBuffer(['BL;Container;Descarga;Devolucao', 'A205BL01;AZCU2050014;01/08/126;'])
      const parsed = await parseContainerDatesFile(new File([csv], 'datas-a205.csv', { type: 'text/csv' }))
      // Pré-condição: a linha chegou ao parser (não foi descartada por cabeçalho ou container).
      expect(parsed.rows.length + parsed.rowErrors.length).toBe(1)
      observed.containerDatesThreeDigitYear = parsed
    })

    it.fails('esperado: "01/08/126" recusado como data inválida, sem gravar o ano 2126 [DAT-14] — regra: ContainerDatesImportModal.tsx:92 (formatos aceitos: DD/MM/AAAA ou AAAA-MM-DD)', () => {
      const parsed = observed.containerDatesThreeDigitYear!
      expect(parsed.rows).toEqual([])
      expect(parsed.rowErrors.map((error) => error.row)).toEqual([2])
    })
  })

  describe('Embarque de Vazios (parseVaziosManifestBuffer)', () => {
    it('cenário: XLSX com data curta do Excel em 05/03 e 06/03/2026 (nenhum dia acima de 12)', async () => {
      const buffer = await xlsxBuffer([
        ['Container', 'Local', 'Condição', 'Embarque'],
        ['AZCU2050021', 'SSZ', 'vazio', { n: excelSerial('2026-03-05'), z: SHORT_DATE }],
        ['AZCU2050022', 'SSZ', 'vazio', { n: excelSerial('2026-03-06'), z: SHORT_DATE }],
      ])
      expect((await storedCell(buffer, 'D2')).z).toBe(SHORT_DATE)

      const parsed = await parseVaziosManifestBuffer(buffer)
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.bookings).toHaveLength(2)
      // Pré-condição: a coluna Embarque (opcional no parser) foi reconhecida e lida.
      // Sem isto, um cabeçalho quebrado daria data nula e o it.fails abaixo passaria à toa.
      expect(parsed.bookings.map((booking) => booking.movement_date)).toEqual([
        expect.stringMatching(/^2026-\d{2}-\d{2}$/),
        expect.stringMatching(/^2026-\d{2}-\d{2}$/),
      ])
      observed.emptyShipments = parsed
    })

    it.fails('esperado: data de embarque 2026-03-05 e 2026-03-06, como na célula [INF-01] — regra: ADR 0033:68-75 (Embarque de Vazios: erro silencioso é pior do que o import recusado) e vaziosImport.ts:182-186 (uma convenção de data por planilha)', () => {
      expect(observed.emptyShipments!.bookings.map((booking) => booking.movement_date)).toEqual(['2026-03-05', '2026-03-06'])
    })

    it('controle: com um dia acima de 12 no arquivo, a mesma célula curta é lida certo', async () => {
      const buffer = await xlsxBuffer([
        ['Container', 'Local', 'Condição', 'Embarque'],
        ['AZCU2050021', 'SSZ', 'vazio', { n: excelSerial('2026-03-05'), z: SHORT_DATE }],
        ['AZCU2050022', 'SSZ', 'vazio', { n: excelSerial('2026-03-15'), z: SHORT_DATE }],
      ])
      const parsed = await parseVaziosManifestBuffer(buffer)
      expect(parsed.bookings.map((booking) => booking.movement_date)).toEqual(['2026-03-05', '2026-03-15'])
    })
  })

  describe('Veículos (parseVehicleImportBuffer)', () => {
    const header = 'CHASSI;MARCA;MODELO;PESO;CUBAGEM;CONTAINER;TIPO_CONTAINER;LACRE;BL'

    it('cenário: CSV salvo pelo Excel pt-BR (";" e vírgula decimal) com cubagem 12,5', async () => {
      const parsed = await parseVehicleImportBuffer(csvBuffer([
        header,
        '9BWZZZ377VT004251;BYD;DOLPHIN;1500;12,5;AZCU2050031;40HC;A205SEAL;A205BL01',
      ]))
      // Pré-condição: a linha passa nas demais regras (chassi, container, faixas).
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.rows).toHaveLength(1)
      expect(parsed.rows[0]?.weight_kg).toBe(1500)
      observed.vehiclesCsv = parsed
    })

    it.fails('esperado: cubagem 12,5 m³ (não 125) [VEI-13, INF-02] — regra: docs/modules/manifesto-edi.md:185-187 (convenção numérica escolhida pelos cabeçalhos: pt-BR no modelo interno)', () => {
      expect(observed.vehiclesCsv!.rows[0]?.cbm).toBe(12.5)
    })

    it('controle: a mesma linha em XLSX (texto 12,5) e o modelo CSV oficial (ponto decimal) já são lidos certo', async () => {
      const XLSX = await import('@e965/xlsx')
      const sheet = XLSX.utils.aoa_to_sheet([
        header.split(';'),
        ['9BWZZZ377VT004251', 'BYD', 'DOLPHIN', '1500', '12,5', 'AZCU2050031', '40HC', 'A205SEAL', 'A205BL01'],
      ])
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, 'Planilha1')
      const fromXlsx = await parseVehicleImportBuffer(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
      expect(fromXlsx.rowErrors).toEqual([])
      expect(fromXlsx.rows[0]?.cbm).toBe(12.5)

      // O modelo oficial usa vírgula como delimitador e ponto decimal: a correção
      // (CSV como texto cru) precisa continuar aceitando-o.
      const template = await parseVehicleImportBuffer(fileBuffer('public/templates/veiculos-modelo.csv'))
      expect(template.rowErrors).toEqual([])
      expect(template.rows.map((row) => row.cbm)).toEqual([8.75, 8.1])
    })
  })

  describe('CE Mercante por planilha (parseCeMercanteBuffer)', () => {
    it('cenário: XLSX com o CE de 15 dígitos digitado em célula numérica (formato Geral)', async () => {
      const buffer = await xlsxBuffer([
        ['BL', 'CE MERCANTE'],
        ['A205BL01', { n: 152605123456789 }],
      ])
      const cell = await storedCell(buffer, 'B2')
      expect(cell.t).toBe('n')
      expect(cell.v).toBe(152605123456789)
      expect(Number.isSafeInteger(cell.v)).toBe(true)

      const parsed = await parseCeMercanteBuffer(buffer)
      expect(parsed.rows.length + parsed.rowErrors.length).toBe(1)
      observed.ceNumeric = parsed
    })

    it.fails('esperado: CE lido como os 15 dígitos da célula, sem erro de linha [CE-05, INF-15, CE-V05] — regra: CONTEXT.md:992-993 (CE entra só por planilha), docs/modules/manifesto-edi.md:282 (parser valida CE de 15 dígitos) e ceUnlockZptReconcile.ts:55 (o mesmo CE numérico é lido exato na conciliação ZPT)', () => {
      expect(observed.ceNumeric!.rowErrors).toEqual([])
      expect(observed.ceNumeric!.rows.map((row) => row.ce_mercante)).toEqual(['152605123456789'])
    })

    it('controle: o CE em célula de texto já é aceito', async () => {
      const parsed = await parseCeMercanteBuffer(await xlsxBuffer([
        ['BL', 'CE MERCANTE'],
        ['A205BL01', '152605123456789'],
      ]))
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.rows[0]?.ce_mercante).toBe('152605123456789')
    })
  })

  describe('Extrato PIX da Reconciliação (parsePixExtract)', () => {
    it('cenário: "Valor pago" numérico com centavos, inteiro numérico e texto pt-BR', async () => {
      const buffer = await xlsxBuffer([
        ['Identificador', 'CPF/CNPJ', 'Pago em', 'Valor pago'],
        ['A205TXID0001', '11222333000181', '05/03/2026 10:00', { n: 1500.5, z: '#,##0.00' }],
        ['A205TXID0002', '11222333000181', '05/03/2026 10:00', { n: 1234 }],
        ['A205TXID0003', '11222333000181', '05/03/2026 10:00', '1.500,50'],
      ])
      expect((await storedCell(buffer, 'D2')).v).toBe(1500.5)

      const transactions = await parsePixExtract(buffer)
      expect(transactions.map((transaction) => transaction.txid)).toEqual(['A205TXID0001', 'A205TXID0002', 'A205TXID0003'])
      // Controles do mesmo arquivo: inteiro numérico e texto pt-BR já saem certos.
      expect(transactions[1]?.amount).toBe(1234)
      expect(transactions[2]?.amount).toBe(1500.5)
      observed.pixAmounts = transactions
    })

    it.fails('esperado: "Valor pago" numérico 1500,50 lido como 1500,50 (não 15005) [INF-V02] — regra: CONTEXT.md:1434-1436 (Conciliação PIX casa TXID e valor) e docs/modules/reconciliacao-pix.md:50-52 (parser exige e lê "valor pago")', () => {
      expect(observed.pixAmounts![0]?.amount).toBe(1500.5)
    })

    it('cenário: "Pago em" com data e hora 05/03/2026 22:48 lido no fuso de Brasília', async () => {
      const transactions = await inBrasilia(async () => {
        // Pré-condição: o fuso do operador está ativo (UTC-3 em março de 2026).
        expect(new Date(2026, 2, 5).getTimezoneOffset()).toBe(180)
        const buffer = await xlsxBuffer([
          ['Identificador', 'CPF/CNPJ', 'Pago em', 'Valor pago'],
          ['A205TXID0004', '11222333000181', { n: excelSerial('2026-03-05', 22, 48), z: 'dd/mm/yyyy hh:mm' }, '100,00'],
          ['A205TXID0005', '11222333000181', '05/03/2026 22:48', '100,00'],
        ])
        return parsePixExtract(buffer)
      })
      expect(transactions).toHaveLength(2)
      // Controle: o mesmo instante digitado como texto já sai como 05/03.
      expect(transactions[1]?.date).toBe('2026-03-05')
      observed.pixPaidAt = transactions
    })

    it.fails('esperado: data de pagamento 2026-03-05, a data civil da célula [INF-19, INF-V02] — regra: docs/modules/reconciliacao-pix.md:51-52 (normaliza a data para YYYY-MM-DD), demurrageKpis.ts:200 (o texto "05/03/2026 22:48" vale 05/03) e reconciliacao-pix.md:276-277 (o banco opera em horário de Brasília)', () => {
      expect(observed.pixPaidAt![0]?.date).toBe('2026-03-05')
    })
  })

  describe('Chegadas/Saídas — Atualizar várias viagens por planilha (readSheet + parseScheduleRows)', () => {
    it('cenário: CSV com QINGDAO ETD 05/03/2026 e SALVADOR ETA 13/03/2026, lido como a tela lê (dates:"date")', async () => {
      const buffer = csvBuffer([
        'VESSEL NAME;VOY;IMO;QINGDAO ETD;SALVADOR ETA',
        'A205 NAVIO;205;9976501;05/03/2026;13/03/2026',
      ])
      // Mesmas opções de src/pages/ChegadasSaidas.tsx:163.
      const { rows } = await readSheet(buffer, { dates: 'date' })
      const parsed = parseScheduleRows(rows)
      expect(parsed).toHaveLength(1)
      const lanes = parsed[0]!.lanes.filter((lane) => lane.date)
      expect(lanes.map((lane) => lane.code)).toEqual(['CNTAO', 'BRSSA'])
      // Controle: dia acima de 12 não é reinterpretado e já sai certo.
      expect(lanes[1]?.date).toBe('2026-03-13')
      observed.scheduleCsv = parsed
    })

    it.fails('esperado: QINGDAO ETD 2026-03-05 (não 3 de maio), como as demais datas DD/MM/AAAA [INF-02] — regra: docs/modules/chegadas-saidas.md:56-58 (datas aceitas: ISO ou DD/MM/AAAA)', () => {
      const lane = observed.scheduleCsv![0]!.lanes.find((item) => item.code === 'CNTAO')
      expect(lane?.date).toBe('2026-03-05')
    })
  })

  describe('Vazios de Importação (parseVaziosImportacaoBuffer)', () => {
    it('cenário: XLSX com as colunas do modelo e tara numérica 2.200 kg em formato de milhar (#,##0) e 3.800 kg em Geral', async () => {
      // Colunas de public/templates/vazios-importacao-modelo.csv; POL e POD são
      // obrigatórias pelo módulo (docs/modules/manifesto-edi.md:218-219).
      const buffer = await xlsxBuffer([
        ['Container', 'Tipo', 'Tara (kg)', 'POL', 'POD'],
        ['AZCU2050041', '40HC', { n: 2200, z: '#,##0' }, 'CNTAC', 'BRVIX'],
        ['AZCU2050042', '40HC', { n: 3800 }, 'CNTAC', 'BRVIX'],
      ])
      expect(await storedCell(buffer, 'C2')).toMatchObject({ t: 'n', v: 2200, z: '#,##0' })

      const parsed = await parseVaziosImportacaoBuffer(buffer)
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.containers).toHaveLength(2)
      // Controle: o número em formato Geral já sai certo.
      expect(parsed.containers[1]?.tare_kg).toBe(3800)
      observed.emptyImportTare = parsed
    })

    it.fails('esperado: tara 2200 kg (não 2,2) [F5-N01, novo, mesma causa de M05] — regra: docs/modules/manifesto-edi.md:218-219 (coluna "Tara (kg)") e src/lib/importNumber.ts:1-4 (fronteira numérica sem inferência silenciosa)', () => {
      expect(observed.emptyImportTare!.containers[0]?.tare_kg).toBe(2200)
    })
  })

  describe('Base de Clientes (parseCustomerBaseFile)', () => {
    // Guarda da correção: a máscara de zeros é o que o operador vê na célula.
    // Um leitor que entregue só o número (205000000128 e 1205000) perde os
    // zeros à esquerda e recusa o CNPJ. Medido numa prova de conceito do leitor
    // tipado (revisão de 2026-10-09), que devolveu "Linha sem CNPJ válido.".
    it('controle: CNPJ e CEP numéricos com máscara de zeros ("00000000000000" e "00000-000") já são lidos como a célula mostra', async () => {
      const buffer = await xlsxBuffer([
        ['CNPJ', 'Razão Social', 'E-mail', 'CEP'],
        [{ n: 205000000128, z: '00000000000000' }, 'A205 CLIENTE TESTE LTDA', 'a205@example.com', { n: 1205000, z: '00000-000' }],
      ])
      expect(await storedCell(buffer, 'A2')).toMatchObject({ t: 'n', v: 205000000128, z: '00000000000000' })

      const parsed = await parseCustomerBaseFile(new File([buffer], 'clientes-a205.xlsx'))
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.rows.map((row) => [row.cnpj_cpf, row.zip])).toEqual([['00205000000128', '01205000']])
    })
  })
})
