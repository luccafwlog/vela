import * as XLSX from '@e965/xlsx'
import { describe, expect, it } from 'vitest'
import { extractEmail, extractTaxId, isInvalidFreightDescription } from '../blParser'

it('extrai o primeiro e-mail do bloco do consignatário', () => {
  expect(extractEmail('ACME LOGISTICS\nEMAIL: Finance@Acme.COM')).toBe('finance@acme.com')
  expect(extractEmail('ACME LOGISTICS')).toBeNull()
})

it('extrai CNPJ válido embutido no bloco mesmo sem o rótulo CNPJ', () => {
  expect(extractTaxId('ACME COMERCIO LTDA\nRUA X 100\n12.345.678/0001-95')).toBe('12345678000195')
})
import { parseBLBuffer, parseBLFile } from '../blParser'

// Fixtures reais de B/L COSCO nao estao versionados no repositorio; estes
// workbooks sinteticos preservam as celulas fixas e colunas do template.
function coscoBuffer({
  blNumber = 'CSC45250E02Y00',
  freightRows = [
    ['OCEAN FREIGHT', 'USD 2,600.00', 'BL', 'USD 2,600.00', '', 'USD 2,600.00'],
    ['THD', 'USD 1,717.00', 'CNTR', 'USD 1,717.00', '', 'USD 1,717.00'],
    ['BAF', 'USD 172.00', 'CNTR', 'USD 172.00', 'USD 172.00', ''],
  ],
  containerRows = [
    'TCLU1234567 / SEAL001 / 3900 / COC / 1 PKG / 40HC / 28000 KGS / 68.500 CBM',
  ],
  vinRows = [] as Array<Record<string, string>>,
  vinSheetName = 'VIN',
  cargoDescription = 'BYD DOLPHIN GS 180EV, 200 UNITS\nNCM : 8703.80.00\nDG CLASS:9\nUN NCM: 3556',
  totalPackages = '          200 UNITS',
} = {}) {
  const rows: Array<Array<string | number>> = Array.from({ length: 60 }, () => [])
  rows[5][0] = 'SHIPPER EXPORTS LTDA\nRua A, 100'
  rows[5][28] = blNumber
  rows[9][0] = 'IMPORTADOR BRASIL LTDA\nCNPJ: 12.345.678/0001-95'
  rows[13][0] = 'NOTIFY BRASIL LTDA'
  rows[13][19] = 'ALSO NOTIFY LTDA'
  rows[15][6] = 'SHANGHAI'
  rows[17][0] = 'GREEN SANTOS   14'
  rows[17][6] = 'CNSHA'
  rows[19][0] = 'BRSSZ'
  rows[19][6] = 'SANTOS'
  rows[19][19] = 'CY'
  rows[19][28] = 'CY'
  rows[34][27] = '2026-02-19'
  rows[37][0] = '2026-02-20'
  rows[37][4] = 'SHANGHAI'
  rows[42][9] = 'Description of Goods (If Dangerous Goods, See Clause 21)'
  rows[43][9] = cargoDescription
  rows[45][0] = 'TOTAL:'
  rows[45][2] = totalPackages

  freightRows.forEach(([description, rate, per, amount, prepaid, collect], index) => {
    const row = rows[25 + index]
    row[0] = description
    row[7] = rate
    row[11] = per
    row[15] = amount
    row[22] = prepaid
    row[23] = collect
  })

  containerRows.forEach((line, index) => {
    rows[46 + index][0] = line
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Page 1')
  if (vinRows.length) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(vinRows), vinSheetName)
  }
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('blParser', () => {
  it('parseia celulas fixas, container FCL e todas as linhas de frete COSCO', async () => {
    const parsed = await parseBLBuffer(coscoBuffer())

    expect(parsed.blNumber).toBe('CSC45250E02Y00')
    expect(parsed.parties).toEqual({
      shipperBlock: 'SHIPPER EXPORTS LTDA\nRua A, 100',
      consigneeBlock: 'IMPORTADOR BRASIL LTDA\nCNPJ: 12.345.678/0001-95',
      consigneeEmail: null,
      consigneeTaxId: '12345678000195',
      notifyBlock: 'NOTIFY BRASIL LTDA',
      alsoNotifyBlock: 'ALSO NOTIFY LTDA',
    })
    expect(parsed.route).toEqual({
      receipt: 'SHANGHAI',
      pol: 'CNSHA',
      pod: 'BRSSZ',
      delivery: 'SANTOS',
      vessel: 'GREEN SANTOS',
      voyage: '14',
      movementFrom: 'CY',
      movementTo: 'CY',
    })
    expect(parsed.dates).toEqual({
      ladenOnBoard: '2026-02-19',
      issueDate: '2026-02-20',
      issuePlace: 'SHANGHAI',
    })
    expect(parsed.cargo).toEqual({
      description: 'BYD DOLPHIN GS 180EV, 200 UNITS\nNCM : 8703.80.00\nDG CLASS:9\nUN NCM: 3556',
      totalPackages: 200,
      packagesUnit: 'UNITS',
      dgClass: '9',
      unNumber: '3556',
    })
    expect(parsed.containers).toEqual([
      {
        containerNumber: 'TCLU1234567',
        sealNumber: 'SEAL001',
        tareKg: 3900,
        ownership: 'COC',
        packages: '1 PKG',
        type: '40HC',
        grossWeightKg: 28000,
        cbm: 68.5,
      },
    ])
    expect(parsed.freightCharges).toEqual([
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 2600, per: 'BL', currency: 'USD', amount: 2600, payment: 'COLLECT' },
      { description: 'THD', rateCurrency: 'USD', rateAmount: 1717, per: 'CNTR', currency: 'USD', amount: 1717, payment: 'COLLECT' },
      { description: 'BAF', rateCurrency: 'USD', rateAmount: 172, per: 'CNTR', currency: 'USD', amount: 172, payment: 'PREPAID' },
    ])
  })

  it('parseia multiplos containers a partir da linha A47', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      containerRows: [
        'TCLU1234567 / SEAL001 / 3900 / COC / 1 PKG / 40HC / 28000 KGS / 68.500 CBM',
        'CSNU7654321 / SEAL002 / 2230 / COC / 2 PKG / 20GP / 12000 KGS / 30.250 CBM',
      ],
      freightRows: [
        ['OCEAN FREIGHT', 'USD 3,000.00', 'BL', 'USD 3,000.00', 'USD 3,000.00', ''],
        ['THD', 'BRL 400,50', 'CNTR', 'BRL 400,50', '', 'BRL 400,50'],
      ],
    }))

    expect(parsed.containers.map((container) => container.containerNumber)).toEqual(['TCLU1234567', 'CSNU7654321'])
    expect(parsed.freightCharges).toEqual([
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 3000, per: 'BL', currency: 'USD', amount: 3000, payment: 'PREPAID' },
      { description: 'THD', rateCurrency: 'BRL', rateAmount: 400.5, per: 'CNTR', currency: 'BRL', amount: 400.5, payment: 'COLLECT' },
    ])
  })

  it('ignora texto contratual no bloco de containers e continua lendo containers validos', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      containerRows: [
        'FFAU4532914 / SEAL001 / 3900 / COC / 1 PKG / 40HC / 28000 KGS / 68.500 CBM',
        "OCEAN FREIGHT PREPAID SHIPPER'S LOAD STOW COUNT AND SEAL NOTWITHSTANDING ANY PROVISION TO THE CONTRARY",
        'SEKU 6862599 / SEAL002 / 2230 / COC / 2 PKG / 20GP / 12000 KGS / 30.250 CBM',
      ],
    }))

    expect(parsed.containers.map((container) => container.containerNumber)).toEqual(['FFAU4532914', 'SEKU6862599'])
  })


  it('rejeita titulos de cabecalho e clausulas juridicas como frete', () => {
    expect(isInvalidFreightDescription('11. Freight & Charges')).toBe(true)
    expect(isInvalidFreightDescription('11. FREIGHT AND CHARGES')).toBe(true)
    expect(isInvalidFreightDescription('Freight & Charges')).toBe(true)
    expect(isInvalidFreightDescription('RATE')).toBe(true)
    expect(isInvalidFreightDescription('4. RECEIVED by the Carrier in external apparent good order')).toBe(true)
    expect(isInvalidFreightDescription('Received in external apparent good order')).toBe(true)
    expect(isInvalidFreightDescription('OCEAN FREIGHT')).toBe(false)
    expect(isInvalidFreightDescription('THD')).toBe(false)
    expect(isInvalidFreightDescription('THC')).toBe(false)
    expect(isInvalidFreightDescription('BAF')).toBe(false)
    expect(isInvalidFreightDescription('PER DIEM')).toBe(false)
    expect(isInvalidFreightDescription('COLLECT FEE')).toBe(false)
    expect(isInvalidFreightDescription('RATE ADJUSTMENT')).toBe(false)
    expect(isInvalidFreightDescription('PREPAID HANDLING')).toBe(false)
    expect(isInvalidFreightDescription('4 X 40HC OCEAN FREIGHT')).toBe(false)
    expect(isInvalidFreightDescription('4.5% AD VALOREM')).toBe(false)
    expect(isInvalidFreightDescription('TERMINAL HANDLING CHARGE AT PORT OF DISCHARGE SANTOS BR')).toBe(false)
    expect(isInvalidFreightDescription('BUNKER ADJUSTMENT FACTOR - CONTAINER IMBALANCE SURCHARGE')).toBe(false)
    expect(isInvalidFreightDescription('FREIGHT & CHARGES AS ARRANGED')).toBe(false)
  })

  it('preserva despesas que começam com rótulos, números ou texto longo quando a linha tem valor', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      freightRows: [
        ['11. Freight & Charges', 'RATE', 'PER', '', 'PREPAID', 'COLLECT'],
        ['PER DIEM', 'USD 50.00', 'DAY', 'USD 50.00', 'USD 50.00', ''],
        ['COLLECT FEE', 'USD 10.00', 'BL', 'USD 10.00', '', 'USD 10.00'],
        ['RATE ADJUSTMENT', 'USD 20.00', 'BL', 'USD 20.00', 'USD 20.00', ''],
        ['PREPAID HANDLING', 'USD 30.00', 'BL', 'USD 30.00', 'USD 30.00', ''],
        ['4 X 40HC OCEAN FREIGHT', 'USD 8,000.00', 'BL', 'USD 8,000.00', '', 'USD 8,000.00'],
        ['4.5% AD VALOREM', 'USD 45.00', 'BL', 'USD 45.00', '', 'USD 45.00'],
        ['TERMINAL HANDLING CHARGE AT PORT OF DISCHARGE SANTOS BR', 'BRL 100.00', 'BL', 'BRL 100.00', '', 'BRL 100.00'],
        ['BUNKER ADJUSTMENT FACTOR - CONTAINER IMBALANCE SURCHARGE', 'USD 12.00', 'CNTR', 'USD 12.00', '', 'USD 12.00'],
        ['FREIGHT & CHARGES AS ARRANGED', 'USD 15.00', 'BL', 'USD 15.00', '', 'USD 15.00'],
        ['4. Received by the Carrier in external apparent good order and condition', '', '', '', '', ''],
      ],
    }))

    expect(parsed.freightCharges.map((charge) => charge.description)).toEqual([
      'PER DIEM',
      'COLLECT FEE',
      'RATE ADJUSTMENT',
      'PREPAID HANDLING',
      '4 X 40HC OCEAN FREIGHT',
      '4.5% AD VALOREM',
      'TERMINAL HANDLING CHARGE AT PORT OF DISCHARGE SANTOS BR',
      'BUNKER ADJUSTMENT FACTOR - CONTAINER IMBALANCE SURCHARGE',
      'FREIGHT & CHARGES AS ARRANGED',
    ])
  })

  it('ignora cabecalho 11 e texto contratual 4 na secao de frete', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      freightRows: [
        ['11. Freight & Charges', 'RATE', 'PER', '', 'PREPAID', 'COLLECT'],
        ['OCEAN FREIGHT', 'USD 24,000.00', 'BL', 'USD 24,000.00', 'USD 24,000.00', ''],
        ['THD', 'BRL 1,500.00', 'CNTR', 'BRL 1,500.00', '', 'BRL 1,500.00'],
        ['4. Received by the Carrier in external apparent good order and condition', '', '', '', '', ''],
      ],
    }))

    expect(parsed.freightCharges).toEqual([
      { description: 'OCEAN FREIGHT', rateCurrency: 'USD', rateAmount: 24000, per: 'BL', currency: 'USD', amount: 24000, payment: 'PREPAID' },
      { description: 'THD', rateCurrency: 'BRL', rateAmount: 1500, per: 'CNTR', currency: 'BRL', amount: 1500, payment: 'COLLECT' },
    ])
  })

  it('mantem despesas apos linha em branco dentro da secao de frete', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      freightRows: [
        ['OCEAN FREIGHT', 'USD 3,000.00', 'BL', 'USD 3,000.00', 'USD 3,000.00', ''],
        ['', '', '', '', '', ''],
        ['BAF', 'USD 172.00', 'CNTR', 'USD 172.00', 'USD 172.00', ''],
      ],
    }))

    expect(parsed.freightCharges.map((charge) => charge.description)).toEqual(['OCEAN FREIGHT', 'BAF'])
  })

  it('parseia volumes sem DG quando a descricao nao declara carga perigosa', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      cargoDescription: '48 PACKAGES (36 IN NUDE PACKING...)',
      totalPackages: '          48 PACKAGES',
    }))

    expect(parsed.cargo).toEqual({
      description: '48 PACKAGES (36 IN NUDE PACKING...)',
      totalPackages: 48,
      packagesUnit: 'PACKAGES',
      dgClass: null,
      unNumber: null,
    })
  })

  it('parseia aba VIN para carga RoRo', async () => {
    const parsed = await parseBLBuffer(coscoBuffer({
      containerRows: [],
      vinSheetName: 'Vin ',
      vinRows: [
        { CHASSIS: '9BWZZZ377VT004251', 'CONTAINER NO': 'RORO001', 'B/L NO.': 'CSC45250E02Y00' },
        { CHASSIS: '9BWZZZ377VT004252', 'CONTAINER NO': 'RORO001', 'B/L NO.': 'CSC45250E02Y00' },
      ],
    }))

    expect(parsed.vehicles).toEqual([
      { chassis: '9BWZZZ377VT004251', containerNumber: 'RORO001', blNumber: 'CSC45250E02Y00', brand: null, model: null, weightKg: null, cbm: null },
      { chassis: '9BWZZZ377VT004252', containerNumber: 'RORO001', blNumber: 'CSC45250E02Y00', brand: null, model: null, weightKg: null, cbm: null },
    ])
  })

  it('parseia Laden on Board quando a celula do B/L e uma data Excel (nao texto)', async () => {
    const buffer = coscoBuffer()
    const XLSX = await import('@e965/xlsx')
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
    const sheet = workbook.Sheets['Page 1']
    // Overwrite the text cell fixture with a real Excel date cell (type 'd'),
    // reproducing the carrier template that formats the column as a date
    // instead of free text.
    sheet['AB35'] = { t: 'd', v: new Date(Date.UTC(2026, 1, 19)) }
    const rewritten = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    const parsed = await parseBLBuffer(rewritten)

    expect(parsed.dates.ladenOnBoard).toBe('2026-02-19')
  })

  it('parseia datas com espaço em vez de barra e rótulo embutido na mesma célula (layout real COSCO)', async () => {
    // Um B/L real da COSCO (não o fixture sintético acima) escreve "22 05 2026"
    // (espaço, não barra) em Laden on Board, e embute o rótulo na mesma célula
    // de Date/Place of Issue ("Date of Issue 22 05 2026", "Place of Issue
    // VITORIA") em vez de um valor limpo — o parser precisa lidar com os dois.
    const buffer = coscoBuffer()
    const XLSX = await import('@e965/xlsx')
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets['Page 1']
    XLSX.utils.sheet_add_aoa(sheet, [['22 05 2026']], { origin: 'AB35' })
    XLSX.utils.sheet_add_aoa(sheet, [['Date of Issue 22 05 2026']], { origin: 'A38' })
    XLSX.utils.sheet_add_aoa(sheet, [['Place of Issue VITORIA']], { origin: 'E38' })
    const rewritten = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    const parsed = await parseBLBuffer(rewritten)

    expect(parsed.dates).toEqual({
      ladenOnBoard: '22 05 2026',
      issueDate: '22 05 2026',
      issuePlace: 'VITORIA',
    })
  })

  it('bloqueia arquivo acima do limite antes de ler o buffer', async () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'bl.xlsx')

    await expect(parseBLFile(file)).rejects.toThrow(/Arquivo muito grande/)
  })

  it('rejeita conteúdo CSV quando o arquivo B/L exige XLS/XLSX', async () => {
    const file = new File(['BL;Container\nBL-1;MSCU1234567'], 'bl.xlsx')

    await expect(parseBLFile(file)).rejects.toThrow(/não reconhecido como XLS\/XLSX/)
  })
})
