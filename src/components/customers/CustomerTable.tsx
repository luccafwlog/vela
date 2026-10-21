import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { CopyValue } from '../ui/CopyValue'
import { NoValue } from '../ui/NoValue'
import { StatusText } from '../ui/StatusText'
import { Card } from '../ui/Card'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { summarizeChargeStatuses } from '../../lib/chargeStatus'
import { accountSituationLabel } from '../../lib/portalProvisioningViewModel'
import {
  buildCustomerBillingUrl,
  summarizeContactsForDisplay,
  type CustomerSortKey,
} from '../../lib/customerTableViewModel'
import { formatBRL, formatCnpjCpf, formatCountLabel } from '../../lib/utils'
import type { CustomerFilters } from '../../hooks/useCustomers'
import type { CustomerListItem } from '../../types/database'
import type { QueueRow } from '../../services/portalProvisioning'

type CustomerRows = {
  rows: CustomerListItem[]
  totalCount: number
}

type RowHandlers = {
  canDeleteCustomers: boolean
  deleting: boolean
  onCopy: (value: string, label: string) => Promise<void>
  onDeleteCustomer: (id: number) => void
  portalStatus: PortalStatus
}

type PortalStatus = 'ready' | 'loading' | 'error'

/**
 * Lista de Clientes em tabela limpa (lote 2, 2026-10-16): o nome abre a ficha,
 * o saldo abre o Financeiro do Cliente; sem menu ⋮ (Desativar fica na ficha,
 * Excluir só na seleção em lote).
 * Abaixo de 640 px a página passa `narrow` e cada Cliente vira um cartão.
 */
export function CustomerTable({
  data,
  canDeleteCustomers,
  selection,
  filters,
  totalPages,
  deleting,
  narrow = false,
  emptyState,
  toolbar,
  onToggleSort,
  onPageChange,
  onCopy,
  onDeleteCustomer,
  portalRows,
  portalStatus = 'ready',
}: {
  data: CustomerRows | undefined
  canDeleteCustomers: boolean
  selection: {
    isSelected: (id: number) => boolean
    toggle: (id: number) => void
    toggleMany: (ids: number[]) => void
  }
  filters: CustomerFilters
  totalPages: number
  deleting: boolean
  narrow?: boolean
  /** Conteúdo do vazio (inicial ou do filtro), decidido pela página. */
  emptyState: ReactNode
  /** Barra acima da lista (resumo do recorte). */
  toolbar?: ReactNode
  onToggleSort: (sortKey: CustomerSortKey) => void
  onPageChange: (page: number) => void
  onCopy: (value: string, label: string) => Promise<void>
  onDeleteCustomer: (id: number) => void
  portalRows?: QueueRow[]
  /** Situação da consulta do Portal: carregando ou com falha não é "sem situação". */
  portalStatus?: PortalStatus
}) {
  const rows = data?.rows ?? []
  const pageCustomerIds = rows.map((row) => row.id)
  const allPageSelected = pageCustomerIds.length > 0 && pageCustomerIds.every((id) => selection.isSelected(id))
  const portalByCustomer = new Map((portalRows ?? []).map((row) => [row.customer_id, row]))
  const handlers: RowHandlers = { canDeleteCustomers, deleting, onCopy, onDeleteCustomer, portalStatus }

  const sortHeader = (key: CustomerSortKey, label: string, className?: string) => (
    <th
      scope="col"
      aria-sort={filters.sortKey === key ? (filters.sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
      className={className}
    >
      <button type="button" className="app-table__sort" onClick={() => onToggleSort(key)}>
        {label}
        {renderSortIcon(filters, key)}
      </button>
    </th>
  )

  return (
    <Card className="app-customer-list overflow-hidden p-0">
      {toolbar}
      {rows.length === 0 ? (
        emptyState
      ) : narrow ? (
        <ul className="app-customer-cards" aria-label="Clientes filtrados">
          {rows.map((row) => (
            <CustomerCard
              key={row.id}
              row={row}
              portalRow={portalByCustomer.get(row.id)}
              selected={selection.isSelected(row.id)}
              onToggle={() => selection.toggle(row.id)}
              {...handlers}
            />
          ))}
        </ul>
      ) : (
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-customer-table text-sm">
            <caption className="sr-only">Clientes filtrados</caption>
            <thead>
              <tr>
                {canDeleteCustomers ? (
                  <th scope="col" className="app-customer-table__select">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os clientes da página"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageCustomerIds)}
                    />
                  </th>
                ) : null}
                {sortHeader('name', 'Cliente', 'app-customer-table__name app-table__text-head')}
                <th scope="col" className="app-customer-table__document">CNPJ</th>
                <th scope="col" className="app-customer-table__city">Cidade</th>
                <th scope="col" className="app-customer-table__contact app-table__text-head">Contato principal</th>
                {sortHeader('bls', 'B/Ls', 'app-customer-table__bls')}
                <th scope="col" className="app-customer-table__charges">Taxas locais</th>
                {sortHeader('pendingBalance', 'Saldo pendente', 'app-customer-table__balance')}
                <th scope="col" className="app-customer-table__portal app-table__text-head">Portal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CustomerTableRow
                  key={row.id}
                  row={row}
                  portalRow={portalByCustomer.get(row.id)}
                  selected={selection.isSelected(row.id)}
                  onToggle={() => selection.toggle(row.id)}
                  {...handlers}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalPages > 1 ? (
        <TableFooterPagination
          page={filters.page}
          pageBase={0}
          pageSize={filters.pageSize}
          totalCount={data?.totalCount ?? 0}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      ) : null}
    </Card>
  )
}

function isDeactivated(row: CustomerListItem) {
  return Boolean((row as { deactivated_at?: string | null }).deactivated_at)
}

/**
 * Situação do Portal em texto, em todas as situações (decisão de 2026-10-16):
 * o que trava ou vai travar a fatura em âmbar; conta ativa em tinta normal.
 */
function PortalSituation({ row, portalRow, status }: { row: CustomerListItem; portalRow?: QueueRow; status: PortalStatus }) {
  if (isDeactivated(row)) return <StatusText tone="muted">Desativado</StatusText>
  if (!portalRow && status === 'loading') return <NoValue label="Carregando a situação do Portal" />
  if (!portalRow && status === 'error') return <StatusText tone="muted">Não carregou</StatusText>
  if (!portalRow) return <NoValue label="Sem situação do Portal" />
  if (portalRow.hasCriticalAlert) return <StatusText tone="warning">Alerta crítico</StatusText>
  if (portalRow.hasActiveProcess && portalRow.recoveryEmailStatus && portalRow.recoveryEmailStatus !== 'ok') return <StatusText tone="warning">E-mail de recuperação com falha</StatusText>
  const label = accountSituationLabel(portalRow.account_situation)
  return portalRow.account_situation === 'ativo' ? <>{label}</> : <StatusText tone="warning">{label}</StatusText>
}

function rowFacts(row: CustomerListItem) {
  const charges = summarizeChargeStatuses(row.bls ?? [])
  const contacts = summarizeContactsForDisplay(row.customer_contacts)
  const place = row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state
  return {
    charges,
    contacts,
    blCount: row.bls?.length ?? 0,
    document: formatCnpjCpf(row.cnpj_cpf),
    meta: [row.trade_name, place].filter(Boolean) as string[],
    place,
    deactivated: isDeactivated(row),
  }
}

/** Saldo pendente; maior que zero abre o Financeiro do Cliente (no lugar de "Ver faturas" do menu). */
function BalanceValue({ row }: { row: CustomerListItem }) {
  const balance = Number(row.pending_balance ?? 0)
  // ADR 0093, decisão 10: a lista mostra o total; o detalhe vem ao passar o mouse.
  const detail = (row as CustomerListItem & { pending_balance_detail?: { invoicedOpenBrl: number; toInvoiceBrl: number } }).pending_balance_detail
  const title = detail ? `Faturado em aberto ${formatBRL(detail.invoicedOpenBrl)} · A faturar ${formatBRL(detail.toInvoiceBrl)}` : undefined
  if (balance <= 0) return <span className="app-customer-money" title={title}>{formatBRL(balance)}</span>
  return <Link className="app-link" to={buildCustomerBillingUrl(row)} title={title}><StatusText tone="warning">{formatBRL(balance)}</StatusText></Link>
}

function ChargesText({ facts }: { facts: ReturnType<typeof rowFacts> }) {
  const { charges } = facts
  if (charges.pending > 0) return <StatusText tone="warning">{charges.pending} a revisar</StatusText>
  if (charges.ready > 0) return <>{formatCountLabel(charges.ready, 'pronta', 'prontas')}</>
  return <NoValue label="Sem taxas a revisar nem prontas" />
}

function NameBlock({ row, facts }: { row: CustomerListItem; facts: ReturnType<typeof rowFacts> }) {
  return (
    <div className="app-customer-cell app-table__cell-stack">
      <Link className="app-customer-link" to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`}>{row.name}</Link>
      <span className="app-customer-cell__meta">
        {facts.document ? <CopyValue value={facts.document} label="CNPJ/CPF" /> : null}
        {facts.document && facts.meta.length > 0 ? ' · ' : null}
        {facts.meta.join(' · ')}
      </span>
    </div>
  )
}

/** Só o e-mail, com copiar (no lugar de "Copiar e-mail" do menu). */
function ContactBlock({ contacts }: { contacts: ReturnType<typeof summarizeContactsForDisplay> }) {
  if (!contacts.primaryEmail) return <StatusText tone="warning">Sem e-mail</StatusText>
  return <span className="app-customer-cell__truncate" title={contacts.primaryEmail}><CopyValue value={contacts.primaryEmail} label="e-mail" /></span>
}

function CustomerTableRow({
  row,
  portalRow,
  selected,
  onToggle,
  ...handlers
}: RowHandlers & {
  row: CustomerListItem
  portalRow?: QueueRow
  selected: boolean
  onToggle: () => void
}) {
  const facts = rowFacts(row)

  return (
    <tr className={facts.deactivated ? 'app-table__row--muted' : undefined} data-deactivated={facts.deactivated ? 'true' : undefined}>
      {handlers.canDeleteCustomers ? (
        <td className="app-customer-table__select">
          <input type="checkbox" aria-label={`Selecionar cliente ${row.name}`} checked={selected} onChange={onToggle} />
        </td>
      ) : null}
      <td className="app-table__text"><Link className="app-customer-link" to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`} title={row.name}>{row.name}</Link></td>
      <td className="tabular-nums">{facts.document ? <CopyValue value={facts.document} label="CNPJ/CPF" /> : <NoValue label="Sem CNPJ" />}</td>
      <td>{facts.place || <NoValue label="Sem cidade" />}</td>
      <td className="app-table__text"><ContactBlock contacts={facts.contacts} /></td>
      <td className="tabular-nums">{facts.blCount === 0 ? 'Nenhum' : facts.blCount}</td>
      <td><ChargesText facts={facts} /></td>
      <td className="app-customer-table__balance"><BalanceValue row={row} /></td>
      <td className="app-table__text"><PortalSituation row={row} portalRow={portalRow} status={handlers.portalStatus} /></td>
    </tr>
  )
}

function CustomerCard({
  row,
  portalRow,
  selected,
  onToggle,
  ...handlers
}: RowHandlers & {
  row: CustomerListItem
  portalRow?: QueueRow
  selected: boolean
  onToggle: () => void
}) {
  const facts = rowFacts(row)

  return (
    <li className="app-customer-card" data-deactivated={facts.deactivated ? 'true' : undefined}>
      <div className="app-customer-card__head">
        {handlers.canDeleteCustomers ? (
          <input type="checkbox" aria-label={`Selecionar cliente ${row.name}`} checked={selected} onChange={onToggle} />
        ) : null}
        <NameBlock row={row} facts={facts} />
      </div>
      <dl className="app-customer-card__facts">
        <div>
          <dt>Contato principal</dt>
          <dd><ContactBlock contacts={facts.contacts} /></dd>
        </div>
        <div>
          <dt>B/Ls</dt>
          <dd>{facts.blCount === 0 ? 'Nenhum' : facts.blCount} · <ChargesText facts={facts} /></dd>
        </div>
        <div>
          <dt>Saldo pendente</dt>
          <dd><BalanceValue row={row} /></dd>
        </div>
        <div>
          <dt>Portal</dt>
          <dd><PortalSituation row={row} portalRow={portalRow} status={handlers.portalStatus} /></dd>
        </div>
      </dl>
    </li>
  )
}

function renderSortIcon(filters: Pick<CustomerFilters, 'sortKey' | 'sortDirection'>, key: CustomerSortKey) {
  if (filters.sortKey !== key) return <ArrowUpDown size={13} className="opacity-50" aria-hidden="true" />
  return filters.sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />
}
