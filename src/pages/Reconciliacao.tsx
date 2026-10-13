import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { useToast } from '../components/ui/Toast'
import { StatusScreen } from '../components/layout/StatusScreen'
import { InvoiceDetailModal } from '../components/billing/InvoiceDetailModal'
import { ReconciliationHistoryTable } from '../components/billing/ReconciliationHistoryTable'
import { PixExtractPanel } from '../components/billing/PixExtractPanel'
import { PixPendingPanel } from '../components/billing/PixPendingPanel'
import { countPixPending } from '../components/billing/pixReconciliationPresentation'
import { useItauPixMonitor, usePixExceptions } from '../hooks/usePixReconciliation'
import { DemurrageInvoiceDetailModal } from '../components/demurrage/DemurrageInvoiceDetailModal'
import { DemurragePaymentReversalModal } from '../components/demurrage/DemurragePaymentReversalModal'
import { InvoiceDocument as DemurrageInvoiceDoc, type DemurrageInvoiceDocumentDetail } from '../components/demurrage/InvoiceDocument'
import { useAuth } from '../hooks/useAuth'
import { useFinancialRefunds } from '../hooks/useFinancialRefunds'
import { useDemurrageComplementOf } from '../hooks/useDemurrageComplementOf'
import { extractErrorText } from '../lib/errors'
import { printDocumentElement } from '../lib/printDocument'
import { afterFaturaDemurrageAlterada } from '../services/cacheEffects'
import { getInvoiceDetail as getDemurrageDetail } from '../services/demurrage/demurrageInvoices'
import { reversalDatesNotice } from '../services/demurrage/demurragePresentation'
import { reverseDemurragePayment } from '../services/reconciliacao'
import { demurrageInvoiceHref } from './demurrageListState'
import { reconciliacaoTabFromSearch, withReconciliacaoTab, type ReconciliacaoTab } from './reconciliacaoState'

export function Reconciliacao() {
  const { isAdmin } = useAuth()

  // A guarda é só navegação; as RPCs de baixa, exceção e monitor exigem o
  // Administrativo no banco.
  if (!isAdmin) {
    return (
      <StatusScreen
        role="alert"
        icon={Lock}
        title="Acesso restrito"
        actions={<Link to="/painel" className="app-btn app-btn--primary">Voltar para o Painel</Link>}
      >
        <p>A Conciliação PIX baixa pagamentos e é exclusiva do departamento Administrativo. Se precisar dela no seu trabalho, fale com o Administrativo.</p>
      </StatusScreen>
    )
  }

  return <ReconciliacaoContent />
}

const TAB_LABELS: Record<ReconciliacaoTab, string> = {
  pendencias: 'Pendências',
  extrato: 'Conciliar extrato',
  historico: 'Histórico de baixas',
}

type OpenedInvoice =
  | { source: 'local'; invoiceId: number; paymentId: number | null }
  | { source: 'demurrage'; invoiceId: number }

function ReconciliacaoContent() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = reconciliacaoTabFromSearch(searchParams)
  // Cada aba monta na primeira visita e continua montada: a leitura do extrato
  // e o recorte do histórico não se perdem ao trocar de aba, e o histórico só
  // consulta quando alguém o abre.
  const [visited, setVisited] = useState<ReadonlySet<ReconciliacaoTab>>(() => new Set([tab]))
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]))

  const [opened, setOpened] = useState<OpenedInvoice | null>(null)
  const [returnTo, setReturnTo] = useState<number | null>(null)
  const [reversing, setReversing] = useState<{ id: number; docNumber: string | null; datesChanged: { negotiated: boolean } | null } | null>(null)
  const [reverseError, setReverseError] = useState<string | null>(null)
  const [document, setDocument] = useState<{ id: number; type: 'invoice' | 'receipt' } | null>(null)

  const monitorQuery = useItauPixMonitor()
  const exceptionsQuery = usePixExceptions()
  const pendingCount = countPixPending(monitorQuery.data, exceptionsQuery.data)

  const selectTab = (next: ReconciliacaoTab) => setSearchParams((params) => withReconciliacaoTab(params, next), { replace: true })
  const openInvoice = (source: 'local' | 'demurrage', invoiceId: number, paymentId: number | null = null) =>
    setOpened(source === 'local' ? { source, invoiceId, paymentId } : { source, invoiceId })

  /** Formulário aberto a partir do detalhe de Demurrage: toma o lugar do diálogo e volta para ele. */
  function fromDemurrageDetail(action: () => void) {
    if (opened?.source === 'demurrage') setReturnTo(opened.invoiceId)
    setOpened(null)
    action()
  }
  function backToDemurrageDetail() {
    if (returnTo != null) setOpened({ source: 'demurrage', invoiceId: returnTo })
    setReturnTo(null)
  }
  /** Pagamento, desconto, disputa e cancelamento da Invoice são de Demurrage: abre a Invoice lá. */
  const openInDemurrage = (invoiceId: number) => navigate(demurrageInvoiceHref(invoiceId))

  const reversalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => reverseDemurragePayment(id, reason),
    onMutate: () => setReverseError(null),
    onSuccess: async () => {
      setReversing(null)
      await afterFaturaDemurrageAlterada(queryClient)
      if (returnTo != null) await queryClient.refetchQueries({ queryKey: ['demurrage-invoice-detail', returnTo], type: 'all' })
      showToast('Baixa de Demurrage cancelada com auditoria.', 'success')
      backToDemurrageDetail()
    },
    onError: (error: Error) => setReverseError(extractErrorText(error)),
  })

  // Recibo só imprime depois de consultar as restituições (manual financeiro, Recibo de Demurrage).
  const receiptRefunds = useFinancialRefunds('demurrage', document?.type === 'receipt' ? document.id : null)
  const documentQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', document?.id ?? null],
    queryFn: () => getDemurrageDetail(document!.id),
    enabled: document != null,
  })
  const documentDetail = documentQuery.data
  const complementOf = useDemurrageComplementOf(documentDetail?.invoice)
  const documentTitle = document?.type === 'receipt' ? 'Recibo de Demurrage' : 'Fatura de Demurrage'
  const refundsPending = document?.type === 'receipt' && !receiptRefunds.data

  function printDemurrageDocument() {
    const content = window.document.querySelector<HTMLElement>('.invoice-print-content')
    if (content && !refundsPending) printDocumentElement(content, documentTitle)
  }

  const panelId = 'reconciliacao-panel'
  const tabs: ReconciliacaoTab[] = ['pendencias', 'extrato', 'historico']

  return (
    <div className="app-pix-page">
      <PageHeader title="Conciliação PIX" />

      <TabList label="Seções da Conciliação PIX" className="app-pix-tabs">
        {tabs.map((item) => (
          <TabButton
            key={item}
            id={`pix-tab-${item}`}
            controls={visited.has(item) ? `${panelId}-${item}` : undefined}
            active={tab === item}
            label={TAB_LABELS[item]}
            count={item === 'pendencias' ? pendingCount : undefined}
            countLabel={item === 'pendencias' && pendingCount != null ? `${pendingCount} ${pendingCount === 1 ? 'pede' : 'pedem'} ação` : undefined}
            onClick={() => selectTab(item)}
          />
        ))}
      </TabList>

      {tabs.filter((item) => visited.has(item)).map((item) => (
        <div key={item} id={`${panelId}-${item}`} role="tabpanel" aria-labelledby={`pix-tab-${item}`} hidden={tab !== item}>
          {item === 'pendencias' ? (
            <PixPendingPanel onOpenExtract={() => selectTab('extrato')} onOpenInvoice={(source, id) => openInvoice(source, id)} />
          ) : null}
          {item === 'extrato' ? (
            <PixExtractPanel onOpenPending={() => selectTab('pendencias')} onOpenInvoice={(source, id) => openInvoice(source, id)} />
          ) : null}
          {item === 'historico' ? (
            <ReconciliationHistoryTable
              onSelectLocalInvoice={(id, paymentId) => openInvoice('local', id, paymentId)}
              onSelectDemurrageInvoice={(id) => openInvoice('demurrage', id)}
            />
          ) : null}
        </div>
      ))}

      <InvoiceDetailModal
        invoiceId={opened?.source === 'local' ? opened.invoiceId : null}
        onClose={() => setOpened(null)}
        enablePaymentReversal
        paymentId={opened?.source === 'local' ? opened.paymentId : null}
      />

      <DemurrageInvoiceDetailModal
        invoiceId={opened?.source === 'demurrage' ? opened.invoiceId : null}
        permissions={{ canSettle: true, canAdmin: true, canAnswerDispute: true }}
        cancelling={false}
        onClose={() => setOpened(null)}
        onOpenInvoice={(id) => openInvoice('demurrage', id)}
        onRegisterPayment={(invoice) => openInDemurrage(invoice.id)}
        onDiscount={(invoice) => openInDemurrage(invoice.id)}
        onDisputeData={(invoice) => openInDemurrage(invoice.id)}
        onOpenDisputes={(invoice) => openInDemurrage(invoice.id)}
        onCancelInvoice={(invoice) => openInDemurrage(invoice.id)}
        onOpenDocument={(id, type) => fromDemurrageDetail(() => setDocument({ id, type }))}
        onReversePayment={(invoice) => fromDemurrageDetail(() => {
          setReverseError(null)
          setReversing({ id: invoice.id, docNumber: invoice.doc_number, datesChanged: reversalDatesNotice(invoice) })
        })}
      />

      {reversing ? (
        <DemurragePaymentReversalModal
          open
          docNumber={reversing.docNumber}
          datesChanged={reversing.datesChanged}
          loading={reversalMutation.isPending}
          error={reverseError}
          onClose={() => { setReversing(null); setReverseError(null); backToDemurrageDetail() }}
          onSubmit={(reason) => reversalMutation.mutate({ id: reversing.id, reason })}
        />
      ) : null}

      {document ? (
        <Modal
          open
          onClose={() => { setDocument(null); backToDemurrageDetail() }}
          title={`${documentTitle}${documentDetail ? ` ${documentDetail.invoice.doc_number}` : ''}`}
        >
          <div className="app-dem-document-toolbar">
            <Button variant="secondary" disabled={!documentDetail || refundsPending} onClick={printDemurrageDocument}>Imprimir</Button>
          </div>
          {documentQuery.error ? <p className="app-dem-form__error" role="alert">Não foi possível carregar o documento: {extractErrorText(documentQuery.error)}</p> : null}
          {!documentDetail && !documentQuery.error ? <p className="app-dem-meta" role="status">Carregando o documento…</p> : null}
          {documentDetail && refundsPending ? (
            <p role="status" className="app-dem-meta">{receiptRefunds.error ? 'Falha ao consultar restituições. Recarregue antes de emitir o recibo.' : 'Consultando restituições…'}</p>
          ) : null}
          {documentDetail ? (
            <div className="invoice-print-content">
              <DemurrageInvoiceDoc
                detail={{ ...documentDetail.invoice, items: documentDetail.items, refund_summary: receiptRefunds.data, complement_of: complementOf } satisfies DemurrageInvoiceDocumentDetail}
                type={document.type}
              />
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  )
}
