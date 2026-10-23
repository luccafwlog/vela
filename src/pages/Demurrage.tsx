import { useEffect, useState } from 'react'
import { NoValue } from '../components/ui/NoValue'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Mail, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { Modal } from '../components/ui/Modal'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { useToast } from '../components/ui/Toast'
import { useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { ImportNotice } from '../components/shared/ImportParts'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { CustomerReportModal } from '../components/demurrage/CustomerReportModal'
import { DemurrageContainersTab } from '../components/demurrage/DemurrageContainersTab'
import { DemurrageContainerDatesModal } from '../components/demurrage/DemurrageContainerDatesModal'
import { canAnswerDemurrageDispute, canManageManualRoe, type ContainerDatesInput } from '../components/demurrage/demurrageFormRules'
import { DemurrageCustomersTab } from '../components/demurrage/DemurrageCustomersTab'
import { DemurrageDunningSettingsModal } from '../components/demurrage/DemurrageDunningSettingsModal'
import { DemurrageInvoiceDetailModal, type DemurrageDetailInvoice } from '../components/demurrage/DemurrageInvoiceDetailModal'
import { DemurrageInvoicesTab } from '../components/demurrage/DemurrageInvoicesTab'
import { DemurragePaymentReversalModal, type DemurrageReversalDatesNotice } from '../components/demurrage/DemurragePaymentReversalModal'
import { DemurrageDisputeConversation } from '../components/demurrage/DemurrageDisputeConversation'
import { DiscountModal, type DiscountFieldErrors } from '../components/demurrage/DiscountModal'
import { DisputeModal } from '../components/demurrage/DisputeModal'
import { InvoiceDocument, type DemurrageInvoiceDocumentDetail } from '../components/demurrage/InvoiceDocument'
import { PaymentModal, type PaymentTarget } from '../components/demurrage/PaymentModal'
import { PtaxModal } from '../components/demurrage/PtaxModal'
import { useFinancialRefunds } from '../hooks/useFinancialRefunds'
import { useDemurrageComplementOf } from '../hooks/useDemurrageComplementOf'
import { useAuth } from '../hooks/useAuth'
import { afterDatasContainerAlteradas, afterFaturaDemurrageAlterada } from '../services/cacheEffects'
import { listDemurrageContainers, updateContainerDates, type DemurrageContainerRow } from '../services/demurrage/demurrageContainers'
import {
  applyDemurrageDiscount,
  cancelDemurrageInvoice,
  createInvoiceForBL,
  getInvoiceDetail,
  listDemurrageInvoices,
  markInvoicePaid,
  updateDemurrageInvoice,
} from '../services/demurrage/demurrageInvoices'
import {
  fetchCustomerDemurrageDetail,
  fetchCustomerDemurrageSummary,
  fetchDemurrageKPIs,
  fetchLatestRecalcDate,
  recalculateInvoicesManual,
} from '../services/demurrage/demurrageKpis'
import { listDemurrageDisputes } from '../services/demurrage/demurrageDisputes'
import { DEMURRAGE_INVOICE_TABS } from '../services/demurrage/demurrageInvoiceTabs'
import { EMPTY_DISCOUNT, EMPTY_DISPUTE, type DiscountForm, type DisputeForm } from '../services/demurrage/demurrageForms'
import {
  discountPreview,
  fmtBRL,
  invoiceNetUsd,
  isPtaxWarningEligible,
  lastBusinessDayISO,
  reversalDatesNotice,
} from '../services/demurrage/demurragePresentation'
import { reverseDemurragePayment } from '../services/reconciliacao'
import { demurrageDiscountSchema } from '../services/financialValidation'
import { extractErrorText } from '../lib/errors'
import { saoPauloTodayIso } from '../lib/dates'
import { printDocumentElement } from '../lib/printDocument'
import { demurrageStateFromSearch, withDemurrageParam, withDemurrageTab, type ContainerLens, type DemurrageTab } from './demurrageListState'

type InvoiceTab = (typeof DEMURRAGE_INVOICE_TABS)[number]['key']

const STATUS_BY_TAB = Object.fromEntries(DEMURRAGE_INVOICE_TABS.map(({ key, status }) => [key, status])) as Record<InvoiceTab, string>
const TAB_BY_STATUS: Record<string, InvoiceTab> = { issued: 'emitidas', overdue: 'emitidas', paid: 'pagas', cancelled: 'canceladas' }

function isInvoiceTab(tab: DemurrageTab): tab is InvoiceTab {
  return tab === 'emitidas' || tab === 'pagas' || tab === 'canceladas'
}

const todayIso = () => saoPauloTodayIso()

/** Erros de validação do desconto por campo, com a mensagem da tela. */
function discountErrors(form: DiscountForm): DiscountFieldErrors {
  const validation = demurrageDiscountSchema.safeParse(form)
  const errors: DiscountFieldErrors = {}
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      if (issue.path[0] === 'discount_value') errors.discount_value = form.discount_mode === 'percent' ? 'Informe um percentual de 0 a 100.' : 'Informe um valor em USD maior ou igual a zero.'
    }
  }
  // A RPC exige justificativa em toda alteração, inclusive para tirar o desconto.
  if (!form.discount_justification.trim()) errors.discount_justification = 'Informe a justificativa do desconto.'
  return errors
}

export function Demurrage() {
  const queryClient = useQueryClient()
  const { effectiveRole } = useAuth()
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = demurrageStateFromSearch(searchParams)
  const { tab, search, lens } = state

  // Permissões das RPCs, para a tela não oferecer o que o banco recusa.
  const canIssue = effectiveRole != null // issue_demurrage_invoice_for_bl: qualquer Departamento (ADR 0085, D3; migration 246)
  const canAdmin = effectiveRole === 'administrativo' // cancel_demurrage_invoice, reverse_demurrage_payment
  const canSettle = effectiveRole === 'financeiro' || effectiveRole === 'administrativo' // register_demurrage_payment; apply_demurrage_discount é de qualquer Departamento (247)
  const canInformPtax = canSettle || effectiveRole === 'equipamentos' // migration 110
  const canAnswerDispute = canAnswerDemurrageDispute(effectiveRole)
  const canManageRoe = canManageManualRoe(effectiveRole)
  // A aba Disputas é de leitura para todos (ADR 0085, D12; migration 250).
  const canReadDisputes = effectiveRole != null
  const activeTab: DemurrageTab = tab === 'disputas' && !canReadDisputes ? 'containers' : tab

  const [generatingBl, setGeneratingBl] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<{ blId: string; message: string } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editingContainer, setEditingContainer] = useState<DemurrageContainerRow | null>(null)
  const [datesError, setDatesError] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState<number | null>(null)
  const [document, setDocument] = useState<{ id: number; type: 'invoice' | 'receipt' } | null>(null)
  const [paying, setPaying] = useState<PaymentTarget | null>(null)
  const [payDate, setPayDate] = useState(todayIso())
  const [payError, setPayError] = useState<string | null>(null)
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [reversing, setReversing] = useState<{ id: number; docNumber: string | null; datesChanged: DemurrageReversalDatesNotice | null } | null>(null)
  const [discountTarget, setDiscountTarget] = useState<{ id: number; docNumber: string; totalUsd: number; hadDiscount: boolean } | null>(null)
  const [discountForm, setDiscountForm] = useState<DiscountForm>(EMPTY_DISCOUNT)
  const [discountFieldErrors, setDiscountFieldErrors] = useState<DiscountFieldErrors>({})
  const [disputeTarget, setDisputeTarget] = useState<{ id: number; docNumber: string } | null>(null)
  const [disputeForm, setDisputeForm] = useState<DisputeForm>(EMPTY_DISPUTE)
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [ptaxModalOpen, setPtaxModalOpen] = useState(false)
  const [ptaxInput, setPtaxInput] = useState('')
  const [ptaxError, setPtaxError] = useState<string | null>(null)
  const [dunningModalOpen, setDunningModalOpen] = useState(false)
  const [expandedCustomer, setExpandedCustomer] = useState<number | null>(null)
  const [customerReportOpen, setCustomerReportOpen] = useState(false)
  const [focusInvoiceId, setFocusInvoiceId] = useState<number | null>(null)

  const containersQuery = useQuery({
    queryKey: ['demurrage-containers'],
    queryFn: () => listDemurrageContainers(),
    staleTime: 60_000,
    enabled: activeTab === 'containers',
  })
  const kpisQuery = useQuery({ queryKey: ['demurrage-kpis'], queryFn: fetchDemurrageKPIs, staleTime: 60_000 })
  const kpis = kpisQuery.data
  const customerSummaryQuery = useQuery({
    queryKey: ['demurrage-customer-summary'],
    queryFn: fetchCustomerDemurrageSummary,
    staleTime: 60_000,
    enabled: activeTab === 'clientes',
  })
  const customerDetailQuery = useQuery({
    queryKey: ['demurrage-customer-detail', expandedCustomer],
    queryFn: () => fetchCustomerDemurrageDetail(expandedCustomer!),
    enabled: expandedCustomer != null && activeTab === 'clientes',
  })
  const { data: latestRecalcDate } = useQuery({ queryKey: ['demurrage-latest-recalc'], queryFn: fetchLatestRecalcDate, staleTime: 60_000 })
  const disputesQuery = useQuery({
    queryKey: ['demurrage-disputes'],
    queryFn: () => listDemurrageDisputes(),
    staleTime: 30_000,
    enabled: canReadDisputes,
  })
  const disputesWaiting = (disputesQuery.data ?? []).filter((dispute) => dispute.state === 'aberta' && dispute.next_responder === 'equipamentos').length

  const invoiceStatus = isInvoiceTab(activeTab) ? STATUS_BY_TAB[activeTab] : null
  const invoicesQuery = useQuery({
    queryKey: ['demurrage-invoices', invoiceStatus],
    queryFn: () => listDemurrageInvoices({ status: invoiceStatus as DemurrageDetailInvoice['status'] }),
    staleTime: 30_000,
    enabled: invoiceStatus != null,
  })

  // Link direto (`?fatura=`) vindo de fora (ficha, Alerta): abre também a aba
  // da situação da Invoice. A Invoice aberta por esta tela fica na aba atual
  // (Containers não tem `tab` na URL, e trocar de aba apagaria a lente).
  const [openedHere, setOpenedHere] = useState<number | null>(null)
  const linkedInvoiceId = state.invoiceId != null && !searchParams.has('tab') && openedHere !== state.invoiceId ? state.invoiceId : null
  const linkedDetailQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', linkedInvoiceId],
    queryFn: () => getInvoiceDetail(linkedInvoiceId!),
    enabled: linkedInvoiceId != null,
  })
  const linkedStatus = linkedInvoiceId != null ? linkedDetailQuery.data?.invoice.status : undefined
  useEffect(() => {
    if (!linkedStatus) return
    const target = TAB_BY_STATUS[linkedStatus]
    if (target) setSearchParams((params) => withDemurrageTab(params, target), { replace: true })
  }, [linkedStatus, setSearchParams])

  const receiptRefunds = useFinancialRefunds('demurrage', document?.type === 'receipt' ? document.id : null)
  const documentQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', document?.id ?? null],
    queryFn: () => getInvoiceDetail(document!.id),
    enabled: document != null,
  })

  const recalcStale =
    (kpis?.issuedInvoicesTotalBrl ?? 0) > 0 &&
    isPtaxWarningEligible() &&
    (latestRecalcDate == null || latestRecalcDate < lastBusinessDayISO())

  function updateParams(next: (params: URLSearchParams) => URLSearchParams) {
    setSearchParams((params) => next(params), { replace: true })
  }
  const selectTab = (next: DemurrageTab) => updateParams((params) => withDemurrageTab(params, next))
  const setSearch = (value: string) => updateParams((params) => withDemurrageParam(params, 'busca', value))
  const setLens = (value: ContainerLens) => updateParams((params) => withDemurrageParam(params, 'lente', value))
  const openInvoice = (invoiceId: number) => {
    setOpenedHere(invoiceId)
    updateParams((params) => withDemurrageParam(params, 'fatura', invoiceId))
  }
  const closeInvoice = () => updateParams((params) => withDemurrageParam(params, 'fatura', null))

  /** Ação aberta a partir do detalhe: o formulário toma o lugar do diálogo e volta para ele. */
  function fromDetail(action: () => void) {
    setReturnTo(state.invoiceId)
    closeInvoice()
    action()
  }
  function backToDetail() {
    if (returnTo != null) openInvoice(returnTo)
    setReturnTo(null)
  }
  /**
   * Depois de gravar, relê o detalhe antes de voltar a ele: enquanto o
   * formulário estava aberto o detalhe não tinha observador, e a invalidação só
   * o marcava velho (voltaria mostrando "Registrar pagamento" numa Invoice paga).
   */
  async function refreshDetailAndBack() {
    if (returnTo != null) await queryClient.refetchQueries({ queryKey: ['demurrage-invoice-detail', returnTo], type: 'all' })
    backToDetail()
  }

  const recalcManualMutation = useMutation({
    mutationFn: (ptax: number) => recalculateInvoicesManual(ptax),
    onSuccess: async (result) => {
      setPtaxModalOpen(false)
      setPtaxInput('')
      setPtaxError(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast(`PTAX aplicada: ${result.updated} ${result.updated === 1 ? 'Invoice recalculada' : 'Invoices recalculadas'}.`, 'success')
    },
    onError: (error) => setPtaxError(extractErrorText(error)),
  })
  const containerDatesMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ContainerDatesInput }) => updateContainerDates(id, input.discharge, input.ret, input.reason),
    onSuccess: async () => {
      await afterDatasContainerAlteradas(queryClient)
      // A recusa da emissão era sobre as datas antigas.
      setGenerateError(null)
      setEditingContainer(null)
      showToast('Datas atualizadas.', 'success')
    },
    onError: (error: Error) => setDatesError(extractErrorText(error)),
  })
  const generateMutation = useMutation({
    mutationFn: (blId: string) => createInvoiceForBL(blId),
    onSuccess: async (invoiceId) => {
      setGenerateError(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Invoice de Demurrage emitida.', 'success')
      if (typeof invoiceId === 'number') openInvoice(invoiceId)
    },
    onError: (error: Error, blId) => setGenerateError({ blId, message: extractErrorText(error) }),
    onSettled: () => setGeneratingBl(null),
  })
  const payMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => markInvoicePaid(id, date),
    onSuccess: async () => {
      setPaying(null)
      setPayError(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Pagamento registrado.', 'success')
      await refreshDetailAndBack()
    },
    onError: (error: Error) => setPayError(extractErrorText(error)),
  })
  const unpayMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => reverseDemurragePayment(id, reason),
    onMutate: () => setReverseError(null),
    onSuccess: async () => {
      setReversing(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Baixa cancelada com auditoria.', 'success')
      await refreshDetailAndBack()
    },
    onError: (error: Error) => setReverseError(extractErrorText(error)),
  })
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelDemurrageInvoice(id, reason),
    onMutate: () => setCancelError(null),
    onSuccess: async () => {
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Invoice cancelada.', 'success')
    },
    // A recusa fica no detalhe, onde o cancelamento foi pedido.
    onError: (error: Error) => setCancelError(extractErrorText(error)),
  })
  const discountMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: DiscountForm }) => {
      const discount = demurrageDiscountSchema.parse(form)
      await applyDemurrageDiscount({
        invoiceId: id,
        discountType: discount.discount_type,
        discountValue: discount.discount_value,
        discountMode: discount.discount_mode,
        justification: discount.discount_justification,
        approver: discount.discount_approver,
      })
    },
    onSuccess: async () => {
      setDiscountTarget(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Desconto atualizado.', 'success')
      await refreshDetailAndBack()
    },
    onError: (error: Error) => setDiscountFieldErrors({ form: extractErrorText(error) }),
  })
  const disputeMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: DisputeForm }) => updateDemurrageInvoice(id, {
      dispute_subject: form.dispute_subject.trim() || null,
      dispute_reason: form.dispute_reason.trim() || null,
      dispute_notes: form.dispute_notes.trim() || null,
    }),
    onSuccess: async () => {
      setDisputeTarget(null)
      await afterFaturaDemurrageAlterada(queryClient)
      showToast('Dados da disputa salvos.', 'success')
      await refreshDetailAndBack()
    },
    onError: (error: Error) => setDisputeError(extractErrorText(error)),
  })

  function openPayment(invoice: DemurrageDetailInvoice) {
    fromDetail(() => {
      setPayDate(todayIso())
      setPayError(null)
      setPaying({ id: invoice.id, docNumber: invoice.doc_number, netUsd: invoiceNetUsd(invoice).netUsd, currentTotalBrl: invoice.current_total_brl, billedAt: invoice.billed_at })
    })
  }

  function openDiscount(invoice: DemurrageDetailInvoice) {
    fromDetail(() => {
      setDiscountForm({
        discount_type: invoice.discount_type as DiscountForm['discount_type'],
        // O campo lê pt-BR: 12.5 do banco vira "12,5" para não ser recusado ao salvar.
        discount_value: invoice.discount_value != null ? String(invoice.discount_value).replace('.', ',') : '',
        discount_mode: invoice.discount_mode === 'fixed' ? 'fixed' : 'percent',
        discount_justification: '',
        discount_approver: invoice.discount_approver ?? '',
      })
      setDiscountFieldErrors({})
      setDiscountTarget({ id: invoice.id, docNumber: invoice.doc_number, totalUsd: invoice.total_usd, hadDiscount: Number(invoice.discount_value ?? 0) > 0 })
    })
  }

  function openDisputeData(invoice: DemurrageDetailInvoice) {
    fromDetail(() => {
      setDisputeForm({
        dispute_subject: invoice.dispute_subject ?? '',
        dispute_reason: invoice.dispute_reason ?? '',
        dispute_notes: invoice.dispute_notes ?? '',
      })
      setDisputeError(null)
      setDisputeTarget({ id: invoice.id, docNumber: invoice.doc_number })
    })
  }

  async function handleCancelInvoice(invoice: DemurrageDetailInvoice) {
    const reason = await confirmWithReason({
      title: `Cancelar Invoice ${invoice.doc_number}`,
      message: `Cancelar a Invoice de Demurrage ${invoice.doc_number} do B/L ${invoice.bl_id}?`,
      consequence: 'A Invoice sai da Régua e do Portal e não aceita mais baixa. As caixas dela voltam a ficar sem Invoice e podem ser cobradas de novo pela aba Containers.',
      reversibility: 'Invoice cancelada não volta: para cobrar de novo, gere outra Invoice.',
      reasonLabel: 'Motivo do cancelamento (obrigatório)',
      confirmLabel: 'Cancelar Invoice',
      tone: 'danger',
    })
    if (reason === null) return
    cancelMutation.mutate({ id: invoice.id, reason })
  }

  function submitDiscount() {
    if (!discountTarget) return
    const errors = discountErrors(discountForm)
    if (discountPreview(discountTarget.totalUsd, discountForm.discount_mode, discountForm.discount_value)?.exceedsTotal) {
      errors.discount_value = 'O desconto fixo não pode passar do total da Invoice.'
    }
    setDiscountFieldErrors(errors)
    if (Object.keys(errors).length) return
    discountMutation.mutate({ id: discountTarget.id, form: discountForm })
  }

  function printInvoiceDocument() {
    if (document?.type === 'receipt' && !receiptRefunds.data) return
    if (complement.pending || complement.failed) return
    const content = window.document.querySelector<HTMLElement>('.invoice-print-content')
    if (!content) return
    printDocumentElement(content, document?.type === 'receipt' ? 'Recibo de Demurrage' : 'Fatura de Demurrage')
  }

  const documentDetail = documentQuery.data
  const complement = useDemurrageComplementOf(documentDetail?.invoice)
  const panelId = 'demurrage-panel'

  return (
    <div className="app-dem-page">
      <PageHeader
        title="Demurrage"
        action={
          <>
            <Link className="app-btn app-btn--secondary" to="/demurrage/taxas">Tarifas e acordos<ArrowRight size={14} aria-hidden="true" /></Link>
            <Button variant="secondary" onClick={() => setDunningModalOpen(true)}><Mail size={15} aria-hidden="true" />Régua de cobrança</Button>
            {canInformPtax ? <Button variant="secondary" onClick={() => { setPtaxError(null); setPtaxModalOpen(true) }}>Informar PTAX</Button> : null}
            <Button onClick={() => setImportOpen(true)}><Upload size={15} aria-hidden="true" />Importar datas</Button>
          </>
        }
      />

      {recalcStale ? (
        <ImportNotice tone="warning" role="status" title="PTAX de hoje não obtida do BCB" className="app-dem-banner">
          <p>Os valores em BRL das Invoices aguardando pagamento podem estar desatualizados.</p>
          {canInformPtax ? <Button variant="secondary" className="app-btn--sm mt-2" onClick={() => { setPtaxError(null); setPtaxModalOpen(true) }}>Informar PTAX</Button> : null}
        </ImportNotice>
      ) : null}

      <div className="app-dem-metrics">
        <MetricCard
          label="Containers em atraso"
          value={kpisQuery.error ? <NoValue label="Não carregado" /> : kpis ? String(kpis.overdueContainers) : '…'}
          tone={kpis && kpis.overdueContainers > 0 ? 'primary' : 'secondary'}
          selected={activeTab === 'containers' && lens === 'atraso'}
          onSelect={() => updateParams((params) => withDemurrageParam(withDemurrageTab(params, 'containers'), 'lente', 'atraso'))}
        />
        <MetricCard
          label="Aguardando pagamento (BRL hoje)"
          value={kpisQuery.error ? <NoValue label="Não carregado" /> : kpis ? fmtBRL(kpis.issuedInvoicesTotalBrl) : '…'}
          selected={activeTab === 'emitidas'}
          onSelect={() => selectTab('emitidas')}
        />
        {canAnswerDispute ? (
          <MetricCard
            label="Disputas aguardando resposta"
            value={disputesQuery.error ? <NoValue label="Não carregado" /> : disputesQuery.data ? String(disputesWaiting) : '…'}
            tone={disputesWaiting > 0 ? 'primary' : 'secondary'}
            selected={activeTab === 'disputas'}
            onSelect={() => selectTab('disputas')}
          />
        ) : null}
      </div>
      {kpisQuery.error ? <p className="app-dem-note app-dem-note--warning" role="status">Os totais do topo não carregaram; as listas abaixo seguem válidas.</p> : null}

      <TabList label="Seções de Demurrage" className="app-dem-tabs">
        <TabButton id="dem-tab-containers" controls={panelId} active={activeTab === 'containers'} label="Containers" onClick={() => selectTab('containers')} />
        {DEMURRAGE_INVOICE_TABS.map((item) => (
          <TabButton key={item.key} id={`dem-tab-${item.key}`} controls={panelId} active={activeTab === item.key} label={item.label} onClick={() => selectTab(item.key)} />
        ))}
        <TabButton id="dem-tab-clientes" controls={panelId} active={activeTab === 'clientes'} label="Por Cliente" onClick={() => selectTab('clientes')} />
        {canReadDisputes ? (
          <TabButton
            id="dem-tab-disputas"
            controls={panelId}
            active={activeTab === 'disputas'}
            label="Disputas"
            count={disputesQuery.data ? disputesWaiting : null}
            countLabel={`${disputesWaiting} aguardando resposta`}
            onClick={() => selectTab('disputas')}
          />
        ) : null}
      </TabList>

      <div id={panelId} role="tabpanel" aria-labelledby={`dem-tab-${activeTab}`}>
        {activeTab === 'containers' ? (
          <DemurrageContainersTab
            containers={containersQuery.data}
            search={search}
            lens={lens}
            loading={containersQuery.isLoading}
            error={containersQuery.error}
            canIssue={canIssue}
            generatingBl={generatingBl}
            generateError={generateError}
            onRetry={() => void containersQuery.refetch()}
            onSearchChange={setSearch}
            onLensChange={setLens}
            onGenerateInvoice={(blId) => { setGenerateError(null); setGeneratingBl(blId); generateMutation.mutate(blId) }}
            onEditContainer={(container) => { setDatesError(null); setEditingContainer(container) }}
            onOpenInvoice={openInvoice}
          />
        ) : null}
        {isInvoiceTab(activeTab) ? (
          <DemurrageInvoicesTab
            tab={activeTab}
            invoices={invoicesQuery.data}
            search={search}
            loading={invoicesQuery.isLoading}
            error={invoicesQuery.error}
            onRetry={() => void invoicesQuery.refetch()}
            onSearchChange={setSearch}
            onOpenDetail={openInvoice}
          />
        ) : null}
        {activeTab === 'clientes' ? (
          <DemurrageCustomersTab
            summary={customerSummaryQuery.data}
            loading={customerSummaryQuery.isLoading}
            error={customerSummaryQuery.error}
            onRetry={() => void customerSummaryQuery.refetch()}
            detail={customerDetailQuery.data}
            detailLoading={customerDetailQuery.isLoading}
            detailError={customerDetailQuery.error}
            expandedCustomer={expandedCustomer}
            onExpandedCustomerChange={(customerId) => setExpandedCustomer((id) => (id === customerId ? null : customerId))}
            onOpenReport={() => setCustomerReportOpen(true)}
            onOpenInvoice={openInvoice}
          />
        ) : null}
        {activeTab === 'disputas' ? (
          <DemurrageDisputeConversation focusDisputeId={state.disputeId} focusInvoiceId={focusInvoiceId} onOpenInvoice={openInvoice} />
        ) : null}
      </div>

      <ContainerDatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PtaxModal
        open={ptaxModalOpen}
        value={ptaxInput}
        loading={recalcManualMutation.isPending}
        error={ptaxError}
        openTotalBrl={kpis?.issuedInvoicesTotalBrl ?? null}
        onValueChange={setPtaxInput}
        onClose={() => setPtaxModalOpen(false)}
        onSubmit={(ptax) => recalcManualMutation.mutate(ptax)}
      />
      <DemurrageContainerDatesModal
        container={editingContainer}
        loading={containerDatesMutation.isPending}
        error={datesError}
        onClose={() => setEditingContainer(null)}
        onSubmit={(input) => editingContainer && containerDatesMutation.mutate({ id: editingContainer.id, input })}
      />
      <DemurrageInvoiceDetailModal
        invoiceId={state.invoiceId}
        permissions={{ canSettle, canAdmin, canAnswerDispute, canManageRoe }}
        cancelling={cancelMutation.isPending}
        cancelError={cancelError}
        onClose={() => { setCancelError(null); closeInvoice() }}
        onOpenInvoice={openInvoice}
        onRegisterPayment={openPayment}
        onDiscount={openDiscount}
        onDisputeData={openDisputeData}
        onOpenDisputes={(invoice) => { setFocusInvoiceId(invoice.id); updateParams((params) => withDemurrageTab(withDemurrageParam(params, 'fatura', null), 'disputas')) }}
        onOpenDocument={(id, type) => fromDetail(() => setDocument({ id, type }))}
        onCancelInvoice={(invoice) => void handleCancelInvoice(invoice)}
        onReversePayment={(invoice) => fromDetail(() => setReversing({ id: invoice.id, docNumber: invoice.doc_number, datesChanged: reversalDatesNotice(invoice) }))}
      />
      <PaymentModal
        open={paying != null}
        invoice={paying}
        paymentDate={payDate}
        loading={payMutation.isPending}
        error={payError}
        onPaymentDateChange={setPayDate}
        onClose={() => { setPaying(null); backToDetail() }}
        onSubmit={(id, date) => payMutation.mutate({ id, date })}
      />
      <DiscountModal
        open={discountTarget != null}
        docNumber={discountTarget?.docNumber}
        totalUsd={discountTarget?.totalUsd}
        hadDiscount={discountTarget?.hadDiscount}
        form={discountForm}
        loading={discountMutation.isPending}
        errors={discountFieldErrors}
        onFormChange={(form) => { setDiscountForm(form); setDiscountFieldErrors({}) }}
        onClose={() => { setDiscountTarget(null); backToDetail() }}
        onSubmit={submitDiscount}
      />
      <DisputeModal
        open={disputeTarget != null}
        docNumber={disputeTarget?.docNumber}
        form={disputeForm}
        loading={disputeMutation.isPending}
        error={disputeError}
        onFormChange={setDisputeForm}
        onClose={() => { setDisputeTarget(null); backToDetail() }}
        onSubmit={() => disputeTarget && disputeMutation.mutate({ id: disputeTarget.id, form: disputeForm })}
      />
      {reversing != null ? (
        <DemurragePaymentReversalModal
          open
          docNumber={reversing.docNumber}
          datesChanged={reversing.datesChanged}
          loading={unpayMutation.isPending}
          error={reverseError}
          onClose={() => { setReversing(null); setReverseError(null); backToDetail() }}
          onSubmit={(reason) => unpayMutation.mutate({ id: reversing.id, reason })}
        />
      ) : null}
      {document ? (
        <Modal
          open
          onClose={() => { setDocument(null); backToDetail() }}
          title={`${document.type === 'invoice' ? 'Fatura' : 'Recibo'} de Demurrage${documentDetail ? ` ${documentDetail.invoice.doc_number}` : ''}`}
        >
          <div className="app-dem-document-toolbar">
            <Button variant="secondary" disabled={!documentDetail || (document.type === 'receipt' && !receiptRefunds.data) || complement.pending || complement.failed} onClick={printInvoiceDocument}>Imprimir</Button>
          </div>
          {documentQuery.error ? <p className="app-dem-form__error" role="alert">Não foi possível carregar o documento: {extractErrorText(documentQuery.error)}</p> : null}
          {!documentDetail && !documentQuery.error ? <p className="app-dem-meta" role="status">Carregando o documento…</p> : null}
          {documentDetail && (complement.pending || complement.failed) ? (
            <p role="status" className="app-dem-meta">{complement.failed ? 'Falha ao conferir as outras Invoices deste B/L. Recarregue antes de imprimir.' : 'Conferindo as outras Invoices deste B/L…'}</p>
          ) : null}
          {document.type === 'receipt' && documentDetail && !receiptRefunds.data ? (
            <p role="status" className="app-dem-meta">{receiptRefunds.error ? 'Falha ao consultar restituições. Recarregue antes de emitir o recibo.' : 'Consultando restituições…'}</p>
          ) : null}
          {documentDetail ? (
            <div className="invoice-print-content">
              <InvoiceDocument detail={{ ...documentDetail.invoice, items: documentDetail.items, refund_summary: receiptRefunds.data, complement_of: complement.complementOf } satisfies DemurrageInvoiceDocumentDetail} type={document.type} />
            </div>
          ) : null}
        </Modal>
      ) : null}
      {customerReportOpen && customerSummaryQuery.data ? <CustomerReportModal open rows={customerSummaryQuery.data} onClose={() => setCustomerReportOpen(false)} /> : null}
      <DemurrageDunningSettingsModal open={dunningModalOpen} onClose={() => setDunningModalOpen(false)} />
    </div>
  )
}
