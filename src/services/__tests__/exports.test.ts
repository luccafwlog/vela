import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerExportEmails, exportCustomerBaseWorkbook, exportInvoicesWorkbook, exportPortalBlsWorkbook, exportPortalContainersWorkbook, exportPortalLocalInvoicesWorkbook, exportVaziosImportacaoWorkbook } from '../exports'
import type { PortalOperationBL } from '../portalOperation'
import { flattenContainers } from '../../lib/portalOperationViews'
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

  it('exporta colunas operacionais dos vazios de importação, com a Natureza e o Nº do manifesto', async () => {
    const rows: Array<VaziosImportacaoContainerListItem & { manifesto_numero?: string | null }> = [
      {
        id: '1',
        manifest_id: 'm1',
        container_number: 'ABCD1234567',
        container_type: '40HC',
        tare_kg: 3800,
        pol: 'CNTAC',
        pod: 'SSZ',
        natureza: 'cover_plate',
        created_at: '2026-06-01T10:00:00Z',
        manifesto_numero: '2626501234568',
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
        Natureza: 'Cover plate',
        Navio: 'NAVIO A',
        Viagem: '001',
        'Manifesto Mercante': '2626501234568',
        'Importado em': '01/06/2026',
      },
    ])
    expect(bookAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'VaziosImportacao')
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^vazios-importacao-\d+\.xlsx$/))
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

describe('planilhas de BLs e Containers do Portal', () => {
  const bl = (bl_id: string, local_charges: PortalOperationBL['local_charges']): PortalOperationBL => ({
    bl_id, ce_mercante: '152609130000101', pol: 'CNSHA', pod: 'BRSSA', voyage_id: 1, voyage_number: '021W', vessel_name: 'NORDIC STAR',
    container_count: 1, containers_in_demurrage: 0, containers_returned: 0, local_charges,
    containers: [{ id: 1, container_number: `CSNU${bl_id}`, type: '40HC', discharge_date: '2026-09-22', return_date: null, usage_days: 12, free_time_days: 21, demurrage_days: 0, status: 'dentro_free_time' }],
  })

  beforeEach(() => { jsonToSheet.mockClear() })

  it('acrescenta Taxas locais e Pagamento com a regra da tela', async () => {
    await exportPortalBlsWorkbook([
      bl('ABERTO', { status: 'open', total_brl: 4804, balance_brl: 1202 }),
      bl('PAGO', { status: 'paid', total_brl: 2702, balance_brl: 0 }),
      bl('SEM-FATURA', { status: 'awaiting_invoice', total_brl: null, balance_brl: null }),
      bl('NADA', { status: 'none', total_brl: null, balance_brl: null }),
    ])
    const sheet = jsonToSheet.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(sheet.map((row) => [row['Taxas locais'], row.Pagamento])).toEqual([
      [4804, expect.stringMatching(/^R\$\s1\.202,00 em aberto$/)],
      [2702, 'Pago'],
      ['', 'Aguardando fatura'],
      ['', ''],
    ])
    expect(sheet[0]).toMatchObject({ 'B/L': 'ABERTO', 'CE Mercante': '152609130000101', Navio: 'NORDIC STAR', Viagem: '021W', POL: 'CNSHA', POD: 'BRSSA' })
  })

  it('mantém CE Mercante, Navio, Viagem e POL na planilha de Containers', async () => {
    await exportPortalContainersWorkbook(flattenContainers([bl('BL1', { status: 'none', total_brl: null, balance_brl: null })]))
    expect(jsonToSheet.mock.calls[0][0]).toEqual([
      expect.objectContaining({ Container: 'CSNUBL1', 'CE Mercante': '152609130000101', Navio: 'NORDIC STAR', Viagem: '021W', POL: 'CNSHA', POD: 'BRSSA' }),
    ])
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

describe('exportação da Validação (planilha única)', () => {
  it('uma linha por B/L, colunas fixas em português e uma coluna por taxa; US$ em coluna própria', async () => {
    const { buildValidacaoSheetRows } = await import('../exports')
    const row = {
      id: 'BL-1', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSZ', charges_calculated_at: '2026-10-13T10:00:00Z',
      customer: { id: 1, name: 'Cliente', cnpj_cpf: '1' }, voyage: { id: 1, voyage_number: '088E', vessel: { name: 'ARIES' } },
      totals: { total_brl: 2870, total_usd: 0, line_count: 3, review_required_count: 0 },
    } as never
    const totals = new Map([
      ['BL-1', new Map([
        ['THC', { brl: 2000, usd: 0, currency: 'BRL' }],
        ['Lacre', { brl: 350, usd: 0, currency: 'BRL' }],
        ['BL Fee', { brl: 0, usd: 60, currency: 'USD' }],
      ])],
    ])
    const [sheet] = buildValidacaoSheetRows([{ row, block: { label: 'Pronto para emitir', detail: 'Tudo certo.' } }], { totals, sharedContainers: new Map([['BL-1', 'CSNU1 (2 B/Ls)']]) })
    expect(Object.keys(sheet)).toEqual(['B/L', 'Cliente', 'CNPJ', 'Navio / Viagem', 'Trecho', 'Modo de carga', 'Motivo', 'Detalhe do motivo', 'Último cálculo', 'Subtotal', 'Contêiner compartilhado', 'Lacre', 'THC', 'BL Fee (US$)'])
    expect(sheet).toMatchObject({ 'Navio / Viagem': 'ARIES / 088E', Motivo: 'Pronto para emitir', THC: 2000, 'BL Fee (US$)': 60, 'Contêiner compartilhado': 'CSNU1 (2 B/Ls)' })
  })
})
