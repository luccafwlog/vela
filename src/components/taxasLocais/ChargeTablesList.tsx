import { Ban, ChevronDown, ChevronRight, MoreVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import {
  basisUnit,
  cargoProfileLabel,
  formatPeriod,
  formatRate,
  itemEngineNotes,
  itemUnitValue,
  type ChargeItem,
  type ChargeTable,
  type ScopeGroup,
  type TableReading,
} from './chargePresentation'
import { ChargeNoteList } from './ChargeFormParts'

type ChargeTablesListProps = {
  groups: ScopeGroup[]
  readings: Map<number, TableReading>
  expanded: Set<number>
  onToggleExpanded: (tableId: number) => void
  canEdit: boolean
  /** Excluir, desativar e reativar são do Administrativo no banco. */
  canDelete: boolean
  onEditTable: (table: ChargeTable) => void
  onAddItem: (table: ChargeTable) => void
  onToggleTableActive: (table: ChargeTable) => void
  onEditItem: (table: ChargeTable, item: ChargeItem) => void
  onToggleItemActive: (item: ChargeItem) => void
  onDeleteItem: (item: ChargeItem) => void
  busyTableId: number | null
  busyItemId: number | null
}

function itemCountText(reading: TableReading) {
  const parts: string[] = []
  if (reading.autoItems) parts.push(`${reading.autoItems} ${reading.autoItems === 1 ? 'automático' : 'automáticos'}`)
  if (reading.manualItems) parts.push(`${reading.manualItems} ${reading.manualItems === 1 ? 'manual' : 'manuais'}`)
  if (reading.inactiveItems) parts.push(`${reading.inactiveItems} ${reading.inactiveItems === 1 ? 'inativo' : 'inativos'}`)
  return parts.length ? parts.join(' · ') : 'Sem itens'
}

/**
 * Tabelas agrupadas pelo escopo que o motor usa para escolher (modo de carga +
 * POD). Cada grupo diz qual tabela vale; cada tabela diz se está no cálculo,
 * por que não está e o que a vigência significa.
 */
export function ChargeTablesList(props: ChargeTablesListProps) {
  const { groups } = props
  return (
    <div className="app-rates-scopes">
      {groups.map((group) => {
        const headingId = `rates-scope-${group.key.replace(/[^a-z0-9]/gi, '-')}`
        return (
          <section key={group.key} className="app-rates-scope" aria-labelledby={headingId}>
            <header className="app-rates-scope__head">
              <h2 id={headingId} className="app-rates-scope__title">{group.label}</h2>
              <p className="app-rates-scope__applied">
                {group.applied ? (
                  <>Vale no cálculo: <strong>{group.applied.name}</strong></>
                ) : (
                  <span className="app-rates-scope__none">Nenhuma tabela ativa: B/Ls deste escopo ficam sem cálculo até uma ser ativada.</span>
                )}
              </p>
            </header>
            <ul className="app-rates-tables">
              {group.tables.map((table) => (
                <ChargeTableRow key={table.id} table={table} {...props} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function ChargeTableRow({
  table,
  readings,
  expanded,
  onToggleExpanded,
  canEdit,
  canDelete,
  onEditTable,
  onAddItem,
  onToggleTableActive,
  busyTableId,
  ...itemProps
}: ChargeTablesListProps & { table: ChargeTable }) {
  const reading = readings.get(table.id)
  if (!reading) return null
  const isOpen = expanded.has(table.id)
  const panelId = `charge-table-items-${table.id}`
  const menuItems: ActionMenuItem[] = [
    { key: 'add', label: 'Adicionar item', icon: <Plus size={14} aria-hidden="true" />, onSelect: () => onAddItem(table) },
  ]
  if (canDelete) {
    menuItems.push(table.active
      ? { key: 'off', label: 'Desativar tabela', icon: <Ban size={14} aria-hidden="true" />, danger: true, disabled: busyTableId === table.id, onSelect: () => onToggleTableActive(table) }
      : { key: 'on', label: 'Reativar tabela', icon: <RotateCcw size={14} aria-hidden="true" />, disabled: busyTableId === table.id, onSelect: () => onToggleTableActive(table) })
  }

  return (
    <li className="app-rates-table" data-state={reading.state.kind}>
      <div className="app-rates-table__row">
        <div className="app-rates-table__name">
          <button
            type="button"
            className="app-rates-table__toggle"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={() => onToggleExpanded(table.id)}
          >
            {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            <span>{table.name}</span>
            <span className="sr-only">{isOpen ? ', recolher itens' : ', ver itens'}</span>
          </button>
          {table.notes ? <p className="app-rates-table__notes" title={table.notes}>{table.notes}</p> : null}
        </div>
        <div className="app-rates-table__cell">
          <span className="app-rates-table__label">Cálculo</span>
          <Badge tone={reading.stateTone} className="w-fit">{reading.stateLabel}</Badge>
          {reading.stateDetail && reading.state.kind === 'shadowed' ? <span className="app-rates-table__detail app-rates-table__detail--danger">{reading.stateDetail}</span> : null}
        </div>
        <div className="app-rates-table__cell app-rates-table__cell--validity">
          <span className="app-rates-table__label">Vigência (informativa)</span>
          <span className="app-rates-num">{formatPeriod(table.valid_from, table.valid_to)}</span>
          {reading.validityNote ? <span className="app-rates-table__detail app-rates-table__detail--warning">{reading.validityNote}</span> : null}
        </div>
        <div className="app-rates-table__cell app-rates-table__cell--items">
          <span className="app-rates-table__label">Itens</span>
          <span>{itemCountText(reading)}</span>
          {reading.noAutomaticItems ? <span className="app-rates-table__detail app-rates-table__detail--warning">Sem item automático: o cálculo deste escopo não gera taxa.</span> : null}
          {reading.itemNotes ? (
            <span className="app-rates-table__detail app-rates-table__detail--warning">
              {reading.itemNotes === 1 ? '1 item com aviso' : `${reading.itemNotes} itens com aviso`}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <div className="app-rates-table__actions">
            <Button variant="secondary" className="app-btn--sm" onClick={() => onEditTable(table)} aria-label={`Editar tabela ${table.name}`}>
              <Pencil size={14} aria-hidden="true" />
              Editar
            </Button>
            <ActionMenu
              label={`Mais ações da tabela ${table.name}`}
              menuId={`charge-table-menu-${table.id}`}
              triggerClassName="app-table__icon-button"
              trigger={<MoreVertical size={16} aria-hidden="true" />}
              items={menuItems}
            />
          </div>
        ) : null}
      </div>
      {isOpen ? (
        <div id={panelId} className="app-rates-items" role="region" aria-label={`Itens da tabela ${table.name}`}>
          {table.charge_table_items.length === 0 ? (
            <div className="app-rates-items__empty">
              <p>
                Nenhum item nesta tabela.
                {reading.state.kind === 'applied' ? ' Enquanto ela for a aplicada, o cálculo deste escopo não gera taxa.' : ''}
              </p>
              {canEdit ? (
                <Button variant="secondary" className="app-btn--sm" onClick={() => onAddItem(table)}>
                  <Plus size={14} aria-hidden="true" />
                  Adicionar item
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <ChargeItemsTable table={table} canEdit={canEdit} canDelete={canDelete} {...itemProps} />
              {canEdit ? (
                <div className="app-rates-items__footer">
                  <Button variant="ghost" className="app-btn--sm" onClick={() => onAddItem(table)}>
                    <Plus size={14} aria-hidden="true" />
                    Adicionar item
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}

type ItemsProps = {
  table: ChargeTable
  canEdit: boolean
  canDelete: boolean
  onEditItem: (table: ChargeTable, item: ChargeItem) => void
  onToggleItemActive: (item: ChargeItem) => void
  onDeleteItem: (item: ChargeItem) => void
  busyItemId: number | null
}

function itemMenu(item: ChargeItem, { canDelete, onToggleItemActive, onDeleteItem, busyItemId }: ItemsProps): ActionMenuItem[] {
  if (!canDelete) return []
  const busy = busyItemId === item.id
  return [
    item.active === false
      ? { key: 'on', label: 'Reativar item', icon: <RotateCcw size={14} aria-hidden="true" />, disabled: busy, onSelect: () => onToggleItemActive(item) }
      : { key: 'off', label: 'Desativar item', icon: <Ban size={14} aria-hidden="true" />, disabled: busy, onSelect: () => onToggleItemActive(item) },
    { key: 'delete', label: 'Excluir item', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, disabled: busy, onSelect: () => onDeleteItem(item) },
  ]
}

function ItemActions({ item, ...props }: ItemsProps & { item: ChargeItem }) {
  if (!props.canEdit) return null
  const menu = itemMenu(item, props)
  return (
    <div className="app-rates-item__actions">
      <button type="button" className="app-table__icon-button" onClick={() => props.onEditItem(props.table, item)} aria-label={`Editar item ${item.name}`} title="Editar item">
        <Pencil size={14} aria-hidden="true" />
      </button>
      {menu.length ? (
        <ActionMenu
          label={`Mais ações do item ${item.name}`}
          menuId={`charge-item-menu-${item.id}`}
          triggerClassName="app-table__icon-button"
          trigger={<MoreVertical size={16} aria-hidden="true" />}
          items={menu}
        />
      ) : null}
    </div>
  )
}

function ItemFlags({ item }: { item: ChargeItem }) {
  const notes = itemEngineNotes(item)
  return (
    <>
      {item.active === false ? <span className="app-rates-item__flag">Inativo: fora do cálculo</span> : null}
      {item.applies_to_soc === false && item.application_basis === 'container_distinct_voyage' ? <span className="app-rates-item__flag">Não cobra de container SOC</span> : null}
      {item.active !== false ? <ChargeNoteList notes={notes} className="app-rates-item__notes" /> : null}
    </>
  )
}

function ChargeItemsTable(props: ItemsProps) {
  const narrow = useNarrowViewport()
  const { table } = props
  if (narrow) {
    return (
      <ul className="app-rates-item-cards">
        {table.charge_table_items.map((item) => (
          <li key={item.id} className="app-rates-item-card" data-inactive={item.active === false || undefined}>
            <div className="app-rates-item-card__head">
              <strong>{item.name}</strong>
              <ItemActions item={item} {...props} />
            </div>
            <p className="app-rates-item-card__value">
              <span className="app-rates-num">{formatRate(item.currency, itemUnitValue(item))}</span>{' '}
              <span className="app-rates-unit">{basisUnit(item.application_basis)}</span>
            </p>
            <p className="app-rates-unit">
              {item.manual_only ? 'Só manual' : 'Automático'} · Perfil {cargoProfileLabel(item.cargo_profile)}
            </p>
            <ItemFlags item={item} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="app-table-scroll">
      <table className="app-table app-table--compact app-rates-item-table text-left">
        <caption className="sr-only">Itens da tabela {table.name}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Entra no cálculo</th>
            <th scope="col">Perfil</th>
            <th scope="col" className="text-right">Valor unitário</th>
            {props.canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {table.charge_table_items.map((item) => (
            <tr key={item.id} data-inactive={item.active === false || undefined}>
              <td>
                <div className="app-rates-item__name">{item.name}</div>
                <ItemFlags item={item} />
              </td>
              <td>{item.manual_only ? 'Só manual' : 'Automático'}</td>
              <td>{cargoProfileLabel(item.cargo_profile)}</td>
              <td className="text-right">
                <span className="app-rates-num app-rates-item__value">{formatRate(item.currency, itemUnitValue(item))}</span>
                <span className="app-rates-unit">{basisUnit(item.application_basis)}</span>
              </td>
              {props.canEdit ? <td className="app-rates-item__actions-cell"><ItemActions item={item} {...props} /></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
