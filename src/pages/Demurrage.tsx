import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DollarSign, Mail, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { ContainerDatesImportModal } from '../components/shared/ContainerDatesImportModal'
import { CustomerReportModal } from '../components/demurrage/CustomerReportModal'
import { TabButton } from '../components/ui/TabButton'
import { DemurrageContainersTab } from '../components/demurrage/DemurrageContainersTab'
import { DemurrageCustomersTab } from '../components/demurrage/DemurrageCustomersTab'
import { DemurrageDunningSettingsModal } from '../components/demurrage/DemurrageDunningSettingsModal'
import { DemurrageInvoicesTab } from '../components/demurrage/DemurrageInvoicesTab'
import { DemurragePaymentReversalModal } from '../components/demurrage/DemurragePaymentReversalModal'
import { DemurrageDisputeConversation } from '../components/demurrage/DemurrageDisputeConversation'
import { DiscountModal } from '../components/demurrage/DiscountModal'
import { DisputeModal } from '../components/demurrage/DisputeModal'
import { InvoiceDocument, type DemurrageInvoiceDocumentDetail } from '../components/demurrage/InvoiceDocument'
import { PaymentModal } from '../components/demurrage/PaymentModal'
import { PtaxModal } from '../components/demurrage/PtaxModal'
import { listDemurrageContainers, updateContainerDates } from '../services/demurrage/demurrageContainers'
import {
  cancelDemurrageInvoice,
  createInvoiceForBL,
  getInvoiceDetail,
  listDemurrageInvoices,
  markInvoicePaid,
  applyDemurrageDiscount,
  updateDemurrageInvoice,
} from '../services/demurrage/demurrageInvoices'
import {
  fetchCustomerDemurrageDetail,
  fetchCustomerDemurrageSummary,
  fetchDemurrageKPIs,
  fetchLatestRecalcDate,
  recalculateInvoicesManual,
} from '../services/demurrage/demurrageKpis'
import { DEMURRAGE_INVOICE_TABS } from '../services/demurrage/demurrageInvoiceTabs'
import { EMPTY_DISCOUNT, EMPTY_DISPUTE, type DiscountForm, type DisputeForm } from '../services/demurrage/demurrageForms'
import { effectiveDemurrage, fmtBRL, fmtUSD, groupByBl, isPtaxWarningEligible, lastBusinessDayISO } from '../services/demurrage/demurragePresentation'
import { reverseDemurragePayment } from '../services/reconciliacao'
import { demurrageDatesSchema, demurrageDiscountSchema, formatValidationError } from '../services/financialValidation'
import type { DemurrageContainerListItem, DemurrageInvoice, DemurrageInvoiceItem } from '../types/database'
import { describeActiveFilters } from '../lib/operationalState'
import { printDocumentElement } from '../lib/printDocument'
import { formatDate } from '../lib/utils'

type DemurrageTab = 'containers' | 'clientes' | (typeof DEMURRAGE_INVOICE_TABS)[number]['key']

const TAB_LABELS: { key: DemurrageTab; label: string }[] = [
  { key: 'containers', label: 'Containers' },
  ...DEMURRAGE_INVOICE_TABS.map(({ key, label }) => ({ key, label })),
  { key: 'clientes', label: 'Por Cliente' },
]

const TAB_TO_STATUS = Object.fromEntries(
  DEMURRAGE_INVOICE_TABS.map(({ key, status }) => [key, status]),
) as Record<Exclude<DemurrageTab, 'containers' | 'clientes'>, NonNullable<DemurrageInvoice['status']>>

export function Demurrage() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState<DemurrageTab>('containers')
  // ?busca= permite que alertas de demurrage abram a página já filtrada.
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('busca') ?? '')
  const [generatingBl, setGeneratingBl] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editingContainer, setEditingContainer] = useState<DemurrageContainerListItem | null>(null)
  const [editDischarge, setEditDischarge] = useState('')
  const [editReturn, setEditReturn] = useState('')
  const [viewInvoiceId, setViewInvoiceId] = useState<number | null>(null)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [payingId, setPayingId] = useState<number | null>(null)
  // Guarda o doc_number junto do id: o titulo do modal mostra a chave natural,
  // e o breakdown que a originou pode ja estar fechado quando ele abre.
  const [reversingPayment, setReversingPayment] = useState<{ id: number; docNumber: string | null } | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null)
  const [discountInvoiceId, setDiscountInvoiceId] = useState<number | null>(null)
  const [discountForm, setDiscountForm] = useState<DiscountForm>(EMPTY_DISCOUNT)
  const [disputeInvoiceId, setDisputeInvoiceId] = useState<number | null>(null)
  const [disputeForm, setDisputeForm] = useState<DisputeForm>(EMPTY_DISPUTE)
  const [ptaxModalOpen, setPtaxModalOpen] = useState(false)
  const [ptaxInput, setPtaxInput] = useState('')
  const [dunningModalOpen, setDunningModalOpen] = useState(false)
  const [expandedCustomer, setExpandedCustomer] = useState<number | null>(null)
  const [customerReportOpen, setCustomerReportOpen] = useState(false)

  const { data: containers, isLoading: containersLoading, error: containersError } = useQuery({
    queryKey: ['demurrage-containers'],
    queryFn: () => listDemurrageContainers(),
    staleTime: 60_000,
    enabled: tab === 'containers',
  })
  const { data: kpis } = useQuery({
    queryKey: ['demurrage-kpis'],
    queryFn: fetchDemurrageKPIs,
    staleTime: 60_000,
  })
  const { data: customerSummary } = useQuery({
    queryKey: ['demurrage-customer-summary'],
    queryFn: fetchCustomerDemurrageSummary,
    staleTime: 60_000,
    enabled: tab === 'clientes',
  })
  const { data: customerDetail } = useQuery({
    queryKey: ['demurrage-customer-detail', expandedCustomer],
    queryFn: () => fetchCustomerDemurrageDetail(expandedCustomer!),
    enabled: expandedCustomer != null,
  })
  const { data: latestRecalcDate } = useQuery({
    queryKey: ['demurrage-latest-recalc'],
    queryFn: fetchLatestRecalcDate,
    staleTime: 60_000,
  })

  const invoiceStatus = tab !== 'containers' && tab !== 'clientes' ? TAB_TO_STATUS[tab] : null
  const { data: invoices, isLoading: invoicesLoading, error: invoicesError } = useQuery({
    queryKey: ['demurrage-invoices', invoiceStatus],
    queryFn: () => listDemurrageInvoices({ status: invoiceStatus! }),
    staleTime: 30_000,
    enabled: invoiceStatus != null,
  })
  const { data: invoiceDetail } = useQuery({
    queryKey: ['demurrage-invoice-detail', viewInvoiceId],
    queryFn: () => getInvoiceDetail(viewInvoiceId!),
    enabled: viewInvoiceId != null,
  })
  const { data: breakdownDetail } = useQuery({
    queryKey: ['demurrage-invoice-detail', detailInvoiceId],
    queryFn: () => getInvoiceDetail(detailInvoiceId!),
    enabled: detailInvoiceId != null,
  })

  const recalcStale =
    (kpis?.issuedInvoicesTotalBrl ?? 0) > 0 &&
    isPtaxWarningEligible() &&
    (latestRecalcDate == null || latestRecalcDate < lastBusinessDayISO())

  function invalidateInvoices() {
    void queryClient.invalidateQueries({ queryKey: ['demurrage-invoices'] })
    void queryClient.invalidateQueries({ queryKey: ['demurrage-kpis'] })
  }

  function printInvoiceDocument() {
    const content = document.querySelector<HTMLElement>('.invoice-print-content')
    if (!content) return
    printDocumentElement(content, 'Fatura de Demurrage')
  }

  function openEditContainer(container: DemurrageContainerListItem) {
    setEditingContainer(container)
    setEditDischarge(container.discharge_date ?? '')
    setEditReturn(container.return_date ?? '')
  }

  function openDiscount(invoice: DemurrageInvoice) {
    setDiscountForm({
      discount_type: invoice.discount_type,
      discount_value: invoice.discount_value != null ? String(invoice.discount_value) : '',
      discount_mode: invoice.discount_mode === 'fixed' ? 'fixed' : 'percent',
      discount_justification: invoice.discount_justification ?? '',
      discount_approver: invoice.discount_approver ?? '',
    })
    setDiscountInvoiceId(invoice.id)
  }

  function openDispute(invoice: DemurrageInvoice) {
    setDisputeForm({
      dispute_open: invoice.dispute_open ?? false,
      dispute_subject: invoice.dispute_subject ?? '',
      dispute_reason: invoice.dispute_reason ?? '',
      dispute_status: invoice.dispute_status,
      dispute_notes: invoice.dispute_notes ?? '',
    })
    setDisputeInvoiceId(invoice.id)
  }

  const recalcManualMutation = useMutation({
    mutationFn: (ptax: number) => recalculateInvoicesManual(ptax),
    onSuccess: (result) => {
      showToast(`PTAX aplicada — ${result.updated} fatura(s) recalculada(s).`, 'success')
      setPtaxModalOpen(false)
      setPtaxInput('')
      void queryClient.invalidateQueries({ queryKey: ['demurrage-latest-recalc'] })
      invalidateInvoices()
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Falha ao recalcular.', 'error'),
  })
  const containerDatesMutation = useMutation({
    mutationFn: ({ id, discharge, ret }: { id: number; discharge: string; ret: string | null }) => updateContainerDates(id, discharge, ret),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] })
      setEditingContainer(null)
      showToast('Datas atualizadas.', 'success')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const generateMutation = useMutation({
    mutationFn: (blId: string) => createInvoiceForBL(blId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['demurrage-containers'] })
      invalidateInvoices()
      showToast('Invoice de demurrage criada com sucesso.', 'success')
    },
    onError: (error: Error) => showToast(error.message ?? 'Erro ao gerar invoice.', 'error'),
    onSettled: () => setGeneratingBl(null),
  })
  const payMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => {
      return markInvoicePaid(id, date)
    },
    onSuccess: () => { invalidateInvoices(); setPayingId(null); showToast('Pagamento registrado.', 'success') },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const unpayMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => reverseDemurragePayment(id, reason),
    onSuccess: () => {
      invalidateInvoices()
      setReversingPayment(null)
      showToast('Baixa cancelada com auditoria.', 'success')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const cancelMutation = useMutation({
    mutationFn: cancelDemurrageInvoice,
    onSuccess: () => { invalidateInvoices(); showToast('Invoice cancelada.', 'success') },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const discountMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: DiscountForm }) => {
      const validation = demurrageDiscountSchema.safeParse(form)
      if (!validation.success) throw new Error(formatValidationError(validation.error, 'Desconto invalido.'))
      const discount = validation.data
      await applyDemurrageDiscount({
        invoiceId: id,
        discountType: discount.discount_type,
        discountValue: discount.discount_value,
        discountMode: discount.discount_mode,
        justification: discount.discount_justification,
        approver: discount.discount_approver,
      })
    },
    onSuccess: () => {
      invalidateInvoices()
      setDiscountInvoiceId(null)
      showToast('Desconto atualizado.', 'success')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })
  const disputeMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: DisputeForm }) => updateDemurrageInvoice(id, {
      dispute_open: form.dispute_open,
      dispute_subject: form.dispute_subject || null,
      dispute_reason: form.dispute_reason || null,
      dispute_status: form.dispute_status,
      dispute_notes: form.dispute_notes || null,
    }),
    onSuccess: () => {
      invalidateInvoices()
      setDisputeInvoiceId(null)
      showToast('Disputa atualizada.', 'success')
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  })

  async function handleCancelInvoice(invoiceId: number) {
    const ok = await confirm({
      title: 'Cancelar invoice',
      message: 'Cancelar esta invoice de demurrage?',
      confirmLabel: 'Cancelar invoice',
      tone: 'danger',
    })
    if (ok) cancelMutation.mutate(invoiceId)
  }

  const filtered = (containers ?? []).filter((container) => {
    // Devolvido dentro do free time (sem demurrage) não é monitoramento operacional.
    if (container.demurrage_status === 'returned' && (effectiveDemurrage(container)?.total_usd ?? 0) <= 0) return false
    if (!search) return true
    const query = search.toLowerCase()
    return (
      container.container_number.toLowerCase().includes(query) ||
      (container.bl_id ?? '').toLowerCase().includes(query) ||
      ((container.bl as { customer?: { name?: string } } | null)?.customer?.name ?? '').toLowerCase().includes(query)
    )
  })
  const grouped = groupByBl(filtered)
  const containerFilterDescription = describeActiveFilters([{ label: 'Busca', value: search }])
  const totalOverdueUSD = filtered.reduce((sum, container) => sum + (effectiveDemurrage(container)?.total_usd ?? 0), 0)
  const activeTabLabel = TAB_LABELS.find((item) => item.key === tab)?.label ?? tab

  return (
    <>
      <ContainerDatesImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PtaxModal
        open={ptaxModalOpen}
        value={ptaxInput}
        loading={recalcManualMutation.isPending}
        onValueChange={setPtaxInput}
        onClose={() => setPtaxModalOpen(false)}
        onSubmit={(ptax) => recalcManualMutation.mutate(ptax)}
        onInvalid={() => showToast('Informe uma PTAX válida maior que zero.', 'error')}
      />

      <PageHeader
        title="Demurrage"
        description="Rastreamento e faturamento de sobreestadia de containers"
        action={
          <>
            <Link to="/demurrage/taxas">
              <Button variant="secondary"><DollarSign size={15} />Tarifas</Button>
            </Link>
            <Button variant="secondary" onClick={() => setDunningModalOpen(true)}><Mail size={15} />Régua de Cobrança</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={15} />Importar Datas</Button>
            <Button variant="secondary" onClick={() => setPtaxModalOpen(true)}><DollarSign size={15} />Informar PTAX</Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4"><div className="text-xs text-slate-400">Containers em atraso</div><div className="text-2xl font-bold text-red-400">{kpis?.overdueContainers ?? '—'}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-400">Total USD (visível)</div><div className="text-2xl font-bold text-amber-400">{fmtUSD(totalOverdueUSD)}</div></Card>
        <Card className="p-4"><div className="text-xs text-slate-400">Aguardando pagamento (BRL)</div><div className="text-2xl font-bold text-blue-400">{kpis ? fmtBRL(kpis.issuedInvoicesTotalBrl) : '—'}</div></Card>
      </div>

      {recalcStale ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <span className="flex items-center gap-2"><AlertTriangle size={16} />PTAX de hoje não obtida do BCB. Os valores em BRL podem estar desatualizados.</span>
          <Button variant="secondary" onClick={() => setPtaxModalOpen(true)}>Informar PTAX</Button>
        </div>
      ) : null}
      <DemurrageDisputeConversation />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Seções de Demurrage">
        {TAB_LABELS.map((item) => (
          <TabButton key={item.key} active={tab === item.key} label={item.label} onClick={() => setTab(item.key)} />
        ))}
      </div>

      {tab === 'containers' && (
        <DemurrageContainersTab
          search={search}
          filtered={filtered}
          grouped={grouped}
          filterDescription={containerFilterDescription}
          loading={containersLoading}
          error={containersError}
          generatingBl={generatingBl}
          onSearchChange={setSearch}
          onGenerateInvoice={(blId) => { setGeneratingBl(blId); generateMutation.mutate(blId) }}
          onEditContainer={openEditContainer}
        />
      )}
      {tab === 'clientes' && (
        <DemurrageCustomersTab
          summary={customerSummary}
          detail={customerDetail}
          expandedCustomer={expandedCustomer}
          onExpandedCustomerChange={(customerId) => setExpandedCustomer((id) => id === customerId ? null : customerId)}
          onOpenReport={() => setCustomerReportOpen(true)}
        />
      )}
      {tab !== 'containers' && tab !== 'clientes' && (
        <DemurrageInvoicesTab
          tab={tab}
          tabLabel={activeTabLabel}
          invoices={invoices}
          loading={invoicesLoading}
          error={invoicesError}
          onOpenDetail={setDetailInvoiceId}
          onOpenDocument={(invoiceId, type) => { setViewInvoiceId(invoiceId); setDocType(type) }}
        />
      )}

      <Modal open={editingContainer != null} onClose={() => setEditingContainer(null)} title="Editar datas do container">
        {editingContainer && (
          <div className="space-y-4 p-4">
            <div className="text-sm font-semibold text-[var(--app-text-strong)]">{editingContainer.container_number}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data de descarga" required><Input type="date" value={editDischarge} onChange={(event) => setEditDischarge(event.target.value)} /></Field>
              <Field label="Data de devolução"><Input type="date" value={editReturn} onChange={(event) => setEditReturn(event.target.value)} /></Field>
            </div>
            <div className="flex gap-2">
              <Button loading={containerDatesMutation.isPending} onClick={() => {
                if (!editDischarge) return showToast('Data de descarga obrigatória.', 'error')
                const validation = demurrageDatesSchema.safeParse({ discharge: editDischarge, ret: editReturn })
                if (!validation.success) return showToast(formatValidationError(validation.error), 'error')
                containerDatesMutation.mutate({ id: editingContainer.id, discharge: validation.data.discharge, ret: validation.data.ret })
              }}>Salvar</Button>
              <Button variant="ghost" onClick={() => setEditingContainer(null)}>Voltar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={detailInvoiceId != null} onClose={() => setDetailInvoiceId(null)} title="Detalhes da invoice">
        {breakdownDetail ? (
          <div className="p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-[var(--app-text-strong)]">{breakdownDetail.invoice.doc_number}</div><div className="text-sm text-slate-400">{breakdownDetail.invoice.bl_id} — {fmtUSD(breakdownDetail.invoice.total_usd)}</div></div><div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setDetailInvoiceId(null); openDiscount(breakdownDetail.invoice as DemurrageInvoice) }}>Desconto</Button>
              <Button variant="secondary" onClick={() => { setDetailInvoiceId(null); openDispute(breakdownDetail.invoice as DemurrageInvoice) }}>Disputa</Button>
              {breakdownDetail.invoice.status === 'issued' && <><Button variant="secondary" onClick={() => { setDetailInvoiceId(null); setPayingId(breakdownDetail.invoice.id) }}>Registrar Pgto</Button><Button variant="ghost" onClick={() => { setDetailInvoiceId(null); setViewInvoiceId(breakdownDetail.invoice.id); setDocType('invoice') }}>Fatura</Button><Button variant="ghost" onClick={() => { setDetailInvoiceId(null); void handleCancelInvoice(breakdownDetail.invoice.id) }}>Voltar</Button></>}
              {breakdownDetail.invoice.status === 'paid' && <><Button variant="ghost" onClick={() => { setDetailInvoiceId(null); setViewInvoiceId(breakdownDetail.invoice.id); setDocType('receipt') }}>Recibo</Button><Button variant="ghost" onClick={() => { setDetailInvoiceId(null); setViewInvoiceId(breakdownDetail.invoice.id); setDocType('invoice') }}>Fatura</Button><Button variant="ghost" onClick={() => { setDetailInvoiceId(null); setReversingPayment({ id: breakdownDetail.invoice.id, docNumber: breakdownDetail.invoice.doc_number }) }}>Cancelar baixa</Button></>}
            </div></div>
            <div className="overflow-x-auto">
              <table className="app-table app-table--compact min-w-[700px] text-left text-sm">
                <thead className="bg-[#0d1117] text-xs uppercase text-slate-500"><tr><th scope="col" className="py-2">Container</th><th scope="col" className="py-2">Tipo</th><th scope="col" className="py-2">Descarga</th><th scope="col" className="py-2">Devolução</th><th scope="col" className="py-2">Dias</th><th scope="col" className="py-2">Free</th><th scope="col" className="py-2">P1</th><th scope="col" className="py-2">P2</th><th scope="col" className="py-2">Subtotal</th></tr></thead>
                <tbody className="divide-y divide-[#30363d]">
                  {(breakdownDetail.items as DemurrageInvoiceItem[]).map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 font-semibold text-white">{item.container_number}</td><td className="py-2">{item.container_type}</td><td className="py-2">{formatDate(item.discharge_date)}</td><td className="py-2">{formatDate(item.return_date)}</td><td className="py-2">{item.total_days}d</td><td className="py-2 text-slate-400">{item.free_days}d</td>
                      <td className="py-2">{item.days_p1 > 0 ? <span className="text-amber-400">{item.days_p1}d @ ${item.rate_p1_usd}</span> : '—'}</td><td className="py-2">{item.days_p2 > 0 ? <span className="text-red-400">{item.days_p2}d @ ${item.rate_p2_usd}</span> : '—'}</td><td className="py-2 font-semibold text-amber-400">{fmtUSD(item.subtotal_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end text-sm font-semibold text-amber-400">Total: {fmtUSD(breakdownDetail.invoice.total_usd)}</div>
          </div>
        ) : <div className="p-4 text-sm text-slate-400">Carregando...</div>}
      </Modal>

      <DiscountModal open={discountInvoiceId != null} form={discountForm} loading={discountMutation.isPending} onFormChange={setDiscountForm} onClose={() => setDiscountInvoiceId(null)} onSubmit={() => discountInvoiceId && discountMutation.mutate({ id: discountInvoiceId, form: discountForm })} />
      <DisputeModal open={disputeInvoiceId != null} form={disputeForm} loading={disputeMutation.isPending} onFormChange={setDisputeForm} onClose={() => setDisputeInvoiceId(null)} onSubmit={() => disputeInvoiceId && disputeMutation.mutate({ id: disputeInvoiceId, form: disputeForm })} />
      <PaymentModal open={payingId != null} paymentId={payingId} paymentDate={payDate} onPaymentDateChange={setPayDate} onClose={() => setPayingId(null)} onSubmit={(id, date) => payMutation.mutate({ id, date })} />

      {reversingPayment != null && <DemurragePaymentReversalModal open docNumber={reversingPayment.docNumber} loading={unpayMutation.isPending} onClose={() => setReversingPayment(null)} onSubmit={(reason) => unpayMutation.mutate({ id: reversingPayment.id, reason })} />}
      {viewInvoiceId && invoiceDetail && (
        <Modal open onClose={() => setViewInvoiceId(null)} title={docType === 'invoice' ? 'Fatura de Demurrage' : 'Recibo de Demurrage'}>
          <div className="mb-2 flex justify-end gap-2"><Button variant="secondary" onClick={printInvoiceDocument}>Imprimir</Button></div>
          <div className="invoice-print-content"><InvoiceDocument detail={{ ...invoiceDetail.invoice, items: invoiceDetail.items } satisfies DemurrageInvoiceDocumentDetail} type={docType} /></div>
        </Modal>
      )}
      {customerReportOpen && customerSummary && <CustomerReportModal open rows={customerSummary} onClose={() => setCustomerReportOpen(false)} />}
      <DemurrageDunningSettingsModal open={dunningModalOpen} onClose={() => setDunningModalOpen(false)} />
    </>
  )
}
