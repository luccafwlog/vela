import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Ban, CircleDollarSign, FileText, MessageSquare, Percent, Receipt, RotateCcw } from 'lucide-react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { CopyValue } from '../ui/CopyValue'
import { Modal } from '../ui/Modal'
import { NoValue } from '../ui/NoValue'
import { FinancialRefundsPanel } from '../billing/FinancialRefundsPanel'
import { ImportNotice } from '../shared/ImportParts'
import { StatusText } from '../ui/StatusText'
import { InvoiceStatusBadge } from './DemurrageBadges'
import { ManualRoeRelease } from './ManualRoeRelease'
import {
  demurrageInvoiceNotices,
  fmtBRL,
  fmtUSD,
  invoiceNetUsd,
  earlierLiveInvoices,
  type DemurrageInvoiceRow,
} from '../../services/demurrage/demurragePresentation'
import { DISCOUNT_TYPE_LABELS } from '../../services/demurrage/demurrageForms'
import { getInvoiceDetail, listDemurrageInvoices, type DemurrageInvoiceListItem } from '../../services/demurrage/demurrageInvoices'
import { queryKeys } from '../../services/queryKeys'
import { DEMURRAGE_INVOICE_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { extractErrorText } from '../../lib/errors'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import type { DemurrageInvoiceItem } from '../../types/database'

export type DemurrageDetailInvoice = DemurrageInvoiceListItem & DemurrageInvoiceRow

export type DemurrageDetailPermissions = {
  /** Baixa manual: Financeiro ou Administrativo (`is_financeiro_user`). O desconto é de qualquer Departamento (migration 247). */
  canSettle: boolean
  /** Cancelar Invoice e cancelar baixa: Administrativo (`is_admin`). */
  canAdmin: boolean
  /** Conversa de Disputas: Equipamentos e Administrativo. */
  canAnswerDispute: boolean
  /** Tirar o ROE manual: Financeiro, Administrativo e Equipamentos (migration 435). */
  canManageRoe: boolean
}

type Props = {
  invoiceId: number | null
  permissions: DemurrageDetailPermissions
  cancelling: boolean
  /** Recusa do banco ao cancelar, mostrada no detalhe. */
  cancelError?: string | null
  onClose: () => void
  onOpenInvoice: (invoiceId: number) => void
  onRegisterPayment: (invoice: DemurrageDetailInvoice) => void
  onDiscount: (invoice: DemurrageDetailInvoice) => void
  onDisputeData: (invoice: DemurrageDetailInvoice) => void
  onOpenDisputes: (invoice: DemurrageDetailInvoice) => void
  onOpenDocument: (invoiceId: number, type: 'invoice' | 'receipt') => void
  onCancelInvoice: (invoice: DemurrageDetailInvoice) => void
  onReversePayment: (invoice: DemurrageDetailInvoice) => void
}

function roeText(invoice: DemurrageDetailInvoice) {
  if (!invoice.current_roe) return <NoValue label="Sem câmbio calculado" />
  const roe = Number(invoice.current_roe).toFixed(4).replace('.', ',')
  // ADR 0094, B10: o ROE manual do B/L prevalece; a PTAX diária não o troca.
  if (invoice.roe_manual && (invoice.status === 'issued' || invoice.status === 'overdue')) return `${roe} (ROE manual, fora do recálculo pela PTAX)`
  const source = invoice.roe_source === 'cached' ? 'PTAX do cache' : invoice.roe_source === 'manual' ? 'PTAX informada' : 'PTAX do BCB'
  return `${roe} (${source})`
}

/** "9 × US$ 30,00", como na fatura do Portal; "—" sem dias no período. */
function periodValue(days: number, rate: number) {
  return days > 0 ? `${days} × ${fmtUSD(rate)}` : <NoValue label="Sem dias neste período" />
}

/**
 * Detalhe da Invoice de Demurrage: quem é, quanto cobra (USD travado na
 * emissão, BRL que acompanha a PTAX até o pagamento), o que a impede de seguir
 * na Régua e as ações que o perfil pode fazer. Cada ação abre o seu formulário
 * no lugar deste diálogo e volta para ele ao terminar.
 */
export function DemurrageInvoiceDetailModal({
  invoiceId,
  permissions,
  cancelling,
  cancelError = null,
  onClose,
  onOpenInvoice,
  onRegisterPayment,
  onDiscount,
  onDisputeData,
  onOpenDisputes,
  onOpenDocument,
  onCancelInvoice,
  onReversePayment,
}: Props) {
  const detailQuery = useQuery({
    queryKey: ['demurrage-invoice-detail', invoiceId],
    queryFn: () => getInvoiceDetail(invoiceId!),
    enabled: invoiceId != null,
  })
  const invoice = detailQuery.data?.invoice as DemurrageDetailInvoice | undefined
  const items = (detailQuery.data?.items ?? []) as DemurrageInvoiceItem[]
  const siblingsQuery = useQuery({
    queryKey: queryKeys.demurrage.invoices({ blId: invoice?.bl_id }),
    queryFn: () => listDemurrageInvoices({ blId: invoice!.bl_id }),
    enabled: Boolean(invoice?.bl_id),
  })
  const siblings = (siblingsQuery.data ?? []).filter((other) => other.id !== invoice?.id)
  const earlier = invoice ? earlierLiveInvoices(invoice, siblingsQuery.data ?? []) : []

  const title = invoice ? `Invoice de Demurrage ${invoice.doc_number}` : 'Invoice de Demurrage'

  return (
    <Modal open={invoiceId != null} onClose={onClose} title={title} size="lg">
      {detailQuery.isLoading ? <p className="app-dem-meta" role="status">Carregando a Invoice…</p> : null}
      {detailQuery.error ? (
        <div className="app-invoice-detail__error" role="alert">
          <p>Não foi possível abrir a Invoice: {extractErrorText(detailQuery.error)}</p>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void detailQuery.refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {invoice ? (
        <DetailBody
          invoice={invoice}
          items={items}
          earlier={earlier}
          siblings={siblings}
          siblingsError={Boolean(siblingsQuery.error)}
          permissions={permissions}
          cancelling={cancelling}
          cancelError={cancelError}
          onOpenInvoice={onOpenInvoice}
          onRegisterPayment={onRegisterPayment}
          onDiscount={onDiscount}
          onDisputeData={onDisputeData}
          onOpenDisputes={onOpenDisputes}
          onOpenDocument={onOpenDocument}
          onCancelInvoice={onCancelInvoice}
          onReversePayment={onReversePayment}
        />
      ) : null}
    </Modal>
  )
}

function DetailBody({
  invoice,
  items,
  earlier,
  siblings,
  siblingsError,
  permissions,
  cancelling,
  cancelError,
  onOpenInvoice,
  onRegisterPayment,
  onDiscount,
  onDisputeData,
  onOpenDisputes,
  onOpenDocument,
  onCancelInvoice,
  onReversePayment,
}: Omit<Props, 'invoiceId' | 'onClose'> & {
  invoice: DemurrageDetailInvoice
  items: DemurrageInvoiceItem[]
  earlier: DemurrageInvoiceListItem[]
  siblings: DemurrageInvoiceListItem[]
  siblingsError: boolean
}) {
  const net = invoiceNetUsd(invoice)
  const notices = demurrageInvoiceNotices(invoice)
  // `overdue` é emitida vencida: a Régua e as ações a tratam como emitida.
  const issued = invoice.status === 'issued' || invoice.status === 'overdue'
  const paid = invoice.status === 'paid'
  const hasReceipt = paid || (invoice.status === 'cancelled' && Boolean(invoice.paid_at))
  const voyage = invoice.bl?.voyage
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.subtotal_usd ?? 0), 0)
  const hasDispute = Boolean(invoice.dispute_subject || invoice.dispute_reason || invoice.dispute_notes)
  const restrictions = [
    issued && !permissions.canSettle ? 'Registrar pagamento: Financeiro ou Administrativo.' : null,
    (issued || paid) && !permissions.canAdmin ? (issued ? 'Cancelar a Invoice: Administrativo.' : 'Cancelar a baixa: Administrativo.') : null,
  ].filter(Boolean)

  return (
    <div className="app-invoice-detail">
      {notices.map((notice) => (
        <ImportNotice key={notice.key} tone={notice.tone} title={notice.title}>
          <p>{notice.text}</p>
        </ImportNotice>
      ))}

      <Block title="Valores e dados da Invoice" headingLevel={3}>
        <LeadValue detail={issued ? 'travado na emissão; o BRL acompanha a PTAX até o pagamento' : 'travado na emissão'}>
          {fmtUSD(net.netUsd)} a cobrar
        </LeadValue>
        <FactList columns={4}>
          <Fact label={paid ? 'BRL pago' : invoice.status === 'cancelled' ? 'BRL no cancelamento' : 'BRL hoje'}>{fmtBRL(invoice.current_total_brl)}</Fact>
          <Fact label={paid ? 'ROE (congelado no pagamento)' : 'ROE'}>{roeText(invoice)}</Fact>
          <Fact label="Situação">{issued && invoice.dispute_open ? <StatusText tone="warning">Em disputa</StatusText> : <InvoiceStatusBadge status={invoice.status} />}</Fact>
          <Fact label="Tipo">{earlier.length ? 'Complementar' : 'Normal'}</Fact>
          <Fact label="Cliente">{invoice.customer?.name ?? 'Cliente não identificado'}</Fact>
          <Fact label="CNPJ">{invoice.customer?.cnpj_cpf ? <CopyValue value={formatCnpjCpf(invoice.customer.cnpj_cpf)} label="CNPJ/CPF" /> : <NoValue label="CNPJ não informado" />}</Fact>
          <Fact label="B/L"><CopyValue value={invoice.bl_id} label="número do B/L"><Link className="app-invoice-detail__link app-invoice-detail__code" to={`/bls/${encodeURIComponent(invoice.bl_id)}?tab=faturamento`}>{invoice.bl_id}</Link></CopyValue></Fact>
          <Fact label="Navio / Viagem">{voyage?.voyage_number ? `${voyage.vessel?.name ? `${voyage.vessel.name} / ` : ''}${voyage.voyage_number}` : <NoValue label="Sem viagem" />}</Fact>
          <Fact label="Emitida em">{invoice.billed_at ? formatDate(invoice.billed_at) : <NoValue label="Sem data de emissão" />}</Fact>
          {invoice.paid_at ? <Fact label="Paga em">{formatDate(invoice.paid_at)}</Fact> : null}
          <Fact label="Itens">{fmtUSD(net.totalUsd)} em {items.length} {items.length === 1 ? 'container' : 'containers'}</Fact>
          <Fact label="Desconto">
            {net.discountUsd > 0
              ? `− ${fmtUSD(net.discountUsd)} (${invoice.discount_mode === 'percent' ? `${String(invoice.discount_value).replace('.', ',')}% em USD` : 'valor fixo em USD'})`
              : <NoValue label="Sem desconto" />}
          </Fact>
        </FactList>
      </Block>

      <div className="app-invoice-detail__actions">
        {issued && permissions.canSettle ? (
          <Button onClick={() => onRegisterPayment(invoice)}><CircleDollarSign size={16} aria-hidden="true" />Registrar pagamento</Button>
        ) : null}
        {issued && invoice.roe_manual && permissions.canManageRoe ? <ManualRoeRelease invoiceId={invoice.id} docNumber={invoice.doc_number} /> : null}
        {issued ? (
          <Button variant="secondary" onClick={() => onDiscount(invoice)}><Percent size={16} aria-hidden="true" />{Number(invoice.discount_value ?? 0) > 0 ? 'Alterar desconto' : 'Aplicar desconto'}</Button>
        ) : null}
        {invoice.status !== 'cancelled' ? (
          <Button variant="secondary" onClick={() => onDisputeData(invoice)}><MessageSquare size={16} aria-hidden="true" />Dados da disputa</Button>
        ) : null}
        <Button variant="secondary" onClick={() => onOpenDocument(invoice.id, 'invoice')}><FileText size={16} aria-hidden="true" />Ver fatura</Button>
        {hasReceipt ? <Button variant="secondary" onClick={() => onOpenDocument(invoice.id, 'receipt')}><Receipt size={16} aria-hidden="true" />Ver recibo</Button> : null}
        {paid && permissions.canAdmin ? (
          <Button variant="danger" onClick={() => onReversePayment(invoice)}><RotateCcw size={16} aria-hidden="true" />Cancelar baixa…</Button>
        ) : null}
        {issued && permissions.canAdmin ? (
          <Button variant="danger" loading={cancelling} loadingLabel="Cancelando…" onClick={() => onCancelInvoice(invoice)}><Ban size={16} aria-hidden="true" />Cancelar Invoice…</Button>
        ) : null}
      </div>
      {cancelError ? <p className="app-invoice-detail__alert" role="alert">{cancelError} A Invoice não foi cancelada.</p> : null}
      {restrictions.length ? <p className="app-invoice-detail__note">{restrictions.join(' ')}</p> : null}

      {earlier.length || siblings.length || siblingsError ? (
        <section className="app-invoice-detail__section" aria-labelledby="dem-detail-group">
          <h3 id="dem-detail-group" className="app-invoice-detail__heading">Outras Invoices deste B/L</h3>
          {earlier.length ? (
            <p className="app-invoice-detail__note">
              Esta é uma Invoice complementar: cobra só as caixas que ainda não estavam em Invoice. As já cobradas ficaram em {earlier.map((other) => other.doc_number).join(', ')}.
            </p>
          ) : null}
          {siblingsError ? <p className="app-invoice-detail__alert">Não foi possível conferir as outras Invoices deste B/L.</p> : null}
          {siblings.length ? (
            <ul className="app-dem-sibling-list">
              {siblings.map((other) => (
                <li key={other.id}>
                  <button type="button" className="app-invoice-detail__link app-invoice-detail__code" onClick={() => onOpenInvoice(other.id)}>{other.doc_number}</button>
                  <span>{statusLabel(DEMURRAGE_INVOICE_STATUS_LABELS, other.status)}</span>
                  <span className="tabular-nums">{fmtUSD(other.total_usd)}</span>
                  <span className="app-invoice-detail__note">Emitida em {other.billed_at ? formatDate(other.billed_at) : <NoValue label="Sem data de emissão" />}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="app-invoice-detail__section" aria-labelledby="dem-detail-items">
        <h3 id="dem-detail-items" className="app-invoice-detail__heading">
          Containers cobrados nesta Invoice <span className="app-invoice-detail__count">{items.length}</span>
        </h3>
        <div className="app-table-scroll">
          <table className="app-table app-table--compact app-invoice-detail__table">
            <caption className="sr-only">Containers cobrados na Invoice {invoice.doc_number}</caption>
            <thead>
              <tr>
                <th scope="col">Container</th>
                <th scope="col">Tipo</th>
                <th scope="col">Descarga</th>
                <th scope="col">Devolução</th>
                <th scope="col" className="app-invoice-detail__num">Dias</th>
                <th scope="col" className="app-invoice-detail__num">Free time</th>
                <th scope="col" className="app-invoice-detail__num">1º período</th>
                <th scope="col" className="app-invoice-detail__num">2º período</th>
                <th scope="col" className="app-invoice-detail__num">US$</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item) => (
                <tr key={item.id}>
                  <td className="app-invoice-detail__code"><CopyValue value={item.container_number} label="número do contêiner" /></td>
                  <td>{item.container_type ?? <NoValue label="Sem tipo" />}</td>
                  <td className="tabular-nums">{item.discharge_date ? formatDate(item.discharge_date) : <NoValue label="Sem descarga" />}</td>
                  <td className="tabular-nums">{item.return_date ? formatDate(item.return_date) : <NoValue label="Sem devolução" />}</td>
                  <td className="app-invoice-detail__num">{item.total_days}</td>
                  <td className="app-invoice-detail__num">{item.free_days}</td>
                  <td className="app-invoice-detail__num">{periodValue(item.days_p1, item.rate_p1_usd)}</td>
                  <td className="app-invoice-detail__num">{periodValue(item.days_p2, item.rate_p2_usd)}</td>
                  <td className="app-invoice-detail__num">{fmtUSD(item.subtotal_usd)}</td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="app-invoice-detail__empty">Nenhum container nesta Invoice.</td></tr>
              )}
            </tbody>
            {items.length ? (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={8}>Total dos itens</th>
                  <td className="app-invoice-detail__num app-dem-strong">{fmtUSD(itemsTotal)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="app-invoice-detail__note">Container devolvido dentro do free time entra com valor zero. Os dias, as faixas e as diárias ficaram travados na emissão.</p>
      </section>

      {net.discountUsd > 0 ? (
        <section className="app-invoice-detail__section" aria-labelledby="dem-detail-discount">
          <h3 id="dem-detail-discount" className="app-invoice-detail__heading">Desconto</h3>
          <p className="app-invoice-detail__meta">
            <span>Tipo: {invoice.discount_type ? DISCOUNT_TYPE_LABELS[invoice.discount_type as keyof typeof DISCOUNT_TYPE_LABELS] ?? invoice.discount_type : 'Não informado'}</span>
            <span>Aprovador: {invoice.discount_approver || 'Não informado'}</span>
          </p>
          {invoice.discount_justification ? <p className="app-invoice-detail__description">{invoice.discount_justification}</p> : null}
        </section>
      ) : null}

      {hasDispute || invoice.dispute_open ? (
        <section className="app-invoice-detail__section" aria-labelledby="dem-detail-dispute">
          <h3 id="dem-detail-dispute" className="app-invoice-detail__heading">Disputa</h3>
          {invoice.dispute_subject ? <p className="app-invoice-detail__subheading">{invoice.dispute_subject}</p> : null}
          {invoice.dispute_reason ? <p className="app-invoice-detail__description">{invoice.dispute_reason}</p> : null}
          {invoice.dispute_notes ? <p className="app-invoice-detail__note">Notas internas: {invoice.dispute_notes}</p> : null}
          {permissions.canAnswerDispute ? (
            <div className="app-invoice-detail__inline-actions">
              <Button variant="secondary" className="app-btn--sm" onClick={() => onOpenDisputes(invoice)}>Abrir conversa da Disputa</Button>
            </div>
          ) : <p className="app-invoice-detail__note">A conversa com o Cliente é respondida por Equipamentos ou pelo Administrativo.</p>}
        </section>
      ) : null}

      <FinancialRefundsPanel key={invoice.id} source="demurrage" invoiceId={invoice.id} />
    </div>
  )
}
