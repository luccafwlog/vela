import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { usePendingReissues, useRetryPendingConsolidatedReissue } from '../../hooks/useBilling'
import { useAuth } from '../../hooks/useAuth'
import { userFacingErrorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/utils'

type Props = {
  onOpenInvoice: (invoiceId: number) => void
}

// Reemissão pendente (ADR 0077): faturas canceladas pela correção do B/L cuja
// nova emissão travou. Some sozinha quando a fatura sai ou quando já não há o
// que reemitir (B/L cancelado, isento, ou consolidada com outros B/Ls).
export function PendingReissuesPanel({ onOpenInvoice }: Props) {
  const { data } = usePendingReissues()
  const { isAdmin } = useAuth()
  const retry = useRetryPendingConsolidatedReissue()
  const { showToast } = useToast()
  const rows = data ?? []
  if (rows.length === 0) return null

  async function handleRetry(invoiceId: number) {
    try {
      const result = await retry.mutateAsync(invoiceId)
      const messages: Record<string, string> = {
        reissued: 'Consolidada reemitida.',
        closed: 'Os B/Ls já não são os mesmos: a consolidada foi encerrada sem reemissão.',
        waiting: 'A consolidada aguarda a fatura individual de um dos B/Ls.',
      }
      showToast(messages[result.status] ?? 'A consolidada ainda não pôde ser reemitida; veja o alerta da fatura.', result.status === 'reissued' ? 'success' : 'error')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao reemitir a consolidada.'), 'error')
    }
  }

  return (
    <section className="app-fin-alerts" data-testid="pending-reissues" aria-labelledby="pending-reissues-title">
      <h2 id="pending-reissues-title" className="app-fin-alerts__title">Reemissão pendente · {rows.length}</h2>
      <p className="app-fin-alerts__message">
        Faturas canceladas pela correção do B/L cuja nova emissão travou. Resolva o motivo do alerta da fatura e use Emitir fatura na ficha do B/L; a consolidada volta sozinha quando as individuais saírem.
      </p>
      <ul className="app-fin-alerts__list">
        {rows.map((row) => (
          <li key={row.invoice_id} className="app-fin-alerts__item">
            <span className="app-fin-alerts__type">
              <button type="button" className="app-fin-alerts__link" onClick={() => onOpenInvoice(row.invoice_id)}>{row.invoice_number}</button>
              {' · '}{row.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'}
            </span>
            <span className="app-fin-alerts__message">
              {row.customer_name ?? 'Cliente não identificado'} · cancelada em {formatDate(row.cancelled_at)}
              {row.bl_ids.length ? ' · ' : ''}
              {row.bl_ids.map((blId, index) => (
                <span key={blId}>{index > 0 ? ', ' : ''}<Link className="app-fin-alerts__link" to={`/bls/${encodeURIComponent(blId)}`}>{blId}</Link></span>
              ))}
            </span>
            {row.invoice_type === 'consolidated' && isAdmin ? (
              <Button
                variant="secondary"
                loading={retry.isPending && retry.variables === row.invoice_id}
                loadingLabel="Reemitindo…"
                onClick={() => void handleRetry(row.invoice_id)}
              >
                Tentar reemitir
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
