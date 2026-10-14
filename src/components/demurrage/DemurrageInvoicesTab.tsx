import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { Input } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { InvoiceStatusBadge } from './DemurrageBadges'
import { demurrageInvoiceNotices, fmtBRL, fmtUSD, invoiceNetUsd, type DemurrageInvoiceRow } from '../../services/demurrage/demurragePresentation'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import type { DemurrageInvoiceListItem } from '../../services/demurrage/demurrageInvoices'
import { fetchDemurrageDunningStatuses, getDemurrageDunningDisplay } from '../../services/demurrageDunning'
import { queryKeys } from '../../services/queryKeys'
import { DemurrageDunningStatus } from './DemurrageDunningStatus'

type InvoiceTab = 'emitidas' | 'pagas' | 'canceladas'

type Props = {
  tab: InvoiceTab
  invoices: DemurrageInvoiceListItem[] | undefined
  search: string
  loading: boolean
  error: unknown
  onRetry: () => void
  onSearchChange: (value: string) => void
  onOpenDetail: (invoiceId: number) => void
}

const EMPTY_TEXT: Record<InvoiceTab, { title: string; description: string }> = {
  emitidas: { title: 'Nenhuma Invoice aguardando pagamento', description: 'As Invoices emitidas pela aba Containers aparecem aqui até a baixa.' },
  pagas: { title: 'Nenhuma Invoice paga', description: 'As Invoices baixadas pelo PIX, pelo extrato ou à mão aparecem aqui.' },
  canceladas: { title: 'Nenhuma Invoice cancelada', description: 'Invoices canceladas à mão ou substituídas por reemissão aparecem aqui.' },
}

function matchesSearch(invoice: DemurrageInvoiceListItem, query: string) {
  if (!query) return true
  const term = query.toLowerCase()
  const digits = term.replace(/\D/g, '')
  return (
    invoice.doc_number.toLowerCase().includes(term)
    || invoice.bl_id.toLowerCase().includes(term)
    || (invoice.customer?.name ?? '').toLowerCase().includes(term)
    || (digits.length >= 3 && (invoice.customer?.cnpj_cpf ?? '').replace(/\D/g, '').includes(digits))
  )
}

/** Situação curta para a linha: o que impede ou pausa a cobrança. */
function rowFlags(invoice: DemurrageInvoiceRow): string[] {
  const flags: string[] = demurrageInvoiceNotices(invoice)
    .filter((notice) => notice.key !== 'roe-cache')
    .map((notice) => (notice.key === 'dispute' ? 'Disputa aberta' : notice.key === 'suspended' ? 'Fora da Régua' : 'Fora da Régua: datas alteradas'))
  if (Number(invoice.discount_value ?? 0) > 0) flags.push('Com desconto')
  return flags
}

export function DemurrageInvoicesTab({ tab, invoices, search, loading, error, onRetry, onSearchChange, onOpenDetail }: Props) {
  const narrow = useNarrowViewport()
  const visible = useMemo(() => (invoices ?? []).filter((invoice) => matchesSearch(invoice, search.trim())), [invoices, search])
  // A Régua é lida para a aba inteira, não para o recorte da busca: digitar
  // não refaz a consulta a cada tecla.
  const allInvoices = useMemo(() => invoices ?? [], [invoices])
  const invoiceIds = useMemo(() => allInvoices.map((invoice) => invoice.id), [allInvoices])
  const showDunning = tab === 'emitidas'
  const dunningQuery = useQuery({
    queryKey: queryKeys.demurrage.dunning(invoiceIds),
    enabled: showDunning && invoiceIds.length > 0,
    queryFn: () => fetchDemurrageDunningStatuses(allInvoices),
  })
  const dunningStatuses = dunningQuery.data ?? new Map()
  const totals = visible.reduce((sum, invoice) => ({
    usd: sum.usd + invoiceNetUsd(invoice).netUsd,
    brl: sum.brl + Number(invoice.current_total_brl ?? 0),
  }), { usd: 0, brl: 0 })
  const filtering = Boolean(search.trim())

  function dunningCell(invoice: DemurrageInvoiceListItem) {
    const status = dunningStatuses.get(invoice.id)
    const display = status ? getDemurrageDunningDisplay(invoice as DemurrageInvoiceRow, status) : undefined
    return <DemurrageDunningStatus display={display} loading={dunningQuery.isLoading} error={Boolean(dunningQuery.error)} />
  }

  return (
    <div className="app-dem-tab">
      <div className="app-dem-toolbar">
        <div className="app-dem-toolbar__search">
          <label className="sr-only" htmlFor="demurrage-invoice-search">Buscar Invoice, B/L, Cliente ou CNPJ</label>
          <Input
            id="demurrage-invoice-search"
            type="search"
            placeholder="Invoice, B/L, Cliente ou CNPJ"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <QueryStateGate
        isLoading={loading}
        isError={Boolean(error)}
        hasData={invoices !== undefined}
        errorMessage="Não foi possível carregar as Invoices de Demurrage."
        onRetry={onRetry}
        loadingLabel="Carregando Invoices…"
      >
        <div className="app-dem-tablebar">
          <SummaryStrip
            label="Resumo das Invoices"
            items={[
              { label: visible.length === 1 ? 'Invoice' : 'Invoices', value: String(visible.length) },
              { label: 'USD a cobrar', value: fmtUSD(totals.usd) },
              { label: tab === 'pagas' ? 'BRL recebido' : tab === 'emitidas' ? 'BRL hoje' : 'BRL no cancelamento', value: fmtBRL(totals.brl) },
            ]}
          />
          {tab === 'emitidas' ? <p className="app-dem-note">O USD fica travado na emissão; o BRL acompanha a PTAX até o pagamento.</p> : null}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtering ? 'Nenhuma Invoice nesta busca' : EMPTY_TEXT[tab].title}
            description={filtering ? `Nada encontrado para "${search.trim()}".` : EMPTY_TEXT[tab].description}
            action={filtering ? <Button variant="secondary" onClick={() => onSearchChange('')}>Limpar busca</Button> : undefined}
          />
        ) : narrow ? (
          <div className="app-dem-cards">
            {visible.map((invoice) => {
              const net = invoiceNetUsd(invoice)
              const flags = rowFlags(invoice as DemurrageInvoiceRow)
              return (
                <article key={invoice.id} className="app-dem-card" aria-label={`Invoice ${invoice.doc_number}`}>
                  <div className="app-dem-card__head">
                    <button type="button" className="app-dem-link app-dem-code app-dem-strong" onClick={() => onOpenDetail(invoice.id)}>{invoice.doc_number}</button>
                    <InvoiceStatusBadge status={invoice.status} />
                  </div>
                  <p className="app-dem-card__customer">{invoice.customer?.name ?? 'Cliente não identificado'}</p>
                  <p className="app-dem-meta">
                    B/L <CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-dem-link app-dem-code" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue>
                    {' · '}Emitida em {invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}
                  </p>
                  <div className="app-dem-card__foot">
                    <div className="app-table__cell-stack">
                      <span className="app-dem-amount">{fmtUSD(net.netUsd)}</span>
                      <span className="app-dem-meta">{fmtBRL(invoice.current_total_brl)}</span>
                    </div>
                    {flags.length ? <span className="app-dem-state app-dem-state--warning">{flags.join(' · ')}</span> : null}
                  </div>
                  {showDunning ? dunningCell(invoice) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <div className="app-surface app-dem-table-surface">
            <div className="app-table-scroll app-table-scroll--sticky">
              <table className="app-table app-table--compact app-dem-table">
                <caption className="sr-only">Invoices de Demurrage</caption>
                <thead>
                  <tr>
                    <th scope="col">Invoice</th>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">{tab === 'pagas' ? 'Emissão · pagamento' : 'Emissão'}</th>
                    <th scope="col" className="app-dem-num">USD a cobrar</th>
                    <th scope="col" className="app-dem-num">{tab === 'pagas' ? 'BRL pago' : 'BRL'}</th>
                    <th scope="col">Situação</th>
                    {showDunning ? <th scope="col">Régua de cobrança</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((invoice) => {
                    const net = invoiceNetUsd(invoice)
                    const flags = rowFlags(invoice as DemurrageInvoiceRow)
                    return (
                      <tr key={invoice.id}>
                        <td>
                          <div className="app-table__cell-stack" data-testid="demurrage-invoice-context">
                            <button type="button" className="app-dem-link app-dem-code app-dem-strong" onClick={() => onOpenDetail(invoice.id)}>{invoice.doc_number}</button>
                            <span className="app-dem-meta">B/L <CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-dem-link app-dem-code" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue></span>
                          </div>
                        </td>
                        <td>
                          <div className="app-table__cell-stack">
                            <span className="app-table__truncate app-table__truncate--xl" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? 'Cliente não identificado'}</span>
                            <span className="app-dem-meta tabular-nums">{invoice.customer?.cnpj_cpf ? <CopyValue value={formatCnpjCpf(invoice.customer.cnpj_cpf)} label="CNPJ/CPF" /> : <NoValue label="Sem CNPJ/CPF" />}</span>
                          </div>
                        </td>
                        <td className="tabular-nums">
                          <div className="app-table__cell-stack">
                            <span>{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</span>
                            {tab === 'pagas' && invoice.paid_at ? <span className="app-dem-meta">Paga em {formatDate(invoice.paid_at)}</span> : null}
                          </div>
                        </td>
                        <td className="app-dem-num">
                          <div className="app-table__cell-stack" data-testid="demurrage-invoice-financial">
                            <span className="app-dem-amount">{fmtUSD(net.netUsd)}</span>
                            {net.discountUsd > 0 ? <span className="app-dem-meta">{fmtUSD(net.totalUsd)} − desconto</span> : null}
                          </div>
                        </td>
                        <td className="app-dem-num">
                          <div className="app-table__cell-stack">
                            <span className="tabular-nums">{fmtBRL(invoice.current_total_brl)}</span>
                            {invoice.current_roe ? <span className="app-dem-meta">ROE {Number(invoice.current_roe).toFixed(4).replace('.', ',')}{invoice.roe_source === 'cached' ? ' · cache' : ''}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="app-table__cell-stack">
                            <InvoiceStatusBadge status={invoice.status} />
                            {flags.map((flag) => <span key={flag} className="app-dem-meta app-dem-meta--warning">{flag}</span>)}
                          </div>
                        </td>
                        {showDunning ? <td>{dunningCell(invoice)}</td> : null}
                      </tr>
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
