import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'

export function HistoricoTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: timeline, isLoading, isError, refetch } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])

  return (
    <Card className="app-customer-sheet">
      <div className="app-customer-section-head">
        <h2 className="app-customer-section-title">
          Histórico do Cliente
          {timeline?.length ? <span className="app-customer-section-count">{timeline.length}</span> : null}
        </h2>
        <p className="app-customer-muted">Cadastro, contatos, Portal, faturas, pagamentos, B/Ls e Comunicados, do mais recente ao mais antigo.</p>
      </div>
      {isLoading ? <p className="app-customer-muted" role="status">Carregando o histórico…</p> : null}
      {!isLoading && isError ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar o histórico.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {!isLoading && !isError && !timeline?.length ? <p className="app-customer-muted">Sem eventos registrados.</p> : null}
      {!isLoading && !isError && timeline?.length ? (
        <ol className="app-customer-timeline">
          {timeline.map((event) => (
            <li key={`${event.kind}-${event.sourceId}`} className="app-customer-timeline__item">
              <time className="app-customer-timeline__date" dateTime={event.at}>{formatDate(event.at)}</time>
              <span className="app-customer-timeline__body">
                {event.link ? <Link className="app-customer-link" to={event.link}>{event.label}</Link> : <span>{event.label}</span>}
                {event.detail || event.actorId ? (
                  <span className="app-customer-timeline__meta">
                    {[event.detail, event.actorId ? `por ${event.actorId}` : null].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  )
}
