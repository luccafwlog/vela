import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Block } from '../ui/Block'
import { NoValue } from '../ui/NoValue'
import { RowActionButton } from '../ui/RowActionButton'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { QueryStateGate } from '../shared/QueryStateGate'
import { formatBrasiliaDateTime } from './auditLogPresentation'
import { departmentLabel } from '../../lib/departmentLabel'
import { LOG_PAGE_SIZE, fetchRoutingFailures, routingFailureReasonLabel } from '../../services/adminObservability'
import { alertEntityLink, getAlertTypeLabel } from '../../services/alerts'
import { queryKeys } from '../../services/queryKeys'

/** Alertas que não acharam ninguém ativo no setor (`alert_notification_failures`). */
export function AdminAlertFailuresTab() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const query = useQuery({
    queryKey: queryKeys.admin.routingFailures(page),
    queryFn: () => fetchRoutingFailures(page),
    staleTime: 30_000,
  })
  const failures = query.data?.rows ?? []
  const total = query.data?.count ?? 0

  return (
    <Block title="Falhas de entrega de alertas" aside="Para resolver: ativar alguém do setor na aba Usuários." flush>
      <QueryStateGate
        isLoading={query.isLoading}
        isError={Boolean(query.error)}
        hasData={query.data !== undefined && query.data !== null}
        errorMessage="Não foi possível carregar as falhas de entrega."
        onRetry={() => void query.refetch?.()}
        loadingLabel="Carregando falhas…"
      >
        {failures.length === 0 ? (
          <p className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhuma falha de entrega registrada.</p>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="app-table">
                <caption className="sr-only">Alertas sem destinatário ativo</caption>
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col" className="app-table__text-head">Alerta</th>
                    <th scope="col">Setor sem destinatário</th>
                    <th scope="col" className="app-table__text-head">Motivo</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((failure) => {
                    const link = alertEntityLink({ type: failure.item_type, entity_type: failure.entity_type ?? null, entity_id: failure.entity_id ?? null })
                    return (
                      <tr key={failure.id}>
                        <td className="tabular-nums whitespace-nowrap">{formatBrasiliaDateTime(failure.created_at)}</td>
                        <td className="app-table__text">{getAlertTypeLabel(failure.item_type)}</td>
                        <td>{departmentLabel(failure.department) === '—' ? <NoValue label="Setor desconhecido" /> : departmentLabel(failure.department)}</td>
                        <td className="app-table__text app-table__text--wrap">{routingFailureReasonLabel(failure.reason)}</td>
                        <td>
                          {link ? (
                            <RowActionButton label="Abrir alerta" icon={ExternalLink} onClick={() => navigate(link)} />
                          ) : <NoValue label="Sem alerta de origem" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TableFooterPagination
              page={page}
              pageBase={0}
              pageSize={LOG_PAGE_SIZE}
              totalCount={total}
              totalPages={Math.max(1, Math.ceil(total / LOG_PAGE_SIZE))}
              onPageChange={setPage}
            />
          </>
        )}
      </QueryStateGate>
    </Block>
  )
}
