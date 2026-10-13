// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  role: 'administrativo' as string,
  showToast: vi.fn(),
  confirm: vi.fn(),
  confirmWithReason: vi.fn(),
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
  recalculateManual: vi.fn(),
  reversePayment: vi.fn(),
  listDisputes: vi.fn(),
  print: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: mocks.role === 'administrativo', effectiveRole: mocks.role }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
  useConfirmWithReason: () => mocks.confirmWithReason,
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
  recalculateInvoicesManual: mocks.recalculateManual,
}))
vi.mock('../../services/demurrage/demurrageRates', () => ({
  calculateDemurrage: () => ({ total_days: 40, free_days: 10, days_p1: 20, rate_p1_usd: 10, days_p2: 10, rate_p2_usd: 20, total_usd: 400, status: 'overdue' }),
}))
vi.mock('../../services/demurrage/demurrageDisputes', () => ({
  listDemurrageDisputes: mocks.listDisputes,
  addDemurrageDisputeMessage: vi.fn(),
  reopenDemurrageDispute: vi.fn(),
  uploadDemurrageDisputeAttachment: vi.fn(),
}))
vi.mock('../../services/reconciliacao', () => ({ reverseDemurragePayment: mocks.reversePayment }))
vi.mock('../../services/supabase', () => ({ supabase: {} }))
vi.mock('../../components/billing/FinancialRefundsPanel', () => ({ FinancialRefundsPanel: () => null }))
vi.mock('../../hooks/useFinancialRefunds', () => ({ useFinancialRefunds: () => ({ data: undefined, error: null }) }))
vi.mock('../../hooks/useAppSettings', () => ({
  useAppSettings: () => ({ data: { demurrage_dunning_interval_days: 7 }, isLoading: false, error: null }),
  useSetDemurrageDunningIntervalDays: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { Demurrage } from '../Demurrage'

const bl = {
  id: 'BL-001',
  pol: 'CNSHA',
  pod: 'BRVIT',
  voyage_id: 3,
  free_time_override: null,
  demurrage_rate_override_p1_usd: null,
  demurrage_rate_override_p2_usd: null,
  demurrage_roe_manual: null,
  demurrage_roe: null,
  customer: { id: 7, name: 'Cliente Teste', cnpj_cpf: '12345678000195' },
  voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } },
}

const returnedContainer = {
  id: 11,
  bl_id: 'BL-001',
  container_number: 'MSCU1234567',
  type: '20GP',
  discharge_date: '2026-06-01',
  return_date: '2026-07-11',
  demurrage_status: 'returned',
  customer_agreement: null,
  billed_in: [],
  bl,
}

const issuedInvoice = {
  id: 21,
  doc_number: 'DEM-001',
  bl_id: 'BL-001',
  customer_id: 7,
  doc_date: '2026-07-01',
  due_date: null,
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
  dunning_suspended_reason: null,
  pix_payload: null,
  pix_txid: null,
  conciliated_by_extract: false,
  status: 'issued',
  notes: null,
  created_at: '2026-07-01T10:00:00Z',
  updated_at: '2026-07-01T10:00:00Z',
  customer: { id: 7, name: 'Cliente Teste', cnpj_cpf: '12345678000195' },
  bl: { id: 'BL-001', pol: 'CNSHA', pod: 'BRVIT', voyage: { id: 3, voyage_number: '001E', vessel: { id: 2, name: 'Navio Teste' } } },
}

const paidInvoice = { ...issuedInvoice, id: 22, doc_number: 'DEM-002', status: 'paid', paid_at: '2026-07-12' }

const item = {
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
}

const customerSummary = [{ customer_id: 7, customer_name: 'Cliente Teste', cnpj_cpf: '12345678000195', invoice_count: 1, total_usd: 400, total_brl: 2200 }]

let detailOverrides: Record<number, Record<string, unknown>> = {}

function renderPage(initialEntries: string[] = ['/demurrage']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <Demurrage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, invalidateQueries }
}

function invalidated(spy: { mock: { calls: unknown[][] } }, key: string) {
  return spy.mock.calls.some(([input]) => JSON.stringify((input as { queryKey: unknown[] }).queryKey) === JSON.stringify([key]))
}

async function openIssuedDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Faturas' }))
  await user.click(await screen.findByRole('button', { name: 'DEM-001' }))
  return screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-001' })
}

describe('Demurrage page behaviours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.role = 'administrativo'
    detailOverrides = {}
    Object.defineProperty(window, 'print', { configurable: true, value: mocks.print })
    mocks.confirm.mockResolvedValue(true)
    mocks.confirmWithReason.mockResolvedValue('Valor contestado e acordado')
    mocks.listContainers.mockResolvedValue([returnedContainer])
    mocks.createInvoice.mockResolvedValue(21)
    mocks.listInvoices.mockImplementation(({ status, blId }: { status?: string; blId?: string }) => Promise.resolve(
      blId ? [issuedInvoice] : status === 'issued' ? [issuedInvoice] : status === 'paid' ? [paidInvoice] : [],
    ))
    mocks.getInvoiceDetail.mockImplementation((id: number) => {
      const base = id === 22 ? paidInvoice : issuedInvoice
      return Promise.resolve({ invoice: { ...base, ...(detailOverrides[id] ?? {}) }, items: [item] })
    })
    mocks.markPaid.mockResolvedValue(undefined)
    mocks.cancelInvoice.mockResolvedValue(undefined)
    mocks.updateInvoice.mockResolvedValue(undefined)
    mocks.applyDiscount.mockResolvedValue(undefined)
    mocks.fetchKpis.mockResolvedValue({ overdueContainers: 1, draftInvoicesTotalUsd: 0, issuedInvoicesTotalBrl: 2200 })
    mocks.fetchLatestRecalcDate.mockResolvedValue('2099-01-01')
    mocks.fetchCustomerSummary.mockResolvedValue(customerSummary)
    mocks.fetchCustomerDetail.mockResolvedValue([{ id: 21, doc_number: 'DEM-001', bl_id: 'BL-001', billed_at: '2026-07-01', total_usd: 400, current_total_brl: 2200, current_roe: 5.5 }])
    mocks.recalculateManual.mockResolvedValue({ updated: 1 })
    mocks.reversePayment.mockResolvedValue(undefined)
    mocks.listDisputes.mockResolvedValue([])
  })

  afterEach(cleanup)

  it('gera a Invoice, atualiza as telas que a leem e abre o detalhe da Invoice emitida', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Gerar Invoice do B/L BL-001' }))

    await waitFor(() => expect(mocks.createInvoice).toHaveBeenCalledWith('BL-001'))
    expect(await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-001' })).toBeTruthy()
    for (const key of ['demurrage-containers', 'demurrage-invoices', 'demurrage-kpis', 'customer-ficha', 'bl-detail']) {
      expect(invalidated(invalidateQueries, key)).toBe(true)
    }
  })

  it('mostra a recusa da emissão na linha do B/L, não só em aviso passageiro', async () => {
    mocks.createInvoice.mockRejectedValue(new Error('Aguardando a devolução de todos os containers do B/L (grupo do B/L BL-000).'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Gerar Invoice do B/L BL-001' }))
    expect((await screen.findByRole('alert')).textContent).toContain('grupo do B/L BL-000')
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.anything(), 'error')
  })

  it('o card Containers em atraso aplica a lente e a reflete na aba', async () => {
    const user = userEvent.setup()
    renderPage()

    const card = await screen.findByRole('button', { name: /Containers em atraso/ })
    await user.click(card)
    expect(card.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('radio', { name: /Em atraso/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('expande o Cliente e abre o relatório imprimível', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Por Cliente' }))
    const customerTrigger = await screen.findByRole('button', { name: /Cliente Teste/ })
    expect(customerTrigger.getAttribute('aria-expanded')).toBe('false')
    await user.click(customerTrigger)

    await waitFor(() => expect(mocks.fetchCustomerDetail).toHaveBeenCalledWith(7))
    expect(customerTrigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('demurrage-customer-panel-7')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Imprimir relatório' }))
    const report = screen.getByRole('dialog', { name: 'Demurrage em aberto por consignatário' })
    await user.click(within(report).getByRole('button', { name: 'Imprimir' }))
    expect(mocks.print).toHaveBeenCalled()
  })

  it('erro do saldo por Cliente não aparece como "Nada em aberto"', async () => {
    mocks.fetchCustomerSummary.mockRejectedValue(new Error('falhou'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Por Cliente' }))
    expect(await screen.findByText('Não foi possível carregar o saldo de Demurrage por Cliente.')).toBeTruthy()
    expect(screen.queryByText('Nada em aberto')).toBeNull()
  })

  it('esconde Informar PTAX de quem a RPC recusa', () => {
    mocks.role = 'operacoes'
    renderPage()
    expect(screen.queryByRole('button', { name: 'Informar PTAX' })).toBeNull()
  })

  it('aceita a PTAX com vírgula, mostra o ROE e recalcula', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('button', { name: 'Informar PTAX' }))
    await user.type(screen.getByLabelText(/PTAX \(cotação de venda\)/), '5,4321')
    expect(screen.getByText('ROE = PTAX × 1,065 = 5,7852')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Recalcular Invoices' }))

    await waitFor(() => expect(mocks.recalculateManual).toHaveBeenCalledWith(5.4321))
    for (const key of ['demurrage-latest-recalc', 'demurrage-invoices', 'demurrage-kpis']) {
      expect(invalidated(invalidateQueries, key)).toBe(true)
    }
    expect(screen.queryByRole('dialog', { name: 'Informar PTAX' })).toBeNull()
  })

  it('a falha do recálculo fica no modal da PTAX', async () => {
    mocks.recalculateManual.mockRejectedValue(new Error('Sem permissao.'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Informar PTAX' }))
    await user.type(screen.getByLabelText(/PTAX \(cotação de venda\)/), '5,4')
    await user.click(screen.getByRole('button', { name: 'Recalcular Invoices' }))
    const dialog = screen.getByRole('dialog', { name: 'Informar PTAX' })
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Nenhuma Invoice foi recalculada.')
  })

  it('aplica desconto, salva os dados da disputa e registra pagamento, voltando ao detalhe depois de cada um', async () => {
    const user = userEvent.setup()
    renderPage()
    await openIssuedDetail(user)

    await user.click(screen.getByRole('button', { name: 'Aplicar desconto' }))
    const discountDialog = screen.getByRole('dialog', { name: 'Desconto da Invoice DEM-001' })
    await user.selectOptions(within(discountDialog).getByLabelText('Tipo de desconto'), 'comercial')
    await user.type(within(discountDialog).getByLabelText(/Desconto em %/), '10')
    expect(within(discountDialog).getByText(/360,00/)).toBeTruthy()
    await user.type(within(discountDialog).getByLabelText(/Justificativa/), 'Acordo comercial')
    await user.type(within(discountDialog).getByLabelText('Aprovador'), 'Diretoria')
    await user.click(within(discountDialog).getByRole('button', { name: 'Salvar desconto' }))
    await waitFor(() => expect(mocks.applyDiscount).toHaveBeenCalledWith({
      invoiceId: 21,
      discountType: 'comercial',
      discountValue: 10,
      discountMode: 'percent',
      justification: 'Acordo comercial',
      approver: 'Diretoria',
    }))
    expect(await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-001' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Dados da disputa' }))
    await user.type(screen.getByLabelText('Assunto'), 'Contestação')
    await user.type(screen.getByLabelText('Motivo'), 'Data divergente')
    await user.type(screen.getByLabelText(/Notas/), 'Aguardando comprovante')
    await user.click(screen.getByRole('button', { name: 'Salvar dados' }))
    await waitFor(() => expect(mocks.updateInvoice).toHaveBeenCalledWith(21, {
      dispute_subject: 'Contestação',
      dispute_reason: 'Data divergente',
      dispute_notes: 'Aguardando comprovante',
    }))
    expect(await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-001' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    const paymentDate = screen.getByLabelText(/Data do pagamento/)
    await user.clear(paymentDate)
    await user.type(paymentDate, '2026-07-12')
    await user.click(within(screen.getByRole('dialog', { name: 'Registrar pagamento DEM-001' })).getByRole('button', { name: 'Registrar pagamento' }))
    await waitFor(() => expect(mocks.markPaid).toHaveBeenCalledWith(21, '2026-07-12'))
  }, 20000)

  it('o desconto sem justificativa é recusado junto do campo, sem chamar a RPC', async () => {
    const user = userEvent.setup()
    renderPage()
    await openIssuedDetail(user)
    await user.click(screen.getByRole('button', { name: 'Aplicar desconto' }))
    const discountDialog = screen.getByRole('dialog', { name: 'Desconto da Invoice DEM-001' })
    await user.type(within(discountDialog).getByLabelText(/Desconto em %/), '10')
    await user.click(within(discountDialog).getByRole('button', { name: 'Salvar desconto' }))
    expect(within(discountDialog).getByRole('alert').textContent).toBe('Informe a justificativa do desconto.')
    expect(mocks.applyDiscount).not.toHaveBeenCalled()
  })

  it('a prévia do desconto lê o valor como o formulário grava: "1.000" é mil dólares', async () => {
    detailOverrides[21] = { total_usd: 2000 }
    const user = userEvent.setup()
    renderPage()
    await openIssuedDetail(user)
    await user.click(screen.getByRole('button', { name: 'Aplicar desconto' }))
    const discountDialog = screen.getByRole('dialog', { name: 'Desconto da Invoice DEM-001' })
    await user.click(within(discountDialog).getByRole('radio', { name: 'Valor fixo (USD)' }))
    await user.type(within(discountDialog).getByLabelText(/Desconto em USD/), '1.000')
    expect(within(discountDialog).getByText(/− US\$\s?1\.000,00/)).toBeTruthy()
    await user.type(within(discountDialog).getByLabelText(/Justificativa/), 'Acordo')
    await user.click(within(discountDialog).getByRole('button', { name: 'Salvar desconto' }))
    await waitFor(() => expect(mocks.applyDiscount).toHaveBeenCalledWith(expect.objectContaining({ discountValue: 1000, discountMode: 'fixed' })))
  })

  it('editar um desconto fracionário já gravado não é recusado pelo formato', async () => {
    detailOverrides[21] = { discount_value: 12.5, discount_mode: 'percent' }
    const user = userEvent.setup()
    renderPage()
    await openIssuedDetail(user)
    await user.click(screen.getByRole('button', { name: /desconto/i }))
    const discountDialog = screen.getByRole('dialog', { name: 'Desconto da Invoice DEM-001' })
    expect((within(discountDialog).getByLabelText(/Desconto em %/) as HTMLInputElement).value).toBe('12,5')
    await user.type(within(discountDialog).getByLabelText(/Justificativa/), 'Só a classificação')
    await user.click(within(discountDialog).getByRole('button', { name: 'Salvar desconto' }))
    await waitFor(() => expect(mocks.applyDiscount).toHaveBeenCalledWith(expect.objectContaining({ discountValue: 12.5 })))
  })

  it('cancelar a Invoice pede confirmação com motivo; nenhum "Voltar" cancela', async () => {
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()
    const detail = await openIssuedDetail(user)

    // Regressão: o botão "Voltar" do detalhe chamava o cancelamento.
    expect(within(detail).queryByRole('button', { name: 'Voltar' })).toBeNull()

    await user.click(within(detail).getByRole('button', { name: 'Cancelar Invoice…' }))
    expect(mocks.confirmWithReason).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancelar Invoice DEM-001', tone: 'danger', confirmLabel: 'Cancelar Invoice' }))
    await waitFor(() => expect(mocks.cancelInvoice).toHaveBeenCalledWith(21, 'Valor contestado e acordado'))
    expect(invalidated(invalidateQueries, 'demurrage-invoices')).toBe(true)
  })

  it('desistir da confirmação não cancela', async () => {
    mocks.confirmWithReason.mockResolvedValue(null)
    const user = userEvent.setup()
    renderPage()
    const detail = await openIssuedDetail(user)
    await user.click(within(detail).getByRole('button', { name: 'Cancelar Invoice…' }))
    await waitFor(() => expect(mocks.confirmWithReason).toHaveBeenCalled())
    expect(mocks.cancelInvoice).not.toHaveBeenCalled()
  })

  it('perfis sem permissão leem o motivo em vez de ações que o banco recusa', async () => {
    mocks.role = 'operacoes'
    const user = userEvent.setup()
    renderPage()
    const detail = await openIssuedDetail(user)
    expect(within(detail).queryByRole('button', { name: 'Registrar pagamento' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: 'Cancelar Invoice…' })).toBeNull()
    expect(within(detail).getByText(/Registrar pagamento e desconto: Financeiro ou Administrativo\./)).toBeTruthy()
  })

  it('explica a Invoice tirada da Régua por datas alteradas com desconto ou disputa', async () => {
    detailOverrides[21] = { dunning_suspended_reason: 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.', discount_value: 20, discount_mode: 'percent' }
    const user = userEvent.setup()
    renderPage()
    const detail = await openIssuedDetail(user)
    expect(within(detail).getByText('Fora da Régua: datas alteradas numa Invoice com desconto ou disputa')).toBeTruthy()
    expect(within(detail).getByText(/Cancele, gere de novo pela aba Containers/)).toBeTruthy()
  })

  it('cancela a baixa com justificativa e preserva o aviso das datas alteradas', async () => {
    detailOverrides[22] = { dunning_suspended_reason: 'Datas de container alteradas depois do pagamento; conferir a diferença.' }
    const user = userEvent.setup()
    const { invalidateQueries } = renderPage()

    await user.click(screen.getByRole('tab', { name: 'Pagas' }))
    await user.click(await screen.findByRole('button', { name: 'DEM-002' }))
    await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-002' })
    await user.click(screen.getByRole('button', { name: 'Cancelar baixa…' }))
    const reversal = screen.getByRole('dialog', { name: /Cancelar baixa de Demurrage DEM-002/ })
    expect(within(reversal).getByText('As datas do container mudaram depois do pagamento')).toBeTruthy()
    await user.type(within(reversal).getByLabelText(/Justificativa para cancelar a baixa/), 'PIX duplicado')
    await user.click(within(reversal).getByRole('button', { name: 'Cancelar baixa' }))

    await waitFor(() => expect(mocks.reversePayment).toHaveBeenCalledWith(22, 'PIX duplicado'))
    expect(invalidated(invalidateQueries, 'demurrage-invoices')).toBe(true)
    expect(invalidated(invalidateQueries, 'demurrage-kpis')).toBe(true)
  })

  it('?fatura= abre a Invoice direto e leva à aba da situação dela', async () => {
    renderPage(['/demurrage?fatura=22'])
    expect(await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-002' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Pagas' }).getAttribute('aria-selected')).toBe('true'))
  })

  it('Invoice aberta a partir de Containers fica na aba Containers e preserva a lente', async () => {
    const user = userEvent.setup()
    renderPage(['/demurrage?lente=devolvidos'])
    await user.click(await screen.findByRole('button', { name: 'Gerar Invoice do B/L BL-001' }))
    expect(await screen.findByRole('dialog', { name: 'Invoice de Demurrage DEM-001' })).toBeTruthy()
    // O detalhe já carregou a situação (emitida); nada pode levar a Faturas.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole('tab', { name: 'Containers' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('radio', { name: /Devolvidos/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('a busca da URL também filtra as Invoices', async () => {
    renderPage(['/demurrage?tab=faturas&busca=OUTRO'])
    expect(await screen.findByText('Nenhuma Invoice nesta busca')).toBeTruthy()
  })

  it('Disputas é aba de Equipamentos e Administrativo e abre pela ?dispute=', async () => {
    mocks.listDisputes.mockResolvedValue([{
      id: 5, demurrage_invoice_id: 21, doc_number: 'DEM-001', customer_id: 7, customer_name: 'Cliente Teste',
      state: 'aberta', next_responder: 'equipamentos', subject: 'Datas', created_at: '2026-07-02T10:00:00Z', updated_at: '2026-07-02T10:00:00Z', messages: [],
    }])
    renderPage(['/demurrage?dispute=5'])
    expect((await screen.findByRole('tab', { name: /Disputas/ })).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('heading', { name: 'DEM-001 · Cliente Teste' })).toBeTruthy()
    expect(document.getElementById('dispute-5')?.className).toContain('app-dem-dispute--focused')
  })

  it('perfil sem a conversa de Disputas não vê a aba', () => {
    mocks.role = 'financeiro'
    renderPage(['/demurrage?tab=disputas'])
    expect(screen.queryByRole('tab', { name: /Disputas/ })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Containers' }).getAttribute('aria-selected')).toBe('true')
  })
})
