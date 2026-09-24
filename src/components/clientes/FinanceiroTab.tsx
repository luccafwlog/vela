import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus } from 'lucide-react'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useCustomerDemurrageInvoices, useCustomerManualChargeBls, useCustomerPayments, useCustomerRateOverrides, useCustomerReceivables } from '../../hooks/useCustomerFicha'
import { useCustomerDemurrageAgreements } from '../../hooks/useCustomerDemurrageAgreements'
import { formatBRL, formatDate, formatUSD } from '../../lib/utils'
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
const restrictedText = <div className="text-sm text-amber-100">Visualização financeira restrita ao perfil autorizado.</div>
const loadingText = <div className="text-sm text-slate-400">Carregando…</div>
const errorText = <div className="text-sm text-red-300">Erro ao carregar dados financeiros.</div>

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

  function handleOpenNewAgreement() {
    setSelectedAgreement(null)
    setAgreementModalOpen(true)
  }

  function handleOpenEditAgreement(ag: CustomerDemurrageAgreementListItem) {
    setSelectedAgreement(ag)
    setAgreementModalOpen(true)
  }

  return (
    <div className="grid gap-5">
      <BillingPortalReleaseCard customerId={data.id} portalReady={portalRow ? isPortalReadyForBilling(portalRow) : undefined} />
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Invoices locais</h2>
          <Link className="app-btn app-btn--secondary" to={`/taxas-locais?customer=${data.id}`}>Ver em Taxas Locais</Link>
        </div>
        {data.invoices_access_denied ? restrictedText : (
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead><tr><th>Invoice</th><th>Emissão</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {data.invoices?.length ? data.invoices.map((row) => (
                <tr key={row.id}>
                  <td><Link className="app-table__action" to={`/taxas-locais?customer=${data.id}&invoice=${row.id}`}>{row.invoice_number ?? `INV-${row.id}`}</Link></td>
                  <td>{formatDate(row.issued_at)}</td>
                  <td>{formatBRL(row.total_brl)}</td>
                  <td>{statusLabel(INVOICE_STATUS_LABELS, row.status)}</td>
                </tr>
              )) : <tr><td colSpan={4} className="py-4 text-slate-400">Nenhuma invoice encontrada.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Invoices de Demurrage</h2>
          <Link className="app-btn app-btn--secondary" to="/demurrage">Ver no Demurrage</Link>
        </div>
        {dem.isLoading ? loadingText : dem.isError ? errorText : restricted(dem.data?.denied) ? restrictedText : (
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead><tr><th>Documento</th><th>B/L</th><th>Emissão</th><th>USD</th><th>BRL atual</th><th>Status</th><th>Disputa</th></tr></thead>
            <tbody>
              {dem.data?.rows.length ? dem.data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.doc_number}</td>
                  <td><Link className="app-table__action" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td>
                  <td>{formatDate(row.billed_at)}</td>
                  <td>{formatUSD(row.total_usd)}</td>
                  <td>{formatBRL(row.current_total_brl ?? 0)}</td>
                  <td>{row.status ? DEMURRAGE_STATUS_LABELS[row.status] ?? row.status : '—'}</td>
                  <td>{row.dispute_open || row.dispute_status === 'aberto' ? `Aberta${row.dispute_subject ? ` · ${row.dispute_subject}` : ''}` : '—'}</td>
                </tr>
              )) : <tr><td colSpan={7} className="py-4 text-slate-400">Nenhuma invoice de demurrage.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Recebíveis (Ledger Local)</h2>
        {rec.isLoading ? loadingText : rec.isError ? errorText : restricted(rec.data?.denied) ? restrictedText : (
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead><tr><th>B/L</th><th>Original</th><th>Liquidado</th><th>Saldo</th><th>Status</th></tr></thead>
            <tbody>
              {rec.data?.rows.length ? rec.data.rows.map((row) => (
                <tr key={row.id}>
                  <td><Link className="app-table__action" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link></td>
                  <td>{formatBRL(row.original_amount_brl)}</td>
                  <td>{formatBRL(row.settled_amount_brl)}</td>
                  <td>{formatBRL(row.balance_brl)}</td>
                  <td>{RECEIVABLE_STATUS_LABELS[row.status] ?? row.status}</td>
                </tr>
              )) : <tr><td colSpan={5} className="py-4 text-slate-400">Nenhum recebível.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-white">Pagamentos</h2>
        {pay.isLoading ? loadingText : pay.isError ? errorText : restricted(pay.data?.denied) ? restrictedText : (
          <table className="app-table app-table--compact w-full text-left text-sm">
            <thead><tr><th>Data</th><th>Invoice</th><th>Valor</th><th>Método</th></tr></thead>
            <tbody>
              {pay.data?.rows.length ? pay.data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.paid_at)}</td>
                  <td>{row.invoice ? <Link className="app-table__action" to={`/taxas-locais?customer=${data.id}&invoice=${row.invoice.id}`}>{row.invoice.invoice_number ?? `INV-${row.invoice.id}`}</Link> : '—'}</td>
                  <td>{formatBRL(row.amount_brl)}</td>
                  <td>{row.payment_method ?? '—'}</td>
                </tr>
              )) : <tr><td colSpan={4} className="py-4 text-slate-400">Nenhum pagamento registrado.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Acordos de Demurrage</h2>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleOpenNewAgreement}>
              <Plus size={14} />
              Novo Acordo
            </Button>
            <Link className="app-btn app-btn--secondary" to={`/demurrage/taxas?tab=acordos&cliente=${encodeURIComponent(data.name)}`}>
              Ver em Tarifas
            </Link>
          </div>
        </div>
        {agreements.isLoading ? loadingText : agreements.isError ? errorText : agreements.data?.length ? (
          <ul className="grid gap-2 text-sm">
            {agreements.data.map((ag) => (
              <li key={ag.id} className="flex items-center justify-between rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{ag.free_days} dias Free Time</span>
                    <Badge tone={ag.active ? 'green' : 'slate'}>{ag.active ? 'Ativo' : 'Inativo'}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    P1: {ag.p1_usd != null ? formatUSD(ag.p1_usd) : 'Padrão'} · P2: {ag.p2_usd != null ? formatUSD(ag.p2_usd) : 'Padrão'} · Vigência: {formatDate(ag.valid_from)} até {ag.valid_to ? formatDate(ag.valid_to) : 'indeterminado'}
                    {ag.notes ? ` · ${ag.notes}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenEditAgreement(ag)}
                  className="rounded p-1 text-slate-400 hover:bg-[#21262d] hover:text-white"
                  title="Editar acordo"
                >
                  <Pencil size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-400">Nenhum acordo comercial de Demurrage cadastrado para este cliente.</div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Tarifas do cliente</h2>
          <Link className="app-btn app-btn--secondary" to={`/taxas-locais/tabelas?tab=overrides&cliente=${encodeURIComponent(data.name)}`}>
            Gerenciar em Tabelas
          </Link>
        </div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Regras gerais (overrides)</h3>
        {overrides.data?.length ? (
          <ul className="mb-4 grid gap-2 text-sm">
            {overrides.data.map((row) => (
              <li key={row.id} className="rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2">
                <span className="font-semibold text-white">{row.charge_item?.name ?? '—'}</span>
                <span className="ml-2 text-slate-400">{row.charge_item?.charge_table?.name ?? '—'} · {row.charge_item?.currency === 'USD' ? formatUSD(row.override_value) : formatBRL(row.override_value)} · {row.valid_from ? formatDate(row.valid_from) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : <div className="mb-4 text-sm text-slate-400">Nenhum override cadastrado.</div>}
        <h3 className="mb-2 text-sm font-semibold text-slate-300">B/Ls com cobrança manual</h3>
        {manual.data?.length ? (
          <ul className="grid gap-2 text-sm">
            {manual.data.map((row) => (
              <li key={row.bl_id}>
                <Link className="app-table__action" to={`/bls/${row.bl_id}`}>{row.bl_id}</Link>
                <span className="ml-2 text-slate-400">{row.manual_count} item(ns) manual(is)</span>
              </li>
            ))}
          </ul>
        ) : <div className="text-sm text-slate-400">Nenhum B/L com tarifa diferenciada.</div>}
      </Card>

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
