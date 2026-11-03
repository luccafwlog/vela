import { describe, expect, it, vi } from 'vitest'
import * as XLSX from '@e965/xlsx'

vi.mock('../../supabase', () => ({ supabase: {} }))

import {
  CARRIER_REPORT_TITLE,
  carrierCneeBlock,
  carrierInvoicedLines,
  carrierPendingLines,
  carrierPendingStatus,
  type CarrierReportBl,
} from '../demurrageCarrierReport'
import { buildDemurrageCarrierWorkbook, excelDateSerial } from '../../exports'
import type { DemurrageExposureRow, DemurrageItemReportRow } from '../../reports'

const blBase: CarrierReportBl = {
  id: 'CSC45630404N00',
  pol: 'CNNSA',
  pod: 'BRVIX',
  consignee: null,
  consignee_address: null,
  consignee_phone: null,
  consignee_block: 'GES LOGISTICA DO BRASIL LTDA\nRUA ALCIDES 167\nCNPJ 08092062/0001-82',
  customer: { name: 'GES LOGISTICA', cnpj_cpf: '08092062000182', address: 'RUA ALCIDES 167', city: 'SAO PAULO', state: 'SP', zip: '04571-110' },
  voyage: { voyage_number: 'V14', vessel: { name: 'GREEN ITAQUI' } },
}
const otherBl: CarrierReportBl = { ...blBase, id: 'CSC45630404L00', pol: 'CNTAC' }
const bls = new Map([[blBase.id, blBase], [otherBl.id, otherBl]])

function item(overrides: Partial<DemurrageItemReportRow> & { doc?: string; billedAt?: string; blId?: string }): DemurrageItemReportRow {
  const { doc = 'DEM-10-0001', billedAt = '2026-10-20T12:00:00Z', blId = blBase.id, ...rest } = overrides
  return {
    id: 1,
    container_number: 'CAAU6209039',
    container_type: '45G1',
    discharge_date: '2026-09-21',
    return_date: '2026-10-14',
    total_days: 23,
    free_days: 21,
    days_p1: 2,
    rate_p1_usd: 60,
    days_p2: 0,
    rate_p2_usd: 120,
    subtotal_usd: 120,
    box_share_count: null,
    container: { bl_id: blId },
    invoice: { id: 10, doc_number: doc, status: 'issued', billed_at: billedAt, bl_id: blBase.id, customer: { id: 1, name: 'GES' }, bl: null },
    ...rest,
  }
}

function exposure(overrides: Partial<DemurrageExposureRow>): DemurrageExposureRow {
  return {
    container_id: 1, bl_id: blBase.id, container_number: 'CSGU6728870', type: '45G1', rate_group: '40',
    discharge_date: '2026-09-27', return_date: null, total_days: 37, free_days: 21, free_source: 'tabela', last_free_day: '2026-10-17',
    days_p1: 16, rate_p1_usd: 60, days_p2: 0, rate_p2_usd: 120, usd: 960, state: 'running', covered_by: null, covered_doc: null,
    division: 'correndo', reason: null, anchor_bl_id: blBase.id, customer_id: 1, customer_name: 'GES', voyage_label: 'GREEN ITAQUI / V14',
    ...overrides,
  }
}

describe('planilha de Demurrage do armador (#1139)', () => {
  it('a aba Demurrage tem uma linha por container das Invoices em aberto, com o B/L do próprio container', () => {
    const lines = carrierInvoicedLines([
      item({ doc: 'DEM-11-0002', billedAt: '2026-10-25T12:00:00Z', container_number: 'ZZZU0000001' }),
      item({ doc: 'DEM-10-0001', container_number: 'BBBU0000002', blId: otherBl.id, total_days: 41, days_p1: 15, days_p2: 5, subtotal_usd: 1420 }),
    ], bls)

    expect(lines.map((line) => line.first)).toEqual(['DEM-10-0001', 'DEM-11-0002'])
    expect(lines[0]).toEqual({
      first: 'DEM-10-0001',
      bl: otherBl.id,
      vessel: 'GREEN ITAQUI V14',
      pol: 'TAICANG',
      pod: 'VITORIA',
      cnee: blBase.consignee_block,
      container: 'BBBU0000002',
      type: '45G1',
      discharge: '2026-09-21',
      returned: '2026-10-14',
      useDays: 41,
      excess: 20,
      totalUsd: 1420,
    })
  })

  it('a aba Not Invoiced diz a situação para o armador sem expor o motivo interno', () => {
    expect(carrierPendingStatus({ state: 'running', return_date: null, division: 'correndo' })).toBe('NOT RETURNED (CALCULATED TO DATE)')
    expect(carrierPendingStatus({ state: 'returned_overstay', return_date: '2026-10-20', division: 'correndo' })).toBe('RETURNED - AWAITING OTHER CONTAINERS OF THE B/L')
    expect(carrierPendingStatus({ state: 'returned_overstay', return_date: '2026-10-20', division: 'esperando' })).toBe('RETURNED - AWAITING OTHER CONTAINERS OF THE B/L')
    expect(carrierPendingStatus({ state: 'returned_overstay', return_date: '2026-10-20', division: 'travado' })).toBe('RETURNED - TO BE INVOICED')
    expect(carrierPendingStatus({ state: 'no_rate', return_date: '2026-10-20', division: 'travado' })).toBe('RATE UNDER REVIEW')

    const [running, noRate] = carrierPendingLines([
      exposure({}),
      exposure({ container_number: 'XXXU0000009', state: 'no_rate', usd: null, days_p1: null, days_p2: null, total_days: 30, return_date: '2026-10-20', division: 'travado' }),
    ], bls)
    expect(running).toMatchObject({ returned: null, useDays: 37, excess: 16, totalUsd: 960 })
    // Sem tarifa: sem valor, e o excesso vem de dias menos free time.
    expect(noRate).toMatchObject({ first: 'RATE UNDER REVIEW', excess: 9, totalUsd: null })
  })

  it('CNEE: bloco do manifesto; sem ele, o consignatário do B/L; sem ele, o cadastro do Cliente', () => {
    expect(carrierCneeBlock(blBase)).toBe(blBase.consignee_block)
    expect(carrierCneeBlock({ ...blBase, consignee_block: ' ', consignee: 'ACME LTDA', consignee_phone: '55 11 5555' })).toBe('ACME LTDA\n55 11 5555')
    expect(carrierCneeBlock({ ...blBase, consignee_block: null })).toBe('GES LOGISTICA\nRUA ALCIDES 167\nSAO PAULO-SP 04571-110\nCNPJ 08.092.062/0001-82')
    expect(carrierCneeBlock(undefined)).toBe('')
  })

  it('o arquivo sai no layout do modelo: título, cabeçalho na linha 3, datas e US$ com os formatos do modelo', () => {
    const workbook = buildDemurrageCarrierWorkbook(XLSX, {
      invoiced: carrierInvoicedLines([item({})], bls),
      pending: carrierPendingLines([exposure({ bl_id: blBase.id, container_number: '=HYPERLINK("x")' })], bls),
      positionDate: '2026-11-03',
    })
    const reread = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true })
    expect(reread.SheetNames).toEqual(['Demurrage', 'Not Invoiced'])

    const main = reread.Sheets.Demurrage
    const rows = XLSX.utils.sheet_to_json<unknown[]>(main, { header: 1, blankrows: true, defval: null })
    expect(rows[0][0]).toBe(CARRIER_REPORT_TITLE)
    expect(rows[2]).toEqual(['INVOICE', 'BL', 'VESSEL', 'POL', 'POD', 'CNEE', 'CONTAINER', 'TYPE', 'DISCHARGE', 'RETURN', 'USE DAYS', 'EXCESS', 'TOTAL USD'])
    expect(rows[3].slice(0, 5)).toEqual(['DEM-10-0001', blBase.id, 'GREEN ITAQUI V14', 'NANSHA', 'VITORIA'])
    expect(rows[3].slice(10)).toEqual([23, 2, 120])
    expect(main.I4.v).toBe(excelDateSerial('2026-09-21'))
    expect(main.I4.z).toBe('m/d/yy')
    expect(main.M4.z).toBe('"US$"\\ #,##0.00')
    expect(main['!merges']).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } }])

    const pending = reread.Sheets['Not Invoiced']
    const pendingRows = XLSX.utils.sheet_to_json<unknown[]>(pending, { header: 1, blankrows: true, defval: null })
    expect(pendingRows[1][0]).toContain('posição em 03/11/2026')
    expect(pendingRows[2][0]).toBe('STATUS')
    expect(pendingRows[3][0]).toBe('NOT RETURNED (CALCULATED TO DATE)')
    // Texto vindo do banco não vira fórmula.
    expect(pendingRows[3][6]).toBe('\'=HYPERLINK("x")')
    expect(pending.F4.f).toBeUndefined()
    // Container fora: RETURN em branco, valor até hoje.
    expect(pendingRows[3][9]).toBeNull()
    expect(pendingRows[3][12]).toBe(960)
  })

  it('série do Excel: 30/12/1899 é o dia zero e não depende do fuso', () => {
    expect(excelDateSerial('1899-12-30')).toBe(0)
    expect(excelDateSerial('2026-09-21')).toBe(46286)
  })
})
