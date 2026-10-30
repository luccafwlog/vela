import { Fragment } from 'react'
import { ChevronDown, ChevronRight, Download, FileText, Printer } from 'lucide-react'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { EmptyState, InlineError } from '../ui/Card'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { fmtBRL, fmtUSD } from '../../services/demurrage/demurragePresentation'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import type { CustomerDemurrageDetailItem } from '../../services/demurrage/demurrageKpis'
import type { CustomerExposureRow } from '../../services/demurrage/demurrageCustomerExposure'

type Props = {
  summary: CustomerExposureRow[] | undefined
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
  /** Exportar (ADR 0112, D14): as linhas da tela. */
  onExport?: (rows: CustomerExposureRow[]) => void
}

/**
 * Por Cliente (ADR 0112, D11): o que corre, falta emitir ou está travado (da
 * classificação do banco) e o faturado em aberto, por Cliente.
 */
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
  onExport,
}: Props) {
  const rows = summary ?? []
  const totals = rows.reduce((sum, row) => ({
    correndo: sum.correndo + row.correndo_usd,
    aEmitir: sum.aEmitir + row.a_emitir_usd,
    esperando: sum.esperando + row.esperando_usd,
    travado: sum.travado + row.travado_usd,
    usd: sum.usd + row.open_usd,
    brl: sum.brl + row.open_brl,
    count: sum.count + row.invoice_count,
  }), { correndo: 0, aEmitir: 0, esperando: 0, travado: 0, usd: 0, brl: 0, count: 0 })

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
              { label: 'Correndo', value: fmtUSD(totals.correndo) },
              { label: 'A emitir', value: fmtUSD(totals.aEmitir) },
              { label: 'Esperando', value: fmtUSD(totals.esperando) },
              { label: 'Travado', value: fmtUSD(totals.travado) },
              { label: totals.count === 1 ? 'Invoice em aberto' : 'Invoices em aberto', value: String(totals.count) },
              { label: 'Faturado em aberto', value: `${fmtUSD(totals.usd)} · ${fmtBRL(totals.brl)}` },
            ]}
          />
          {onExport && rows.length ? (
            <Button variant="secondary" onClick={() => onExport(rows)}>
              <Download size={15} aria-hidden="true" />
              Exportar
            </Button>
          ) : null}
          <Button variant="secondary" disabled={!rows.length} onClick={onOpenReport}>
            <Printer size={15} aria-hidden="true" />
            Imprimir relatório
          </Button>
        </div>
        {!rows.length ? (
          <EmptyState icon={FileText} title="Nada em aberto" description="Nenhum Cliente com Demurrage correndo, a emitir, travada ou faturada em aberto." />
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Demurrage em aberto por Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col" className="app-dem-num">Correndo</th>
                    <th scope="col" className="app-dem-num">A emitir</th>
                    <th scope="col" className="app-dem-num">Esperando</th>
                    <th scope="col" className="app-dem-num">Travado</th>
                    <th scope="col" className="app-dem-num">Invoices em aberto</th>
                    <th scope="col" className="app-dem-num">Faturado em aberto (USD)</th>
                    <th scope="col" className="app-dem-num">Faturado em aberto (BRL hoje)</th>
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
                                {/* Tabela limpa: o CNPJ fica no relatório do Cliente e na busca. */}
                                <span className="app-dem-strong" title={customer.cnpj_cpf ? formatCnpjCpf(customer.cnpj_cpf) : undefined}>{customer.customer_name}</span>
                              </button>
                            </div>
                          </td>
                          <td className="app-dem-num">{fmtUSD(customer.correndo_usd)}</td>
                          <td className="app-dem-num">{fmtUSD(customer.a_emitir_usd)}</td>
                          <td className="app-dem-num">{fmtUSD(customer.esperando_usd)}</td>
                          <td className="app-dem-num">
                            {customer.travado_usd === 0 && customer.travado_sem_valor > 0
                              ? <NoValue label="Sem valor: tipo sem tarifa" />
                              : fmtUSD(customer.travado_usd)}
                          </td>
                          <td className="app-dem-num">{customer.invoice_count}</td>
                          <td className="app-dem-num app-dem-amount">{fmtUSD(customer.open_usd)}</td>
                          <td className="app-dem-num">{fmtBRL(customer.open_brl)}</td>
                        </tr>
                        {isExpanded ? (
                          <tr className="app-dem-subrow">
                            <td colSpan={8} id={panelId}>
                              {detailError ? <InlineError message="Não foi possível carregar as Invoices deste Cliente." /> : null}
                              {detailLoading ? <p className="app-dem-meta" role="status">Carregando Invoices…</p> : null}
                              {detail && !detail.length && !detailLoading ? <p className="app-dem-meta">Nenhuma Invoice em aberto; o que corre está na aba Containers.</p> : null}
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
