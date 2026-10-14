import { Fragment } from 'react'
import { ChevronDown, ChevronRight, FileText, Printer } from 'lucide-react'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { EmptyState, InlineError } from '../ui/Card'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { fmtBRL, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import type { CustomerDemurrageDetailItem, CustomerDemurrageSummary } from '../../services/demurrage/demurrageKpis'

type Props = {
  summary: CustomerDemurrageSummary[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  detail: CustomerDemurrageDetailItem[] | undefined
  detailLoading: boolean
  detailError: unknown
  expandedCustomer: number | null
  onExpandedCustomerChange: (customerId: number) => void
  onOpenReport: () => void
  onOpenInvoice: (invoiceId: number) => void
}

/** Saldo de Demurrage em aberto por Cliente: Invoices emitidas e não pagas. */
export function DemurrageCustomersTab({
  summary,
  loading,
  error,
  onRetry,
  detail,
  detailLoading,
  detailError,
  expandedCustomer,
  onExpandedCustomerChange,
  onOpenReport,
  onOpenInvoice,
}: Props) {
  const rows = summary ?? []
  const totals = rows.reduce((sum, row) => ({ usd: sum.usd + row.total_usd, brl: sum.brl + row.total_brl, count: sum.count + row.invoice_count }), { usd: 0, brl: 0, count: 0 })

  return (
    <div className="app-dem-tab">
      <QueryStateGate
        isLoading={loading}
        isError={Boolean(error)}
        hasData={summary !== undefined}
        errorMessage="Não foi possível carregar o saldo de Demurrage por Cliente."
        onRetry={onRetry}
        loadingLabel="Carregando Clientes…"
      >
        <div className="app-dem-tablebar">
          <SummaryStrip
            label="Resumo por Cliente"
            items={[
              { label: rows.length === 1 ? 'Cliente' : 'Clientes', value: String(rows.length) },
              { label: totals.count === 1 ? 'Invoice em aberto' : 'Invoices em aberto', value: String(totals.count) },
              { label: 'USD', value: fmtUSD(totals.usd) },
              { label: 'BRL hoje', value: fmtBRL(totals.brl) },
            ]}
          />
          <Button variant="secondary" disabled={!rows.length} onClick={onOpenReport}>
            <Printer size={15} aria-hidden="true" />
            Imprimir relatório
          </Button>
        </div>
        {!rows.length ? (
          <EmptyState icon={FileText} title="Nada em aberto" description="Nenhuma Invoice de Demurrage emitida e não paga." />
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Demurrage em aberto por Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col" className="app-dem-num">Invoices</th>
                    <th scope="col" className="app-dem-num">USD</th>
                    <th scope="col" className="app-dem-num">BRL hoje</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((customer) => {
                    const isExpanded = expandedCustomer === customer.customer_id
                    const panelId = `demurrage-customer-panel-${customer.customer_id}`
                    return (
                      <Fragment key={customer.customer_id}>
                        <tr>
                          <td>
                            <div className="app-table__cell-stack">
                              <button
                                type="button"
                                className="app-dem-disclosure"
                                onClick={() => onExpandedCustomerChange(customer.customer_id)}
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                              >
                                {isExpanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                                <span className="app-table__cell-stack">
                                  <span className="app-dem-strong">{customer.customer_name}</span>
                                  <span className="app-dem-meta tabular-nums">{customer.cnpj_cpf ? formatCnpjCpf(customer.cnpj_cpf) : <NoValue label="Sem CNPJ/CPF" />}</span>
                                </span>
                              </button>
                            </div>
                          </td>
                          <td className="app-dem-num">{customer.invoice_count}</td>
                          <td className="app-dem-num app-dem-amount">{fmtUSD(customer.total_usd)}</td>
                          <td className="app-dem-num">{fmtBRL(customer.total_brl)}</td>
                        </tr>
                        {isExpanded ? (
                          <tr className="app-dem-subrow">
                            <td colSpan={4} id={panelId}>
                              {detailError ? <InlineError message="Não foi possível carregar as Invoices deste Cliente." /> : null}
                              {detailLoading ? <p className="app-dem-meta" role="status">Carregando Invoices…</p> : null}
                              {detail?.length ? (
                                <table className="app-dem-subtable">
                                  <caption className="sr-only">Invoices de Demurrage em aberto de {customer.customer_name}</caption>
                                  <thead>
                                    <tr>
                                      <th scope="col">Invoice</th>
                                      <th scope="col">B/L</th>
                                      <th scope="col">Emissão</th>
                                      <th scope="col" className="app-dem-num">USD</th>
                                      <th scope="col" className="app-dem-num">BRL hoje</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.map((invoice) => (
                                      <tr key={invoice.id}>
                                        <td><button type="button" className="app-dem-link app-dem-code" onClick={() => onOpenInvoice(invoice.id)}>{invoice.doc_number}</button></td>
                                        <td className="app-dem-code"><CopyValue value={invoice.bl_id} label="número do B/L" /></td>
                                        <td className="tabular-nums">{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</td>
                                        <td className="app-dem-num">{fmtUSD(invoice.total_usd)}</td>
                                        <td className="app-dem-num">{fmtBRL(invoice.current_total_brl)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </QueryStateGate>
    </div>
  )
}
