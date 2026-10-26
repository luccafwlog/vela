import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/Card'
import { Input } from '../ui/Input'
import { SummaryStrip } from '../ui/SummaryStrip'
import { QueryStateGate } from '../shared/QueryStateGate'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import { InvoiceStatusBadge } from './DemurrageBadges'
import { demurrageInvoiceNotices, fmtBRL, fmtUSD, invoiceNetUsd, type DemurrageInvoiceRow } from '../../services/demurrage/demurragePresentation'
import { formatDate } from '../../lib/utils'
import type { DemurrageInvoiceListItem } from '../../services/demurrage/demurrageInvoices'
import { fetchDemurrageDunningStatuses, getDemurrageDunningDisplay } from '../../services/demurrageDunning'
import { queryKeys } from '../../services/queryKeys'
import { DemurrageDunningStatus } from './DemurrageDunningStatus'
import { matchesAnyToken } from '../../lib/searchTerms'

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
    || matchesAnyToken(term, [invoice.bl_id, invoice.doc_number])
    || (invoice.customer?.name ?? '').toLowerCase().includes(term)
    || (digits.length >= 3 && (invoice.customer?.cnpj_cpf ?? '').replace(/\D/g, '').includes(digits))
  )
}

/** Situação curta para o cartão do celular: o que impede ou pausa a cobrança. */
function rowFlags(invoice: DemurrageInvoiceRow): string[] {
  const flags: string[] = demurrageInvoiceNotices(invoice)
    .filter((notice) => notice.key !== 'roe-cache')
    .map((notice) => (notice.key === 'dispute' ? 'Disputa aberta' : notice.key === 'suspended' ? 'Fora da Régua' : 'Fora da Régua: datas alteradas'))
  if (Number(invoice.discount_value ?? 0) > 0) flags.push('Com desconto')
  return flags
}

/**
 * Situação na tabela (regra 5, tabela limpa): disputa aberta vira "Em disputa"
 * em âmbar. Fora da Régua fica na coluna da Régua; sem essa coluna (Pagas e
 * Canceladas), aparece ao lado da situação.
 */
function InvoiceSituation({ invoice, withDunning }: { invoice: DemurrageInvoiceRow; withDunning: boolean }) {
  const open = invoice.status === 'issued' || invoice.status === 'overdue'
  if (open && invoice.dispute_open) return <StatusText tone="warning">Em disputa</StatusText>
  const outOfDunning = !withDunning && demurrageInvoiceNotices(invoice).some((notice) => notice.key === 'dates-paid' || notice.key === 'dates-negotiated' || notice.key === 'suspended')
  return (
    <>
      <InvoiceStatusBadge status={invoice.status} />
      {outOfDunning ? <> · <StatusText tone="warning">Fora da Régua</StatusText></> : null}
    </>
  )
}

/** ROE comum a todas as Invoices do recorte (o da PTAX do dia, nas em aberto); null quando variam. */
function sharedRoe(invoices: readonly DemurrageInvoiceListItem[]): number | null {
  const values = new Set(invoices.map((invoice) => (invoice.current_roe ? Number(invoice.current_roe) : null)))
  if (values.size !== 1) return null
  const [value] = values
  return value ?? null
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
  const roe = sharedRoe(visible)

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
              ...(roe ? [{ label: 'ROE', value: roe.toFixed(4).replace('.', ',') }] : []),
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
                    <th scope="col">B/L</th>
                    <th scope="col">Emissão</th>
                    {tab === 'pagas' ? <th scope="col">Pagamento</th> : null}
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col">USD a cobrar</th>
                    <th scope="col">{tab === 'pagas' ? 'BRL pago' : tab === 'emitidas' ? 'BRL hoje' : 'BRL'}</th>
                    <th scope="col" className="app-table__text-head">Situação</th>
                    {showDunning ? <th scope="col" className="app-table__text-head">Régua de cobrança</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((invoice) => {
                    const net = invoiceNetUsd(invoice)
                    const cancelled = invoice.status === 'cancelled'
                    const brlPending = tab === 'emitidas' && Number(invoice.current_total_brl ?? 0) > 0
                    return (
                      <tr key={invoice.id} className={cancelled ? 'app-table__row--muted' : undefined}>
                        <td data-testid="demurrage-invoice-context"><button type="button" className="app-dem-link app-dem-code app-dem-strong" onClick={() => onOpenDetail(invoice.id)}>{invoice.doc_number}</button></td>
                        <td className="app-dem-code"><CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-dem-link" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue></td>
                        <td className="tabular-nums">{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</td>
                        {tab === 'pagas' ? <td className="tabular-nums">{invoice.paid_at ? formatDate(invoice.paid_at) : <NoValue label="Sem data de pagamento" />}</td> : null}
                        <td className="app-table__text" title={invoice.customer?.name ?? undefined}>{invoice.customer?.name ?? 'Cliente não identificado'}</td>
                        <td className="tabular-nums" data-testid="demurrage-invoice-financial" title={net.discountUsd > 0 ? `${fmtUSD(net.totalUsd)} − desconto de ${fmtUSD(net.discountUsd)}` : undefined}>{fmtUSD(net.netUsd)}</td>
                        <td className="tabular-nums">{brlPending ? <StatusText tone="warning">{fmtBRL(invoice.current_total_brl)}</StatusText> : fmtBRL(invoice.current_total_brl)}</td>
                        <td className="app-table__text"><InvoiceSituation invoice={invoice as DemurrageInvoiceRow} withDunning={showDunning} /></td>
                        {showDunning ? <td className="app-table__text">{dunningCell(invoice)}</td> : null}
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
