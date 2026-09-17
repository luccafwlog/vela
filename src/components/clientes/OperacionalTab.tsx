import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { useCustomerPendingReconciliation } from '../../hooks/useCustomerFicha'
import { FINANCIAL_STATUS_LABELS, REVIEW_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import type { useCustomerDetail } from '../../hooks/useCustomers'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
const RECONCILIATION_LABELS: Record<string, string> = { pending: 'Pendente', matched_document: 'Match CNPJ — aguardando confirmação', matched_name: 'Match nome — aguardando confirmação' }

export function OperacionalTab({ data }: { data: Data }) {
  const { data: pending } = useCustomerPendingReconciliation(data.id)
  return <div className="grid gap-5">
    {(pending?.length ?? 0) > 0 ? <Card><h2 className="mb-2 text-lg font-semibold text-white">Reconciliação de Cliente pendente</h2><p className="mb-3 text-sm text-slate-400">Confirme ou rejeite o vínculo no detalhe de cada B/L (seção Cliente).</p><ul className="grid gap-2 text-sm">{pending!.map((row) => <li key={row.id} className="flex items-center justify-between rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2"><span><Link className="app-table__action" to={`/bls/${row.id}`}>{row.id}</Link><span className="ml-2 text-slate-400">{row.consignee ?? '—'}</span></span><span className="text-xs text-amber-200">{RECONCILIATION_LABELS[row.customer_reconciliation_status ?? ''] ?? row.customer_reconciliation_status}</span></li>)}</ul></Card> : null}
    <Card><h2 className="mb-4 text-lg font-semibold text-white">Histórico de B/Ls</h2><div className="app-table-scroll"><table className="app-table app-table--compact min-w-[520px] text-left text-sm"><thead><tr><th scope="col" className="py-2">B/L</th><th scope="col" className="py-2">Consignatário</th><th scope="col" className="py-2">Revisão</th><th scope="col" className="py-2">Financeiro</th></tr></thead><tbody className="divide-y divide-[#30363d]">{data.bls?.length ? data.bls.map((bl) => <tr key={bl.id}><td className="py-2"><Link className="app-table__action" to={`/bls/${bl.id}`}>{bl.id}</Link></td><td className="py-2">{bl.consignee ?? '-'}</td><td className="py-2">{statusLabel(REVIEW_STATUS_LABELS, bl.review_status)}</td><td className="py-2">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status)}</td></tr>) : <tr><td colSpan={4} className="py-4 text-slate-400">Nenhum B/L vinculado.</td></tr>}</tbody></table></div></Card>
  </div>
}
