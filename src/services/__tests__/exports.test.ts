import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerExportEmails, exportCustomerBaseWorkbook, exportInvoicesWorkbook, exportLocalChargeConferenceWorkbook, exportPortalLocalInvoicesWorkbook, exportVaziosImportacaoWorkbook } from '../exports'
import type { InvoiceListRow } from '../billing'
import type { PortalInvoiceSummary } from '../portalBilling'
import type { VaziosImportacaoContainerListItem } from '../../types/database'

const { jsonToSheet, bookAppendSheet, writeFile } = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: unknown[]) => ({ rows })),
  bookAppendSheet: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@e965/xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({ Sheets: {} })),
    json_to_sheet: jsonToSheet,
    book_append_sheet: bookAppendSheet,
  },
  writeFile,
}))

describe('exportVaziosImportacaoWorkbook', () => {
  beforeEach(() => {
    jsonToSheet.mockClear()
    bookAppendSheet.mockClear()
    writeFile.mockClear()
  })

  it('exporta colunas operacionais dos vazios de importacao', async () => {
    const rows: VaziosImportacaoContainerListItem[] = [
      {
        id: '1',
        manifest_id: 'm1',
        container_number: 'ABCD1234567',
        container_type: '40HC',
        tare_kg: 3800,
        pol: 'CNTAC',
        pod: 'SSZ',
        natureza: null,
        created_at: '2026-06-01T10:00:00Z',
        manifest: {
          id: 'm1',
          voyage_id: 10,
          description: 'Baplie',
          imported_at: '2026-06-01T10:00:00Z',
          voyage: {
            voyage_number: '001',
            vessel: { name: 'NAVIO A' },
          },
        },
      },
    ]

    await exportVaziosImportacaoWorkbook(rows)

    expect(jsonToSheet).toHaveBeenCalledWith([
      {
        Container: 'ABCD1234567',
        Tipo: '40HC',
        'Tara (kg)': 3800,
        POL: 'CNTAC',
        POD: 'SSZ',
        Navio: 'NAVIO A',
        Viagem: '001',
        Manifesto: 'Baplie',
        'Importado em': '01/06/2026',
      },
    ])
    expect(bookAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'VaziosImportacao')
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^vazios-importacao-\d+\.xlsx$/))
  })
})

describe('exportLocalChargeConferenceWorkbook', () => {
  it('preserva o escopo e exporta as colunas da conferência em xlsx', async () => {
    await exportLocalChargeConferenceWorkbook([{
      bl_id: 'BL-1', customer_name: 'Cliente', pod: 'BRSSA', charge_name: 'THD', application_basis: 'bl', quantity: 1,
      unit_value_brl: 10, total_value_brl: 10, price_origin: 'Tabela padrão', shared_containers: '',
    }], '1 B/L selecionado')
    expect(jsonToSheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ Escopo: '1 B/L selecionado' }), expect.objectContaining({ 'B/L': 'BL-1' })]))
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^conferencia-taxas-locais-\d+\.xlsx$/))
  })
})

describe('exportInvoicesWorkbook', () => {
  it('exporta fatura avulsa sem B/L como tipo próprio', async () => {
    const row = {
      id: 3,
      invoice_number: 'INV-AV-003',
      customer_id: 1,
      bl_id: null,
      issued_at: '2026-06-01T10:00:00Z',
      total_brl: 150,
      status: 'issued',
      invoice_type: 'manual',
      total_paid_brl: 0,
      balance_brl: 150,
      created_at: '2026-06-01T10:00:00Z',
      voyage_id: 42,
      voyage: { id: 42, voyage_number: '42N', vessel: { name: 'Navio Manual' } },
      customer: { id: 1, name: 'Cliente', cnpj_cpf: '123' },
      invoice_bls: [],
      invoice_receivable_links: [],
      payments: [],
    } as InvoiceListRow

    await exportInvoicesWorkbook([row])

    expect(jsonToSheet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Tipo: 'Avulsa', QtdBLs: 0, Navio: 'Navio Manual', Viagem: '42N' }),
    ]))
  })
})

describe('exportPortalLocalInvoicesWorkbook', () => {
  it('exporta fatura avulsa do Portal sem B/L como Avulsa', async () => {
    const row: PortalInvoiceSummary = {
      id: 3,
      invoice_number: 'INV-AV-003',
      issued_at: '2026-06-03',
      total_brl: 75,
      total_paid_brl: 0,
      balance_brl: 75,
      status: 'issued',
      invoice_type: 'manual',
      vessels: ['NAVIO MANUAL'],
      voyages: ['42N'],
      vessel_voyages: ['NAVIO MANUAL / 42N'],
      bls: [],
      pods: [],
    }

    await exportPortalLocalInvoicesWorkbook([row])

    expect(jsonToSheet).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ Tipo: 'Avulsa', 'B/L': '', 'Navio/Viagem': 'NAVIO MANUAL / 42N' }),
    ]))
  })
})

describe('exportCustomerBaseWorkbook', () => {
  it('preenche Email com os e-mails ativos, o principal primeiro, como a importação lê', async () => {
    const contacts = [
      { id: 1, email: 'ops@acme.com', is_primary: false, deactivated_at: null },
      { id: 2, email: 'fin@acme.com ', is_primary: true, deactivated_at: null },
      { id: 3, email: 'antigo@acme.com', is_primary: false, deactivated_at: '2026-01-01' },
      { id: 4, email: '', is_primary: false, deactivated_at: null },
    ] as never
    expect(customerExportEmails(contacts)).toBe('fin@acme.com; ops@acme.com')
    expect(customerExportEmails(null)).toBe('')

    jsonToSheet.mockClear()
    await exportCustomerBaseWorkbook([{ id: 1, cnpj_cpf: '12345678000195', name: 'ACME', customer_contacts: contacts }] as never)
    expect(jsonToSheet.mock.calls[0][0][0]).toMatchObject({ CNPJ: '12345678000195', Email: 'fin@acme.com; ops@acme.com' })
  })
})
