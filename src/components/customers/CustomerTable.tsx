import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, MoreHorizontal, Power, ReceiptText, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import { Badge } from '../ui/Badge'
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
  onToggleCustomerActive: (id: number, deactivated: boolean) => void
}

/**
 * Lista de Clientes. O nome abre a ficha; a única ação visível é "Mais ações"
 * (⋮), com faturas, cópias e, para o Administrativo, desativar e excluir.
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
  onToggleCustomerActive,
  portalRows,
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
  onToggleCustomerActive: (id: number, deactivated: boolean) => void
  portalRows?: QueueRow[]
}) {
  const rows = data?.rows ?? []
  const pageCustomerIds = rows.map((row) => row.id)
  const allPageSelected = pageCustomerIds.length > 0 && pageCustomerIds.every((id) => selection.isSelected(id))
  const portalByCustomer = new Map((portalRows ?? []).map((row) => [row.customer_id, row]))
  const handlers: RowHandlers = { canDeleteCustomers, deleting, onCopy, onDeleteCustomer, onToggleCustomerActive }

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
          <table className="app-table app-table--compact app-customer-table text-left text-sm">
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
                {sortHeader('name', 'Cliente', 'app-customer-table__name')}
                <th scope="col" className="app-customer-table__contact">Contato principal</th>
                {sortHeader('bls', 'B/Ls', 'app-customer-table__bls')}
                {sortHeader('pendingBalance', 'Saldo pendente', 'app-customer-table__balance')}
                <th scope="col" className="app-customer-table__actions"><span className="sr-only">Ações</span></th>
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

/** Situação do Portal só quando pede atenção: o que trava ou vai travar a fatura. */
function customerPortalNote(portalRow?: QueueRow) {
  if (!portalRow) return null
  if (portalRow.hasCriticalAlert) return 'Portal: alerta crítico'
  if (portalRow.hasActiveProcess && portalRow.account_situation !== 'ativo') return `Portal: ${accountSituationLabel(portalRow.account_situation).toLowerCase()}`
  if (portalRow.hasActiveProcess && portalRow.recoveryEmailStatus && portalRow.recoveryEmailStatus !== 'ok') return 'Portal: Email de Recuperação com falha'
  return null
}

function rowFacts(row: CustomerListItem, portalRow?: QueueRow) {
  const charges = summarizeChargeStatuses(row.bls ?? [])
  const contacts = summarizeContactsForDisplay(row.customer_contacts)
  const place = row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state
  return {
    charges,
    contacts,
    blCount: row.bls?.length ?? 0,
    meta: [formatCnpjCpf(row.cnpj_cpf), row.trade_name, place].filter(Boolean) as string[],
    deactivated: isDeactivated(row),
    portalNote: customerPortalNote(portalRow),
  }
}

function rowMenuItems(row: CustomerListItem, primaryEmail: string | null, handlers: RowHandlers): ActionMenuItem[] {
  const deactivated = isDeactivated(row)
  return [
    { key: 'faturas', label: 'Ver faturas em Taxas Locais', icon: <ReceiptText size={14} aria-hidden="true" />, to: buildCustomerBillingUrl(row) },
    { key: 'cnpj', label: 'Copiar CNPJ', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void handlers.onCopy(formatCnpjCpf(row.cnpj_cpf), 'CNPJ') },
    ...(primaryEmail
      ? [{ key: 'email', label: 'Copiar e-mail', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void handlers.onCopy(primaryEmail, 'E-mail principal') }]
      : []),
    ...(handlers.canDeleteCustomers
      ? [
          {
            key: 'ativo',
            label: deactivated ? 'Reativar cliente' : 'Desativar cliente',
            icon: <Power size={14} aria-hidden="true" />,
            danger: !deactivated,
            onSelect: () => handlers.onToggleCustomerActive(row.id, deactivated),
          },
          {
            key: 'excluir',
            label: 'Excluir cliente',
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            disabled: handlers.deleting,
            onSelect: () => handlers.onDeleteCustomer(row.id),
          },
        ]
      : []),
  ]
}

function RowMenu({ row, primaryEmail, handlers }: { row: CustomerListItem; primaryEmail: string | null; handlers: RowHandlers }) {
  return (
    <ActionMenu
      label={`Mais ações para ${row.name}`}
      menuId={`customer-menu-${row.id}`}
      triggerClassName="app-table__icon-button app-table__icon-button--sm app-customer-menu-trigger"
      trigger={<MoreHorizontal size={16} aria-hidden="true" />}
      items={rowMenuItems(row, primaryEmail, handlers)}
    />
  )
}

function NameBlock({ row, facts }: { row: CustomerListItem; facts: ReturnType<typeof rowFacts> }) {
  return (
    <div className="app-customer-cell">
      <Link className="app-customer-link" to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`}>{row.name}</Link>
      <span className="app-customer-cell__meta">{facts.meta.join(' · ')}</span>
      {facts.deactivated || facts.portalNote ? (
        <span className="app-customer-cell__flags">
          {facts.deactivated ? <Badge tone="neutral">Desativado</Badge> : null}
          {facts.portalNote ? <span className="app-customer-note app-customer-note--warning">{facts.portalNote}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

function ContactBlock({ contacts }: { contacts: ReturnType<typeof summarizeContactsForDisplay> }) {
  if (!contacts.primaryEmail) {
    return (
      <div className="app-customer-cell">
        <span className="app-customer-note app-customer-note--warning">Sem e-mail de contato</span>
        {contacts.count > 0 ? <span className="app-customer-cell__meta">{formatCountLabel(contacts.count, 'contato sem e-mail', 'contatos sem e-mail')}</span> : null}
      </div>
    )
  }
  const others = contacts.count - 1
  return (
    <div className="app-customer-cell">
      <span className="app-customer-cell__truncate" title={contacts.primaryEmail}>{contacts.primaryEmail}</span>
      <span className="app-customer-cell__meta">
        {contacts.isPrimary ? 'Principal' : 'Sem contato principal'}
        {others > 0 ? ` · mais ${formatCountLabel(others, 'contato', 'contatos')}` : ''}
      </span>
    </div>
  )
}

function BlsBlock({ facts }: { facts: ReturnType<typeof rowFacts> }) {
  const { charges, blCount } = facts
  return (
    <div className="app-customer-cell">
      <span className="tabular-nums">{blCount === 0 ? 'Nenhum' : blCount}</span>
      {charges.pending > 0 ? <span className="app-customer-note app-customer-note--warning">{formatCountLabel(charges.pending, 'com taxas a revisar', 'com taxas a revisar')}</span> : null}
      {charges.ready > 0 ? <span className="app-customer-note">{formatCountLabel(charges.ready, 'pronto para faturar', 'prontos para faturar')}</span> : null}
    </div>
  )
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
  const facts = rowFacts(row, portalRow)
  const balance = Number(row.pending_balance ?? 0)

  return (
    <tr data-deactivated={facts.deactivated ? 'true' : undefined}>
      {handlers.canDeleteCustomers ? (
        <td className="app-customer-table__select">
          <input type="checkbox" aria-label={`Selecionar cliente ${row.name}`} checked={selected} onChange={onToggle} />
        </td>
      ) : null}
      <td><NameBlock row={row} facts={facts} /></td>
      <td><ContactBlock contacts={facts.contacts} /></td>
      <td className="app-customer-table__bls"><BlsBlock facts={facts} /></td>
      <td className="app-customer-table__balance">
        <span className={balance > 0 ? 'app-customer-money app-customer-money--due' : 'app-customer-money'}>{formatBRL(balance)}</span>
      </td>
      <td className="app-customer-table__actions">
        <RowMenu row={row} primaryEmail={facts.contacts.primaryEmail} handlers={handlers} />
      </td>
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
  const facts = rowFacts(row, portalRow)
  const balance = Number(row.pending_balance ?? 0)

  return (
    <li className="app-customer-card" data-deactivated={facts.deactivated ? 'true' : undefined}>
      <div className="app-customer-card__head">
        {handlers.canDeleteCustomers ? (
          <input type="checkbox" aria-label={`Selecionar cliente ${row.name}`} checked={selected} onChange={onToggle} />
        ) : null}
        <NameBlock row={row} facts={facts} />
        <RowMenu row={row} primaryEmail={facts.contacts.primaryEmail} handlers={handlers} />
      </div>
      <dl className="app-customer-card__facts">
        <div>
          <dt>Contato principal</dt>
          <dd><ContactBlock contacts={facts.contacts} /></dd>
        </div>
        <div>
          <dt>B/Ls</dt>
          <dd><BlsBlock facts={facts} /></dd>
        </div>
        <div>
          <dt>Saldo pendente</dt>
          <dd className={balance > 0 ? 'app-customer-money app-customer-money--due' : 'app-customer-money'}>{formatBRL(balance)}</dd>
        </div>
      </dl>
    </li>
  )
}

function renderSortIcon(filters: Pick<CustomerFilters, 'sortKey' | 'sortDirection'>, key: CustomerSortKey) {
  if (filters.sortKey !== key) return <ArrowUpDown size={13} className="opacity-50" aria-hidden="true" />
  return filters.sortDirection === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />
}
