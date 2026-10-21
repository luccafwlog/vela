import { Fragment } from 'react'
import { Ban, ChevronDown, ChevronRight, MoreVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import { Block, LeadValue } from '../ui/Block'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { StatusText } from '../ui/StatusText'
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

type RowProps = ChargeTablesListProps & { table: ChargeTable; reading: TableReading }

const TABLE_COLUMNS = 7

function itemCountText(reading: TableReading) {
  const parts: string[] = []
  if (reading.autoItems) parts.push(`${reading.autoItems} ${reading.autoItems === 1 ? 'automático' : 'automáticos'}`)
  if (reading.manualItems) parts.push(`${reading.manualItems} ${reading.manualItems === 1 ? 'manual' : 'manuais'}`)
  if (reading.inactiveItems) parts.push(`${reading.inactiveItems} ${reading.inactiveItems === 1 ? 'desativado' : 'desativados'}`)
  return parts.length ? parts.join(' · ') : 'Sem itens'
}

function itemWarningText(count: number) {
  return count === 1 ? '1 item' : `${count} itens`
}

/** Situação em texto (sem selo), com a explicação ao passar o mouse. */
function TableSituation({ reading }: { reading: TableReading }) {
  return (
    <span title={reading.stateDetail ?? undefined}>
      <StatusText tone={reading.stateTone}>{reading.stateLabel}</StatusText>
    </span>
  )
}

/** Aviso nos itens: âmbar só se a tabela não está desativada. */
function TableItemWarning({ reading }: { reading: TableReading }) {
  if (!reading.itemNotes) return null
  const text = itemWarningText(reading.itemNotes)
  const title = `${text} com aviso: entram no cálculo de um jeito que talvez não seja o esperado. Abra a tabela para ver.`
  return <span title={title}>{reading.hasItemWarning ? <StatusText tone="warning">{text}</StatusText> : text}</span>
}

/**
 * Coluna Aviso: o que a tabela em uso faz de inesperado no cálculo (sem item
 * automático, vigência fora do período) e os avisos dos itens, sem abrir a linha.
 */
function TableWarning({ reading }: { reading: TableReading }) {
  const parts = [
    reading.noAutomaticItems ? (
      <span key="auto" title="O cálculo deste escopo não gera taxa: todos os itens ativos são só manuais.">
        <StatusText tone="warning">Sem item automático</StatusText>
      </span>
    ) : null,
    reading.validityNote ? (
      <span key="validity" title={reading.validityNote}>
        <StatusText tone="warning">Vigência fora do período</StatusText>
      </span>
    ) : null,
    reading.itemNotes ? <TableItemWarning key="items" reading={reading} /> : null,
  ].filter(Boolean)
  if (!parts.length) return null
  return <>{parts.flatMap((part, index) => (index ? [<span key={`sep-${index}`}> · </span>, part] : [part]))}</>
}

function tableMenu({ table, reading, canDelete, busyTableId, onToggleTableActive }: RowProps): ActionMenuItem[] {
  if (!canDelete) return []
  const disabled = busyTableId === table.id
  if (!table.active) {
    return [{ key: 'on', label: 'Reativar tabela', icon: <RotateCcw size={14} aria-hidden="true" />, disabled, onSelect: () => onToggleTableActive(table) }]
  }
  // A "Ativa, mas não usada" já tem Desativar na linha.
  if (reading.state.kind === 'shadowed') return []
  return [{ key: 'off', label: 'Desativar tabela', icon: <Ban size={14} aria-hidden="true" />, danger: true, disabled, onSelect: () => onToggleTableActive(table) }]
}

/**
 * Desativar (só na "Ativa, mas não usada"), Editar e o ⋮. Na linha da tabela,
 * só os ícones (`iconOnly`, regra 9); no cartão do celular, com texto.
 */
function TableActions({ iconOnly = false, ...props }: RowProps & { iconOnly?: boolean }) {
  const { table, reading, canEdit, canDelete, busyTableId, onEditTable, onToggleTableActive } = props
  if (!canEdit) return null
  const menu = tableMenu(props)
  const showDeactivate = canDelete && reading.state.kind === 'shadowed'
  const menuTrigger = menu.length ? (
    <ActionMenu
      label={`Mais ações da tabela ${table.name}`}
      menuId={`charge-table-menu-${table.id}`}
      triggerClassName={iconOnly ? 'app-btn app-btn--ghost app-btn--icon' : 'app-table__icon-button'}
      trigger={<MoreVertical size={iconOnly ? 15 : 16} aria-hidden="true" />}
      items={menu}
    />
  ) : null
  if (iconOnly) {
    return (
      <div className="app-rates-table__actions">
        {showDeactivate ? (
          <RowActionButton label={`Desativar tabela ${table.name}`} icon={Ban} disabled={busyTableId === table.id} onClick={() => onToggleTableActive(table)} />
        ) : null}
        <RowActionButton label={`Editar tabela ${table.name}`} icon={Pencil} onClick={() => onEditTable(table)} />
        {menuTrigger}
      </div>
    )
  }
  return (
    <div className="app-rates-table__actions">
      {showDeactivate ? (
        <Button
          variant="secondary"
          className="app-btn--sm"
          disabled={busyTableId === table.id}
          onClick={() => onToggleTableActive(table)}
          aria-label={`Desativar tabela ${table.name}`}
        >
          Desativar
        </Button>
      ) : null}
      <Button variant="secondary" className="app-btn--sm" onClick={() => onEditTable(table)} aria-label={`Editar tabela ${table.name}`}>
        <Pencil size={14} aria-hidden="true" />
        Editar
      </Button>
      {menuTrigger}
    </div>
  )
}

/**
 * Tabelas agrupadas pelo escopo que o motor usa para escolher (modo de carga +
 * POD). Cada escopo é um bloco com a tabela em uso no cálculo como dado
 * principal e, embaixo, as tabelas do escopo numa tabela limpa.
 */
export function ChargeTablesList(props: ChargeTablesListProps) {
  const narrow = useNarrowViewport()
  return (
    <div className="grid gap-4">
      {props.groups.map((group) => (
        <Block
          key={group.key}
          title={group.label}
          aside="vale no cálculo a tabela ativa de vigência inicial mais recente"
          flush
        >
          <div className="app-block__body">
            {group.applied ? (
              <LeadValue detail="em uso no cálculo">{group.applied.name}</LeadValue>
            ) : (
              <LeadValue tone="warning" detail="B/Ls deste escopo ficam sem cálculo até uma tabela ser ativada">
                Nenhuma tabela em uso
              </LeadValue>
            )}
          </div>
          {narrow ? (
            <ul className="app-rates-tables">
              {group.tables.map((table) => {
                const reading = props.readings.get(table.id)
                return reading ? <ChargeTableCard key={table.id} {...props} table={table} reading={reading} /> : null
              })}
            </ul>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Tabelas de {group.label}; o nome abre os itens</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Abrir itens</span></th>
                    <th scope="col" className="app-table__text-head">Tabela</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Vigência</th>
                    <th scope="col">Itens</th>
                    <th scope="col">Aviso</th>
                    <th scope="col"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {group.tables.map((table) => {
                    const reading = props.readings.get(table.id)
                    return reading ? <ChargeTableRow key={table.id} {...props} table={table} reading={reading} /> : null
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      ))}
    </div>
  )
}

function ChargeTableRow(props: RowProps) {
  const { table, reading, expanded, onToggleExpanded } = props
  const isOpen = expanded.has(table.id)
  const panelId = `charge-table-items-${table.id}`
  return (
    <Fragment>
      <tr className={reading.state.kind === 'inactive' ? 'app-table__row--muted' : undefined}>
        <td>
          <button
            type="button"
            className="app-table__icon-button"
            aria-controls={isOpen ? panelId : undefined}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Recolher' : 'Abrir'} os itens da tabela ${table.name}`}
            onClick={() => onToggleExpanded(table.id)}
          >
            {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </button>
        </td>
        <td className="app-table__text">
          <button type="button" className="app-link" aria-expanded={isOpen} onClick={() => onToggleExpanded(table.id)}>
            {table.name}
          </button>
        </td>
        <td><TableSituation reading={reading} /></td>
        <td className="tabular-nums">{formatPeriod(table.valid_from, table.valid_to)}</td>
        <td>{itemCountText(reading)}</td>
        <td><TableWarning reading={reading} /></td>
        <td><TableActions {...props} iconOnly /></td>
      </tr>
      {isOpen ? (
        <tr id={panelId} data-row-detail>
          <td colSpan={TABLE_COLUMNS}>
            <TableDetail {...props} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

/** Linha aberta: notas da tabela, avisos de vigência e os itens. */
function TableDetail(props: RowProps) {
  const { table, reading, canEdit, onAddItem } = props
  return (
    <div className="app-rates-items" role="region" aria-label={`Itens da tabela ${table.name}`}>
      {table.notes ? <p className="app-rates-help">{table.notes}</p> : null}
      {reading.validityNote ? <ChargeNoteList notes={[{ tone: 'warning', text: reading.validityNote }]} /> : null}
      {reading.noAutomaticItems && table.charge_table_items.length > 0 ? (
        <ChargeNoteList notes={[{ tone: 'warning', text: 'Sem item automático: o cálculo deste escopo não gera taxa.' }]} />
      ) : null}
      {table.charge_table_items.length === 0 ? (
        <p className="app-rates-help">
          Nenhum item nesta tabela.
          {reading.state.kind === 'applied' ? ' Enquanto ela estiver em uso no cálculo, o cálculo deste escopo não gera taxa.' : ''}
        </p>
      ) : (
        <ChargeItemsTable {...props} />
      )}
      {canEdit ? (
        <div className="app-rates-items__footer">
          <Button variant="secondary" className="app-btn--sm" onClick={() => onAddItem(table)}>
            <Plus size={14} aria-hidden="true" />
            Adicionar item
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Tela estreita: o cartão de lista de antes, com os nomes novos. */
function ChargeTableCard(props: RowProps) {
  const { table, reading, expanded, onToggleExpanded } = props
  const isOpen = expanded.has(table.id)
  const panelId = `charge-table-items-${table.id}`
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
        </div>
        <div className="app-rates-table__cell">
          <span className="app-rates-table__label">Situação</span>
          <TableSituation reading={reading} />
        </div>
        <div className="app-rates-table__cell app-rates-table__cell--validity">
          <span className="app-rates-table__label">Vigência</span>
          <span className="app-rates-num">{formatPeriod(table.valid_from, table.valid_to)}</span>
        </div>
        <div className="app-rates-table__cell app-rates-table__cell--items">
          <span className="app-rates-table__label">Itens</span>
          <span>{itemCountText(reading)}</span>
          {reading.hasWarning || reading.itemNotes ? <span>Aviso: <TableWarning reading={reading} /></span> : null}
        </div>
        <TableActions {...props} />
      </div>
      {isOpen ? (
        <div id={panelId}>
          <TableDetail {...props} />
        </div>
      ) : null}
    </li>
  )
}

type ItemsProps = RowProps

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

/**
 * Editar e o ⋮ do item. A tabela de itens fica dentro do painel da tabela
 * aberta, mas cada item é uma linha de tabela: só os ícones (`iconOnly`,
 * regra 9). No cartão do celular, com texto.
 */
function ItemActions({ item, iconOnly = false, ...props }: ItemsProps & { item: ChargeItem; iconOnly?: boolean }) {
  // Editar item é correção de erro e reemite faturas: só o Administrativo
  // (ADR 0093, decisão 2). Reajuste se faz com tabela nova.
  if (!props.canEdit || !props.canDelete) return null
  const menu = itemMenu(item, props)
  return (
    <div className="app-rates-item__actions">
      {iconOnly ? (
        <RowActionButton label={`Editar item ${item.name}`} icon={Pencil} onClick={() => props.onEditItem(props.table, item)} />
      ) : (
        <Button variant="secondary" className="app-btn--sm" onClick={() => props.onEditItem(props.table, item)} aria-label={`Editar item ${item.name}`}>
          <Pencil size={14} aria-hidden="true" />
          Editar
        </Button>
      )}
      {menu.length ? (
        <ActionMenu
          label={`Mais ações do item ${item.name}`}
          menuId={`charge-item-menu-${item.id}`}
          triggerClassName={iconOnly ? 'app-btn app-btn--ghost app-btn--icon' : 'app-table__icon-button'}
          trigger={<MoreVertical size={iconOnly ? 15 : 16} aria-hidden="true" />}
          items={menu}
        />
      ) : null}
    </div>
  )
}

function itemIncidence(item: ChargeItem) {
  const unit = basisUnit(item.application_basis)
  return item.applies_to_soc === false && item.application_basis === 'container_distinct_voyage' ? `${unit}, exceto SOC` : unit
}

/** Aviso do item: texto curto (âmbar se pede ação), frase inteira no title. */
function ItemWarning({ item }: { item: ChargeItem }) {
  if (item.active === false) return null
  const notes = itemEngineNotes(item)
  if (!notes.length) return null
  return (
    <span className="grid gap-0.5">
      {notes.map((note) => (
        <span key={note.text} title={note.text}>
          {note.tone === 'info' ? note.short ?? note.text : <StatusText tone="warning">{note.short ?? note.text}</StatusText>}
          <span className="sr-only">: {note.text}</span>
        </span>
      ))}
    </span>
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
              <span className="app-rates-unit">{itemIncidence(item)}</span>
            </p>
            <p className="app-rates-unit">
              {item.active === false ? 'Desativado · ' : ''}{item.manual_only ? 'Só manual' : 'Automático'} · Perfil {cargoProfileLabel(item.cargo_profile)}
            </p>
            <ItemWarning item={item} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <table className="app-table app-table--compact app-table--nested">
      <caption className="sr-only">Itens da tabela {table.name}</caption>
      <thead>
        <tr>
          <th scope="col" className="app-table__text-head">Item</th>
          <th scope="col">Entra no cálculo</th>
          <th scope="col">Perfil</th>
          <th scope="col">Incide</th>
          <th scope="col">Valor unitário</th>
          <th scope="col" className="app-table__text-head">Aviso</th>
          {props.canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
        </tr>
      </thead>
      <tbody>
        {table.charge_table_items.map((item) => (
          <tr key={item.id} className={item.active === false ? 'app-table__row--muted' : undefined}>
            <td className="app-table__text">
              {item.name}
              {item.active === false ? <span className="sr-only"> (desativado, fora do cálculo)</span> : null}
            </td>
            <td>{item.active === false ? 'Desativado' : item.manual_only ? 'Só manual' : 'Automático'}</td>
            <td>{cargoProfileLabel(item.cargo_profile)}</td>
            <td>{itemIncidence(item)}</td>
            <td className="tabular-nums">{formatRate(item.currency, itemUnitValue(item))}</td>
            <td className="app-table__text"><ItemWarning item={item} /></td>
            {props.canEdit ? <td><ItemActions item={item} {...props} iconOnly /></td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
