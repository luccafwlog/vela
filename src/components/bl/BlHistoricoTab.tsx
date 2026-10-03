import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, familyTone, isAudited } from './blTimelinePresentation'
import { useBlCommunicationHistory } from '../../hooks/useCustomerCommunications'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../../services/customerCommunications'

const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

type Row = { key: string; at: string; node: ReactNode }

export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useBlTimeline(blId)
  const { data: communications } = useBlCommunicationHistory(blId)
  if (!active) return null

  // Eventos e comunicados numa só lista, do mais recente ao mais antigo.
  // ponytail: ordena só o que já foi carregado; um comunicado mais antigo que
  // a última página aparece no fim até "Carregar mais" trazer o resto.
  const rows: Row[] = [
    ...(data?.pages.flat() ?? []).map((event) => ({
      key: `${event.entity_type}-${event.id}`,
      at: event.changed_at ?? '',
      node: (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={familyTone(event.family)}>{familyLabel(event.family)}</Badge>
            {isAudited(event) ? <Badge tone="green">Auditoria</Badge> : null}
          </div>
          <div className="mt-1 font-medium text-[var(--app-text-strong)]">{describeTimelineEvent(event)}</div>
          {event.justification ? <div className="mt-0.5 text-[var(--app-muted)]">Motivo: {event.justification}</div> : null}
        </>
      ),
    })),
    ...(communications ?? []).map((communication) => ({
      key: `communication-${communication.id}`,
      at: communication.created_at,
      node: (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">Comunicado</Badge>
            <Badge tone={communication.status === 'enviado' ? 'green' : communication.status === 'falha' ? 'red' : 'yellow'}>
              {customerCommunicationStatusLabel(communication.status)}
            </Badge>
          </div>
          <div className="mt-1 font-medium text-[var(--app-text-strong)]">{customerCommunicationKindLabel(communication.kind)}</div>
          <div className="mt-0.5 text-[var(--app-muted)]">
            {[communication.anchor_port, communication.attachments.length ? `${communication.attachments.length} anexo(s)` : null].filter(Boolean).join(' · ')}
            {communication.anchor_port || communication.attachments.length ? ' · ' : ''}
            <Link to={`/clientes/comunicacao?tab=historico&communication=${encodeURIComponent(String(communication.id))}`} className="text-[var(--app-link)] hover:underline">Abrir comunicado</Link>
          </div>
        </>
      ),
    })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-[var(--app-text-strong)]">Histórico</h2>
      {rows.length ? (
        <ol className="grid divide-y divide-[var(--app-border)]">
          {rows.map((row) => (
            <li key={row.key} className="grid gap-1 py-3 text-sm sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-4">
              <time className="tabular-nums text-xs text-[var(--app-muted)] sm:pt-1" dateTime={row.at}>{dateTime(row.at)}</time>
              <div className="min-w-0">{row.node}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-[var(--app-muted)]">Nenhum evento registrado ainda.</p>
      )}
      {hasNextPage ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
