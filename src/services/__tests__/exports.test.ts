import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerExportEmails, exportCustomerBaseWorkbook, exportCustomerContainersWorkbook, exportFinancialReportWorkbook,
  exportDemurrageReportWorkbook, exportInvoicesWorkbook, exportOperationalReportWorkbook, exportPortalBlsWorkbook, exportPortalContainersWorkbook, exportPortalLocalInvoicesWorkbook, exportVaziosImportacaoWorkbook, ceUnlockWorkbookRows } from '../exports'
import type { WorkbookSpec } from '../exportWorkbook'
import type { PortalOperationBL } from '../portalOperation'
import { flattenContainers } from '../../lib/portalOperationViews'
import type { InvoiceListRow } from '../billing'
import type { PortalInvoiceSummary } from '../portalBilling'
import type { VaziosImportacaoContainerListItem } from '../../types/database'
import type { CeUnlockItem } from '../../types/ceUnlock'

// As linhas de cada tela são o contrato testado aqui; a aparência é do
// `writeWorkbook`, coberto em exportWorkbook.test.ts contra o exceljs real.
const { writeWorkbook } = vi.hoisted(() => ({ writeWorkbook: vi.fn<(spec: unknown) => Promise<void>>(async () => {}) }))

vi.mock('../exportWorkbook', () => ({ writeWorkbook, exportTimestamp: () => '202611031432' }))

const spec = (call = 0) => writeWorkbook.mock.calls[call][0] as unknown as WorkbookSpec
const sheetRows = (sheetIndex = 0, call = 0) => spec(call).sheets[sheetIndex].rows

beforeEach(() => { writeWorkbook.mockClear() })

describe('exportVaziosImportacaoWorkbook', () => {
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

    expect(sheetRows()).toEqual([
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
        // Data como está no banco: vira data de verdade na célula (ADR 0120).
        'Importado em': '2026-06-01T10:00:00Z',
      },
    ])
    expect(spec().sheets[0].name).toBe('VaziosImportacao')
    expect(spec().product).toBe('vela')
    expect(spec().fileName).toMatch(/^vazios-importacao-\d+\.xlsx$/)
  })
})

describe('exportInvoicesWorkbook', () => {
  it('exporta fatura avulsa sem B/L como tipo próprio, com rótulos em português', async () => {
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

    expect(sheetRows()).toEqual([
      expect.objectContaining({ Tipo: 'Avulsa', 'Qtd. B/Ls': 0, Navio: 'Navio Manual', Viagem: '42N', Emissão: '2026-06-01T10:00:00Z', Pagamento: '', 'Total (R$)': 150, 'Saldo (R$)': 150, Situação: 'Emitida' }),
    ])
    expect(Object.keys(sheetRows()[0])).not.toEqual(expect.arrayContaining(['TotalBRL', 'QtdBLs', 'Emissao', 'DataPagamento']))
    expect(spec().sheets.map((sheet) => sheet.name)).toEqual(['Faturas', 'BLs'])
    // Uma linha por B/L repete o total da fatura: a aba BLs não soma.
    expect(spec().sheets[1].totals).toBe(false)
  })
})

describe('exportPortalLocalInvoicesWorkbook', () => {
  it('exporta fatura avulsa do Portal sem B/L como Avulsa, no produto Portal', async () => {
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

    expect(sheetRows()).toEqual([
      expect.objectContaining({ Tipo: 'Avulsa', 'B/L': '', 'Navio/Viagem': 'NAVIO MANUAL / 42N', 'Total (R$)': 75 }),
    ])
    expect(spec().product).toBe('portal')
  })
})

describe('planilhas de BLs e Containers do Portal', () => {
  const bl = (bl_id: string, local_charges: PortalOperationBL['local_charges']): PortalOperationBL => ({
    bl_id, ce_mercante: '152609130000101', pol: 'CNSHA', pod: 'BRSSA', voyage_id: 1, voyage_number: '021W', vessel_name: 'NORDIC STAR',
    container_count: 1, containers_in_demurrage: 0, containers_returned: 0, local_charges,
    containers: [{ id: 1, container_number: `CSNU${bl_id}`, type: '40HC', discharge_date: '2026-09-22', return_date: null, usage_days: 12, free_time_days: 21, demurrage_days: 0, status: 'dentro_free_time' }],
  })

  it('acrescenta Taxas locais e Pagamento com a regra da tela', async () => {
    await exportPortalBlsWorkbook([
      bl('ABERTO', { status: 'open', total_brl: 4804, balance_brl: 1202 }),
      bl('PAGO', { status: 'paid', total_brl: 2702, balance_brl: 0 }),
      bl('SEM-FATURA', { status: 'awaiting_invoice', total_brl: null, balance_brl: null }),
      bl('NADA', { status: 'none', total_brl: null, balance_brl: null }),
    ])
    const sheet = sheetRows()
    expect(sheet.map((row) => [row['Taxas locais'], row.Pagamento])).toEqual([
      [4804, expect.stringMatching(/^R\$\s1\.202,00 em aberto$/)],
      [2702, 'Pago'],
      ['', 'Aguardando fatura'],
      ['', ''],
    ])
    expect(sheet[0]).toMatchObject({ 'B/L': 'ABERTO', 'CE Mercante': '152609130000101', Navio: 'NORDIC STAR', Viagem: '021W', POL: 'CNSHA', POD: 'BRSSA' })
    expect(spec().sheets[0].types).toMatchObject({ 'Taxas locais': 'brl', Pagamento: 'status' })
  })

  it('leva os devolvidos com demurrage, a mesma conta da coluna Demurrage da tela', async () => {
    const returnedLate = { ...bl('LATE', { status: 'none', total_brl: null, balance_brl: null }) }
    returnedLate.containers = [{ ...returnedLate.containers[0], return_date: '2026-10-20', usage_days: 28, demurrage_days: 7, status: 'devolvido' }]
    await exportPortalBlsWorkbook([returnedLate, bl('NO-PRAZO', { status: 'none', total_brl: null, balance_brl: null })])
    expect(sheetRows().map((row) => row['Devolvidos com demurrage'])).toEqual([1, 0])
  })

  it('mantém CE Mercante, Navio, Viagem e POL na planilha de Containers', async () => {
    await exportPortalContainersWorkbook(flattenContainers([bl('BL1', { status: 'none', total_brl: null, balance_brl: null })]))
    expect(sheetRows()).toEqual([
      expect.objectContaining({ Container: 'CSNUBL1', 'CE Mercante': '152609130000101', Navio: 'NORDIC STAR', Viagem: '021W', POL: 'CNSHA', POD: 'BRSSA', Descarga: '2026-09-22', Devolução: '' }),
    ])
  })
})

describe('exportCustomerBaseWorkbook', () => {
  it('preenche Email com os e-mails ativos, o principal primeiro, como a importação lê, e sai plana para reimportar', async () => {
    const contacts = [
      { id: 1, email: 'ops@acme.com', is_primary: false, deactivated_at: null },
      { id: 2, email: 'fin@acme.com ', is_primary: true, deactivated_at: null },
      { id: 3, email: 'antigo@acme.com', is_primary: false, deactivated_at: '2026-01-01' },
      { id: 4, email: '', is_primary: false, deactivated_at: null },
    ] as never
    expect(customerExportEmails(contacts)).toBe('fin@acme.com; ops@acme.com')
    expect(customerExportEmails(null)).toBe('')

    await exportCustomerBaseWorkbook([{ id: 1, cnpj_cpf: '12345678000195', name: 'ACME', customer_contacts: contacts }] as never)
    expect(sheetRows()[0]).toMatchObject({ CNPJ: '12345678000195', 'Razao Social': 'ACME', Email: 'fin@acme.com; ops@acme.com' })
    expect(spec().sheets[0].plain).toBe(true)
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
    expect(Object.keys(sheet)).toEqual(['B/L', 'Cliente', 'CNPJ', 'Navio / Viagem', 'Trecho', 'Modo de carga', 'Motivo', 'Detalhe do motivo', 'Último cálculo', 'Subtotal', 'Container compartilhado', 'Taxas alteradas à mão', 'Lacre', 'THC', 'BL Fee (US$)'])
    expect(sheet).toMatchObject({ 'Navio / Viagem': 'ARIES / 088E', Motivo: 'Pronto para emitir', THC: 2000, 'BL Fee (US$)': 60, 'Container compartilhado': 'CSNU1 (2 B/Ls)', 'Taxas alteradas à mão': '', 'Último cálculo': '2026-10-13T10:00:00Z' })
  })

  it('coluna Taxas alteradas à mão com a frase da spec (ADR 0111)', async () => {
    const { buildValidacaoSheetRows } = await import('../exports')
    const row = {
      id: 'BL-2', totals: { total_brl: 1200, total_usd: 0, line_count: 2, review_required_count: 0 },
      adjustments: {
        bl_id: 'BL-2', manual_exempt: true, items: [
          { charge_name: 'THD', excluded: false, kind: 'unit', currency: 'BRL', application_basis: 'container_distinct_voyage', table_unit: 1420, unit: 1200 },
          { charge_name: 'Taxa X', excluded: true, kind: 'excluded', currency: 'BRL', application_basis: 'bl' },
        ],
      },
    } as never
    const [sheet] = buildValidacaoSheetRows([{ row, block: { label: 'Isento', detail: '' } }], { totals: new Map(), sharedContainers: new Map() })
    expect(String(sheet['Taxas alteradas à mão']).replace(/\u00a0/g, ' ')).toBe('THD: R$ 1.420,00 → R$ 1.200,00 por container; Taxa X: excluída; Isento à mão')
  })

  it('toda coluna de taxa é declarada como dinheiro: "(US$)" em dólar, o resto em real', async () => {
    const { exportValidacaoWorkbook } = await import('../exports')
    const row = {
      id: 'BL-1', cargo_mode: 'container', pol: 'CNSHA', pod: 'BRSSZ', charges_calculated_at: null, customer: null, voyage: null,
      totals: { total_brl: 2060, total_usd: 60, line_count: 2, review_required_count: 0 },
    } as never
    const totals = new Map([['BL-1', new Map([['+THC', { brl: 2000, usd: 0, currency: 'BRL' }], ['BL Fee', { brl: 0, usd: 60, currency: 'USD' }]])]])
    await exportValidacaoWorkbook([{ row, block: { label: 'Pronto para emitir', detail: '' } }], { totals, sharedContainers: new Map() })
    expect(spec().sheets[0].types).toMatchObject({ '+THC': 'brl', 'BL Fee (US$)': 'usd', Subtotal: 'brl', Motivo: 'status' })
    expect(spec().fileName).toMatch(/^validacao-taxas-locais-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})

// Achado 2: a planilha do relatório fala como a tela, sem código cru.
describe('planilhas de Relatórios', () => {
  it('Operacional traz Revisão e Taxas locais com os rótulos da tela, a data como veio e os filtros na faixa e na aba', async () => {
    await exportOperationalReportWorkbook([
      {
        id: 'BL1', pol: 'CNSHA', pod: 'BRSSZ', cargo_mode: 'container', review_status: 'pending_review', financial_status: 'invoiced',
        charge_status: 'ready_for_billing', cancelled_at: null, total_weight_kg: 1000, bb_weight_ton: null, total_cbm: 5, bb_cbm: null,
        created_at: '2026-05-10', voyage_id: 1, customer: null, voyage: null, bl_containers: [],
      },
      {
        id: 'BL2', pol: null, pod: null, cargo_mode: 'container', review_status: null, financial_status: 'paid',
        charge_status: 'ready_for_billing', cancelled_at: null, total_weight_kg: 0, bb_weight_ton: null, total_cbm: 0, bb_cbm: null,
        created_at: null, voyage_id: null, customer: null, voyage: null, bl_containers: [],
      },
    ], [{ Filtro: 'Revisão', Valor: 'Pendente' }])

    const rows = sheetRows()
    expect(rows[0]).toMatchObject({ Revisão: 'Pendente', 'Taxas locais': 'Emitida', 'Criação do B/L': '2026-05-10' })
    expect(rows[1]).toMatchObject({ Revisão: 'Em ordem', 'Taxas locais': 'Paga', 'Criação do B/L': '' })
    expect(JSON.stringify(rows)).not.toMatch(/pending_review|invoiced/)
    expect(rows[0]).not.toHaveProperty('Financeiro')
    expect(spec().sheets[1]).toMatchObject({ name: 'Filtros', plain: true, rows: [{ Filtro: 'Revisão', Valor: 'Pendente' }] })
    expect(spec().filters).toEqual(['Revisão = Pendente'])
  })

  it('Financeiro traz Emissão como veio e Situação com o rótulo', async () => {
    await exportFinancialReportWorkbook([
      { id: 1, invoice_number: 'F-1', invoice_type: 'individual', status: 'covered', total_brl: 10, balance_brl: 0, issued_at: '2026-05-02', created_at: null, customer_id: 1, customer: null },
    ])

    expect(sheetRows()[0]).toMatchObject({ Emissão: '2026-05-02', Situação: 'Coberta' })
    expect(sheetRows()[0]).not.toHaveProperty('Status')
    expect(spec().sheets[1].rows).toEqual([{ Filtro: 'Filtros', Valor: 'Nenhum' }])
  })

  it('Demurrage sai com uma aba por recorte, mais Filtros, com os rótulos da tela (D14)', async () => {
    await exportDemurrageReportWorkbook({
      exposure: [{ division: 'correndo', reason: null, customer_name: 'Cliente', voyage_label: 'NAVIO / 1', bl_id: 'BL1', container_number: 'MSCU1', type: '40HC', discharge_date: '2026-09-01', return_date: null, total_days: 40, free_days: 21, usd: 1140, state: 'running' } as never],
      invoices: [{ id: 1, doc_number: 'DEM-2026-0001', bl_id: 'BL1', billed_at: '2026-10-26T12:00:00Z', total_usd: 100, current_total_brl: 540, status: 'issued', net_usd: 100, discount_usd: 0, kind: { label: 'Normal', doc: null }, customer: { id: 1, name: 'Cliente', cnpj_cpf: '1' } } as never],
      items: [],
    }, [{ Filtro: 'Recorte', Valor: 'Invoices' }])
    expect(spec().sheets.map((sheet) => sheet.name)).toEqual(['Exposição', 'Invoices', 'Itens por container', 'Filtros'])
    expect(sheetRows(0)[0]).toMatchObject({ Divisão: 'Correndo', Devolução: 'Fora', 'US$ previsto': 1140 })
    expect(Object.keys(sheetRows(1)[0])).toEqual(['Invoice', 'Tipo', 'B/L', 'Navio / Viagem', 'Cliente', 'CNPJ', 'Emissão', 'USD líquido', 'Desconto US$', 'R$ hoje', 'R$ pago', 'Paga em', 'Disputa', 'Situação'])
    expect(sheetRows(1)[0]).toMatchObject({ Emissão: '2026-10-26T12:00:00Z', 'R$ hoje': 540, 'R$ pago': '', Situação: 'Faturado' })
  })
})

// ADR 0112, D24: a planilha da aba Containers da ficha do Cliente diz o mesmo que a tela.
describe('exportCustomerContainersWorkbook', () => {
  it('a caixa com a cobrança dispensada sai sem US$ e como "Cobrança dispensada"', async () => {
    const row = { id: 1, bl_id: 'BL-1', container_number: 'MSCU1234565', type: '40HC', ownership: 'COC', discharge_date: '2026-09-01', return_date: '2026-09-28', bl: null } as never
    await exportCustomerContainersWorkbook('ACME', [
      { row, view: { soc: false, days: 27, freeTimeDays: 21, freeTimeSourceLabel: 'tabela', overFreeTime: true, demurrage: { kind: 'waived' } } },
      { row, view: { soc: false, days: 27, freeTimeDays: 21, freeTimeSourceLabel: 'tabela', overFreeTime: true, demurrage: { kind: 'to_bill', usd: 420 } } },
      { row, view: { soc: false, days: 43, freeTimeDays: 21, freeTimeSourceLabel: 'tabela', overFreeTime: true, demurrage: { kind: 'running', usd: 2450 } } },
    ])
    const rows = sheetRows()
    expect(rows[0]).toMatchObject({ Demurrage: 'Cobrança dispensada', 'Demurrage (US$)': '' })
    // Decisão de 2026-11-03: "a emitir" e "correndo", como a aba na tela.
    expect(rows[1]).toMatchObject({ Demurrage: 'A emitir', 'Demurrage (US$)': 420 })
    expect(rows[2]).toMatchObject({ Demurrage: 'Correndo', 'Demurrage (US$)': 2450 })
    expect(spec().fileName).toMatch(/^conteineres-acme-\d+\.xlsx$/)
  })
})

// Migration 590 (pedido do dono de 2026-11-04): requisito atendido mostra quando se cumpriu.
describe('ceUnlockWorkbookRows', () => {
  const base = {
    bl_id: 'BL-1', ce_mercante: '123', customer_id: 1, customer_name: 'Cliente', cnpj_cpf: '1', voyage_id: 1, voyage_number: '001',
    vessel_name: 'Navio', pod: 'BRSSZ', request_id: 'r1', protocol: 'CE-0001', state: 'in_review', version: 1, vip: false,
    termo: true, procuracao: false, paid: true, delivered: true, can_submit: false, can_export: false, confirmed: false,
    reasons: [], source: 'request', delivery_version: 1,
  } as CeUnlockItem
  const dates = new Map([['BL-1', {
    bl_id: 'BL-1', termo_at: '2026-11-02T13:15:00Z', procuracao_at: null, paid_at: '2026-11-03T17:45:00Z', delivered_at: '2026-11-03T19:20:00Z',
  }]])

  it('atendido vira data e hora de Brasília; pendente continua "Pendente"', () => {
    const [row] = ceUnlockWorkbookRows([base], dates)
    expect(row['Termo de devolução']).toBe('02/11/2026 10:15')
    expect(row.Procuração).toBe('Pendente')
    expect(row['Taxas locais']).toBe('03/11/2026 14:45')
    expect(row['B/L original']).toBe('03/11/2026 16:20')
  })

  it('sem a data na fonte diz "Atendido"; isentas, dispensados e anual VIP dizem o que são', () => {
    expect(ceUnlockWorkbookRows([base])[0]['Termo de devolução']).toBe('Atendido')
    const exempt = ceUnlockWorkbookRows([{ ...base, paid_exempt: true }], dates)[0]
    expect(exempt['Taxas locais']).toBe('Isentas')
    const lcl = ceUnlockWorkbookRows([{ ...base, documents_dispensed: true }], dates)[0]
    expect([lcl['Termo de devolução'], lcl.Procuração]).toEqual(['Dispensado', 'Dispensada'])
    const vip = ceUnlockWorkbookRows([{ ...base, request_id: null, protocol: null, vip: true, vip_covered: true }], dates)[0]
    expect(vip['Termo de devolução']).toBe('02/11/2026 10:15 · anual VIP')
  })
})
