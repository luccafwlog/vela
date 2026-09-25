import { Fragment, useState } from 'react'
import { Ban, ChevronDown, ChevronUp, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card, EmptyState } from '../ui/Card'
import { formatBRL, formatDate, formatUSD } from '../../lib/utils'
import { chargeTableAlerts } from '../../pages/taxasLocaisHelpers'
import type { LocalChargeTableWithItems } from '../../services/charges/chargeTableService'

type ChargeTablesListProps = {
  tables: LocalChargeTableWithItems[]
  tablesLoading: boolean
  tablesError: unknown
  tableCount: number
  filterDescription: string
  emptyState: { title: string; description: string }
  canEdit: boolean
  /** Excluir item e do Administrativo no banco. */
  canDelete: boolean
  onEditTable: (id: number) => void
  onPrepareTableItem: (tableId: number) => void
  onToggleTableActive: (id: number, current: boolean | null) => void
  onEditTableItem: (tableId: number, itemId: number) => void
  onDeleteTableItem: (itemId: number) => void
  togglingTableActive: boolean
  deletingTableItem: boolean
}

export function ChargeTablesList({
  tables,
  tablesLoading,
  tablesError,
  tableCount,
  filterDescription,
  emptyState,
  canEdit,
  canDelete,
  onEditTable,
  onPrepareTableItem,
  onToggleTableActive,
  onEditTableItem,
  onDeleteTableItem,
  togglingTableActive,
  deletingTableItem,
}: ChargeTablesListProps) {
  const [expandedTableId, setExpandedTableId] = useState<number | null>(null)
  // ADR 0040: a vigência não filtra mais o cálculo, então ela precisa avisar
  // quando o que está cadastrado não descreve o que o motor faz.
  const alerts = chargeTableAlerts(tables, new Date().toISOString().slice(0, 10))
  const columnCount = canEdit ? 8 : 7

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-1 border-b border-[var(--app-border)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-[var(--app-text-strong)]">{tableCount} tabela(s) retornada(s)</span>
        <span className="text-xs text-[var(--app-muted)]">{filterDescription}</span>
      </div>
      {tablesError ? (
        <div className="p-5 text-sm text-amber-200">
          Não foi possível consultar tabelas de taxas locais. Se você for operador, este acesso pode estar restrito por role.
        </div>
      ) : null}
      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[860px] text-left text-sm whitespace-nowrap">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-3">Tabela</th>
              <th scope="col" className="px-4 py-3">Modo</th>
              <th scope="col" className="px-4 py-3">POD</th>
              <th scope="col" className="px-4 py-3" title="Informativa: não decide qual tabela o cálculo usa (ADR 0040)">
                Vigência
              </th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Itens</th>
              {canEdit ? <th scope="col" className="px-4 py-3">Ações</th> : null}
              <th scope="col" className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tablesLoading ? (
              <tr>
                <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={columnCount}>
                  Carregando tabelas...
                </td>
              </tr>
            ) : null}

            {!tablesLoading && tables.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-0">
                  <EmptyState title={emptyState.title} description={emptyState.description} />
                </td>
              </tr>
            ) : null}
            {tables.map((table) => {
              const isExpanded = expandedTableId === table.id
              const panelId = `charge-table-items-${table.id}`
              const autoCount = table.charge_table_items.filter((item) => !item.manual_only).length
              const manualCount = table.charge_table_items.filter((item) => item.manual_only).length
              return (
                <Fragment key={table.id}>
                  <tr className={isExpanded ? 'bg-[var(--app-surface-muted)]' : undefined}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--app-text-strong)]">{table.name}</div>
                      {table.notes ? <div className="mt-0.5 text-xs text-[var(--app-muted)]">{table.notes}</div> : null}
                    </td>
                    <td className="px-4 py-3">{table.cargo_mode === 'carga_solta' ? 'Carga Solta' : table.cargo_mode === 'granito' ? 'Granito' : 'Container'}</td>
                    <td className="px-4 py-3">{table.pod ?? '-'}</td>
                    <td className="px-4 py-3">
                      <div className="app-table__cell-stack">
                        <span>
                          {formatDate(table.valid_from)}{table.valid_to ? ` até ${formatDate(table.valid_to)}` : ' (aberta)'}
                        </span>
                        {(alerts.get(table.id) ?? []).map((alert) => (
                          <Badge key={alert.label} tone={alert.tone} className="w-fit" title={alert.hint}>
                            {alert.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={table.active ? 'green' : 'slate'}>{table.active ? 'Ativa' : 'Inativa'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone="blue">{autoCount} auto</Badge>
                        {manualCount > 0 ? <Badge tone="yellow">{manualCount} manual</Badge> : null}
                      </div>
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button className="app-table__icon-button" type="button" onClick={() => onEditTable(table.id)} aria-label="Editar tabela" title="Editar tabela">
                            <Pencil size={13} />
                          </button>
                          <button className="app-table__icon-button" type="button" onClick={() => onPrepareTableItem(table.id)} aria-label="Novo item nesta tabela" title="Novo item nesta tabela">
                            <Plus size={13} />
                          </button>
                          <button
                            className={`app-table__icon-button ${table.active ? 'app-table__icon-button--danger' : ''}`}
                            type="button"
                            onClick={() => onToggleTableActive(table.id, table.active)}
                            aria-label={table.active ? 'Desativar tabela' : 'Reativar tabela'}
                            title={table.active ? 'Desativar tabela' : 'Reativar tabela'}
                            disabled={togglingTableActive}
                          >
                            {table.active ? <Ban size={13} /> : <Save size={13} />}
                          </button>
                        </div>
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <button
                        className="app-table__icon-button"
                        type="button"
                        onClick={() => setExpandedTableId(isExpanded ? null : table.id)}
                        title={isExpanded ? 'Recolher itens' : 'Ver itens'}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={panelId} key={`${table.id}-items`} className="bg-[var(--app-surface-muted)]">
                      <td colSpan={columnCount} className="px-6 py-3">
                        {table.charge_table_items.length === 0 ? (
                          <div className="py-4 text-center text-sm text-[var(--app-muted)]">Nenhum item cadastrado nesta tabela.</div>
                        ) : (
                          <table className="w-full text-left text-sm">
                            <thead className="text-xs uppercase tracking-wider text-[var(--app-muted)]">
                              <tr>
                                <th scope="col" className="py-2 pr-4">Item</th>
                                <th scope="col" className="py-2 pr-4">Perfil</th>
                                <th scope="col" className="py-2 pr-4">Base</th>
                                <th scope="col" className="py-2 pr-4">Moeda</th>
                                <th scope="col" className="py-2 pr-4 text-right">Valor</th>
                                <th scope="col" className="py-2 pr-4">Tipo</th>
                                {canEdit ? <th scope="col" className="py-2"></th> : null}
                              </tr>
                            </thead>
                            <tbody>
                              {table.charge_table_items.map((item) => (
                                <tr key={item.id}>
                                  <td className="py-2 pr-4 font-medium text-[var(--app-text-strong)]">
                                    {item.name}
                                    {!item.active ? <span className="ml-2 text-xs text-[var(--app-muted)]">(inativo)</span> : null}
                                  </td>
                                  <td className="py-2 pr-4 text-[var(--app-muted)]">{item.cargo_profile ?? '-'}</td>
                                  <td className="py-2 pr-4 text-[var(--app-muted)]">{item.application_basis ?? '-'}</td>
                                  <td className="py-2 pr-4 text-[var(--app-muted)]">{item.currency ?? '-'}</td>
                                  <td className="py-2 pr-4 text-right font-semibold text-[var(--app-text-strong)]">
                                    {item.currency === 'USD' ? formatUSD(item.unit_value_usd ?? 0) : formatBRL(item.unit_value_brl ?? 0)}
                                  </td>
                                  <td className="py-2 pr-4">
                                    {item.manual_only ? <Badge tone="yellow">Manual</Badge> : <Badge tone="blue">Auto</Badge>}
                                  </td>
                                  {canEdit ? (
                                    <td className="py-2">
                                      <div className="flex items-center gap-1">
                                        <button className="app-table__icon-button" type="button" onClick={() => onEditTableItem(table.id, item.id)} title="Editar item">
                                          <Pencil size={13} />
                                        </button>
{canDelete ? (
                                        <button
                                          className="app-table__icon-button app-table__icon-button--danger"
                                          type="button"
                                          onClick={() => onDeleteTableItem(item.id)}
                                          disabled={deletingTableItem}
                                          title="Excluir item"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                        ) : null}
                                      </div>
                                    </td>
                                  ) : null}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
