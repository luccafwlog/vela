import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { usePendingReissues } from '../../hooks/useBilling'
import type { PendingReissue } from '../../services/billing'
import { formatDate } from '../../lib/utils'

type Props = {
  onOpenInvoice: (invoiceId: number) => void
  onReissueConsolidated: (pending: PendingReissue) => void
}

// Reemissão pendente (ADR 0077): faturas canceladas por Cancelar e reemitir
// que ainda não têm sucessora. Some sozinha quando a nova emissão sai.
export function PendingReissuesPanel({ onOpenInvoice, onReissueConsolidated }: Props) {
  const { data } = usePendingReissues()
  const rows = data ?? []
  if (rows.length === 0) return null

  return (
    <Card className="mb-5" data-testid="pending-reissues">
      <h2 className="mb-1 text-base font-semibold text-white">Reemissão pendente</h2>
      <p className="mb-3 text-xs text-slate-400">
        Faturas canceladas para correção. Corrija o B/L e emita a nova fatura; a consolidada reemite com os mesmos B/Ls.
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
            {row.invoice_type === 'consolidated' ? (
              <Button variant="secondary" onClick={() => onReissueConsolidated(row)}>Reemitir consolidada</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
