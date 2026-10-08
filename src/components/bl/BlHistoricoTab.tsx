import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, isAudited } from './blTimelinePresentation'
import { useBlCommunicationHistory } from '../../hooks/useCustomerCommunications'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../../services/customerCommunications'

const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

type Row = { key: string; at: string; kind: string; node: ReactNode }

export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const timeline = useBlTimeline(blId)
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = timeline
  const { data: communications } = useBlCommunicationHistory(blId)
  if (!active) return null

  // Eventos e comunicados numa só lista, do mais recente ao mais antigo.
  // ponytail: ordena só o que já foi carregado; um comunicado mais antigo que
  // a última página aparece no fim até "Carregar mais" trazer o resto.
  const rows: Row[] = [
    ...(data?.pages.flat() ?? []).map((event) => ({
      key: `${event.entity_type}-${event.id}`,
      at: event.changed_at ?? '',
      kind: isAudited(event) ? `${familyLabel(event.family)} · auditado` : familyLabel(event.family),
      node: (
        <>
          <div className="app-bl-history__title">{describeTimelineEvent(event)}</div>
          {event.justification ? <div className="app-bl-facts__sub">Motivo: {event.justification}</div> : null}
        </>
      ),
    })),
    ...(communications ?? []).map((communication) => ({
      key: `communication-${communication.id}`,
      at: communication.created_at,
      kind: 'Comunicado',
      node: (
        <>
          <div className="app-bl-history__title">
            {customerCommunicationKindLabel(communication.kind)}{' '}
            <Badge tone={communication.status === 'enviado' ? 'success' : communication.status === 'falha' ? 'danger' : 'warning'}>
              {customerCommunicationStatusLabel(communication.status)}
            </Badge>
          </div>
          <div className="app-bl-facts__sub">
            {[communication.anchor_port, communication.attachments.length ? `${communication.attachments.length} anexo(s)` : null].filter(Boolean).join(' · ')}
            {communication.anchor_port || communication.attachments.length ? ' · ' : ''}
            <Link to={`/clientes/comunicacao?tab=historico&communication=${encodeURIComponent(String(communication.id))}`} className="app-bl-link">Abrir comunicado</Link>
          </div>
        </>
      ),
    })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))

  return (
    <Card className="app-bl-sheet">
      <section className="app-bl-sheet__section" aria-labelledby="bl-historico">
        <div className="app-bl-section-head">
          <h2 id="bl-historico" className="app-bl-section-title">Histórico</h2>
          <span className="app-bl-facts__sub">Edições, containers, taxas, faturas e comunicados ao Cliente</span>
        </div>
        {timeline.isLoading ? (
          <p className="app-bl-facts__missing" role="status">Carregando histórico…</p>
        ) : timeline.isError && !rows.length ? (
          <div className="app-bl-notice app-bl-notice--row" role="alert">
            <span>Não foi possível carregar o histórico deste B/L.</span>
            <Button variant="secondary" onClick={() => void timeline.refetch()}>Tentar novamente</Button>
          </div>
        ) : rows.length ? (
          <ol className="app-bl-history">
            {rows.map((row) => (
              <li key={row.key} className="app-bl-history__item">
                <div className="app-bl-history__meta">
                  <time className="tabular-nums" dateTime={row.at}>{dateTime(row.at)}</time>
                  <span>{row.kind}</span>
                </div>
                <div className="min-w-0">{row.node}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="app-bl-facts__missing">Nenhum evento registrado ainda.</p>
        )}
        {hasNextPage ? (
          <div className="mt-3">
            <Button type="button" variant="secondary" loading={isFetchingNextPage} loadingLabel="Carregando…" onClick={() => void fetchNextPage()}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </section>
    </Card>
  )
}
