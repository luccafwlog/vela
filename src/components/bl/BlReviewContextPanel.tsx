import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import type { BLDetail } from '../../types/database'
import { extractReviewReasons } from '../../hooks/useReview'
import { isBreakbulkCargoMode } from '../../lib/cargoMode'

export function BlReviewContextPanel({ bl }: { bl: BLDetail }) {
  if (bl.review_status !== 'pending_review') return null

  const notesReasons = extractReviewReasons(bl.notes)
  const computedReasons: string[] = []
  const contacts = (bl.customer as { customer_contacts?: { email?: string | null }[] } | null | undefined)?.customer_contacts
  if (bl.customer_id == null) {
    computedReasons.push('Cliente não vinculado')
  } else if (!contacts?.some((contact) => (contact.email ?? '').trim())) {
    computedReasons.push('Cliente sem e-mail cadastrado')
  }
  if (isBreakbulkCargoMode(bl.cargo_mode) && (bl.bb_weight_ton == null || Number(bl.bb_weight_ton) <= 0)) {
    computedReasons.push('Peso BB ausente')
  }

  const reasons = notesReasons.length > 0 ? notesReasons : (computedReasons.length > 0 ? computedReasons : ['Pendência documental não classificada'])

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-amber-400 shrink-0" size={18} />
          <h3 className="text-sm font-semibold text-[var(--app-text-strong)]">
            Pendências documentais
          </h3>
          <Badge tone="yellow">Documentação</Badge>
          <Badge tone="red">Bloqueio de faturamento</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/revisao?bl=${encodeURIComponent(bl.id)}`}
            className="flex items-center gap-1 text-xs font-semibold text-[#58a6ff] hover:underline"
          >
            Tratar pendência na ficha
            <ExternalLink size={13} />
          </Link>
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--app-muted)]">
        Este B/L possui pendências documentais ou cadastrais que impedem o avanço para faturamento.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--app-text)]">Motivos ativos:</span>
        {reasons.map((reason) => (
          <Badge key={reason} tone="yellow">
            {reason}
          </Badge>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--app-muted)]">
        <span>Ambiente de correção:</span>
        <span className="font-semibold text-[var(--app-text)]">Ficha do B/L / fila documental</span>
        <span>·</span>
        <span>Ação sugerida:</span>
        <span className="text-[var(--app-text)]">
          {bl.customer_id == null
            ? 'Vincule ou cadastre o cliente com CNPJ e e-mail válidos na ficha do B/L.'
            : reasons.some((r) => r.toLowerCase().includes('peso'))
              ? 'Informe o peso BB na aba Detalhes do B/L.'
              : 'Verifique os dados cadastrais do cliente na ficha do B/L.'}
        </span>
      </div>
    </Card>
  )
}
