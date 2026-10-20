import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  brasiliaEndOfDay,
  brasiliaStartOfDay,
  countsAsIssuedInvoice,
  defaultDemurragePeriod,
  fetchAllPages,
  fetchCustomerReport,
  fetchDemurrageReport,
  fetchFinancialReport,
  fetchOperationalReport,
} from '../reports'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

const NO_SCOPE = { dateFrom: '', dateTo: '', voyageId: '', customerId: '' }
const FINANCIAL = { ...NO_SCOPE, status: '' as const, consolidated: '' as const, balance: '' as const }

type Call = { method: string; args: unknown[] }

// Construtor falso do PostgREST: registra cada filtro e responde a `.range`
// com o pedaço da lista, como o servidor faria (com `count` quando pedido).
function createBuilder(rows: unknown[], options: { error?: unknown; maxRows?: number } = {}) {
  const calls: Call[] = []
  let wantsCount = false
  let range: [number, number] | null = null
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args })
    if (method === 'select' && (args[1] as { count?: string } | undefined)?.count === 'exact') wantsCount = true
    if (method === 'range') range = [args[0] as number, args[1] as number]
    return builder
  }
  const builder: Record<string, unknown> = {
    calls,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      if (options.error) return Promise.resolve({ data: null, error: options.error, count: null }).then(resolve, reject)
      const [from, to] = range ?? [0, rows.length - 1]
      const last = Math.min(to, from + (options.maxRows ?? 1000) - 1)
      const data = rows.slice(from, last + 1)
      return Promise.resolve({ data, error: null, count: wantsCount ? rows.length : null }).then(resolve, reject)
    },
  }
  for (const method of ['select', 'order', 'limit', 'gte', 'lte', 'lt', 'eq', 'neq', 'not', 'in', 'is', 'or', 'filter', 'range', 'overrideTypes']) {
    builder[method] = record(method)
  }
  return builder as { calls: Call[] } & Record<string, unknown>
}

function installReportMocks(input: { bls?: unknown[]; invoices?: unknown[]; links?: unknown[]; demurrage?: unknown[] }) {
  const builders: Record<string, Array<ReturnType<typeof createBuilder>>> = {}
  mockFrom.mockImplementation((table: string) => {
    const rows = {
      bls: input.bls,
      invoices: input.invoices,
      invoice_receivable_links: input.links,
      demurrage_invoices: input.demurrage,
    }[table]
    if (!rows && !['bls', 'invoices', 'invoice_receivable_links', 'demurrage_invoices'].includes(table)) {
      throw new Error(`Tabela nao mockada: ${table}`)
    }
    const builder = createBuilder(rows ?? [])
    ;(builders[table] ??= []).push(builder)
    return builder
  })
  return builders
}

function callsOf(builder: { calls: Call[] }, method: string) {
  return builder.calls.filter((call) => call.method === method).map((call) => call.args)
}

const customerAlfa = { id: 10, name: 'Cliente Alfa', cnpj_cpf: '12345678000195' }
const customerBeta = { id: 20, name: 'Cliente Beta', cnpj_cpf: '98765432000110' }

describe('reports receivable-backed balances', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('deduplica saldo financeiro aberto por receivable mesmo com individual e consolidada', async () => {
    installReportMocks({
      invoices: [
        { id: 1, invoice_number: 'INV-1', invoice_type: 'individual', status: 'issued', total_brl: 100, balance_brl: 100, issued_at: '2026-05-20', created_at: '2026-05-20', customer_id: 10, customer: customerAlfa },
        { id: 2, invoice_number: 'INV-2', invoice_type: 'consolidated', status: 'issued', total_brl: 100, balance_brl: 100, issued_at: '2026-05-21', created_at: '2026-05-21', customer_id: 10, customer: customerAlfa },
        { id: 3, invoice_number: 'GR-1', invoice_type: 'granite', status: 'issued', total_brl: 40, balance_brl: 40, issued_at: '2026-05-22', created_at: '2026-05-22', customer_id: 10, customer: customerAlfa },
      ],
      links: [
        { invoice_id: 1, receivable_id: 99, status: 'active', receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' } },
        { invoice_id: 2, receivable_id: 99, status: 'active', receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' } },
      ],
    })

    const result = await fetchFinancialReport(FINANCIAL)

    expect(result.rows.find((row) => row.id === 1)?.balance_brl).toBe(75)
    expect(result.rows.find((row) => row.id === 2)?.balance_brl).toBe(75)
    expect(result.rows.find((row) => row.id === 3)?.balance_brl).toBe(40)
    expect(result.kpis.totalOpen).toBe(115)
    // O recebível 99 entra uma vez no emitido, não duas (individual + consolidada).
    expect(result.kpis.totalIssued).toBe(140)
    expect(result.accessDenied).toBe(false)
  })

  it('zera saldo exibido de invoice local coberta quando seus links ledger nao estao ativos', async () => {
    installReportMocks({
      invoices: [
        { id: 1, invoice_number: 'INV-1', invoice_type: 'individual', status: 'covered', total_brl: 100, balance_brl: 100, issued_at: '2026-05-20', created_at: '2026-05-20', customer_id: 10, customer: customerAlfa },
      ],
      links: [
        { invoice_id: 1, receivable_id: 99, status: 'settled_elsewhere', receivable: { id: 99, original_amount_brl: 100, balance_brl: 0, status: 'settled' } },
      ],
    })

    const result = await fetchFinancialReport(FINANCIAL)

    expect(result.rows.find((row) => row.id === 1)?.balance_brl).toBe(0)
    expect(result.kpis.totalOpen).toBe(0)
  })

  it('calcula saldo por cliente a partir de receivables unicos e preserva granite como legado', async () => {
    installReportMocks({
      bls: [{ id: 'BL1', customer_id: 10, total_weight_kg: 1000, total_cbm: 20, customer: customerAlfa }],
      invoices: [
        { id: 1, customer_id: 10, invoice_type: 'individual', total_brl: 100, balance_brl: 100, status: 'issued', issued_at: '2026-05-20', customer: customerAlfa },
        { id: 2, customer_id: 10, invoice_type: 'consolidated', total_brl: 100, balance_brl: 100, status: 'issued', issued_at: '2026-05-21', customer: customerAlfa },
        { id: 3, customer_id: 10, invoice_type: 'granite', total_brl: 40, balance_brl: 40, status: 'issued', issued_at: '2026-05-22', customer: customerAlfa },
      ],
      links: [
        { invoice_id: 1, receivable_id: 99, status: 'active', receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' } },
        { invoice_id: 2, receivable_id: 99, status: 'active', receivable: { id: 99, original_amount_brl: 100, balance_brl: 75, status: 'open' } },
      ],
    })

    const result = await fetchCustomerReport(NO_SCOPE)
    const row = result.rows[0]

    expect(row?.invoiceCount).toBe(3)
    expect(row?.totalIssued).toBe(140)
    expect(row?.totalBalance).toBe(115)
  })

  it('sessao expirada e erro da consulta, nao "sem permissao" (R5)', async () => {
    mockFrom.mockImplementation(() => createBuilder([], { error: { code: 'PGRST301', message: 'JWT expired' } }))
    await expect(fetchFinancialReport(FINANCIAL)).rejects.toMatchObject({ code: 'PGRST301' })
  })

  it('falta de permissao vira aviso sem linhas', async () => {
    mockFrom.mockImplementation(() => createBuilder([], { error: { code: '42501', message: 'permission denied for table invoices' } }))
    const result = await fetchFinancialReport(FINANCIAL)
    expect(result.accessDenied).toBe(true)
    expect(result.rows).toEqual([])
  })
})

// R3 (decisão de 2026-10-19): "Por Cliente" e "Financeiro" contam a mesma
// fatura — emitida no período, sem rascunho e sem cancelada.
describe('regra comum de faturas (R3)', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('so conta fatura emitida, sem rascunho e sem cancelada', () => {
    expect(countsAsIssuedInvoice({ status: 'issued', issued_at: '2026-05-01T12:00:00Z' })).toBe(true)
    expect(countsAsIssuedInvoice({ status: 'paid', issued_at: '2026-05-01T12:00:00Z' })).toBe(true)
    expect(countsAsIssuedInvoice({ status: 'covered', issued_at: '2026-05-01T12:00:00Z' })).toBe(true)
    expect(countsAsIssuedInvoice({ status: 'draft', issued_at: '2026-05-01T12:00:00Z' })).toBe(false)
    expect(countsAsIssuedInvoice({ status: 'cancelled', issued_at: '2026-05-01T12:00:00Z' })).toBe(false)
    // A consolidada obsoleta (perdeu a validade quando a individual liquidou) é agrupada como Cancelada.
    expect(countsAsIssuedInvoice({ status: 'obsolete', issued_at: '2026-05-01T12:00:00Z' })).toBe(false)
    expect(countsAsIssuedInvoice({ status: 'issued', issued_at: null })).toBe(false)
  })

  it('Financeiro e Por Cliente chegam ao mesmo emitido, inclusive de Cliente sem B/L no periodo', async () => {
    const invoices = [
      { id: 1, invoice_number: 'F-1', invoice_type: 'granite', status: 'issued', total_brl: 100, balance_brl: 100, issued_at: '2026-05-02T12:00:00Z', created_at: null, customer_id: 10, customer: customerAlfa },
      { id: 2, invoice_number: 'F-2', invoice_type: 'manual', status: 'paid', total_brl: 50, balance_brl: 0, issued_at: '2026-05-03T12:00:00Z', created_at: null, customer_id: 20, customer: customerBeta },
      { id: 3, invoice_number: 'F-3', invoice_type: 'manual', status: 'draft', total_brl: 999, balance_brl: 999, issued_at: '2026-05-04T12:00:00Z', created_at: null, customer_id: 10, customer: customerAlfa },
      { id: 4, invoice_number: 'F-4', invoice_type: 'manual', status: 'cancelled', total_brl: 777, balance_brl: 0, issued_at: '2026-05-05T12:00:00Z', created_at: null, customer_id: 20, customer: customerBeta },
      { id: 5, invoice_number: 'F-5', invoice_type: 'consolidated', status: 'obsolete', total_brl: 300, balance_brl: 300, issued_at: '2026-05-06T12:00:00Z', created_at: null, customer_id: 10, customer: customerAlfa },
    ]
    // Só o Cliente Alfa teve B/L criado no período; a fatura do Beta conta mesmo assim.
    const bls = [{ id: 'BL1', customer_id: 10, total_weight_kg: 1000, total_cbm: 2, customer: customerAlfa }]

    installReportMocks({ invoices, bls })
    const financial = await fetchFinancialReport(FINANCIAL)

    // O servidor recorta rascunho e cancelada na consulta do Por Cliente; o
    // falso devolve só o que passaria pelo filtro.
    installReportMocks({ invoices: invoices.filter(countsAsIssuedInvoice), bls })
    const customers = await fetchCustomerReport(NO_SCOPE)

    expect(financial.kpis.totalIssued).toBe(150)
    expect(financial.kpis.totalInvoices).toBe(2)
    expect(financial.kpis.totalPaid).toBe(50)
    expect(financial.kpis.totalOpen).toBe(100)
    // A cancelada e a consolidada obsoleta.
    expect(financial.kpis.totalCanceled).toBe(2)
    expect(customers.kpis.totalIssued).toBe(financial.kpis.totalIssued)
    expect(customers.rows.reduce((sum, row) => sum + row.invoiceCount, 0)).toBe(financial.kpis.totalInvoices)
    expect(customers.rows.map((row) => row.name)).toEqual(['Cliente Alfa', 'Cliente Beta'])
    expect(customers.kpis.customersWithInvoices).toBe(2)
    expect(customers.kpis.topByBls).toBe('Cliente Alfa')
  })

  it('Por Cliente pede ao banco so a fatura emitida, sem rascunho e sem cancelada', async () => {
    const builders = installReportMocks({})
    await fetchCustomerReport(NO_SCOPE)
    const invoicesQuery = builders.invoices[0]
    expect(callsOf(invoicesQuery, 'not')).toEqual(expect.arrayContaining([
      ['issued_at', 'is', null],
      ['status', 'in', '(draft,cancelled,obsolete)'],
    ]))
  })

  it('sem nenhum dado, os cartoes de topo ficam vazios em vez de "-"', async () => {
    installReportMocks({})
    const result = await fetchCustomerReport(NO_SCOPE)
    expect(result.kpis.topByBls).toBeNull()
    expect(result.kpis.topByInvoiced).toBeNull()
  })
})

// R2: o servidor entrega no máximo 1.000 linhas por consulta.
describe('leitura em paginas ate o fim (R2)', () => {
  const rows = Array.from({ length: 2500 }, (_, index) => ({ id: index + 1 }))

  function fakeServer(maxRows: number) {
    const requested: Array<[number, number]> = []
    const fetchPage = async (from: number, to: number) => {
      requested.push([from, to])
      const last = Math.min(to, from + maxRows - 1)
      return { data: rows.slice(from, last + 1), error: null, count: from === 0 ? rows.length : null }
    }
    return { requested, fetchPage }
  }

  it('le as 2.500 linhas em tres paginas de 1.000', async () => {
    const server = fakeServer(1000)
    const result = await fetchAllPages(server.fetchPage)
    expect(result.rows).toHaveLength(2500)
    expect(result.rows.at(-1)).toEqual({ id: 2500 })
    expect(result.load).toEqual({ loaded: 2500, total: 2500 })
    expect(server.requested).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('servidor com teto menor que a pagina nao pula linhas', async () => {
    const server = fakeServer(400)
    const result = await fetchAllPages(server.fetchPage)
    expect(result.rows.map((row) => row.id)).toEqual(rows.map((row) => row.id))
  })

  it('para no teto da tela e informa quantas linhas faltam', async () => {
    const server = fakeServer(1000)
    const result = await fetchAllPages(server.fetchPage, { ceiling: 1500 })
    expect(result.rows).toHaveLength(1500)
    expect(result.load).toEqual({ loaded: 1500, total: 2500 })
    expect(server.requested).toEqual([[0, 999], [1000, 1499]])
  })

  it('propaga o erro da consulta', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('falhou'), count: null }))).rejects.toThrow('falhou')
  })

  it('o relatorio operacional pede a contagem, ordena de forma estavel e le todas as paginas', async () => {
    const bls = Array.from({ length: 1200 }, (_, index) => ({ id: `BL${index}`, voyage_id: 1, bl_containers: [] }))
    const builders = installReportMocks({ bls })
    const result = await fetchOperationalReport({ ...NO_SCOPE, pol: '', pod: '', cargoMode: '', review: '', localCharges: '' })
    expect(result.rows).toHaveLength(1200)
    expect(result.load).toEqual({ loaded: 1200, total: 1200 })
    expect(builders.bls).toHaveLength(2)
    expect(callsOf(builders.bls[0], 'select')[0][1]).toEqual({ count: 'exact' })
    expect(callsOf(builders.bls[0], 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ])
    expect(callsOf(builders.bls[1], 'range')).toEqual([[1000, 1999]])
  })
})

// R4: o dia do filtro é o de Brasília, não o de UTC.
describe('recorte de periodo em horario de Brasilia (R4)', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('corta o dia em -03:00', () => {
    expect(brasiliaStartOfDay('2026-05-01')).toBe('2026-05-01T00:00:00-03:00')
    expect(brasiliaEndOfDay('2026-05-31')).toBe('2026-05-31T23:59:59.999-03:00')
    // 31/05 às 23h em Brasília é 01/06 02h em UTC e ainda está dentro do período.
    expect(new Date('2026-06-01T02:00:00Z') <= new Date(brasiliaEndOfDay('2026-05-31'))).toBe(true)
    expect(new Date('2026-05-01T02:59:00Z') < new Date(brasiliaStartOfDay('2026-05-01'))).toBe(true)
  })

  it('aplica -03:00 nas consultas de B/L e de fatura', async () => {
    const builders = installReportMocks({})
    await fetchFinancialReport({ ...FINANCIAL, dateFrom: '2026-05-01', dateTo: '2026-05-31' })
    expect(callsOf(builders.invoices[0], 'gte')).toEqual([['issued_at', '2026-05-01T00:00:00-03:00']])
    expect(callsOf(builders.invoices[0], 'lte')).toEqual([['issued_at', '2026-05-31T23:59:59.999-03:00']])

    await fetchCustomerReport({ ...NO_SCOPE, dateFrom: '2026-05-01', dateTo: '2026-05-31' })
    expect(callsOf(builders.bls[0], 'lte')).toEqual([['created_at', '2026-05-31T23:59:59.999-03:00']])
    expect(callsOf(builders.invoices[1], 'lte')).toEqual([['issued_at', '2026-05-31T23:59:59.999-03:00']])
  })

  it('o ano e o hoje do Demurrage sao os de Brasilia', () => {
    // 01/01/2026 01h UTC ainda é 31/12/2025 em Brasília.
    expect(defaultDemurragePeriod(new Date('2026-01-01T01:00:00Z'))).toEqual({ dateFrom: '2025-01-01', dateTo: '2025-12-31' })
    expect(defaultDemurragePeriod(new Date('2026-10-19T15:00:00Z'))).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-10-19' })
  })

  it('"Vencidas" no Demurrage compara o vencimento com o hoje de Brasilia', async () => {
    const builders = installReportMocks({ demurrage: [] })
    await fetchDemurrageReport({ ...NO_SCOPE, status: '', dispute: '', overdue: 'sim' }, { today: '2026-10-19' })
    expect(callsOf(builders.demurrage_invoices[0], 'lt')).toEqual([['due_date', '2026-10-19']])
    expect(callsOf(builders.demurrage_invoices[0], 'in')).toEqual([['status', ['issued', 'overdue']]])
  })
})
