import { FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card, EmptyState } from '../ui/Card'
import { fmtBRL, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatResultCount } from '../../lib/operationalState'
import { formatDate } from '../../lib/utils'
import type { CustomerDemurrageDetailItem, CustomerDemurrageSummary } from '../../services/demurrage/demurrageKpis'

type Props = {
  summary: CustomerDemurrageSummary[] | undefined
  detail: CustomerDemurrageDetailItem[] | undefined
  expandedCustomer: number | null
  onExpandedCustomerChange: (customerId: number) => void
  onOpenReport: () => void
}

export function DemurrageCustomersTab({ summary, detail, expandedCustomer, onExpandedCustomerChange, onOpenReport }: Props) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold text-white">
          {formatResultCount(summary?.length ?? 0, 'consignatário', 'consignatários')}
        </span>
        <Button variant="secondary" disabled={!summary?.length} onClick={onOpenReport}>
          <FileText size={15} />
          Imprimir
        </Button>
      </div>
      {!summary?.length ? (
        <EmptyState icon={FileText} title="Nada em aberto" description="Nenhuma fatura de demurrage emitida e não paga." />
      ) : (
        <div className="space-y-2">
          {summary.map((customer) => {
            const isExpanded = expandedCustomer === customer.customer_id
            const panelId = `demurrage-customer-panel-${customer.customer_id}`
            return (
              <Card key={customer.customer_id} className="overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5"
                  onClick={() => onExpandedCustomerChange(customer.customer_id)}
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                >
                  <span className="font-medium text-white">{customer.customer_name}</span>
                  <span className="flex items-center gap-4 text-sm">
                    <span className="text-slate-400">{customer.invoice_count} fat.</span>
                    <span className="font-semibold text-amber-400">{fmtUSD(customer.total_usd)}</span>
                    <span className="font-semibold text-green-400">{fmtBRL(customer.total_brl)}</span>
                  </span>
                </button>
                {isExpanded && (
                  <div id={panelId} className="border-t border-[#30363d] px-4 py-2">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Invoices de demurrage de {customer.customer_name}</caption>
                      <thead className="text-xs uppercase text-slate-500">
                        <tr>
                          <th className="py-1 text-left">Nº Doc</th>
                          <th className="py-1 text-left">BL</th>
                          <th className="py-1 text-left">Emissão</th>
                          <th className="py-1 text-right">USD</th>
                          <th className="py-1 text-right">BRL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail ?? []).map((invoice) => (
                          <tr key={invoice.id}>
                            <td className="py-1 font-mono text-xs">{invoice.doc_number}</td>
                            <td className="py-1 text-blue-400">{invoice.bl_id}</td>
                            <td className="py-1">{invoice.billed_at ? formatDate(invoice.billed_at) : '—'}</td>
                            <td className="py-1 text-right text-amber-400">{fmtUSD(invoice.total_usd)}</td>
                            <td className="py-1 text-right text-green-400">{fmtBRL(invoice.current_total_brl)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
