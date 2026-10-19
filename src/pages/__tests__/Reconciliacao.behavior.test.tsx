// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  match: vi.fn(),
  createImportKey: vi.fn(),
  getLineIdentity: vi.fn(),
  persist: vi.fn(),
  listExceptions: vi.fn(),
  listCandidates: vi.fn(),
  linkCandidate: vi.fn(),
  resolveException: vi.fn(),
  confirm: vi.fn(),
  reverseDemurrage: vi.fn(),
  getDemurrageDetail: vi.fn(),
  showToast: vi.fn(),
  itauMonitor: vi.fn(),
  markHandled: vi.fn(),
  sheetNotices: vi.fn(),
  sheetWarnings: vi.fn(),
  navigate: vi.fn(),
}))
const authState = vi.hoisted(() => ({ isAdmin: true, role: 'administrativo' }))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../services/demurrage/demurrageKpis', () => ({
  parsePixExtractFile: mocks.parse,
}))
vi.mock('../../services/importCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/importCore')>()),
  readSpreadsheetNotices: mocks.sheetNotices,
  readSpreadsheetWarnings: mocks.sheetWarnings,
}))
vi.mock('../../services/reconciliacao', () => ({
  matchUnifiedPixTransactions: mocks.match,
  createPixImportKey: mocks.createImportKey,
  getPixLineIdentity: mocks.getLineIdentity,
  persistUnresolvedPixMatches: mocks.persist,
  listPixReconciliationExceptions: mocks.listExceptions,
  listPixReconciliationCandidates: mocks.listCandidates,
  linkPixReconciliationCandidate: mocks.linkCandidate,
  resolvePixReconciliationException: mocks.resolveException,
  confirmUnifiedPixReconciliation: mocks.confirm,
  reverseDemurragePayment: mocks.reverseDemurrage,
  getItauPixMonitor: mocks.itauMonitor,
  markItauPixReceiptHandled: mocks.markHandled,
}))
vi.mock('../../services/demurrage/demurrageInvoices', () => ({
  getInvoiceDetail: mocks.getDemurrageDetail,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAdmin: authState.isAdmin,
    effectiveRole: authState.role,
    can: (permission: string) => permission === 'settle_financial_adjustments' && ['administrativo', 'financeiro'].includes(authState.role),
  }),
}))
vi.mock('../../hooks/useFinancialRefunds', () => ({
  useFinancialRefunds: () => ({ data: { pending: 0, settled: 0 }, error: null }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/billing/InvoiceDetailModal', () => ({
  InvoiceDetailModal: ({ invoiceId, paymentId }: { invoiceId: number | null; paymentId: number | null }) =>
    invoiceId ? <div>Detalhe local {invoiceId}/{String(paymentId)}</div> : null,
}))
vi.mock('../../components/demurrage/DemurrageInvoiceDetailModal', () => ({
  DemurrageInvoiceDetailModal: ({ invoiceId, onReversePayment, onOpenDocument, onRegisterPayment }: {
    invoiceId: number | null
    onReversePayment: (invoice: object) => void
    onOpenDocument: (id: number, type: 'invoice' | 'receipt') => void
    onRegisterPayment: (invoice: object) => void
  }) => invoiceId ? (
    <div>
      Detalhe Demurrage {invoiceId}
      <button onClick={() => onReversePayment({ id: invoiceId, doc_number: 'DEM-31', dunning_suspended_reason: null })}>Cancelar baixa…</button>
      <button onClick={() => onOpenDocument(invoiceId, 'receipt')}>Ver recibo</button>
      <button onClick={() => onRegisterPayment({ id: invoiceId })}>Registrar pagamento</button>
    </div>
  ) : null,
}))
vi.mock('../../components/billing/ReconciliationHistoryTable', () => ({
  ReconciliationHistoryTable: ({
    onSelectLocalInvoice,
    onSelectDemurrageInvoice,
  }: {
    onSelectLocalInvoice: (invoiceId: number, paymentId: number) => void
    onSelectDemurrageInvoice: (invoiceId: number) => void
  }) => (
    <div>
      <button onClick={() => onSelectLocalInvoice(11, 21)}>Abrir local</button>
      <button onClick={() => onSelectDemurrageInvoice(31)}>Abrir demurrage</button>
    </div>
  ),
}))
vi.mock('../../components/demurrage/InvoiceDocument', () => ({
  InvoiceDocument: ({ type }: { type: string }) => <div>Documento demurrage {type}</div>,
}))

import { Reconciliacao } from '../Reconciliacao'

function renderPage(path = '/reconciliacao?tab=pendencias') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Reconciliacao />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { invalidate }
}

const transaction = { txid: 'INV-001', cnpj: '123', date: '2026-06-23', amount: 100, lineNumber: 5 }
const safeMatch = {
  transaction,
  source: 'local' as const,
  invoiceId: 11,
  docNumber: 'INV-001',
  customerName: 'Cliente Seguro',
  customerCnpj: '12345678000190',
  amount: 100,
  ambiguous: false,
  matchType: 'txid' as const,
}
const ambiguousMatch = {
  ...safeMatch,
  transaction: { ...transaction, txid: 'TX-DIV', lineNumber: 6 },
  invoiceId: 12,
  docNumber: 'INV-002',
  ambiguous: true,
  ambiguityReason: 'Valor do Pix diferente do valor da cobrança da fatura.',
}
const unmatchedMatch = {
  ...safeMatch,
  source: 'unmatched' as const,
  invoiceId: 0,
  docNumber: 'SEM-MATCH',
  ambiguous: true,
  ambiguityReason: 'Nenhum documento aberto usa este TXID.',
  candidateCount: 0,
  matchType: 'unmatched' as const,
  transaction: { ...transaction, txid: 'SEM-MATCH', lineNumber: 7 },
}

const exceptionRow = {
  id: 42, importKey: 'sha256:pix-import', lineNumber: 8, txid: 'TX-42', cnpj: '12345678000190',
  paidAt: '2026-06-23T00:00:00+00:00', amount: 100, reason: 'ambiguous' as const, candidateCount: 2,
  metadata: { ambiguity_reason: '2 documentos usam o mesmo TXID.' }, status: 'active' as const,
  createdAt: '2026-06-23T13:00:00Z', updatedAt: '2026-06-23T13:00:00Z', resolvedAt: null,
}

async function uploadExtract(user: ReturnType<typeof userEvent.setup>) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, new File(['xlsx'], 'pix.xlsx', { type: 'application/vnd.ms-excel' }))
  await screen.findByText('Conferência do extrato')
}

describe('Conciliação PIX', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    authState.isAdmin = true
    authState.role = 'administrativo'
    mocks.parse.mockResolvedValue({ transactions: [transaction], ignored: 0, errors: [] })
    mocks.match.mockResolvedValue([safeMatch, ambiguousMatch, unmatchedMatch])
    mocks.sheetNotices.mockResolvedValue({ warnings: [], firstSheetHiddenRows: 0 })
    mocks.sheetWarnings.mockResolvedValue([])
    mocks.createImportKey.mockResolvedValue('sha256:pix-import')
    mocks.getLineIdentity.mockImplementation((tx: { lineNumber?: number }) => tx.lineNumber ?? 1)
    mocks.persist.mockResolvedValue([{ id: 43, lineNumber: 6, status: 'active' }, { id: 44, lineNumber: 7, status: 'active' }])
    mocks.listExceptions.mockResolvedValue([])
    mocks.listCandidates.mockResolvedValue([])
    mocks.linkCandidate.mockResolvedValue({ id: 42, status: 'active' })
    mocks.resolveException.mockResolvedValue({ id: 42, status: 'resolved' })
    mocks.confirm.mockResolvedValue({
      local: 1,
      demurrage: 0,
      items: [{ source: 'local', invoice_id: 11, doc_number: 'INV-001', status: 'ok' }],
    })
    mocks.reverseDemurrage.mockResolvedValue(undefined)
    mocks.itauMonitor.mockResolvedValue({ provider: 'static', polledUntil: null, counts: {}, charges: [], receipts: [] })
    mocks.getDemurrageDetail.mockResolvedValue({
      invoice: { id: 31, doc_number: 'DEM-31', status: 'paid', paid_at: '2026-06-25' },
      items: [],
    })
  })

  it('monitor Itaú: horário de Brasília, fila do banco com o que pede ação primeiro e Pix sem baixa', async () => {
    const base = { attempts: 1, lastError: null, amount: 10, nextAttemptAt: '', updatedAt: '2026-10-06T10:00:00Z', invoiceId: 1, uncertain: false }
    mocks.itauMonitor.mockResolvedValue({
      provider: 'itau',
      polledUntil: '2026-10-06T15:00:00Z',
      counts: { active: 4 },
      charges: [
        { ...base, id: 1, txid: 'VELA1', status: 'pending_cancel', source: 'local', docNumber: 'FL-100' },
        { ...base, id: 2, txid: 'VELA2', status: 'pending_create', source: 'demurrage', docNumber: 'DM-200', uncertain: true, attempts: 3, lastError: 'timeout', updatedAt: '2026-10-06T11:00:00Z' },
      ],
      receipts: [{ endToEndId: 'E1', txid: 'VELA9', amount: 5, paidAt: '2026-10-06T14:00:00Z', reason: 'Valor recebido difere do valor da cobrança.' }],
    })
    const user = userEvent.setup()
    renderPage()

    // 15:00 UTC é meio-dia em Brasília; a hora literal do texto seria 3 h adiantada.
    const itau = (await screen.findByRole('heading', { name: 'Cobrança Pix Itaú' })).closest('section')!
    expect(await within(itau).findByText('06/10/2026 às 12:00')).toBeTruthy()
    // Consulta parada é o dado principal, em âmbar, com a orientação.
    const lead = within(itau).getByText(/^Consulta parada há/)
    expect(lead.className).toContain('app-lead__value--warning')
    expect(within(itau).getByText(/Pix pagos depois de 06\/10\/2026 às 12:00 não deram baixa automática\. Avise quem cuida da integração/)).toBeTruthy()
    expect(within(itau).getByText('Cobranças ativas')).toBeTruthy()

    const queue = screen.getByRole('heading', { name: /Cobranças aguardando o Itaú/ }).closest('section')!
    expect(within(queue).getByText('Cancelamento pendente').closest('.app-status-text')).toBeNull()
    expect(within(queue).getByText('Emissão sem resposta do banco').closest('.app-status-text--warning')).toBeTruthy()
    const docs = within(queue).getAllByRole('button', { name: /^(DM|FL)-/ }).map((button) => button.textContent)
    expect(docs).toEqual(['DM-200', 'FL-100'])
    // A resposta do banco e o identificador inteiro ficam na linha aberta.
    expect(within(queue).queryByText('timeout')).toBeNull()
    await user.click(within(queue).getByRole('button', { name: /Abrir resposta do banco da cobrança DM-200/ }))
    expect(within(queue).getByText('timeout')).toBeTruthy()
    expect(within(queue).getAllByText('VELA2').length).toBeGreaterThan(0)

    const receipts = screen.getByRole('heading', { name: 'Pix recebidos sem baixa' }).closest('section')!
    expect(within(receipts).getByText(/Valor recebido difere/)).toBeTruthy()
    expect(within(receipts).getByText('06/10/2026 11:00')).toBeTruthy()
    expect(within(receipts).getByRole('columnheader', { name: 'Identificador do Pix' })).toBeTruthy()
    expect(screen.queryByText(/TXID|endToEndId/)).toBeNull()
    // Pix sem baixa e cobrança com resposta incerta pedem ação; o cancelamento na fila não.
    expect(screen.getByRole('tab', { name: /Pendências/ }).textContent).toContain('2')
  })

  it('consulta Itaú recente não mostra o aviso de consulta parada', async () => {
    mocks.itauMonitor.mockResolvedValue({ provider: 'itau', polledUntil: new Date().toISOString(), counts: {}, charges: [], receipts: [] })
    renderPage()
    expect(await screen.findByText(/Recebimentos consultados agora há pouco/)).toBeTruthy()
    expect(screen.getByText('Baixa automática ligada')).toBeTruthy()
    expect(screen.queryByText(/Consulta parada/)).toBeNull()
  })

  it('Pix Itaú em análise só é marcado como tratado com motivo; Voltar devolve o foco e a recusa fica no campo', async () => {
    mocks.itauMonitor.mockResolvedValue({
      provider: 'itau', polledUntil: new Date().toISOString(), counts: {}, charges: [],
      receipts: [{ endToEndId: 'E9', txid: 'VELA9', amount: 5, paidAt: '2026-10-06T14:00:00Z', reason: 'Fatura cancelada.' }],
    })
    mocks.markHandled.mockRejectedValueOnce(new Error('Pix Itaú não está em análise.')).mockResolvedValueOnce(undefined)
    const user = userEvent.setup()
    renderPage()

    const trigger = await screen.findByRole('button', { name: 'Marcar como tratado' })
    await user.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText(/Motivo do tratamento/))
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Marcar como tratado'))

    await user.click(screen.getByRole('button', { name: 'Marcar como tratado' }))
    const submit = screen.getByRole('button', { name: 'Marcar como tratado' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Motivo do tratamento/), 'Rest.')
    await user.click(submit)
    expect(await screen.findByText('Pix Itaú não está em análise.')).toBeTruthy()
    await user.type(screen.getByLabelText(/Motivo do tratamento/), ' registrada')
    await user.click(screen.getByRole('button', { name: 'Marcar como tratado' }))
    await waitFor(() => expect(mocks.markHandled).toHaveBeenLastCalledWith('E9', 'Rest. registrada'))
    expect(await screen.findByText(/marcado como tratado; o Alerta do recebimento foi encerrado/)).toBeTruthy()
  })

  it('lê o extrato, salva as exceções e separa o que entra no lote do que fica pendente', async () => {
    const user = userEvent.setup()
    const { invalidate } = renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    expect(mocks.persist).toHaveBeenCalledWith('sha256:pix-import', [safeMatch, ambiguousMatch, unmatchedMatch])
    // Dado principal da conferência e o que fica como exceção.
    expect(screen.getByText('1 pronta para baixa')).toBeTruthy()
    expect(screen.getByText(/R\$\s100,00 no lote/)).toBeTruthy()
    const ready = screen.getByRole('table', { name: 'Linhas do extrato prontas para baixa' })
    expect(within(ready).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Linha', 'Pago em', 'Valor do Pix', 'Identificador do Pix', 'Fatura', 'Origem', 'Cliente'])
    expect(within(ready).getAllByText('INV-001')).toHaveLength(2) // identificador e fatura
    expect(within(ready).getByText('Taxas Locais')).toBeTruthy()
    // Sem o CNPJ sob o Cliente.
    expect(within(ready).queryByText('12.345.678/0001-90')).toBeNull()
    const pending = screen.getByRole('table', { name: 'Linhas do extrato que ficam como exceção pendente' })
    expect(within(pending).getByText(/^Valor do Pix diferente do valor da cobrança da fatura · Fatura indicada: INV-002 \(R\$\s[0-9.,]+\)$/).closest('.app-status-text--warning')).toBeTruthy()
    expect(within(pending).getByText('Nenhuma fatura aberta com este identificador')).toBeTruthy()
    expect(screen.getByText(/Nada foi baixado ainda\. As exceções já estão em Pendências\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver Pendências' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar 1 baixa' })).toBeTruthy()
    // As exceções gravadas na leitura aparecem em Pendências sem recarregar.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pix-reconciliation-exceptions'] })
  })

  it('falha de leitura fica na tela, com nada baixado', async () => {
    mocks.parse.mockRejectedValueOnce(new Error('Coluna "valor pago" não encontrada.'))
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['xlsx'], 'pix.xlsx'))

    expect(await screen.findByText('Não foi possível ler o extrato')).toBeTruthy()
    expect(screen.getByText(/valor pago" não encontrada\. Nada foi baixado\./)).toBeTruthy()
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  // Regra de 2026-10-19: valor ilegível recusa o extrato inteiro antes de
  // procurar faturas ou salvar exceções.
  it('valor ilegível no extrato: nada é procurado, salvo nem baixado', async () => {
    mocks.parse.mockResolvedValueOnce({ transactions: [transaction], ignored: 0, errors: [{ row: 9, message: 'Valor pago "1,2,3" ilegível.' }] })
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['xlsx'], 'pix.xlsx'))

    expect(await screen.findByText('Valor pago "1,2,3" ilegível.')).toBeTruthy()
    expect(screen.getByText(/nada é baixado nem salvo em Pendências/)).toBeTruthy()
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Confirmar/ })).toBeNull()
  })

  it('lançamentos zerados ou negativos ficam fora com a contagem à vista (D3)', async () => {
    mocks.parse.mockResolvedValueOnce({ transactions: [transaction], ignored: 3, errors: [] })
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    const ignored = screen.getByText('Lançamentos zerados ou negativos ignorados').closest('div')!
    expect(within(ignored).getByText('3')).toBeTruthy()
  })

  // Revisão da PR 929: linhas ocultas do extrato ficam fora da leitura; o aviso aparece antes de Confirmar.
  it('avisa as linhas ocultas do extrato antes de confirmar', async () => {
    mocks.sheetNotices.mockResolvedValueOnce({ warnings: ['2 linhas ocultas ignoradas: o filtro da planilha indica importar só o visível.'], firstSheetHiddenRows: 2 })
    mocks.sheetWarnings.mockResolvedValueOnce(['2 linhas ocultas ignoradas: o filtro da planilha indica importar só o visível.'])
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    const hidden = screen.getByText('Linhas ocultas fora da leitura').closest('div')!
    expect(within(hidden).getByText('2').closest('.app-status-text--warning')).toBeTruthy()
    expect(within(hidden).getByText(/Só as linhas visíveis entram/)).toBeTruthy()
    expect(await screen.findByText(/2 linhas ocultas ignoradas: o filtro/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar 1 baixa' })).toBeTruthy()
  })

  // Revisão da PR 929: linhas ocultas de OUTRA aba não tiram nada da conciliação.
  it('linhas ocultas em outra aba: avisa a leitura sem dizer que parte do extrato ficou de fora', async () => {
    mocks.sheetNotices.mockResolvedValueOnce({ warnings: ['3 linhas ocultas ignoradas na aba "Resumo".'], firstSheetHiddenRows: 0 })
    mocks.sheetWarnings.mockResolvedValueOnce(['3 linhas ocultas ignoradas na aba "Resumo".'])
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    expect(await screen.findByText('Avisos de leitura do arquivo')).toBeTruthy()
    expect(screen.getByText(/aba "Resumo"/)).toBeTruthy()
    const hidden = screen.getByText('Linhas ocultas fora da leitura').closest('div')!
    expect(within(hidden).getByText('Nenhuma')).toBeTruthy()
  })

  it('confirma só o lote seguro e mostra o resultado que o banco devolveu, com caminho para o detalhe', async () => {
    const user = userEvent.setup()
    const { invalidate } = renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar 1 baixa' }))

    expect(mocks.confirm).toHaveBeenCalledWith([expect.objectContaining(safeMatch)])
    expect(await screen.findByText('1 baixa confirmada pelo banco')).toBeTruthy()
    expect(screen.getByText('Baixa confirmada')).toBeTruthy()
    expect(screen.getByText(/2 linhas não entraram no lote e estão/)).toBeTruthy()
    expect(screen.queryByText('Conferência do extrato')).toBeNull()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['demurrage-invoices'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-ledger'] })

    await user.click(screen.getByRole('button', { name: 'INV-001' }))
    expect(screen.getByText('Detalhe local 11/null')).toBeTruthy()
  })

  it('lote recusado: nada é baixado, a conferência continua e a recusa fica junto do botão', async () => {
    mocks.confirm.mockRejectedValueOnce(new Error('Valor do PIX diverge do saldo da invoice INV-001.'))
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar 1 baixa' }))

    expect(await screen.findByText('Nenhuma baixa foi gravada')).toBeTruthy()
    expect(screen.getByText(/diverge do saldo da invoice INV-001/)).toBeTruthy()
    expect(screen.getByText('Conferência do extrato')).toBeTruthy()
    expect(screen.queryByText(/baixa confirmada pelo banco/)).toBeNull()
  })

  it('resposta com menos itens que o enviado não promete a baixa que faltou', async () => {
    mocks.match.mockResolvedValueOnce([safeMatch, { ...safeMatch, invoiceId: 13, docNumber: 'INV-003', transaction: { ...transaction, txid: 'TX-3', lineNumber: 9 } }])
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)
    expect(screen.getByText(/As 2 baixas são gravadas juntas/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Confirmar 2 baixas' }))

    expect(await screen.findByText('1 baixa confirmada pelo banco')).toBeTruthy()
    expect(screen.getByText(/1 linha enviada não voltou na resposta/)).toBeTruthy()
  })

  it('Demurrage paga com a cotação anterior explica a diferença na linha pronta', async () => {
    mocks.match.mockResolvedValueOnce([{ ...safeMatch, source: 'demurrage', invoiceId: 31, docNumber: 'DEM-31', amount: 104.2 }])
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)
    expect(screen.getByText(/Cotação anterior aceita \(janela das duas PTAX\)/)).toBeTruthy()
  })

  it('exceção persistida: motivo, CNPJ e dia do extrato; Tentar de novo sem fatura segura explica na linha', async () => {
    mocks.listExceptions.mockResolvedValue([exceptionRow])
    mocks.match.mockResolvedValueOnce([{ ...ambiguousMatch, ambiguityReason: 'TXID repetido no mesmo extrato.' }])
    const user = userEvent.setup()
    renderPage()

    // Ambígua: motivo em texto âmbar, com "identificador" no lugar de "TXID".
    expect((await screen.findByText('2 faturas usam o mesmo identificador')).closest('.app-status-text--warning')).toBeTruthy()
    expect(screen.getByText('12.345.678/0001-90')).toBeTruthy()
    // A data do extrato fica no dia escrito, não no dia anterior de Brasília.
    expect(screen.getByText('23/06/2026')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText(/Ainda não há uma fatura segura para esta linha: Identificador repetido no mesmo extrato\./)).toBeTruthy()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('escolher fatura baixa pela autoridade financeira e encerra a exceção', async () => {
    mocks.listExceptions.mockResolvedValue([exceptionRow])
    mocks.listCandidates.mockResolvedValueOnce([{ source: 'local', invoiceId: 10, docNumber: 'INV-010', amount: 100 }])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /Abrir faturas candidatas da linha 8/ }))
    expect(await screen.findByText('INV-010')).toBeTruthy()
    expect(screen.getByText(/Linha 8 do extrato importado em 23\/06\/2026 às 10:00/)).toBeTruthy()
    const candidates = screen.getByRole('table', { name: 'Faturas candidatas da linha 8' })
    expect(within(candidates).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Fatura', 'Origem', 'Valor da fatura', 'Pix', 'Ação'])
    expect(within(candidates).getByTitle('Mesmo valor do Pix')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Baixar nesta fatura' }))

    await waitFor(() => expect(mocks.resolveException).toHaveBeenCalledWith(42, expect.objectContaining({ source: 'local', invoiceId: 10, txid: 'TX-42' })))
    expect(mocks.linkCandidate).toHaveBeenCalledWith(42, expect.objectContaining({ source: 'local', invoiceId: 10 }))
    expect(mocks.confirm).toHaveBeenCalledWith([expect.objectContaining({ source: 'local', invoiceId: 10, ambiguous: false })])
    expect(await screen.findByText(/INV-010: baixa confirmada pelo banco/)).toBeTruthy()
  })

  it('baixa gravada e exceção não encerrada: pede para não repetir e só encerra a exceção', async () => {
    mocks.listExceptions.mockResolvedValue([exceptionRow])
    mocks.listCandidates.mockResolvedValueOnce([{ source: 'local', invoiceId: 10, docNumber: 'INV-010', amount: 100 }])
    mocks.resolveException.mockRejectedValueOnce(new Error('timeout'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /Abrir faturas candidatas da linha 8/ }))
    await user.click(await screen.findByRole('button', { name: 'Baixar nesta fatura' }))
    expect(await screen.findByText(/A baixa em INV-010 foi gravada, mas a exceção não foi encerrada: timeout Não repita a baixa; use Encerrar exceção/)).toBeTruthy()
    // A fatura já não está aberta: Tentar de novo e Escolher fatura não a achariam.
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
    expect(screen.queryByRole('button', { name: /faturas candidatas/ })).toBeNull()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Encerrar exceção' }))
    expect(await screen.findByText('INV-010: exceção encerrada; a baixa já estava gravada.')).toBeTruthy()
    expect(mocks.resolveException).toHaveBeenLastCalledWith(42, expect.objectContaining({ source: 'local', invoiceId: 10, txid: 'TX-42' }))
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('histórico abre o detalhe local com a baixa e o de Demurrage com cancelamento e recibo no mesmo fluxo', async () => {
    const user = userEvent.setup()
    const { invalidate } = renderPage('/reconciliacao?tab=historico')

    await user.click(screen.getByRole('button', { name: 'Abrir local' }))
    expect(screen.getByText('Detalhe local 11/21')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Abrir demurrage' }))
    expect(screen.getByText('Detalhe Demurrage 31')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancelar baixa…' }))
    const reverse = screen.getByRole('button', { name: 'Cancelar baixa' }) as HTMLButtonElement
    expect(reverse.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), 'Pagamento duplicado')
    await user.click(reverse)
    await waitFor(() => expect(mocks.reverseDemurrage).toHaveBeenCalledWith(31, 'Pagamento duplicado'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reconciliation-history'] })
    expect(await screen.findByText('Detalhe Demurrage 31')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ver recibo' }))
    expect(await screen.findByText('Documento demurrage receipt')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(await screen.findByText('Detalhe Demurrage 31')).toBeTruthy()

    // Pagamento, desconto e disputa são de Demurrage: a Invoice abre lá.
    await user.click(screen.getByRole('button', { name: 'Registrar pagamento' }))
    expect(mocks.navigate).toHaveBeenCalledWith('/demurrage?fatura=31')
  })

  it('cancelar a baixa de Demurrage recusado: a recusa fica no formulário', async () => {
    mocks.reverseDemurrage.mockRejectedValueOnce(new Error('Restituição depende desta baixa.'))
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=historico')
    await user.click(screen.getByRole('button', { name: 'Abrir demurrage' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar baixa…' }))
    await user.type(screen.getByLabelText(/Justificativa para cancelar a baixa/), 'Engano')
    await user.click(screen.getByRole('button', { name: 'Cancelar baixa' }))
    expect(await screen.findByText(/Restituição depende desta baixa\. A baixa continua registrada\./)).toBeTruthy()
  })

  it('sem aba na URL abre no Histórico de baixas; as abas ficam Histórico, Pendências (com contagem) e Conciliar extrato', async () => {
    mocks.listExceptions.mockResolvedValue([exceptionRow])
    renderPage('/reconciliacao')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent?.replace(/\d.*$/, '').trim())).toEqual(['Histórico de baixas', 'Pendências', 'Conciliar extrato'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Abrir local' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('tab', { name: /Pendências/ }).textContent).toContain('1'))
  })

  it('a aba fica na URL e o extrato lido sobrevive à troca de aba', async () => {
    const user = userEvent.setup()
    renderPage('/reconciliacao?tab=extrato')
    await uploadExtract(user)
    await user.click(screen.getByRole('tab', { name: /Histórico de baixas/ }))
    expect(screen.getByRole('button', { name: 'Abrir local' })).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: /Conciliar extrato/ }))
    expect(screen.getByText('Conferência do extrato')).toBeTruthy()
    expect(mocks.parse).toHaveBeenCalledTimes(1)
  })

  it('qualquer Departamento lê a Conciliação; conciliar o extrato é do Financeiro e do Administrativo (ADR 0085, D5)', async () => {
    authState.isAdmin = false
    authState.role = 'operacoes'
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('tab', { name: /Pendências/ })).toBeTruthy()
    await waitFor(() => expect(mocks.itauMonitor).toHaveBeenCalled())
    // Cobrança Itaú desligada: o dado principal diz de onde vem a baixa.
    expect(await screen.findByText('Desligada: as faturas usam o QR estático e a baixa vem do extrato')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Marcar como tratado' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: /Conciliar extrato/ }))
    expect(screen.getByText('Conciliar extrato é do Financeiro e do Administrativo')).toBeTruthy()
  })

  it('o Financeiro concilia', async () => {
    authState.isAdmin = false
    authState.role = 'financeiro'
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('tab', { name: /Conciliar extrato/ }))
    expect(screen.queryByText('Conciliar extrato é do Financeiro e do Administrativo')).toBeNull()
  })
})
