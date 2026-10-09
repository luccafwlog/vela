import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useCustomerPendingReconciliation } from '../../hooks/useCustomerFicha'
import { FINANCIAL_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { formatCountLabel, formatDate } from '../../lib/utils'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import { revisaoHref } from './fichaOverview'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>

// Revisão do B/L em palavras: "OK" e "Pendente" sozinhos não dizem de quê.
const REVIEW_TEXT: Record<string, string> = { ok: 'Sem pendência', pending_review: 'Em revisão', reviewed: 'Revisado' }
const FINANCIAL_TEXT: Record<string, string> = { ...FINANCIAL_STATUS_LABELS, pending: 'Sem faturamento' }

export function OperacionalTab({ data }: { data: Data }) {
  const pending = useCustomerPendingReconciliation(data.id)
  const bls = [...(data.bls ?? [])].sort((left, right) => String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')))
  const inReview = bls.filter((bl) => bl.review_status === 'pending_review').length

  return (
    <div className="app-customer-stack">
      {pending.isError ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível verificar os B/Ls vinculados por nome.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void pending.refetch()}>Tentar novamente</Button>
        </div>
      ) : (pending.data?.length ?? 0) > 0 ? (
        <Card className="app-customer-sheet">
          <h2 className="app-customer-section-title">B/Ls vinculados por nome, aguardando confirmação</h2>
          <p className="app-customer-muted">O vínculo veio da semelhança do nome, não do CNPJ. Confirme ou corrija na seção Cliente de cada B/L.</p>
          <ul className="app-customer-rows">
            {pending.data!.map((row) => (
              <li key={row.id}>
                <Link className="app-customer-link app-customer-code" to={`/bls/${row.id}`}>{row.id}</Link>
                <span className="app-customer-muted">{row.consignee ?? 'Consignatário não informado'}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="app-customer-sheet p-0">
        <div className="app-customer-section-head app-customer-section-head--padded">
          <h2 className="app-customer-section-title">
            B/Ls vinculados
            <span className="app-customer-section-count">{bls.length}</span>
          </h2>
          <div className="app-customer-section-links">
            {inReview > 0 ? (
              <Link className="app-customer-text-link" to={revisaoHref(data.cnpj_cpf)}>
                {formatCountLabel(inReview, 'em revisão', 'em revisão')}: abrir na Revisão <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
            {bls.length ? (
              <Link className="app-customer-text-link" to={`/bls?q=${encodeURIComponent(data.cnpj_cpf)}`}>
                Ver na lista de BLs <ArrowRight size={14} aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </div>
        {bls.length ? (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-customer-subtable text-left text-sm">
              <caption className="sr-only">B/Ls vinculados ao Cliente</caption>
              <thead>
                <tr>
                  <th scope="col">B/L</th>
                  <th scope="col">Consignatário no B/L</th>
                  <th scope="col">Revisão</th>
                  <th scope="col">Faturamento</th>
                  <th scope="col" className="app-customer-subtable__date">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {bls.map((bl) => (
                  <tr key={bl.id}>
                    <td><Link className="app-customer-link app-customer-code" to={`/bls/${bl.id}`}>{bl.id}</Link></td>
                    <td className="app-customer-subtable__wrap">{bl.consignee ?? '—'}</td>
                    <td>
                      <span className={bl.review_status === 'pending_review' ? 'app-customer-note app-customer-note--warning' : undefined}>
                        {REVIEW_TEXT[bl.review_status ?? ''] ?? '—'}
                      </span>
                    </td>
                    <td>{statusLabel(FINANCIAL_TEXT, bl.financial_status)}</td>
                    <td className="app-customer-subtable__date tabular-nums">{bl.created_at ? formatDate(bl.created_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="app-customer-muted app-customer-empty-line">
            Nenhum B/L vinculado. B/Ls entram pelo manifesto com o CNPJ deste Cliente ou pelo vínculo na Revisão.
          </p>
        )}
      </Card>
    </div>
  )
}
