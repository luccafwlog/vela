import type { MouseEvent as ReactMouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Copy, FileText, MoreHorizontal, Power, ReceiptText, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { TableFooterPagination } from '../ui/TableFooterPagination'
import { summarizeChargeStatuses } from '../../lib/chargeStatus'
import {
  buildCustomerBillingUrl,
  getCustomerNextAction,
  summarizeContactsForDisplay,
  type CustomerSortKey,
} from '../../lib/customerTableViewModel'
import { formatBRL, formatCnpjCpf, formatCountLabel } from '../../lib/utils'
import type { CustomerFilters } from '../../hooks/useCustomers'
import type { CustomerListItem } from '../../types/database'
import type { QueueRow } from '../../services/portalProvisioning'

export type CustomerActionsMenu = {
  id: number
  top: number
  left: number
  name: string
  cnpj: string
  email: string | null
  /** Cliente desativado (ADR 0073; migration 092). */
  deactivated: boolean
}

type CustomerRows = {
  rows: CustomerListItem[]
  totalCount: number
}

export function CustomerTable({
  data,
  isLoading,
  error,
  canDeleteCustomers,
  selection,
  filters,
  totalPages,
  actionsMenu,
  deleting,
  onToggleSort,
  onPageChange,
  onOpenActionsMenu,
  onCopy,
  onDeleteCustomer,
  onToggleCustomerActive,
  portalRows,
}: {
  data: CustomerRows | undefined
  isLoading: boolean
  error: unknown
  canDeleteCustomers: boolean
  selection: {
    isSelected: (id: number) => boolean
    toggle: (id: number) => void
    toggleMany: (ids: number[]) => void
  }
  filters: CustomerFilters
  totalPages: number
  actionsMenu: CustomerActionsMenu | null
  deleting: boolean
  onToggleSort: (sortKey: CustomerSortKey) => void
  onPageChange: (page: number) => void
  onOpenActionsMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    row: { id: number; name: string; cnpj_cpf: string; email: string | null; deactivated: boolean },
  ) => void
  onCopy: (value: string, label: string) => Promise<void>
  onDeleteCustomer: (id: number) => void
  onToggleCustomerActive: (id: number, deactivated: boolean) => void
  portalRows?: QueueRow[]
}) {
  const pageCustomerIds = (data?.rows ?? []).map((row) => row.id)
  const allPageSelected = pageCustomerIds.length > 0 && pageCustomerIds.every((id) => selection.isSelected(id))

  return (
    <>
      <Card className="overflow-hidden p-0">
        {error ? <InlineError message="Erro ao carregar clientes." /> : null}
        <div className="app-table-scroll app-table-scroll--sticky">
          <table className="app-table app-table--compact app-table--sticky-actions min-w-[1140px] table-fixed text-left text-sm">
            <thead className="text-xs uppercase tracking-wider">
              <tr>
                {canDeleteCustomers ? (
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os clientes da pagina"
                      checked={allPageSelected}
                      onChange={() => selection.toggleMany(pageCustomerIds)}
                    />
                  </th>
                ) : null}
                <th scope="col" className="w-[30%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => onToggleSort('name')}>
                    Cliente
                    {renderSortIcon(filters, 'name')}
                  </button>
                </th>
                <th scope="col" className="w-[18%] px-4 py-3">Contatos</th>
                <th scope="col" className="w-[20%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => onToggleSort('bls')}>
                    Operação
                    {renderSortIcon(filters, 'bls')}
                  </button>
                </th>
                <th scope="col" className="w-[16%] px-4 py-3">
                  <button type="button" className="app-table__sort" onClick={() => onToggleSort('pendingBalance')}>
                    Financeiro
                    {renderSortIcon(filters, 'pendingBalance')}
                  </button>
                </th>
                <th scope="col" className="w-[236px] px-3 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={canDeleteCustomers ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                    Carregando clientes...
                  </td>
                </tr>
              ) : null}
              {!isLoading && !data?.rows.length ? (
                <tr>
                  <td colSpan={canDeleteCustomers ? 6 : 5} className="p-0">
                    <EmptyState title="Nenhum cliente encontrado." description="Importe uma base de clientes ou cadastre manualmente." />
                  </td>
                </tr>
              ) : null}
              {data?.rows.map((row) => (
                <CustomerTableRow
                  key={row.id}
                  row={row}
                  canDeleteCustomers={canDeleteCustomers}
                  selected={selection.isSelected(row.id)}
                  actionsOpen={actionsMenu?.id === row.id}
                  onToggle={() => selection.toggle(row.id)}
                  onOpenActionsMenu={onOpenActionsMenu}
                  portalRow={portalRows?.find((portal) => portal.customer_id === row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
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

      {actionsMenu ? (
        <div data-actions-menu className="app-floating-menu" role="menu" style={{ top: actionsMenu.top, left: actionsMenu.left }}>
          <button type="button" role="menuitem" onClick={() => void onCopy(formatCnpjCpf(actionsMenu.cnpj), 'CNPJ')}>
            <Copy size={14} />
            Copiar CNPJ
          </button>
          {actionsMenu.email ? (
            <button type="button" role="menuitem" onClick={() => void onCopy(actionsMenu.email!, 'E-mail principal')}>
              <Copy size={14} />
              Copiar e-mail
            </button>
          ) : null}
          {canDeleteCustomers ? (
            <button
              type="button"
              role="menuitem"
              className={actionsMenu.deactivated ? undefined : 'app-floating-menu__danger'}
              onClick={() => onToggleCustomerActive(actionsMenu.id, actionsMenu.deactivated)}
            >
              <Power size={14} />
              {actionsMenu.deactivated ? 'Reativar cliente' : 'Desativar cliente'}
            </button>
          ) : null}
          {canDeleteCustomers ? (
            <button
              type="button"
              role="menuitem"
              className="app-floating-menu__danger"
              disabled={deleting}
              onClick={() => onDeleteCustomer(actionsMenu.id)}
            >
              <Trash2 size={14} />
              Excluir cliente
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function CustomerTableRow({
  row,
  canDeleteCustomers,
  selected,
  actionsOpen,
  onToggle,
  onOpenActionsMenu,
  portalRow,
}: {
  row: CustomerListItem
  canDeleteCustomers: boolean
  selected: boolean
  actionsOpen: boolean
  onToggle: () => void
  onOpenActionsMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    row: { id: number; name: string; cnpj_cpf: string; email: string | null; deactivated: boolean },
  ) => void
  portalRow?: QueueRow
}) {
  const summary = summarizeChargeStatuses(row.bls ?? [])
  const customerComplement = [
    row.trade_name,
    row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state,
  ].filter(Boolean).join(' • ')
  const contactSummary = summarizeContactsForDisplay(row.customer_contacts)
  const nextAction = getCustomerNextAction({
    hasEmail: !contactSummary.empty,
    readyCount: summary.ready,
    pendingCount: summary.pending,
    pendingBalance: Number(row.pending_balance ?? 0),
  })
  const portalNeedsAttention = Boolean(portalRow && (portalRow.hasCriticalAlert || (portalRow.hasActiveProcess && (portalRow.account_situation !== 'ativo' || portalRow.recoveryEmailStatus !== 'ok'))))

  return (
    <tr>
      {canDeleteCustomers ? (
        <td className="px-4 py-3">
          <input type="checkbox" aria-label={`Selecionar cliente ${row.name}`} checked={selected} onChange={onToggle} />
        </td>
      ) : null}
      <td className="px-4 py-3">
        <div className="app-table__cell-stack">
          <div className="app-table__cell-value flex items-center gap-2" title={row.name}>{truncateCustomerName(row.name, 64)}{(row as { deactivated_at?: string | null }).deactivated_at ? <Badge tone="slate">Desativado</Badge> : null}{portalNeedsAttention ? <AlertTriangle size={15} className="text-amber-400" aria-label="Pendência de Portal" /> : null}</div>
          <div className="app-table__cell-meta">{formatCnpjCpf(row.cnpj_cpf)}</div>
          {customerComplement ? <div className="app-table__cell-meta">{customerComplement}</div> : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="app-table__cell-stack">
          <div className="app-table__cell-value">{formatCountLabel(contactSummary.count, 'contato', 'contatos')}</div>
          {contactSummary.primaryEmail ? (
            <span className="app-table__truncate app-table__truncate--md" title={contactSummary.primaryEmail}>{contactSummary.primaryEmail}</span>
          ) : (
            <span className="app-cell-flag app-cell-flag--warn">Sem e-mail</span>
          )}
          {contactSummary.isPrimary ? <span className="app-cell-flag">Principal</span> : null}
          {contactSummary.boxCount !== null && contactSummary.boxCount > 0 ? (
            <span className="app-cell-flag">
              {contactSummary.boxCount} {contactSummary.boxCount === 1 ? 'caixa' : 'caixas'}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="app-table__cell-stack">
          <div className="app-table__cell-value">{formatCountLabel(row.bls?.length ?? 0, 'B/L vinculado', 'B/Ls vinculados')}</div>
          {summary.pending > 0 || summary.ready > 0 || summary.exempt > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {summary.pending > 0 ? <Badge tone="yellow">Pend {summary.pending}</Badge> : null}
              {summary.ready > 0 ? <Badge tone="green">Pronto {summary.ready}</Badge> : null}
              {summary.exempt > 0 ? <span className="app-cell-flag">Isento {summary.exempt}</span> : null}
            </div>
          ) : (
            <span className="app-cell-flag">Sem taxas</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="app-table__cell-stack">
          <div className="app-table__cell-value app-table__cell-value--financial app-table__cell-value--financial-left">{formatBRL(row.pending_balance)}</div>
          <Badge tone={nextAction.tone}>{nextAction.label}</Badge>
        </div>
      </td>
      <td className="px-3 py-3 text-right">
        <div className="app-customer-row-actions">
          <Link className="app-table__action app-table__action--compact" to={`/clientes/${encodeURIComponent(row.cnpj_cpf)}`} title="Abrir ficha do cliente">
            <FileText size={14} />
            Ficha
          </Link>
          <Link className="app-table__icon-button app-table__icon-button--sm" to={buildCustomerBillingUrl(row)} title="Ver faturas do cliente" aria-label={`Ver faturas de ${row.name}`}>
            <ReceiptText size={15} />
          </Link>
          <button
            type="button"
            data-actions-menu
            className="app-table__icon-button app-table__icon-button--sm"
            title="Mais ações"
            aria-label={`Mais ações para ${row.name}`}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            onClick={(event) => onOpenActionsMenu(event, { id: row.id, name: row.name, cnpj_cpf: row.cnpj_cpf, email: contactSummary.primaryEmail, deactivated: Boolean((row as { deactivated_at?: string | null }).deactivated_at) })}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function truncateCustomerName(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}...`
}

function renderSortIcon(filters: Pick<CustomerFilters, 'sortKey' | 'sortDirection'>, key: CustomerSortKey) {
  if (filters.sortKey !== key) return <ArrowUpDown size={13} className="opacity-50" />
  return filters.sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
}
