import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConfirm } from '../ui/ConfirmDialog'
import { formatCommunicationDateTime } from '../../services/customerCommunicationTemplates'
import {
  dispatchCeMercanteTaxasCommunication,
  type CustomerVoyageCommunicationStatus,
} from '../../services/customerFinanceCommunications'
import { getInvoiceCommunicationContext, getInvoiceCommunicationContexts, type InvoiceListRow } from '../../services/billing'
import { queryKeys } from '../../services/queryKeys'
import { useCustomerVoyageCommunicationStatuses } from '../../hooks/useCustomerCommunicationReadiness'

type Props = { invoice: InvoiceListRow }

function statusText(status: CustomerVoyageCommunicationStatus['latest']): string {
  if (!status) return 'Aguardando envio automático'
  const when = formatCommunicationDateTime(status.createdAt)
  const action = status.attemptDiscriminator === 0 ? 'Enviado automaticamente' : 'Reenviado manualmente'
  if (status.status === 'enviado') return `${action} em ${when}`
  if (status.status === 'simulado') return `${action} em simulação em ${when}`
  if (status.status === 'parcial') return `Envio parcial em ${when}`
  if (status.status === 'falha') return `Falha no ${status.attemptDiscriminator === 0 ? 'envio automático' : 'reenvio manual'} em ${when}`
  return `Status do comunicado: ${status.status}`
}

export function InvoiceCommunicationStatusCell({ invoice }: Props) {
  const contexts = getInvoiceCommunicationContexts(invoice)
  const context = getInvoiceCommunicationContext(invoice)
  const statusQueries = useCustomerVoyageCommunicationStatuses(contexts)
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryMutation = useMutation({
    mutationFn: (retryContext: { voyageId: number; customerId: number }) => dispatchCeMercanteTaxasCommunication(retryContext.voyageId, retryContext.customerId, { forceRetry: true }),
    onSuccess: async (_, retryContext) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.status(retryContext.voyageId, retryContext.customerId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.statusRoot() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerCommunications.all() }),
      ])
      setRetryError(null)
    },
    onError: (error) => setRetryError(error instanceof Error ? error.message : 'Falha ao reenviar o comunicado.'),
  })

  if (!contexts.length || context.voyageId == null) return <span className="app-invoice-comm app-invoice-comm--muted">Sem viagem vinculada</span>

  // Uma linha por viagem; o nome da viagem só aparece quando a fatura tem mais de uma.
  return (
    <div className="app-invoice-comm" data-testid="customer-finance-communication-status">
      {contexts.map((voyageContext, index) => {
        const statusQuery = statusQueries[index]
        const status = statusQuery?.data
        const canRetry = Boolean(status?.readiness.ready && status.latest)
        const tone = !status ? 'muted' : status.blockedReason ? 'warning' : status.latest?.status === 'enviado' ? 'success' : status.latest?.status === 'falha' ? 'danger' : 'warning'
        return (
          <div key={voyageContext.voyageId} className="app-invoice-comm__item">
            {contexts.length > 1 ? <span className="app-invoice-comm__voyage">{voyageContext.vesselName ?? 'Viagem'}{voyageContext.voyageNumber ? ` / ${voyageContext.voyageNumber}` : ''}</span> : null}
            {statusQuery?.isLoading ? <span className="app-invoice-comm--muted">Verificando comunicado…</span> : null}
            {!statusQuery?.isLoading && (statusQuery?.error || !status) ? <span className="app-invoice-comm--warning">Status indisponível</span> : null}
            {status ? (
              <span className={`app-invoice-comm--${tone}`}>{status.blockedReason ? `Prontidão bloqueada: ${status.blockedReason}` : statusText(status.latest)}</span>
            ) : null}
            {status?.latest || canRetry ? (
              <span className="app-invoice-comm__actions">
                {status?.latest ? <Link className="app-invoice-comm__link" to={`/clientes/comunicacao?tab=historico&customer=${voyageContext.customerId}&communication=${status.latest.id}`}>Ver comunicado</Link> : null}
                {canRetry ? <button type="button" className="app-invoice-comm__link" disabled={retryMutation.isPending} aria-busy={retryMutation.isPending || undefined} onClick={() => {
                  void (async () => {
                    const confirmed = await confirm({
                      title: 'Reenviar comunicado',
                      message: 'Confirma o reenvio assistido do comunicado de CE Mercante para este cliente?',
                      confirmLabel: 'Reenviar comunicado',
                    })
                    if (confirmed) await retryMutation.mutateAsync({ voyageId: voyageContext.voyageId!, customerId: voyageContext.customerId! })
                  })()
                }}>{retryMutation.isPending ? 'Reenviando…' : 'Reenviar comunicado'}</button> : null}
              </span>
            ) : null}
          </div>
        )
      })}
      {retryError ? <span role="alert" className="app-invoice-comm--danger">{retryError}</span> : null}
    </div>
  )
}
