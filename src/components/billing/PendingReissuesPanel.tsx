import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
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
    <Card className="mb-5" data-testid="pending-reissues">
      <h2 className="mb-1 text-base font-semibold text-white">Reemissão pendente</h2>
      <p className="mb-3 text-xs text-slate-400">
        Faturas canceladas pela correção do B/L cuja nova emissão travou. Resolva o motivo indicado no alerta da fatura e use Emitir fatura na ficha do B/L; a consolidada volta sozinha quando as individuais saírem.
      </p>
      <ul className="grid gap-2 text-sm text-slate-200">
        {rows.map((row) => (
          <li key={row.invoice_id} className="flex flex-wrap items-center gap-2">
            <Badge tone="yellow">{row.invoice_type === 'consolidated' ? 'Consolidada' : 'Individual'}</Badge>
            <button type="button" className="font-semibold text-[#58a6ff] hover:underline" onClick={() => onOpenInvoice(row.invoice_id)}>
              {row.invoice_number}
            </button>
            <span>{row.customer_name ?? '-'}</span>
            <span className="text-slate-400">cancelada em {formatDate(row.cancelled_at)}</span>
            <span className="flex flex-wrap gap-1">
              {row.bl_ids.map((blId) => (
                <Link key={blId} className="text-[#58a6ff] hover:underline" to={`/bls/${blId}`}>{blId}</Link>
              ))}
            </span>
            {row.invoice_type === 'consolidated' && isAdmin ? (
              <Button
                variant="secondary"
                loading={retry.isPending && retry.variables === row.invoice_id}
                onClick={() => void handleRetry(row.invoice_id)}
              >
                Tentar reemitir
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
