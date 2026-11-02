import { describe, expect, it } from 'vitest'
import {
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
    containers: [container()],
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
      { ...header, closingDate: null, terminalCode: null },
      [bl({
        consigneeCnpj: null,
        ncmCodes: [],
        containers: [container({ type: '45XX' })],
        freightLines: [
          { category: 'OCEAN_FREIGHT', description: 'OCEAN FREIGHT', currency: 'USD', amount: 100, payment: 'PREPAID' },
          { category: 'BAF', description: 'BAF', currency: 'USD', amount: 10, payment: 'PREPAID' },
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
      expect.stringContaining('Despesa "BAF"'),
    ]))
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
