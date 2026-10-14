import { useState } from 'react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useCustomerTimeline } from '../../hooks/useCustomerFicha'
import { CUSTOMER_TIMELINE_SUBJECTS, type CustomerTimelineSubject } from '../../services/customerFicha'
import { formatCountLabel } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import { TimelineLabel } from './VisaoGeralTab'

const PAGE_SIZE = 20

function formatMoment(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', '')
}

/**
 * Histórico do Cliente (lote 1 da identidade): Quando, Assunto, O que
 * aconteceu e Por (nome, "Sistema" ou "—" quando o registro não guarda
 * autor), com filtro por assunto e 20 por página.
 */
export function HistoricoTab({ data }: { data: NonNullable<ReturnType<typeof useCustomerDetail>['data']> }) {
  const { data: timeline, isLoading, isError, refetch } = useCustomerTimeline(data.id, data.customer_contacts ?? [], data.bls ?? [])
  const [subject, setSubject] = useState<CustomerTimelineSubject | null>(null)
  const [page, setPage] = useState(1)
  const events = (timeline ?? []).filter((event) => !subject || event.subject === subject)
  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const shown = events.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function choose(next: CustomerTimelineSubject | null) {
    setSubject(next)
    setPage(1)
  }

  return (
    <Block
      title="Histórico do Cliente"
      headingLevel={2}
      flush
      aside={timeline?.length ? `${formatCountLabel(timeline.length, 'evento', 'eventos')} · do mais recente ao mais antigo` : null}
    >
      <div className="app-block__body">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por assunto">
          {[null, ...CUSTOMER_TIMELINE_SUBJECTS].map((option) => (
            <Button
              key={option ?? 'todos'}
              variant={subject === option ? 'primary' : 'secondary'}
              className="app-btn--sm"
              aria-pressed={subject === option}
              onClick={() => choose(option)}
            >
              {option ?? 'Todos'}
            </Button>
          ))}
        </div>
      </div>
      {isLoading ? <p className="app-block__body app-facts__detail" role="status">Carregando o histórico…</p> : null}
      {!isLoading && isError ? (
        <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar o histórico.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {!isLoading && !isError && !events.length ? (
        <p className="app-block__body app-facts__detail">{subject ? `Sem eventos de ${subject}.` : 'Sem eventos registrados.'}</p>
      ) : null}
      {!isLoading && !isError && events.length ? (
        <>
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Histórico do Cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Assunto</th>
                  <th scope="col" className="app-table__text-head">O que aconteceu</th>
                  <th scope="col">Por</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((event) => (
                  <tr key={`${event.kind}-${event.sourceId}`}>
                    <td className="whitespace-nowrap tabular-nums"><time dateTime={event.at}>{formatMoment(event.at)}</time></td>
                    <td className="whitespace-nowrap">{event.subject}</td>
                    <td className="app-table__text app-table__text--wrap">
                      <TimelineLabel label={event.label} link={event.link} />
                      {event.detail ? <span className="app-facts__detail"> · {event.detail}</span> : null}
                    </td>
                    <td className="whitespace-nowrap">{event.actor ?? <NoValue label="O registro não guarda o autor" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <TableFooterPagination page={currentPage} pageSize={PAGE_SIZE} totalCount={events.length} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
          ) : null}
        </>
      ) : null}
    </Block>
  )
}
