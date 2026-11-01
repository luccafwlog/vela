import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FilePlus2, Printer } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { InlineError, PageHeader } from '../components/ui/Card'
import { MetricCard } from '../components/ui/MetricCard'
import { TabButton } from '../components/ui/TabButton'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { InvoiceDocumentLocal } from '../components/billing/InvoiceDocumentLocal'
import { InvoiceDocument as DemurrageInvoiceDocument, type DemurrageInvoiceDocumentDetail } from '../components/demurrage/InvoiceDocument'
import { InformationLinks } from '../components/portal/information/InformationLinks'
import { PortalConsolidatedModal } from '../components/portal/PortalConsolidatedModal'
import { DisputeModal } from '../components/portal/DisputeModal'
import { PortalDemurrageDetailModal } from '../components/portal/PortalDemurrageDetailModal'
import { PortalDisputesScreen } from '../components/portal/PortalDisputeConversation'
import { PortalInvoiceDetailModal } from '../components/portal/PortalInvoiceDetailModal'
import { PortalPixPayModal } from '../components/portal/PortalPixPayModal'
import { DemurrageTab, LocalFeesTab } from '../components/portal/PortalBillingTabs'
import { usePortalAuth } from '../hooks/usePortalAuth'
import { usePortalScope } from '../hooks/usePortalScope'
import {
  usePortalConsolidatableReceivables,
  usePortalCurrentRoe,
  usePortalDemurrageComplements,
  usePortalDemurrageInvoiceDetail,
  usePortalDemurrageInvoicesPage,
  usePortalInvoiceDetail,
  usePortalInvoicesPage,
  usePortalObsoleteConsolidation,
} from '../hooks/usePortalBilling'
import { usePortalDisputes } from '../hooks/usePortalDisputes'
import { buildInvoiceFileBaseName } from '../components/shared/invoiceFormat'
import { exportPortalDemurrageWorkbook, exportPortalLocalInvoicesWorkbook } from '../services/exports'
import { portalInvoiceDocumentDetail, portalListDemurrageInvoicesForExport, portalListInvoicesForExport, type PortalDemurrageInvoice, type PortalInvoiceSummary } from '../services/portalBilling'
import { EMPTY_PORTAL_BILLING_FILTERS, portalBillingFiltersFromSearch, type PortalBillingFilters } from '../lib/portalBillingFilters'
import { demurrageInvoiceShowsPix, localInvoiceShowsPix } from '../lib/portalInvoiceStatus'
import { formatBRL } from '../lib/utils'
import { portalErrorMessage } from '../lib/portalErrorMessage'
import { isPortalReadOnly } from '../services/portalScope'
import { featureFlags, initFeatureFlags, PRODUCT_EVENTS } from '../lib/featureFlags'

type PortalTab = 'local' | 'demurrage'
type Filters = PortalBillingFilters

const BILLING_PAGE_SIZE = 25

export function PortalBilling() {
  const { overview: authOverview } = usePortalAuth()
  const portalScope = usePortalScope()
  const readOnly = isPortalReadOnly(portalScope)
  const { overview } = portalScope
  const effectiveOverview = overview ?? authOverview
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: receivables } = usePortalConsolidatableReceivables()
  const { data: currentRoe } = usePortalCurrentRoe()
  const obsoleteMutation = usePortalObsoleteConsolidation()
  const disputesQuery = usePortalDisputes()
  const disputes = disputesQuery.data
  const complements = usePortalDemurrageComplements()

  const [searchParams, setSearchParams] = useSearchParams()
  const tab: PortalTab = searchParams.get('tab') === 'demurrage' ? 'demurrage' : 'local'
  const setTab = (next: PortalTab) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('tab', next)
      return params
    })
  }
  // Disputas de Demurrage: outra tela dentro de Faturas, na URL
  // (`?tab=demurrage&disputas=1`, e `&disputa=<id>` com a conversa aberta).
  const disputesOpen = tab === 'demurrage' && searchParams.get('disputas') === '1'
  const selectedDisputeId = Number(searchParams.get('disputa')) || null
  const showDisputes = (disputeId: number | null = null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.set('tab', 'demurrage')
      params.set('disputas', '1')
      if (disputeId) params.set('disputa', String(disputeId))
      else params.delete('disputa')
      return params
    })
  }
  const leaveDisputes = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.delete('disputas')
      params.delete('disputa')
      return params
    })
  }
  const [consolidateOpen, setConsolidateOpen] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [selectedDemurrageId, setSelectedDemurrageId] = useState<number | null>(null)
  const [disputeInvoiceId, setDisputeInvoiceId] = useState<number | null>(null)
  const [disputeDocNumber, setDisputeDocNumber] = useState('')
  const [printOpen, setPrintOpen] = useState(false)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [demurragePrint, setDemurragePrint] = useState<'invoice' | 'receipt' | null>(null)
  const [exporting, setExporting] = useState(false)
  // Atalho de outra tela (`?bl=` e `?status=`, como "Ver faturas do B/L" do
  // Desbloqueio de CE) chega com a aba já filtrada; os parâmetros saem da URL
  // logo depois, e a barra de filtros mostra o recorte com "Limpar".
  const [urlFilters] = useState(() => portalBillingFiltersFromSearch(searchParams))
  const [localFilters, setLocalFilters] = useState<Filters>(() => (tab === 'local' && urlFilters) || EMPTY_PORTAL_BILLING_FILTERS)
  const [demFilters, setDemFilters] = useState<Filters>(() => (tab === 'demurrage' && urlFilters) || EMPTY_PORTAL_BILLING_FILTERS)
  useEffect(() => {
    if (!urlFilters) return
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.delete('bl')
      params.delete('status')
      return params
    }, { replace: true })
  }, [urlFilters, setSearchParams])
  const [pixLocal, setPixLocal] = useState<PortalInvoiceSummary | null>(null)
  const [pixDemurrage, setPixDemurrage] = useState<PortalDemurrageInvoice | null>(null)
  const [localPage, setLocalPage] = useState(0)
  const [demPage, setDemPage] = useState(0)

  const localInvoicesQuery = usePortalInvoicesPage(localFilters, localPage, BILLING_PAGE_SIZE)
  const demurrageInvoicesQuery = usePortalDemurrageInvoicesPage(demFilters, demPage, BILLING_PAGE_SIZE)
  const localInvoices = localInvoicesQuery.data?.rows ?? []
  const localInvoiceCount = localInvoicesQuery.data?.totalCount ?? 0
  const demurrageInvoices = demurrageInvoicesQuery.data?.rows ?? []
  const demurrageInvoiceCount = demurrageInvoicesQuery.data?.totalCount ?? 0

  const detailQuery = usePortalInvoiceDetail(selectedInvoiceId)
  // Individual coberta: a forma e a data do pagamento vêm da consolidada que a cobriu.
  // ponytail: uma leitura a mais por abertura; se pesar, portal_invoice_details devolve os pagamentos dela.
  const coveredInvoice = detailQuery.data?.invoice
  const coveringQuery = usePortalInvoiceDetail(coveredInvoice?.status === 'covered' ? coveredInvoice.covered_by_invoice_id ?? null : null)
  const demurrageDetailQuery = usePortalDemurrageInvoiceDetail(selectedDemurrageId)
  // "Pagar com Pix" da lista: a lista local não traz o código Pix; ele vem do
  // mesmo detalhe (mesma chave de cache do detalhe da fatura).
  const pixLocalQuery = usePortalInvoiceDetail(pixLocal?.id ?? null)
  // Demurrage relê o detalhe também: a linha da lista é uma foto e não vê o
  // Pix que o Itaú confirmou nem o pagamento feito com a janela aberta.
  const pixDemurrageQuery = usePortalDemurrageInvoiceDetail(pixDemurrage?.id ?? null)
  const trackedInvoiceViews = useRef(new Set<string>())

  useEffect(() => {
    const invoice = detailQuery.data?.invoice
    if (
      portalScope.mode !== 'client' ||
      !selectedInvoiceId ||
      !detailQuery.isSuccess ||
      detailQuery.isLoading ||
      detailQuery.error ||
      !invoice ||
      Number(invoice.id) !== selectedInvoiceId
    ) return

    const key = `local:${selectedInvoiceId}`
    if (trackedInvoiceViews.current.has(key)) return
    trackedInvoiceViews.current.add(key)
    void initFeatureFlags().then(() => {
      featureFlags.capture(PRODUCT_EVENTS.INVOICE_VIEWED, { surface: 'portal', invoice_type: 'local' })
    })
  }, [portalScope.mode, selectedInvoiceId, detailQuery.data, detailQuery.error, detailQuery.isLoading, detailQuery.isSuccess])

  useEffect(() => {
    const invoice = demurrageDetailQuery.data?.invoice
    if (
      portalScope.mode !== 'client' ||
      !selectedDemurrageId ||
      !demurrageDetailQuery.isSuccess ||
      demurrageDetailQuery.isLoading ||
      demurrageDetailQuery.error ||
      !invoice ||
      Number(invoice.id) !== selectedDemurrageId
    ) return

    const key = `demurrage:${selectedDemurrageId}`
    if (trackedInvoiceViews.current.has(key)) return
    trackedInvoiceViews.current.add(key)
    void initFeatureFlags().then(() => {
      featureFlags.capture(PRODUCT_EVENTS.INVOICE_VIEWED, { surface: 'portal', invoice_type: 'demurrage' })
    })
  }, [portalScope.mode, selectedDemurrageId, demurrageDetailQuery.data, demurrageDetailQuery.error, demurrageDetailQuery.isLoading, demurrageDetailQuery.isSuccess])

  const eligibleCount = (receivables ?? []).filter((r) => r.eligibility_status === 'eligible').length

  const updateLocalFilters = (next: Filters) => {
    setLocalFilters(next)
    setLocalPage(0)
  }
  const updateDemFilters = (next: Filters) => {
    setDemFilters(next)
    setDemPage(0)
  }

  async function handleExport() {
    setExporting(true)
    try {
      if (tab === 'demurrage') {
        const rows = await portalListDemurrageInvoicesForExport(demFilters, portalScope)
        await exportPortalDemurrageWorkbook(rows)
        return
      }
      const rows = await portalListInvoicesForExport(localFilters, portalScope)
      await exportPortalLocalInvoicesWorkbook(rows)
    } catch (error) {
      showToast(portalErrorMessage(error, 'Falha ao exportar as faturas.'), 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleObsolete() {
    if (!detailQuery.data?.invoice) return
    const confirmed = await confirm({
      title: 'Desfazer fatura consolidada',
      message: 'Desfazer esta fatura consolidada? Os B/Ls voltam a ficar disponíveis para uma nova consolidação.',
      confirmLabel: 'Desfazer',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await obsoleteMutation.mutateAsync(Number(detailQuery.data.invoice.id))
      showToast('Fatura consolidada desfeita. Os B/Ls foram liberados.', 'success')
      setSelectedInvoiceId(null)
    } catch (error) {
      showToast(portalErrorMessage(error, 'Falha ao desfazer a fatura.'), 'error')
    }
  }

  const detailInvoice = detailQuery.data?.invoice
  const canObsolete =
    detailInvoice?.invoice_type === 'consolidated' &&
    ['issued', 'partially_paid', 'overdue'].includes(detailInvoice.status ?? 'issued') &&
    (detailQuery.data?.payments.length ?? 0) === 0

  const openDisputeCount = (disputes ?? []).filter((item) => item.state === 'aberta').length
  const demurrageDetail = demurrageDetailQuery.data
  const selectedDemurrageDispute = (disputes ?? []).find((item) => item.demurrage_invoice_id === selectedDemurrageId && item.state === 'aberta') ?? null
  // Uma conversa por Invoice (ADR 0112, D17): depois da resolvida, só a reabertura.
  const selectedResolvedDispute = selectedDemurrageDispute ? null
    : (disputes ?? []).find((item) => item.demurrage_invoice_id === selectedDemurrageId && item.state === 'resolvida') ?? null
  const demurrageComplementOf = demurrageDetail?.invoice ? complements.complementOf(demurrageDetail.invoice) : undefined
  // A Invoice e o recibo dizem de qual Invoice esta completa: enquanto isso
  // não se sabe (ou a consulta falhou), o documento não é impresso.
  const demurragePrintBlocked = complements.pending || complements.failed

  const demurrageModals = (
    <>
      <DisputeModal
        demurrageInvoiceId={disputeInvoiceId}
        docNumber={disputeDocNumber}
        onClose={() => setDisputeInvoiceId(null)}
      />
      <PortalDemurrageDetailModal
        open={Boolean(selectedDemurrageId)}
        invoiceId={selectedDemurrageId}
        detail={demurrageDetail}
        loading={demurrageDetailQuery.isLoading}
        dispute={selectedDemurrageDispute}
        resolvedDispute={selectedResolvedDispute}
        complementOf={demurrageComplementOf}
        onClose={() => setSelectedDemurrageId(null)}
        onPrint={() => setDemurragePrint(demurrageDetail?.invoice.status === 'paid' || demurrageDetail?.invoice.status === 'covered' ? 'receipt' : 'invoice')}
        onDispute={(id: number, doc: string) => { setSelectedDemurrageId(null); setDisputeInvoiceId(id); setDisputeDocNumber(doc) }}
        onShowDispute={() => {
          setSelectedDemurrageId(null)
          showDisputes(selectedDemurrageDispute?.id ?? selectedResolvedDispute?.id ?? null)
        }}
        onOpenInvoice={setSelectedDemurrageId}
      />
      {demurragePrint && demurrageDetail?.invoice ? (
        <Modal open onClose={() => setDemurragePrint(null)} title={`${demurragePrint === 'receipt' ? 'Recibo' : 'Invoice'} ${demurrageDetail.invoice.doc_number}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDemurragePrint(null)}>Fechar</Button>
            <Button loading={complements.pending} disabled={demurragePrintBlocked} onClick={() => window.print()}><Printer size={16} />Imprimir</Button>
          </div>
          {complements.failed ? <div className="mb-3"><InlineError message="Não foi possível confirmar se esta Invoice completa outra. Tente de novo em instantes." /></div> : null}
          <div className="invoice-print-content">
            <DemurrageInvoiceDocument
              detail={{
                ...demurrageDetail.invoice,
                items: demurrageDetail.items,
                refund_summary: demurrageDetail.refund_summary ?? undefined,
                complement_of: demurrageComplementOf?.map((other) => other.doc_number),
                customer: { name: demurrageDetail.invoice.customer_name, cnpj_cpf: demurrageDetail.invoice.customer_cnpj_cpf },
                bl: { pol: demurrageDetail.invoice.pol, pod: demurrageDetail.invoice.pod, voyage: { voyage_number: demurrageDetail.invoice.voyage_number, vessel: { name: demurrageDetail.invoice.vessel_name } } },
              } satisfies DemurrageInvoiceDocumentDetail}
              type={demurragePrint}
            />
          </div>
        </Modal>
      ) : null}
    </>
  )

  if (disputesOpen) {
    return (
      <>
        <PortalDisputesScreen
          disputes={disputes ?? []}
          loading={disputesQuery.isLoading}
          error={Boolean(disputesQuery.error)}
          invoices={complements.invoices ?? []}
          selectedDisputeId={selectedDisputeId}
          onOpenDispute={showDisputes}
          onBackToList={() => showDisputes(null)}
          onBackToInvoices={leaveDisputes}
          onOpenInvoice={setSelectedDemurrageId}
        />
        {demurrageModals}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Faturas"
        description="Consulte e pague suas faturas locais, avulsas e de Demurrage com Pix."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" loading={exporting} onClick={() => void handleExport()}>
              <Download size={16} />
              Exportar Excel
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConsolidateOpen(true)}
              disabled={readOnly}
              title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
            >
              <FilePlus2 size={16} />
              Gerar fatura consolidada
            </Button>
          </div>
        }
      />

      <div className="mb-5 grid gap-4 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
        <MetricCard label="Saldo pendente" value={formatBRL(effectiveOverview?.pending_balance)} />
        <MetricCard label="Faturas emitidas" value={String(localInvoiceCount)} />
        <MetricCard label="B/Ls elegíveis" value={String(eligibleCount)} />
      </div>

      <div className="mb-4"><InformationLinks sections={[tab === 'local' ? 'taxas' : 'demurrage', 'atendimento']} pod={(tab === 'local' ? localFilters : demFilters).pod} /></div>

      <div className="mb-4 flex gap-2 border-b border-[var(--app-border)]" role="tablist">
        <TabButton active={tab === 'local'} label="Taxas Locais" onClick={() => setTab('local')} />
        <TabButton active={tab === 'demurrage'} label="Demurrage" onClick={() => setTab('demurrage')} />
      </div>

      {tab === 'local' ? (
        <LocalFeesTab
          invoices={localInvoices}
          totalCount={localInvoiceCount}
          page={localPage}
          onPageChange={setLocalPage}
          loading={localInvoicesQuery.isLoading}
          error={Boolean(localInvoicesQuery.error)}
          filters={localFilters}
          onFilters={updateLocalFilters}
          vesselOptions={localInvoicesQuery.data?.vesselOptions ?? []}
          pods={localInvoicesQuery.data?.pods ?? []}
          onOpenDetail={setSelectedInvoiceId}
          onPayPix={setPixLocal}
        />
      ) : (
        <DemurrageTab
          invoices={demurrageInvoices}
          totalCount={demurrageInvoiceCount}
          page={demPage}
          onPageChange={setDemPage}
          loading={demurrageInvoicesQuery.isLoading}
          error={Boolean(demurrageInvoicesQuery.error)}
          filters={demFilters}
          onFilters={updateDemFilters}
          vesselOptions={demurrageInvoicesQuery.data?.vesselOptions ?? []}
          pods={demurrageInvoicesQuery.data?.pods ?? []}
          onOpenDetail={setSelectedDemurrageId}
          roe={currentRoe}
          openDisputeCount={openDisputeCount}
          onOpenDisputes={() => showDisputes(null)}
          complementOf={complements.complementOf}
          onPayPix={setPixDemurrage}
        />
      )}

      {pixLocal ? (() => {
        const invoice = pixLocalQuery.data?.invoice
        const balance = Number(invoice?.balance_brl ?? 0)
        const received = Number(invoice?.total_paid_brl ?? 0)
        const showPix = invoice ? localInvoiceShowsPix(invoice) : false
        return (
          <PortalPixPayModal
            open
            invoiceNumber={pixLocal.invoice_number ?? `INV-${pixLocal.id}`}
            amount={`${formatBRL(invoice ? balance : pixLocal.balance_brl)} a pagar`}
            amountDetail={received > 0 && balance > 0 ? `de ${formatBRL(invoice?.total_brl)}; o QR cobra o saldo` : undefined}
            pix={showPix ? invoice?.pix_payload ?? null : undefined}
            loading={pixLocalQuery.isLoading}
            error={Boolean(pixLocalQuery.error)}
            onOpenDetail={() => { setSelectedInvoiceId(pixLocal.id); setPixLocal(null) }}
            onClose={() => setPixLocal(null)}
          />
        )
      })() : null}
      {pixDemurrage ? (() => {
        const invoice = pixDemurrageQuery.data?.invoice
        const brl = invoice?.current_total_brl
        const showPix = invoice ? demurrageInvoiceShowsPix(invoice) : false
        return (
          <PortalPixPayModal
            open
            invoiceNumber={pixDemurrage.doc_number}
            amount={brl == null ? 'Sem total em R$' : `${formatBRL(brl)} a pagar hoje`}
            amountDetail="O valor em reais acompanha a cotação do dia até o pagamento."
            pix={showPix ? invoice?.pix_payload ?? null : undefined}
            loading={pixDemurrageQuery.isLoading}
            error={Boolean(pixDemurrageQuery.error)}
            onOpenDetail={() => { setSelectedDemurrageId(pixDemurrage.id); setPixDemurrage(null) }}
            onClose={() => setPixDemurrage(null)}
          />
        )
      })() : null}

      <PortalConsolidatedModal
        open={consolidateOpen}
        onClose={() => setConsolidateOpen(false)}
        onCreated={(id) => setSelectedInvoiceId(id)}
      />

      <PortalInvoiceDetailModal
        open={Boolean(selectedInvoiceId)}
        invoiceId={selectedInvoiceId}
        detail={detailQuery.data}
        loading={detailQuery.isLoading}
        error={detailQuery.error}
        canObsolete={canObsolete}
        obsoleteLoading={obsoleteMutation.isPending}
        onClose={() => setSelectedInvoiceId(null)}
        onObsolete={() => void handleObsolete()}
        onPrint={() => setPrintOpen(true)}
        onPrintReceipt={() => setReceiptOpen(true)}
        onOpenInvoice={setSelectedInvoiceId}
        coveringPayments={coveringQuery.data?.payments}
      />
      {printOpen && detailQuery.data?.invoice ? (
        <Modal open onClose={() => setPrintOpen(false)} title={`Imprimir fatura ${detailQuery.data.invoice.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPrintOpen(false)}>Fechar</Button>
            <Button
              onClick={() => {
                const prev = document.title
                document.title = buildInvoiceFileBaseName(portalInvoiceDocumentDetail(detailQuery.data!))
                window.print()
                document.title = prev
              }}
            >
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
          <div className="invoice-print-content">
            <InvoiceDocumentLocal detail={portalInvoiceDocumentDetail(detailQuery.data)} />
          </div>
        </Modal>
      ) : null}

      {demurrageModals}
      {receiptOpen && detailQuery.data?.invoice?.status === 'paid' ? (
        <Modal open onClose={() => setReceiptOpen(false)} title={`Recibo ${detailQuery.data.invoice.invoice_number ?? ''}`}>
          <div className="mb-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReceiptOpen(false)}>Fechar</Button>
            <Button onClick={() => window.print()}><Printer size={16} />Imprimir</Button>
          </div>
          <div className="invoice-print-content"><InvoiceDocumentLocal detail={portalInvoiceDocumentDetail(detailQuery.data)} type="receipt" /></div>
        </Modal>
      ) : null}
    </>
  )
}
