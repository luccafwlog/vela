import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { LocalChargesStatus } from '../bl/LocalChargesStatus'
import { useCustomerBls, useCustomerPendingReconciliation } from '../../hooks/useCustomerFicha'
import { formatBlCargoBadge } from '../../lib/blCargoBadge'
import { formatCountLabel } from '../../lib/utils'
import type { BLListItem } from '../../types/database'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import { revisaoHref } from './fichaOverview'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>

const PAGE_SIZE = 20

/**
 * Aba BLs da ficha do Cliente (antes "Operacional"; lote 1 da identidade):
 * as colunas da lista de BLs aprovada — B/L, Navio / Viagem, Trecho, Carga,
 * CE Mercante e Taxas locais (Pendente, Emitida, Isenta).
 */
export function BlsTab({ data }: { data: Data }) {
  const pending = useCustomerPendingReconciliation(data.id)
  const blsQuery = useCustomerBls(data.id)
  const [page, setPage] = useState(1)
  const bls = blsQuery.data ?? []
  const inReview = (data.bls ?? []).filter((bl) => bl.review_status === 'pending_review').length
  const totalPages = Math.max(1, Math.ceil(bls.length / PAGE_SIZE))
  const shown = bls.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="grid gap-4">
      {pending.isError ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível verificar os B/Ls vinculados por nome.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void pending.refetch()}>Tentar novamente</Button>
        </div>
      ) : (pending.data?.length ?? 0) > 0 ? (
        <Block title="B/Ls vinculados por nome, aguardando confirmação" headingLevel={2}>
          <p className="app-facts__detail">O vínculo veio da semelhança do nome, não do CNPJ. Confirme ou corrija na seção Cliente de cada B/L.</p>
          <ul className="grid gap-1">
            {pending.data!.map((row) => (
              <li key={row.id}>
                <Link className="app-customer-link app-customer-code" to={`/bls/${row.id}`}>{row.id}</Link>
                {' '}
                <span className="app-facts__detail">{row.consignee ?? 'Consignatário não informado'}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block
        title="B/Ls vinculados"
        headingLevel={2}
        flush
        aside={(
          <>
            <span>{formatCountLabel(bls.length, 'B/L', 'B/Ls')}</span>
            {inReview > 0 ? (
              <Link className="app-btn app-btn--secondary app-btn--sm" to={revisaoHref(data.cnpj_cpf)}>
                {formatCountLabel(inReview, 'em revisão', 'em revisão')}: abrir na Revisão <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
            {bls.length ? (
              <Link className="app-btn app-btn--secondary app-btn--sm" to={`/bls?q=${encodeURIComponent(data.cnpj_cpf)}`}>
                Ver na lista de BLs <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </>
        )}
      >
        {blsQuery.isLoading ? (
          <p className="app-block__body app-facts__detail" role="status">Carregando os B/Ls…</p>
        ) : blsQuery.isError ? (
          <div className="app-block__body app-customer-notice app-customer-notice--danger" role="alert">
            <span>Não foi possível carregar os B/Ls.</span>
            <Button variant="secondary" className="app-btn--sm" onClick={() => void blsQuery.refetch()}>Tentar novamente</Button>
          </div>
        ) : bls.length ? (
          <>
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">B/Ls vinculados ao Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col">B/L</th>
                    <th scope="col" className="app-table__text-head">Navio / Viagem</th>
                    <th scope="col">Trecho</th>
                    <th scope="col">Carga</th>
                    <th scope="col">CE Mercante</th>
                    <th scope="col">Taxas locais</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((bl) => {
                    const voyage = bl.voyage ? `${bl.voyage.vessel?.name ?? 'Navio'} / ${bl.voyage.voyage_number ?? '—'}` : null
                    return (
                      <tr key={bl.id}>
                        <td className="whitespace-nowrap">
                          <CopyValue value={bl.id} label="número do B/L"><Link className="app-customer-link app-customer-code" to={`/bls/${bl.id}`}>{bl.id}</Link></CopyValue>
                        </td>
                        <td className="app-table__text">
                          {voyage ? <Link className="app-customer-link" to={`/viagens/${bl.voyage!.id}`} title={voyage}>{voyage}</Link> : <NoValue label="Sem viagem" />}
                        </td>
                        <td className="whitespace-nowrap">{`${bl.pol ?? '—'} → ${bl.pod ?? '—'}`}</td>
                        <td className="whitespace-nowrap tabular-nums">{formatBlCargoBadge(bl as unknown as BLListItem)}</td>
                        <td className="app-customer-code whitespace-nowrap">{bl.ce_mercante ? <CopyValue value={bl.ce_mercante} label="CE Mercante" /> : <NoValue label="Sem CE Mercante" />}</td>
                        <td><LocalChargesStatus bl={bl} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 ? (
              <TableFooterPagination page={page} pageSize={PAGE_SIZE} totalCount={bls.length} totalPages={totalPages} onPageChange={setPage} pageSizes={[PAGE_SIZE]} />
            ) : null}
          </>
        ) : (
          <p className="app-block__body app-facts__detail">
            Nenhum B/L vinculado. B/Ls entram pelo manifesto com o CNPJ deste Cliente ou pelo vínculo na Revisão.
          </p>
        )}
      </Block>
    </div>
  )
}
