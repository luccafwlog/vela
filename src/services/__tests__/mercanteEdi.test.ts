import { describe, expect, it } from 'vitest'
import {
  buildMercanteBreakbulkEdi,
  buildMercanteCargoEdi,
  buildMercanteVaziosEdi,
  cleanMercanteText,
  mercanteContainerType,
  mercanteFileName,
  mercanteFreightModality,
  mercanteNcmPositions,
  type MercanteEdiBl,
  type MercanteEdiContainer,
  type MercanteEdiHeader,
} from '../mercanteEdi'

// Dados anonimizados no formato dos B/Ls COSCO da GREEN GUANGZHOU V.6 (issue
// #560). As posições seguem o manual do Mercante (base 1).
const field = (line: string, from: number, to: number) => line.slice(from - 1, to)

const header: MercanteEdiHeader = {
  carrierCode: 'CN001321',
  closingDate: '2026-09-30',
  operationDate: '2026-11-09',
  pol: 'CNTAC',
  pod: 'BRVIX',
  voyageNumber: '6',
  vesselImo: '1095014',
  terminalCode: 'BRVIX004',
  terminalDepot: 'TVV',
}

function container(overrides: Partial<MercanteEdiContainer> = {}): MercanteEdiContainer {
  return {
    number: 'ABCU1234567',
    type: '40HC',
    grossKg: 25480,
    tareKg: 3700,
    cbm: 68,
    seal: '134543',
    isImo: false,
    imoClass: null,
    unNumber: null,
    shared: false,
    ...overrides,
  }
}

function bl(overrides: Partial<MercanteEdiBl> = {}): MercanteEdiBl {
  return {
    id: 'CSC45640602Q00',
    consigneeBlock: 'ACME LOGÍSTICA LTDA\nRUA X, Nº 10 - VILA VELHA/ES\nCNPJ:28.772.926/0001-14\nEMAIL: OPS@ACME.COM.BR',
    consigneeCnpj: '28772926000114',
    shipperBlock: 'SHIPPER CO., LTD.\nTEL:86-21-63173166',
    notifyBlock: 'SAME AS CONSIGNEE',
    notifyCnpj: null,
    emissionDate: '2026-09-25',
    description: 'TEXTILE PIECE GOODS (POLY BEDSHEET)\nNCM: 5407/5408\nPO#PO23847',
    totalPackages: 1535,
    packagesUnit: 'ROLLS',
    totalCbm: 68,
    movementFrom: 'FCL/FCL',
    ncmCodes: ['54075210', '5408', '54079999'],
    freightLines: [
      { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 8500, payment: 'PREPAID' },
      { category: 'THD', description: 'THD', currency: 'BRL', amount: 1565, payment: 'COLLECT' },
    ],
    terminalCode: null,
    terminalDepot: null,
    containers: [container()],
    breakbulkItems: [],
    vehicles: [],
    ...overrides,
  }
}

function lines(content: string | null) {
  expect(content).not.toBeNull()
  expect(content!.startsWith('﻿')).toBe(true)
  expect(content!.endsWith('\r\n')).toBe(true)
  return content!.slice(1).split('\r\n').filter(Boolean)
}

describe('buildMercanteCargoEdi', () => {
  it('monta M5, C5 e I5 nas posições do manual, com BOM e CRLF', () => {
    const result = buildMercanteCargoEdi(header, [bl()])
    expect(result.issues.filter((issue) => issue.severity === 'impedimento')).toEqual([])
    const [m5, c5, i5] = lines(result.content)

    expect(m5).toHaveLength(164)
    expect(m5.slice(0, 74).trimEnd()).toBe('M50001    CN001321      063529720001212026093020261109CNTAGBRVIX6')
    expect(field(m5, 75, 84).trim()).toBe('1095014')
    expect(field(m5, 125, 132)).toBe('BRVIX004')

    expect(c5).toHaveLength(4104)
    expect(field(c5, 1, 29)).toBe('C50001CSC45640602Q00    NN  N')
    expect(field(c5, 30, 282).trimEnd()).toBe('ACME LOGISTICA LTDA RUA X, NO 10 VILA VELHAES CNPJ:28.772.926000114 EMAIL: OPSACME.COM.BR')
    expect(field(c5, 368, 381)).toBe('28772926000114')
    expect(field(c5, 382, 634).trimEnd()).toBe('SHIPPER CO., LTD. TEL:862163173166')
    expect(field(c5, 635, 642)).toBe('20260925')
    expect(field(c5, 643, 1148).trimEnd()).toBe('TEXTILE PIECE GOODS POLY BEDSHEET NCM: 5407 5408 POPO23847 TOTAL: 1535 ROLLS')
    expect(field(c5, 1402, 1438)).toBe('0000000068000CNTAGBRVIX28772926000114')
    // notify SAME AS CONSIGNEE repete o bloco do consignatário
    expect(field(c5, 1439, 1691)).toBe(field(c5, 30, 282))
    expect(field(c5, 1740, 1795)).toBe('000000000000000850000220PHHIESBRVIX004CNN000000000000000')
    expect(field(c5, 3797, 3816)).toBe('0177900000000156500C')
    expect(field(c5, 3817, 3836)).toBe('0000000000000000000 ')

    expect(i5).toHaveLength(5000)
    expect(field(i5, 1, 44)).toBe('I51000100002548000045G1ABCU1234567003700000 ')
    expect(field(i5, 449, 458).trim()).toBe('')
    expect(field(i5, 459, 471)).toBe('0000000068000')
    expect(field(i5, 472, 486).trimEnd()).toBe('134543')
    expect(field(i5, 532, 547)).toBe('5407    5408    ')
  })

  it('marca contêiner dividido, leva o IMO do contêiner e até 4 lacres', () => {
    const shared = container({ shared: true, isImo: true, imoClass: '9', unNumber: '3166', seal: 'S1/S2 S3,S4;S5', type: '48FR' })
    const result = buildMercanteCargoEdi(header, [bl({ containers: [shared] })])
    const i5 = lines(result.content)[2]
    expect(field(i5, 20, 23)).toBe('R9P0')
    expect(field(i5, 44, 44)).toBe('S')
    expect(field(i5, 449, 458)).toBe('0031669   ')
    expect(field(i5, 472, 531).replace(/ +/g, ' ').trim()).toBe('S1 S2 S3 S4')
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'aviso', message: expect.stringContaining('4 lacres') }))
  })

  it('usa o notify próprio, frete collect e modalidade LCL/FCL', () => {
    const result = buildMercanteCargoEdi(header, [bl({
      notifyBlock: 'NOTIFY BRASIL LTDA',
      notifyCnpj: '19324555000117',
      movementFrom: 'LCL/FCL',
      freightLines: [{ category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 890, payment: 'COLLECT' }],
    })])
    const c5 = lines(result.content)[1]
    expect(field(c5, 1425, 1438)).toBe('19324555000117')
    expect(field(c5, 1439, 1691).trimEnd()).toBe('NOTIFY BRASIL LTDA')
    expect(field(c5, 1764, 1766)).toBe('CPH')
    expect(field(c5, 3797, 3816)).toBe('0000000000000000000 ')
  })

  it('continua a descrição longa nas observações e avisa o que ficou de fora', () => {
    const description = Array.from({ length: 200 }, (_, index) => `ITEM${index}`).join(' ')
    const result = buildMercanteCargoEdi(header, [bl({ description })])
    const c5 = lines(result.content)[1]
    expect(field(c5, 643, 1148).trimEnd().endsWith(' ')).toBe(false)
    expect(field(c5, 1149, 1401).trim().length).toBeGreaterThan(200)
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'aviso', ref: 'CSC45640602Q00' }))
  })

  it('impede a geração e diz por quê, sem descartar B/L', () => {
    const result = buildMercanteCargoEdi(
      { ...header, closingDate: null, terminalCode: null, terminalDepot: null },
      [bl({
        consigneeCnpj: null,
        ncmCodes: [],
        containers: [container({ type: '45XX' })],
        freightLines: [
          { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 100, payment: 'PREPAID' },
        ],
      })],
    )
    expect(result.content).toBeNull()
    const messages = result.issues.filter((issue) => issue.severity === 'impedimento').map((issue) => issue.message)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('Sem ATD no POL CNTAC'),
      expect.stringContaining('Sem terminal de descarga'),
      expect.stringContaining('Sem CNPJ/CPF do consignatário'),
      expect.stringContaining('B/L sem NCM'),
      expect.stringContaining('Tipo de contêiner 45XX'),
    ]))
  })

  it('manifesta só o frete e o THD; outra despesa fica de fora com aviso', () => {
    const result = buildMercanteCargoEdi(header, [bl({
      freightLines: [
        { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 8500, payment: 'PREPAID' },
        { category: 'BAF', description: 'BUNKER SURCHARGE', currency: 'USD', amount: 300, payment: 'PREPAID' },
        { category: 'THD', description: 'THD', currency: 'BRL', amount: 1565, payment: 'COLLECT' },
      ],
    })])
    const c5 = lines(result.content)[1]
    expect(field(c5, 3797, 3816)).toBe('0177900000000156500C')
    expect(field(c5, 3817, 3835)).toBe('0'.repeat(19))
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'aviso',
      message: 'Fora do manifesto (só frete e THD são manifestados): BUNKER SURCHARGE.',
    }))
  })

  it('recusa B/L à ordem e porto fora da tabela do Mercante', () => {
    const result = buildMercanteCargoEdi({ ...header, pol: 'CNXXX' }, [bl({ consigneeBlock: 'TO ORDER OF SHIPPER' })])
    const messages = result.issues.map((issue) => issue.message)
    expect(result.content).toBeNull()
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('B/L à ordem'),
      expect.stringContaining('CNXXX não existe na tabela de portos'),
    ]))
  })

  it('ordena os B/Ls pelo número e numera os itens por B/L', () => {
    const result = buildMercanteCargoEdi(header, [
      bl({ id: 'CSC2', containers: [container(), container({ number: 'ABCU7654321' })] }),
      bl({ id: 'CSC1' }),
    ])
    const records = lines(result.content)
    expect(field(records[0], 3, 6)).toBe('0002')
    expect(records.slice(1).map((line) => line.slice(0, 2) + (line[0] === 'C' ? field(line, 7, 10) : field(line, 4, 7)))).toEqual([
      'C5CSC1', 'I50001', 'C5CSC2', 'I50001', 'I50002',
    ])
  })
  it('terminal sem código Mercante, na frente ou na exceção do B/L, é impedimento e não cai para outro terminal', () => {
    const semCodigo = buildMercanteCargoEdi({ ...header, terminalCode: null, terminalDepot: 'NOVO' }, [bl()])
    expect(semCodigo.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining('Terminal NOVO do POD BRVIX sem código Mercante'))

    const excecao = buildMercanteCargoEdi(header, [bl({ terminalCode: null, terminalDepot: 'NOVO' })])
    expect(excecao.content).toBeNull()
    expect(excecao.issues).toContainEqual(expect.objectContaining({ ref: 'CSC45640602Q00', message: expect.stringContaining('Terminal NOVO da exceção do B/L') }))
  })

  it('não soma Ocean Freight de moedas ou pagamentos diferentes', () => {
    const result = buildMercanteCargoEdi(header, [bl({
      freightLines: [
        { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 8000, payment: 'PREPAID' },
        { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'BRL', amount: 500, payment: 'PREPAID' },
      ],
    })])
    expect(result.content).toBeNull()
    expect(result.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining('mais de uma moeda'))
  })

  it('valor que não cabe, contêiner fora do ISO, repetido, CNPJ e IMO inválidos são impedimentos, não cortes', () => {
    const result = buildMercanteCargoEdi({ ...header, vesselImo: 'IMO 123' }, [bl({
      id: 'CSC1234567890123456789',
      consigneeCnpj: '28772926000115',
      containers: [container({ tareKg: 1_000_000 }), container({ number: 'ABC123' }), container({ number: 'ABC123' })],
    })])
    expect(result.content).toBeNull()
    const messages = result.issues.map((issue) => issue.message)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('IMO do navio "IMO 123" não tem 7 dígitos'),
      expect.stringContaining('mais de 18 caracteres'),
      expect.stringContaining('CNPJ do consignatário 28772926000115 inválido'),
      expect.stringContaining('Tara 1000000 não cabe'),
      'Número do contêiner fora do padrão ISO (4 letras e 7 dígitos).',
      'Contêiner repetido no mesmo B/L.',
    ]))
  })

  it('IMO do navio com prefixo sai só com os dígitos', () => {
    const m5 = lines(buildMercanteCargoEdi({ ...header, vesselImo: 'IMO 1095014' }, [bl()]).content)[0]
    expect(field(m5, 75, 84)).toBe('1095014   ')
  })
})

describe('buildMercanteBreakbulkEdi (arquivo parcial)', () => {
  // B/L de carga solta como o Manifesto BB grava: nome curto das partes, sem
  // emissão, frete nem Type of Movement; itens e veículos fora de contêiner.
  const breakbulk = (overrides: Partial<MercanteEdiBl> = {}) => bl({
    id: 'GPCVI2SANY003',
    consigneeBlock: 'ACME MAQUINAS LTDA',
    shipperBlock: 'SANY HEAVY INDUSTRY CO., LTD.',
    notifyBlock: null,
    emissionDate: null,
    description: 'SANY HYDRAULIC EXCAVATOR',
    totalPackages: null,
    movementFrom: null,
    ncmCodes: ['84295199'],
    freightLines: [],
    containers: [],
    breakbulkItems: [{ description: 'SANY HYDRAULIC EXCAVATOR SY215', quantity: 2, unit: 'UNITS', grossKg: 43800, cbm: 120.5, marks: 'SANY' }],
    vehicles: [{ chassis: 'SYS11021TT3C60990', grossKg: 21900, brand: 'SANY', model: 'SY215C' }],
    ...overrides,
  })

  it('sai com os dados básicos e lista o que a equipe completa, sem impedir o download', () => {
    const result = buildMercanteBreakbulkEdi({ ...header, terminalCode: null, terminalDepot: null }, [breakbulk()])
    const [m5, c5, cargaSolta, veiculo] = lines(result.content)

    expect(result.issues.filter((issue) => issue.severity === 'impedimento')).toEqual([])
    expect(field(m5, 3, 6)).toBe('0001')
    expect(field(c5, 3, 6)).toBe('0002') // um item de carga solta e um veículo
    expect(field(c5, 7, 24).trim()).toBe('GPCVI2SANY003')
    expect(field(c5, 30, 282).trim()).toBe('ACME MAQUINAS LTDA')
    expect(field(c5, 382, 634).trim()).toBe('SANY HEAVY INDUSTRY CO., LTD.')
    expect(field(c5, 1439, 1691).trim()).toBe('ACME MAQUINAS LTDA') // sem notify: o consignatário
    expect(field(c5, 635, 642)).toBe('        ') // emissão em branco para a equipe

    expect(field(cargaSolta, 1, 7)).toBe('I520001')
    expect(field(cargaSolta, 8, 19)).toBe('000043800000')
    expect(field(cargaSolta, 24, 34)).toBe(' '.repeat(11))
    expect(field(cargaSolta, 45, 46)).toBe('41') // tabela 71: 41 para todo item (decisão do dono)
    expect(field(cargaSolta, 47, 53)).toBe('0000002')
    expect(field(cargaSolta, 339, 393).trim()).toBe('SANY')
    expect(field(cargaSolta, 394, 448).trim()).toBe('SANY HYDRAULIC EXCAVATOR SY215')
    expect(field(cargaSolta, 459, 471)).toBe('0000000120500')
    expect(field(cargaSolta, 532, 539)).toBe('8429    ')

    expect(field(veiculo, 1, 7)).toBe('I540002')
    expect(field(veiculo, 8, 19)).toBe('000021900000')
    expect(field(veiculo, 309, 338).trim()).toBe('SYS11021TT3C60990')
    expect(field(veiculo, 339, 393).trim()).toBe('SANY')
    expect(field(veiculo, 394, 448).trim()).toBe('SY215C')

    const completar = result.issues.filter((issue) => issue.severity === 'completar').map((issue) => issue.message)
    expect(completar).toEqual(expect.arrayContaining([
      expect.stringContaining('Sem terminal de descarga'),
      'Sem data de emissão do B/L.',
      expect.stringContaining('Sem valor do frete marítimo'),
      expect.stringContaining('Type of Movement'),
    ]))
    expect(completar.some((message) => message.includes('embalagem'))).toBe(false)
  })

  it('notify com o mesmo nome do consignatário leva o CNPJ dele', () => {
    const c5 = lines(buildMercanteBreakbulkEdi(header, [breakbulk({ notifyBlock: 'Acme Máquinas Ltda' })]).content)[1]
    expect(field(c5, 1425, 1438)).toBe('28772926000114')
    expect(field(c5, 1439, 1691).trim()).toBe('ACME MAQUINAS LTDA')
  })

  it('B/L misto leva contêiner, item de carga solta e veículo no mesmo C5', () => {
    const result = buildMercanteBreakbulkEdi(header, [breakbulk({ containers: [container()] })])
    const records = lines(result.content)
    expect(field(records[1], 3, 6)).toBe('0003')
    expect(records.slice(2).map((line) => field(line, 3, 7))).toEqual(['10001', '20002', '40003'])
  })

  it('item montado com os totais do B/L sai com aviso para conferir', () => {
    const result = buildMercanteBreakbulkEdi(header, [breakbulk({
      breakbulkItems: [{ description: 'Maquinas: 8', quantity: 32, unit: null, grossKg: 259312, cbm: 1217.109, marks: 'SANY', fromTotals: true }],
      vehicles: [],
    })])
    const item = lines(result.content)[2]
    expect(field(item, 1, 19)).toBe('I520001000259312000')
    expect(field(item, 45, 53)).toBe('410000032')
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'aviso', message: expect.stringContaining('montado com os totais do B/L') }))
  })

  it('sem B/L de carga solta na rota, não há arquivo', () => {
    const result = buildMercanteBreakbulkEdi(header, [])
    expect(result.content).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'impedimento', message: 'A rota não tem B/L ativo de carga solta.' }))
  })

  it('no arquivo de contêiner, o mesmo dado que falta continua impedindo', () => {
    const result = buildMercanteCargoEdi(header, [bl({ emissionDate: null })])
    expect(result.content).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'impedimento', message: 'Sem data de emissão do B/L.' }))
  })
})

describe('revisão da PR 1173 (gerador)', () => {
  it('IMO não confirmado pelo Baplie: contêiner sem IMO e aviso; classe IMO só com letras, dígitos e ponto', () => {
    const result = buildMercanteCargoEdi(header, [bl({ containers: [
      container({ imoUnconfirmed: true }),
      container({ number: 'ABCU7654321', isImo: true, imoClass: ' 2.1 (A)', unNumber: 'UN 1950' }),
    ] })])
    const [, , semImo, comImo] = lines(result.content)
    expect(field(semImo, 449, 458).trim()).toBe('')
    expect(field(comImo, 449, 458)).toBe('0019502.1A')
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'aviso', ref: 'CSC45640602Q00 · ABCU1234567', message: expect.stringContaining('não confirmado pelo Baplie') }))
  })

  it('terminal pendente do B/L: impede o de contêiner, vira "completar" no parcial e o campo sai em branco', () => {
    const issue = 'B/L misto sem terminal definido: defina a exceção de terminal do B/L.'
    expect(buildMercanteCargoEdi(header, [bl({ terminalIssue: issue })]).issues).toContainEqual(expect.objectContaining({ severity: 'impedimento', message: issue }))
    const partial = buildMercanteBreakbulkEdi(header, [bl({ terminalIssue: issue })])
    expect(partial.issues).toContainEqual(expect.objectContaining({ severity: 'completar', message: issue }))
    expect(field(lines(partial.content)[1], 1770, 1777)).toBe(' '.repeat(8))
  })

  it('no parcial, valor que não cabe sai em branco (nunca cortado) e número do B/L longo impede', () => {
    const partial = buildMercanteBreakbulkEdi(header, [bl({ totalCbm: Number.NaN, containers: [container({ tareKg: 1_000_000 })] })])
    const [, c5, i5] = lines(partial.content)
    expect(field(c5, 1402, 1414)).toBe(' '.repeat(13))
    expect(field(i5, 35, 43)).toBe(' '.repeat(9))
    const longId = buildMercanteBreakbulkEdi(header, [bl({ id: 'CSC1234567890123456789' })])
    expect(longId.content).toBeNull()
  })

  it('sem cubagem do B/L e aviso vindo da leitura chegam à prévia', () => {
    const result = buildMercanteCargoEdi(header, [bl({ totalCbm: null, warnings: ['Aviso da leitura.'] })])
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'impedimento', message: 'Sem cubagem do B/L.' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: 'aviso', message: 'Aviso da leitura.' }))
  })
})

describe('buildMercanteVaziosEdi', () => {
  it('monta M5 sem conhecimento e um V5 por vazio', () => {
    const result = buildMercanteVaziosEdi(header, [
      { number: 'FBIU4825306', type: '40FH', tareKg: 5200 },
      { number: 'FBIU4003330', type: '40FR', tareKg: 5800 },
    ])
    const [m5, v1, v2] = lines(result.content)
    expect(field(m5, 3, 10)).toBe('00000002')
    expect(v1).toHaveLength(5000)
    expect(v1.slice(0, 30)).toBe('V5000145P3FBIU4825306005200000')
    expect(v2.slice(0, 30)).toBe('V5000242P3FBIU4003330005800000')
  })

  it('impede vazio sem tara ou com tipo fora da tabela', () => {
    const result = buildMercanteVaziosEdi(header, [{ number: 'FBIU4825306', type: '40XX', tareKg: null }])
    expect(result.content).toBeNull()
    expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Tipo de contêiner 40XX'),
      'Vazio sem tara.',
    ]))
  })

  it('impede vazio repetido na rota', () => {
    const vazio = { number: 'FBIU4825306', type: '40FH', tareKg: 5200 }
    const result = buildMercanteVaziosEdi(header, [vazio, vazio])
    expect(result.content).toBeNull()
    expect(result.issues).toContainEqual(expect.objectContaining({ ref: 'FBIU4825306', message: 'Contêiner vazio repetido na rota.' }))
  })
})

describe('regras auxiliares', () => {
  it('converte tipo, modalidade e NCM', () => {
    expect(mercanteContainerType('40 HC')).toBe('45G1')
    expect(mercanteContainerType('40GP')).toBe('42G1')
    expect(mercanteContainerType('45XX')).toBeNull()
    expect(mercanteFreightModality('FCL/FCL')).toBe('HH')
    expect(mercanteFreightModality('LCL/LCL')).toBe('PP')
    expect(mercanteFreightModality('CY-CY')).toBeNull()
    expect(mercanteNcmPositions(['87038000', '8703', '60012200'])).toEqual(['8703', '6001'])
  })

  it('limpa texto sem acento e sem caracteres fora da lista', () => {
    expect(cleanMercanteText('SÃO PAULO/SP - Nº 5 (A)', 'party')).toBe('SAO PAULOSP NO 5 A')
    expect(cleanMercanteText('NCM:8483/8708 E-MAIL', 'description')).toBe('NCM:8483 8708 E-MAIL')
  })

  it('nomeia o arquivo com o instante e a sigla do navio e da viagem', () => {
    expect(mercanteFileName('GREEN GUANGZHOU', '6', new Date(2026, 10, 2, 9, 5))).toBe('FWL_MERCANTE_202611020905_GG6.TXT')
  })
})
