import { useState } from 'react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { useCustomerCadastroChanges } from '../../hooks/useCustomerFicha'
import { formatCountLabel } from '../../lib/utils'

const PAGE_SIZE = 20

function formatMoment(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date).replace(',', '')
}

/** "Alterações do cadastro": o que mudou, de, para, por quem, quando e justificativa. */
export function CadastroChangesBlock({ customerId }: { customerId: number }) {
  const query = useCustomerCadastroChanges(customerId)
  const [page, setPage] = useState(1)
  const rows = query.data ?? []
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  return (
    <Block
      title="Alterações do cadastro"
      headingLevel={2}
      flush
      aside={rows.length ? `${formatCountLabel(rows.length, 'alteração', 'alterações')} · dados, contatos e caixas` : null}
    >
      {query.isLoading ? <p className="app-block__body app-facts__detail" role="status">Carregando as alterações…</p>
        : query.isError ? (
          <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
            <span>Não foi possível carregar as alterações do cadastro.</span>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        )
        : !rows.length ? <p className="app-block__body app-facts__detail">Nenhuma alteração registrada.</p>
        : (
          <>
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Alterações do cadastro do Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col" className="app-table__text-head">O que mudou</th>
                    <th scope="col" className="app-table__text-head">De</th>
                    <th scope="col" className="app-table__text-head">Para</th>
                    <th scope="col">Por</th>
                    <th scope="col" className="app-table__text-head">Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap tabular-nums"><time dateTime={row.at}>{formatMoment(row.at)}</time></td>
                      <td className="app-table__text" title={row.what}>{row.what}</td>
                      <td className="app-table__text" title={row.from ?? undefined}>{row.from ?? <NoValue label="Sem valor anterior" />}</td>
                      <td className="app-table__text" title={row.to ?? undefined}>{row.to ?? <NoValue label="Sem valor" />}</td>
                      <td className="whitespace-nowrap">{row.by ?? <NoValue label="O registro não guarda o autor" />}</td>
                      <td className="app-table__text" title={row.justification ?? undefined}>{row.justification ?? <NoValue label="Sem justificativa" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <TableFooterPagination page={currentPage} pageSize={PAGE_SIZE} totalCount={rows.length} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
            ) : null}
          </>
        )}
    </Block>
  )
}
