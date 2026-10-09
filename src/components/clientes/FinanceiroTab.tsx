import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Pencil, Plus } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useCustomerDemurrageInvoices, useCustomerManualChargeBls, useCustomerPayments, useCustomerRateOverrides, useCustomerReceivables } from '../../hooks/useCustomerFicha'
import { useCustomerDemurrageAgreements } from '../../hooks/useCustomerDemurrageAgreements'
import { formatBRL, formatCountLabel, formatDate, formatUSD } from '../../lib/utils'
import { INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { CustomerDemurrageAgreementModal } from '../demurrage/CustomerDemurrageAgreementModal'
import type { useCustomerDetail } from '../../hooks/useCustomers'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { isPortalReadyForBilling } from '../../lib/portalProvisioningViewModel'
import { BillingPortalReleaseCard } from './BillingPortalReleaseCard'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
const DEMURRAGE_STATUS_LABELS: Record<string, string> = { draft: 'Rascunho', issued: 'Emitida', paid: 'Paga', overdue: 'Vencida', cancelled: 'Cancelada' }
const RECEIVABLE_STATUS_LABELS: Record<string, string> = { open: 'Aberto', partially_settled: 'Parcialmente liquidado', settled: 'Liquidado', cancelled: 'Cancelado' }

type QueryLike = { isLoading?: boolean; isError?: boolean; refetch?: () => unknown }

/** Carregando, erro e restrito antes de qualquer "nenhum": nunca um vazio falso. */
function QueryBody({ query, restricted, children }: { query: QueryLike; restricted?: boolean; children: ReactNode }) {
  if (query.isLoading) return <p className="app-customer-muted app-customer-empty-line" role="status">Carregando…</p>
  if (query.isError) {
    return (
      <div className="app-customer-notice app-customer-notice--danger app-customer-empty-line" role="alert">
        <span>Erro ao carregar dados financeiros.</span>
        {query.refetch ? <Button variant="secondary" className="app-btn--sm" onClick={() => void query.refetch?.()}>Tentar novamente</Button> : null}
      </div>
    )
  }
  if (restricted) return <p className="app-customer-muted app-customer-empty-line">Visualização financeira restrita ao perfil autorizado.</p>
  return <>{children}</>
}

function Section({ title, count, links, children }: { title: string; count?: number; links?: ReactNode; children: ReactNode }) {
  return (
    <Card className="app-customer-sheet p-0">
      <div className="app-customer-section-head app-customer-section-head--padded">
        <h2 className="app-customer-section-title">
          {title}
          {count ? <span className="app-customer-section-count">{count}</span> : null}
        </h2>
        {links ? <div className="app-customer-section-links">{links}</div> : null}
      </div>
      {children}
    </Card>
  )
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="app-customer-text-link" to={to}>{children} <ArrowRight size={14} aria-hidden="true" /></Link>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="app-customer-muted app-customer-empty-line">{children}</p>
}

export function FinanceiroTab({ data }: { data: Data }) {
  const dem = useCustomerDemurrageInvoices(data.id)
  const rec = useCustomerReceivables(data.id)
  const pay = useCustomerPayments(data.id)
  const overrides = useCustomerRateOverrides(data.id)
  const manual = useCustomerManualChargeBls(data.id)
  const agreements = useCustomerDemurrageAgreements({ customerId: data.id })
  const { data: portalRow } = usePortalProvisioningForCustomer(data.id)

  const [agreementModalOpen, setAgreementModalOpen] = useState(false)
  const [selectedAgreement, setSelectedAgreement] = useState<CustomerDemurrageAgreementListItem | null>(null)

  const restricted = (value?: boolean) => Boolean(data.invoices_access_denied || value)
  const invoices = data.invoices ?? []
  const billingHref = `/taxas-locais?customer=${data.id}`

  function handleOpenNewAgreement() {
    setSelectedAgreement(null)
    setAgreementModalOpen(true)
  }

  function handleOpenEditAgreement(ag: CustomerDemurrageAgreementListItem) {
    setSelectedAgreement(ag)
    setAgreementModalOpen(true)
  }

  return (
    <div className="app-customer-stack">
      <BillingPortalReleaseCard customerId={data.id} portalReady={portalRow ? isPortalReadyForBilling(portalRow) : undefined} />

      <Section title="Faturas de Taxas Locais" count={data.invoices_access_denied ? undefined : invoices.length} links={<SectionLink to={billingHref}>Abrir em Taxas Locais</SectionLink>}>
        <QueryBody query={{}} restricted={data.invoices_access_denied}>
          {invoices.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-customer-subtable text-left text-sm">
                <caption className="sr-only">Faturas de Taxas Locais do cliente</caption>
                <thead><tr><th scope="col">Fatura</th><th scope="col">Emissão</th><th scope="col">Situação</th><th scope="col" className="app-customer-subtable__money">Total</th><th scope="col" className="app-customer-subtable__money">Saldo</th></tr></thead>
                <tbody>
                  {invoices.map((row) => (
                    <tr key={row.id}>
                      <td><Link className="app-customer-link" to={`${billingHref}&invoice=${row.id}`}>{row.invoice_number ?? `INV-${row.id}`}</Link></td>
                      <td className="tabular-nums">{formatDate(row.issued_at)}</td>
                      <td>{statusLabel(INVOICE_STATUS_LABELS, row.status)}</td>
                      <td className="app-customer-subtable__money">{formatBRL(row.total_brl)}</td>
                      <td className="app-customer-subtable__money">{row.balance_brl == null ? '—' : formatBRL(row.balance_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhuma fatura de Taxas Locais.</Empty>}
        </QueryBody>
      </Section>

      <Section title="Faturas de Demurrage" count={dem.data && !restricted(dem.data.denied) ? dem.data.rows.length : undefined} links={<SectionLink to={`/demurrage?busca=${encodeURIComponent(data.name)}`}>Abrir em Demurrage</SectionLink>}>
        <QueryBody query={dem} restricted={restricted(dem.data?.denied)}>
          {dem.data?.rows.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-customer-subtable text-left text-sm">
                <caption className="sr-only">Faturas de Demurrage do cliente</caption>
                <thead><tr><th scope="col">Documento</th><th scope="col">B/L</th><th scope="col">Emissão</th><th scope="col">Situação</th><th scope="col">Disputa</th><th scope="col" className="app-customer-subtable__money">USD</th><th scope="col" className="app-customer-subtable__money">BRL atual</th></tr></thead>
                <tbody>
                  {dem.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="app-customer-code">{row.doc_number}</td>
                      <td><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td>
                      <td className="tabular-nums">{formatDate(row.billed_at)}</td>
                      <td>{row.status ? DEMURRAGE_STATUS_LABELS[row.status] ?? row.status : '—'}</td>
                      <td>{row.dispute_open || row.dispute_status === 'aberto' ? <span className="app-customer-note app-customer-note--warning">Aberta{row.dispute_subject ? ` · ${row.dispute_subject}` : ''}</span> : '—'}</td>
                      <td className="app-customer-subtable__money">{formatUSD(row.total_usd)}</td>
                      <td className="app-customer-subtable__money">{row.current_total_brl == null ? '—' : formatBRL(row.current_total_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhuma fatura de Demurrage.</Empty>}
        </QueryBody>
      </Section>

      <Section title="Recebíveis de Taxas Locais" count={rec.data && !restricted(rec.data.denied) ? rec.data.rows.length : undefined}>
        <QueryBody query={rec} restricted={restricted(rec.data?.denied)}>
          {rec.data?.rows.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-customer-subtable text-left text-sm">
                <caption className="sr-only">Recebíveis de Taxas Locais do cliente, por B/L</caption>
                <thead><tr><th scope="col">B/L</th><th scope="col">Situação</th><th scope="col" className="app-customer-subtable__money">Original</th><th scope="col" className="app-customer-subtable__money">Liquidado</th><th scope="col" className="app-customer-subtable__money">Saldo</th></tr></thead>
                <tbody>
                  {rec.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td><Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td>
                      <td>{RECEIVABLE_STATUS_LABELS[row.status] ?? row.status}</td>
                      <td className="app-customer-subtable__money">{formatBRL(row.original_amount_brl)}</td>
                      <td className="app-customer-subtable__money">{formatBRL(row.settled_amount_brl)}</td>
                      <td className="app-customer-subtable__money app-customer-subtable__strong">{formatBRL(row.balance_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhum recebível.</Empty>}
        </QueryBody>
      </Section>

      <Section title="Pagamentos" count={pay.data && !restricted(pay.data.denied) ? pay.data.rows.length : undefined}>
        <QueryBody query={pay} restricted={restricted(pay.data?.denied)}>
          {pay.data?.rows.length ? (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact app-customer-subtable text-left text-sm">
                <caption className="sr-only">Pagamentos registrados para o cliente</caption>
                <thead><tr><th scope="col">Data</th><th scope="col">Fatura</th><th scope="col">Método</th><th scope="col" className="app-customer-subtable__money">Valor</th></tr></thead>
                <tbody>
                  {pay.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular-nums">{formatDate(row.paid_at)}</td>
                      <td>{row.invoice ? <Link className="app-customer-link" to={`${billingHref}&invoice=${row.invoice.id}`}>{row.invoice.invoice_number ?? `INV-${row.invoice.id}`}</Link> : '—'}</td>
                      <td>{row.payment_method ?? '—'}</td>
                      <td className="app-customer-subtable__money">{formatBRL(row.amount_brl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nenhum pagamento registrado.</Empty>}
        </QueryBody>
      </Section>

      <Section
        title="Acordos de Demurrage"
        count={agreements.data?.length || undefined}
        links={(
          <>
            <Button variant="secondary" onClick={handleOpenNewAgreement}>
              <Plus size={14} aria-hidden="true" />
              Novo acordo
            </Button>
            <SectionLink to={`/demurrage/taxas?tab=acordos&cliente=${encodeURIComponent(data.name)}`}>Ver em Tarifas</SectionLink>
          </>
        )}
      >
        <QueryBody query={agreements}>
          {agreements.data?.length ? (
            <ul className="app-customer-rows">
              {agreements.data.map((ag) => (
                <li key={ag.id}>
                  <div className="app-customer-rows__main">
                    <span className="app-customer-rows__title">
                      <strong>{ag.free_days} dias Free Time</strong>
                      <Badge tone={ag.active ? 'success' : 'neutral'}>{ag.active ? 'Ativo' : 'Inativo'}</Badge>
                    </span>
                    <span className="app-customer-muted">
                      P1: {ag.p1_usd != null ? formatUSD(ag.p1_usd) : 'Padrão'} · P2: {ag.p2_usd != null ? formatUSD(ag.p2_usd) : 'Padrão'} · Vigência: {formatDate(ag.valid_from)} até {ag.valid_to ? formatDate(ag.valid_to) : 'indeterminado'}
                      {ag.notes ? ` · ${ag.notes}` : ''}
                    </span>
                  </div>
                  <Button variant="ghost" className="app-btn--sm" onClick={() => handleOpenEditAgreement(ag)} aria-label={`Editar acordo de ${ag.free_days} dias`}>
                    <Pencil size={14} aria-hidden="true" />
                    Editar
                  </Button>
                </li>
              ))}
            </ul>
          ) : <Empty>Nenhum acordo comercial de Demurrage cadastrado para este cliente.</Empty>}
        </QueryBody>
      </Section>

      <Section
        title="Tarifas do cliente"
        links={<SectionLink to={`/taxas-locais/tabelas?tab=overrides&cliente=${encodeURIComponent(data.name)}`}>Gerenciar em Tabelas</SectionLink>}
      >
        <div className="app-customer-subsections">
          <div>
            <h3 className="app-customer-subsection-title">Regras gerais (overrides)</h3>
            <QueryBody query={overrides}>
              {overrides.data?.length ? (
                <ul className="app-customer-rows">
                  {overrides.data.map((row) => (
                    <li key={row.id}>
                      <div className="app-customer-rows__main">
                        <strong>{row.charge_item?.name ?? '—'}</strong>
                        <span className="app-customer-muted">{row.charge_item?.charge_table?.name ?? '—'} · desde {row.valid_from ? formatDate(row.valid_from) : '—'}</span>
                      </div>
                      <span className="app-customer-money">{row.charge_item?.currency === 'USD' ? formatUSD(row.override_value) : formatBRL(row.override_value)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhum override cadastrado.</Empty>}
            </QueryBody>
          </div>
          <div>
            <h3 className="app-customer-subsection-title">B/Ls com cobrança manual</h3>
            <QueryBody query={manual}>
              {manual.data?.length ? (
                <ul className="app-customer-rows">
                  {manual.data.map((row) => (
                    <li key={row.bl_id}>
                      <Link className="app-customer-link app-customer-code" to={`/bls/${row.bl_id}?tab=faturamento`}>{row.bl_id}</Link>
                      <span className="app-customer-muted">{formatCountLabel(row.manual_count, 'item manual', 'itens manuais')}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nenhum B/L com cobrança manual.</Empty>}
            </QueryBody>
          </div>
        </div>
      </Section>

      {agreementModalOpen ? (
        <CustomerDemurrageAgreementModal
          open={agreementModalOpen}
          onClose={() => setAgreementModalOpen(false)}
          initialAgreement={selectedAgreement}
          initialCustomer={{ id: data.id, name: data.name, cnpj_cpf: data.cnpj_cpf }}
        />
      ) : null}
    </div>
  )
}
