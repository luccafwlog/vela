import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useActorNames, useBlTimeline } from '../../hooks/useBlTimeline'
import { describeTimelineEvent, familyLabel, timelineEventActor, timelineEventDetail } from './blTimelinePresentation'
import { useBlCommunicationHistory } from '../../hooks/useCustomerCommunications'
import { customerCommunicationKindLabel, customerCommunicationStatusLabel } from '../../services/customerCommunications'
import { formatCountLabel } from '../../lib/utils'

const PAGE_SIZE = 20

/** Assuntos do filtro, na ordem da tela. */
const BL_HISTORY_SUBJECTS = ['Edição', 'Contêiner', 'Taxas', 'Fatura', 'Comunicado', 'Sistema'] as const
type Subject = (typeof BL_HISTORY_SUBJECTS)[number]

type Row = {
  key: string
  at: string
  subject: Subject
  what: string
  link?: string
  status?: { text: string; warning: boolean }
  detail: string | null
  actor: string | null
}

function formatMoment(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', '')
}

/**
 * Histórico do B/L (identidade, lote 1): as colunas do Histórico do Cliente —
 * Quando, Assunto, O que aconteceu e Por — com filtro por assunto e 20 por
 * página. Eventos e comunicados numa só lista, do mais recente ao mais antigo.
 */
export function BlHistoricoTab({ active, blId }: { active: boolean; blId?: string }) {
  const timeline = useBlTimeline(blId)
  const { data: communications } = useBlCommunicationHistory(blId)
  const communicationActors = useActorNames((communications ?? []).map((communication) => communication.created_by))
  const [subject, setSubject] = useState<Subject | null>(null)
  const [page, setPage] = useState(1)
  if (!active) return null

  const actorNames = timeline.data?.actorNames ?? new Map<string, string>()
  const rows: Row[] = [
    ...(timeline.data?.events ?? []).map((event): Row => ({
      key: `${event.entity_type}-${event.id}`,
      at: event.changed_at ?? '',
      subject: familyLabel(event.family) as Subject,
      what: describeTimelineEvent(event),
      detail: timelineEventDetail(event),
      actor: timelineEventActor(event, actorNames),
    })),
    ...(communications ?? []).map((communication): Row => ({
      key: `communication-${communication.id}`,
      at: communication.created_at,
      subject: 'Comunicado',
      what: customerCommunicationKindLabel(communication.kind),
      link: `/clientes/comunicacao?tab=historico&communication=${encodeURIComponent(String(communication.id))}`,
      status: { text: customerCommunicationStatusLabel(communication.status), warning: communication.status === 'falha' || communication.status === 'parcial' },
      detail: [communication.anchor_port, communication.attachments.length ? formatCountLabel(communication.attachments.length, 'anexo', 'anexos') : null].filter(Boolean).join(' · ') || null,
      actor: communication.created_by ? communicationActors.data?.get(communication.created_by) ?? null : 'Sistema',
    })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))

  const filtered = rows.filter((row) => !subject || row.subject === subject)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function choose(next: Subject | null) {
    setSubject(next)
    setPage(1)
  }

  return (
    <Block
      title="Histórico do B/L"
      headingLevel={2}
      flush
      aside={rows.length ? `${formatCountLabel(rows.length, 'evento', 'eventos')} · do mais recente ao mais antigo` : null}
    >
      <div className="app-block__body">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por assunto">
          {[null, ...BL_HISTORY_SUBJECTS].map((option) => (
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
      {timeline.isError && !timeline.isLoading ? (
        // Falha parcial: os comunicados podem ter carregado e a linha do tempo não.
        <div className="app-block__body flex flex-wrap items-center gap-3" role="alert">
          <span>{rows.length ? 'Parte do histórico deste B/L não carregou; a lista abaixo está incompleta.' : 'Não foi possível carregar o histórico deste B/L.'}</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void timeline.refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {timeline.isLoading ? <p className="app-block__body app-facts__detail" role="status">Carregando o histórico…</p> : null}
      {!timeline.isLoading && !filtered.length && !(timeline.isError && !rows.length) ? (
        <p className="app-block__body app-facts__detail">{subject ? `Sem eventos de ${subject}.` : 'Nenhum evento registrado ainda.'}</p>
      ) : null}
      {!timeline.isLoading && filtered.length ? (
        <>
          <div className="app-table-scroll">
            <table className="app-table app-table--compact">
              <caption className="sr-only">Histórico do B/L</caption>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Assunto</th>
                  <th scope="col" className="app-table__text-head">O que aconteceu</th>
                  <th scope="col">Por</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.key}>
                    <td className="whitespace-nowrap tabular-nums">{row.at ? <time dateTime={row.at}>{formatMoment(row.at)}</time> : <NoValue label="Sem data" />}</td>
                    <td className="whitespace-nowrap">{row.subject}</td>
                    <td className="app-table__text app-table__text--wrap">
                      {row.link ? <Link className="app-link" to={row.link}>{row.what}</Link> : row.what}
                      {row.status ? <> · {row.status.warning ? <StatusText tone="warning">{row.status.text}</StatusText> : row.status.text}</> : null}
                      {row.detail ? <span className="app-facts__detail"> · {row.detail}</span> : null}
                    </td>
                    <td className="whitespace-nowrap">{row.actor ?? <NoValue label="O registro não guarda o autor" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <TableFooterPagination page={currentPage} pageSize={PAGE_SIZE} totalCount={filtered.length} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
          ) : null}
        </>
      ) : null}
    </Block>
  )
}
