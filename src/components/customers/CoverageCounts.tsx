import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { formatBrasiliaTime, nextAutoRunnerRun, queuedLabel } from '../../lib/communicationAutoRunner'

// Contagens da Cobertura de viagens, também usadas na página de Comunicados da
// Viagem: o mesmo "N de M" nas duas telas.

function plural(count: number, singular: string, pluralWord: string) {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

/** "0 de 3", âmbar enquanto falta enviar; "—" quando nada é devido (lote 5a). */
export function CoverageCount({ sent, total, queued = 0, now }: { sent: number; total: number; queued?: number; now: Date }) {
  if (total === 0) return <NoValue label="Nada devido" />
  return (
    <span className="inline-flex flex-col">
      <StatusText tone={sent < total ? 'warning' : 'default'}>{sent} de {total}</StatusText>
      <QueuedNote queued={queued} now={now} />
    </span>
  )
}

/** "1 na fila · 16:07": a próxima rodada automática envia (migration 345). */
function QueuedNote({ queued, now }: { queued: number; now: Date }) {
  if (queued <= 0) return null
  return <span className="text-xs text-[var(--app-muted)]" title={queuedLabel(now)}>{queued} na fila · {formatBrasiliaTime(nextAutoRunnerRun(now))}</span>
}

/**
 * B/Ls do porto sem Cliente: pendência, porque nenhum Comunicado sai para eles.
 * Âmbar com a contagem e quantos consignatários do manifesto deixam de ser avisados.
 */
export function UnlinkedCount({ bls, consignees }: { bls: number; consignees: number }) {
  if (bls === 0) return <NoValue label="Todos com Cliente" />
  return (
    <span className="inline-flex flex-col">
      <StatusText tone="warning">{plural(bls, 'B/L', 'B/Ls')}</StatusText>
      <span className="text-xs text-[var(--app-muted)]">{plural(consignees, 'consignatário', 'consignatários')}</span>
    </span>
  )
}

/** CE e Taxas: enviados em dia de devidos, e quem precisa de reenvio. */
export function FinanceCoverageCount({ sent, due, resend, queued, now }: { sent: number; due: number; resend: number; queued: number; now: Date }) {
  if (due === 0) return <NoValue label="Nada devido" />
  return (
    <span className="inline-flex flex-col">
      <StatusText tone={sent < due ? 'warning' : 'default'}>{sent} de {due}</StatusText>
      {resend > 0 ? <span className="text-xs text-[var(--app-muted)]">{resend === 1 ? '1 reenvio pendente' : `${resend} reenvios pendentes`}</span> : null}
      <QueuedNote queued={queued} now={now} />
    </span>
  )
}
