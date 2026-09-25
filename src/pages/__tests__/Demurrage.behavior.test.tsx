// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  confirm: vi.fn(),
  listContainers: vi.fn(),
  updateContainerDates: vi.fn(),
  createInvoice: vi.fn(),
  listInvoices: vi.fn(),
  getInvoiceDetail: vi.fn(),
  markPaid: vi.fn(),
  cancelInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  applyDiscount: vi.fn(),
  fetchKpis: vi.fn(),
  fetchLatestRecalcDate: vi.fn(),
  fetchCustomerSummary: vi.fn(),
  fetchCustomerDetail: vi.fn(),
  fetchRoe: vi.fn(),
  recalculateManual: vi.fn(),
  reversePayment: vi.fn(),
  print: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../services/demurrage/demurrageContainers', () => ({
  listDemurrageContainers: mocks.listContainers,
  updateContainerDates: mocks.updateContainerDates,
}))
vi.mock('../../services/demurrage/demurrageInvoices', () => ({
  createInvoiceForBL: mocks.createInvoice,
  listDemurrageInvoices: mocks.listInvoices,
  getInvoiceDetail: mocks.getInvoiceDetail,
  markInvoicePaid: mocks.markPaid,
  cancelDemurrageInvoice: mocks.cancelInvoice,
  updateDemurrageInvoice: mocks.updateInvoice,
  applyDemurrageDiscount: mocks.applyDiscount,
}))
vi.mock('../../services/demurrage/demurrageKpis', () => ({
  DEMURRAGE_ROE_MARKUP: 1.065,
  fetchDemurrageKPIs: mocks.fetchKpis,
  fetchLatestRecalcDate: mocks.fetchLatestRecalcDate,
  fetchCustomerDemurrageSummary: mocks.fetchCustomerSummary,
  fetchCustomerDemurrageDetail: mocks.fetchCustomerDetail,
  fetchROE: mocks.fetchRoe,
  recalculateInvoicesManual: mocks.recalculateManual,
}))
vi.mock('../../services/demurrage/demurragePresentation', () => ({
  effectiveDemurrage: () => ({
    total_days: 40,
    free_days: 10,
    days_p1: 20,
    rate_p1_usd: 10,
    days_p2: 10,
    rate_p2_usd: 20,
    total_usd: 400,
    status: 'overdue',
  }),
  fmtBRL: (value: number | null | undefined) => value == null ? '---' : `BRL ${value}`,
  fmtUSD: (value: number | null | undefined) => value == null ? '---' : `USD ${value}`,
  groupByBl: (containers: Array<{ bl_id: string | null }>) => {
    const grouped = new Map<string, typeof containers>()
    for (const container of containers) {
      const key = container.bl_id ?? 'unknown'
      grouped.set(key, [...(grouped.get(key) ?? []), container])
    }
    return grouped
  },
  lastBusinessDayISO: () => '2026-07-17',
  isPtaxWarningEligible: () => true,
}))
vi.mock('../../services/reconciliacao', () => ({ reverseDemurragePayment: mocks.reversePayment }))
vi.mock('../../services/supabase', () => ({ supabase: {} }))

import { Demurrage } from '../Demurrage'

const container = {
  id: 11,
  bl_id: 'BL-001',
  container_number: 'MSCU1234567',
  type: '20GP',
  discharge_date: '2026-06-01',
  return_date: null,
  demurrage_status: 'overdue',
  bl: {
    id: 'BL-001',
    pol: 'CNSHA',
    pod: 'BRVIT',
    free_time_override: null,
    demurrage_rate_override_p1_usd: null,
    demurrage_rate_override_p2_usd: null,
    demurrage_roe_manual: null,
    demurrage_roe: null,
    customer: { id: 7, name: 'Cliente Teste', cnpj_cpf: '12345678000195' },
    voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } },
  },
}

const issuedInvoice = {
  id: 21,
  doc_number: 'DEM-001',
  bl_id: 'BL-001',
  customer_id: 7,
  doc_date: '2026-07-01',
  due_date: '2026-07-10',
  billed_at: '2026-07-01',
  first_billed_at: '2026-07-01',
  paid_at: null,
  ready_at: '2026-07-01',
  total_usd: 400,
  roe: 5.5,
  roe_manual: false,
  current_roe: 5.5,
  roe_source: 'bcb_live',
  current_total_brl: 2200,
  discount_type: null,
  discount_value: null,
  discount_mode: 'percent',
  discount_justification: null,
  discount_approver: null,
  dispute_open: false,
  dispute_subject: null,
  dispute_reason: null,
  dispute_status: null,
  dispute_notes: null,
  pix_payload: null,
  pix_txid: null,
  conciliated_by_extract: false,
  status: 'issued',
  notes: null,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
  customer: { name: 'Cliente Teste' },
}

const paidInvoice = {
  ...issuedInvoice,
  id: 22,
  doc_number: 'DEM-002',
  status: 'paid',
  paid_at: '2026-07-12',
}

const invoiceDetail = {
  ...issuedInvoice,
  customer: { id: 7, name: 'Cliente Teste', cnpj_cpf: '12345678000195' },
  bl: { id: 'BL-001', pol: 'CNSHA', pod: 'BRVIT', voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } } },
  items: [{
    id: 31,
    invoice_id: 21,
    container_id: 11,
    container_number: 'MSCU1234567',
    container_type: '20GP',
    discharge_date: '2026-06-01',
    return_date: '2026-07-11',
    total_days: 40,
    free_days: 10,
    days_p1: 20,
    rate_p1_usd: 10,
    days_p2: 10,
    rate_p2_usd: 20,
    subtotal_usd: 400,
    created_at: '2026-07-01T10:00:00Z',
  }],
}

const detailResponse = { invoice: invoiceDetail, items: invoiceDetail.items }

const paidInvoiceDetail = { ...invoiceDetail, id: 22, doc_number: 'DEM-002', status: 'paid', paid_at: '2026-07-12' }
const paidDetailResponse = { invoice: paidInvoiceDetail, items: paidInvoiceDetail.items }

const customerSummary = [{
  customer_id: 7,
  customer_name: 'Cliente Teste',
  cnpj_cpf: '12345678000195',
  invoice_count: 1,
  total_usd: 400,
  total_brl: 2200,
}]

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Demurrage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, invalidateQueries }
}

async function openIssuedInvoices(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Faturas' }))
  await screen.findByText('DEM-001')
}

describe('Demurrage page behaviours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'print', { configurable: true, value: mocks.print })
    mocks.confirm.mockResolvedValue(true)
    mocks.listContainers.mockResolvedValue([container])
    mocks.createInvoice.mockResolvedValue(issuedInvoice)
    mocks.listInvoices.mockImplementation(({ status }: { status: string }) => Promise.resolve(
      status === 'issued' ? [issuedInvoice] : status === 'paid' ? [paidInvoice] : [],
    ))
    mocks.getInvoiceDetail.mockImplementation((id: number) => Promise.resolve(id === 22 ? paidDetailResponse : detailResponse))
    mocks.markPaid.mockResolvedValue(undefined)
    mocks.cancelInvoice.mockResolvedValue(undefined)
    mocks.updateInvoice.mockResolvedValue(undefined)
    mocks.applyDiscount.mockResolvedValue(undefined)
    mocks.fetchKpis.mockResolvedValue({ overdueContainers: 1, draftInvoicesTotalUsd: 0, issuedInvoicesTotalBrl: 2200 })
    mocks.fetchLatestRecalcDate.mockResolvedValue('2026-07-17')
    mocks.fetchCustomerSummary.mockResolvedValue(customerSummary)
    mocks.fetchCustomerDetail.mockResolvedValue([{ id: 21, doc_number: 'DEM-001', bl_id: 'BL-001', billed_at: '2026-07-01', total_usd: 400, current_total_brl: 2200, current_roe: 5.5 }])
    mocks.fetchRoe.mockResolvedValue({ roe: 5.5, offline: false, cachedAt: null })
    mocks.recalculateManual.mockResolvedValue({ updated: 1 })
    mocks.reversePayment.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('generates an invoice and invalidates container, invoice, and KPI queries', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Gerar Fatura' }))

    await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith('BL-001'))
    for (const queryKey of [['demurrage-containers'], ['demurrage-invoices'], ['demurrage-kpis']]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect((await screen.findByRole('button', { name: 'Gerar Fatura' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('expands a customer disclosure and opens the printable customer report', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Por Cliente' }))
    const customerTrigger = await screen.findByRole('button', { name: /Cliente Teste/ })
    expect(customerTrigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(customerTrigger)

    await waitFor(() => expect(mocks.fetchCustomerDetail).toHaveBeenCalledWith(7))
    expect(customerTrigger.getAttribute('aria-expanded')).toBe('true')
    const panelId = customerTrigger.getAttribute('aria-controls')
    expect(panelId).toBe('demurrage-customer-panel-7')
    expect(document.getElementById(panelId!)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    const report = screen.getByRole('dialog', { name: 'Demurrage em aberto por consignatário' })
    expect(within(report).getByText('Cliente Teste')).toBeTruthy()
    await user.click(within(report).getByRole('button', { name: 'Imprimir' }))
    expect(mocks.print).toHaveBeenCalled()
    await user.click(within(report).getByRole('button', { name: 'Fechar modal' }))
    expect(screen.queryByRole('dialog', { name: 'Demurrage em aberto por consignatário' })).toBeNull()
  })

  it('submits manual PTAX, invalidates recalc state, closes and resets the modal', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Informar PTAX' }))
    await user.type(screen.getByLabelText('PTAX (cotação de venda)'), '5.4321')
    await user.click(screen.getByRole('button', { name: 'Recalcular' }))

    await waitFor(() => expect(mocks.recalculateManual).toHaveBeenCalledWith(5.4321))
    for (const queryKey of [['demurrage-latest-recalc'], ['demurrage-invoices'], ['demurrage-kpis']]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
    expect(screen.queryByRole('dialog', { name: 'Informar PTAX manualmente' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Informar PTAX' }))
    expect((screen.getByLabelText('PTAX (cotação de venda)') as HTMLInputElement).value).toBe('')
  })

  it('opens invoice detail and submits discount, dispute, payment, and cancellation actions', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()
    await openIssuedInvoices(user)

    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    expect(await screen.findByRole('dialog', { name: 'Detalhes da invoice' })).toBeTruthy()
    expect(mocks.getInvoiceDetail).toHaveBeenCalledWith(21)
    await user.click(screen.getByRole('button', { name: 'Fechar modal' }))

    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    await screen.findByRole('dialog', { name: 'Detalhes da invoice' })
    await user.click(screen.getByRole('button', { name: 'Desconto' }))
    const discountDialog = screen.getByRole('dialog', { name: 'Desconto' })
    await user.selectOptions(within(discountDialog).getByLabelText('Tipo de desconto'), 'comercial')
    await user.type(within(discountDialog).getByLabelText(/Valor do desconto/), '10')
    await user.type(within(discountDialog).getByLabelText('Justificativa'), 'Acordo comercial')
    await user.type(within(discountDialog).getByLabelText('Aprovador'), 'Diretoria')
    await user.click(within(discountDialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mocks.applyDiscount).toHaveBeenCalledWith({
      invoiceId: 21,
      discountType: 'comercial',
      discountValue: 10,
      discountMode: 'percent',
      justification: 'Acordo comercial',
      approver: 'Diretoria',
    }))
    expect(screen.queryByRole('dialog', { name: 'Desconto' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    await screen.findByRole('dialog', { name: 'Detalhes da invoice' })
    await user.click(screen.getByRole('button', { name: 'Disputa' }))
    await user.click(screen.getByRole('checkbox', { name: 'Disputa em aberto' }))
    await user.type(screen.getByLabelText('Assunto'), 'Contestação')
    await user.selectOptions(screen.getByLabelText('Status'), 'aberto')
    await user.type(screen.getByLabelText('Motivo'), 'Data divergente')
    await user.type(screen.getByLabelText('Notas'), 'Aguardando comprovante')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mocks.updateInvoice).toHaveBeenCalledWith(21, {
      dispute_open: true,
      dispute_subject: 'Contestação',
      dispute_reason: 'Data divergente',
      dispute_status: 'aberto',
      dispute_notes: 'Aguardando comprovante',
    }))
    expect(screen.queryByRole('dialog', { name: 'Disputa' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    await screen.findByRole('dialog', { name: 'Detalhes da invoice' })
    await user.click(screen.getByRole('button', { name: 'Registrar Pgto' }))
    const paymentDate = screen.getByLabelText('Data do pagamento')
    await user.clear(paymentDate)
    await user.type(paymentDate, '2026-07-12')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledWith(21, '2026-07-12'))
    expect(mocks.fetchRoe).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Registrar Pagamento' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    await screen.findByRole('dialog', { name: 'Detalhes da invoice' })
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(mocks.cancelInvoice.mock.calls.at(-1)?.[0]).toBe(21))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Cancelar invoice',
      tone: 'danger',
    }))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['demurrage-invoices'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['demurrage-kpis'] })
  })

  it('reverses a paid invoice with an audited reason', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('tab', { name: 'Pagas' }))
    await screen.findByText('DEM-002')
    await user.click(screen.getByRole('button', { name: 'Detalhes' }))
    expect(await screen.findByRole('dialog', { name: 'Detalhes da invoice' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancelar baixa' }))
    await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), 'PIX duplicado')
    const reversal = screen.getByRole('dialog', { name: /Cancelar baixa de Demurrage/ })
    await user.click(within(reversal).getByRole('button', { name: 'Cancelar baixa' }))

    await waitFor(() => expect(mocks.reversePayment).toHaveBeenCalledWith(22, 'PIX duplicado'))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['demurrage-invoices'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['demurrage-kpis'] })
    expect(screen.queryByRole('dialog', { name: /Cancelar baixa de Demurrage/ })).toBeNull()
  })
})
