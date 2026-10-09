import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { EmptyState, InlineError } from '../ui/Card'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SkeletonTable } from '../ui/Skeleton'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  useDeleteChargeTableItem,
  useLocalChargeTables,
  useSaveChargeTable,
  useSaveChargeTableItem,
  useSetChargeTableActive,
  useSetChargeTableItemActive,
} from '../../hooks/useLocalCharges'
import { userFacingErrorMessage } from '../../lib/errors'
import { normalizeChargeTablePod, resolveChargeTableStates } from '../../pages/taxasLocaisHelpers'
import type { ChargeTableInput, ChargeTableItemInput } from '../../services/charges/chargeTableService'
import { ChargeScopeFilters } from './ChargeScopeFilters'
import { ChargeTableFormModal } from './ChargeTableFormModal'
import { ChargeTableItemFormModal } from './ChargeTableItemFormModal'
import { ChargeTablesList } from './ChargeTablesList'
import {
  groupTablesByScope,
  podOptions,
  readTable,
  scopeLabel,
  type ChargeItem,
  type ChargeTable,
  type TableReading,
} from './chargePresentation'
import type { ChargeFilterProps, TablesLens } from './chargeForms'

function todayIso() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function matchesLens(lens: TablesLens, reading: TableReading) {
  if (lens === 'aplicadas') return reading.state.kind === 'applied'
  if (lens === 'aviso') return reading.hasWarning
  if (lens === 'inativas') return reading.state.kind === 'inactive'
  return true
}

export function ChargeTablesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  lens,
  setLens,
  canEdit,
  canDelete,
}: ChargeFilterProps & {
  lens: TablesLens
  setLens: (value: TablesLens) => void
  canEdit: boolean
  canDelete: boolean
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  // A lista inteira vem do banco e o recorte é feito aqui: o aviso "Não
  // aplicada" e o "vale no cálculo" precisam enxergar todas as tabelas do
  // escopo, inclusive as de grafia diferente de POD (BRVIX × BRVIT).
  const { data, isLoading, error, refetch, isFetching } = useLocalChargeTables()
  const saveTable = useSaveChargeTable()
  const setTableActive = useSetChargeTableActive()
  const setItemActive = useSetChargeTableItemActive()
  const saveItem = useSaveChargeTableItem()
  const deleteItem = useDeleteChargeTableItem()
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [tableModal, setTableModal] = useState<{ table: ChargeTable | null } | null>(null)
  const [itemModal, setItemModal] = useState<{ table: ChargeTable; item: ChargeItem | null } | null>(null)
  const [busyTableId, setBusyTableId] = useState<number | null>(null)
  const [busyItemId, setBusyItemId] = useState<number | null>(null)

  const tables = useMemo(() => data ?? [], [data])
  const today = todayIso()
  const states = useMemo(() => resolveChargeTableStates(tables), [tables])
  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables])
  const readings = useMemo(
    () => new Map(tables.map((table) => [table.id, readTable(table, states, tablesById, today)])),
    [tables, states, tablesById, today],
  )
  const pods = useMemo(() => podOptions(tables), [tables])

  const inScope = useMemo(() => tables.filter((table) => {
    if (cargoModeFilter && table.cargo_mode !== cargoModeFilter) return false
    if (podFilter && normalizeChargeTablePod(table.pod) !== podFilter) return false
    return true
  }), [tables, cargoModeFilter, podFilter])
  const visible = inScope.filter((table) => {
    const reading = readings.get(table.id)
    return reading ? matchesLens(lens, reading) : false
  })
  const groups = groupTablesByScope(visible, states)

  const counts = {
    applied: inScope.filter((table) => readings.get(table.id)?.state.kind === 'applied').length,
    warning: inScope.filter((table) => readings.get(table.id)?.hasWarning).length,
    inactive: inScope.filter((table) => readings.get(table.id)?.state.kind === 'inactive').length,
    autoItems: inScope
      .filter((table) => readings.get(table.id)?.state.kind === 'applied')
      .reduce((sum, table) => sum + (readings.get(table.id)?.autoItems ?? 0), 0),
  }
  const hasScopeFilter = Boolean(cargoModeFilter || podFilter)
  const hasAnyFilter = hasScopeFilter || lens !== 'todas'

  function toggleExpanded(tableId: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(tableId)) next.delete(tableId)
      else next.add(tableId)
      return next
    })
  }

  function clearFilters() {
    setCargoModeFilter('')
    setPodFilter('')
    setLens('todas')
  }

  async function handleSaveTable(input: ChargeTableInput) {
    const id = await saveTable.mutateAsync(input)
    setTableModal(null)
    setExpanded((current) => new Set(current).add(Number(input.id ?? id)))
    showToast(input.id ? 'Tabela atualizada.' : 'Tabela cadastrada. Adicione os itens dela.', 'success')
  }

  async function handleSaveItem(input: ChargeTableItemInput) {
    await saveItem.mutateAsync(input)
    setItemModal(null)
    setExpanded((current) => new Set(current).add(input.chargeTableId))
    showToast(input.id ? 'Item atualizado.' : 'Item cadastrado.', 'success')
  }

  async function handleToggleTableActive(table: ChargeTable) {
    const nextActive = table.active !== true
    const scope = scopeLabel(table.cargo_mode, table.pod)
    const reading = readings.get(table.id)
    const confirmed = await confirm({
      title: nextActive ? 'Reativar tabela de taxas' : 'Desativar tabela de taxas',
      message: `${nextActive ? 'Reativar' : 'Desativar'} a tabela "${table.name}" (${scope})?`,
      confirmLabel: nextActive ? 'Reativar tabela' : 'Desativar tabela',
      tone: nextActive ? 'primary' : 'danger',
      consequence: nextActive
        ? `Volta a disputar o cálculo de ${scope}: vale se tiver a vigência inicial mais recente entre as ativas.`
        : reading?.state.kind === 'applied'
          ? `Sai do cálculo de ${scope}. Cálculos novos usam a próxima tabela ativa do escopo, ou ficam pendentes se não houver. Faturas emitidas não mudam.`
          : 'Sai da lista de tabelas ativas. Ela já não era a aplicada, então o cálculo não muda.',
      reversibility: nextActive ? 'Pode ser desativada de novo.' : 'Pode ser reativada pelo Administrativo.',
    })
    if (!confirmed) return
    setBusyTableId(table.id)
    try {
      await setTableActive.mutateAsync({ id: table.id, active: nextActive })
      showToast(nextActive ? 'Tabela reativada.' : 'Tabela desativada.', 'success')
    } catch (failure) {
      showToast(userFacingErrorMessage(failure, 'Não foi possível alterar a situação da tabela.'), 'error')
    } finally {
      setBusyTableId(null)
    }
  }

  async function handleToggleItemActive(item: ChargeItem) {
    const nextActive = item.active === false
    const confirmed = await confirm({
      title: nextActive ? 'Reativar item de taxa' : 'Desativar item de taxa',
      message: `${nextActive ? 'Reativar' : 'Desativar'} o item "${item.name}"?`,
      consequence: nextActive
        ? 'O item volta a entrar nos cálculos novos.'
        : 'O item deixa de entrar em cálculos novos; cálculos e faturas antigos continuam mostrando de onde veio o valor.',
      reversibility: nextActive ? 'Pode ser desativado de novo.' : 'Pode ser reativado pelo Administrativo.',
      confirmLabel: nextActive ? 'Reativar item' : 'Desativar item',
      tone: nextActive ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setBusyItemId(item.id)
    try {
      await setItemActive.mutateAsync({ id: item.id, active: nextActive })
      showToast(nextActive ? 'Item reativado.' : 'Item desativado.', 'success')
    } catch (failure) {
      showToast(userFacingErrorMessage(failure, 'Não foi possível alterar o item.'), 'error')
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleDeleteItem(item: ChargeItem) {
    const reason = await confirmWithReason({
      title: 'Excluir item de taxa',
      message: `Excluir o item "${item.name}"?`,
      consequence: 'O item sai da tabela. Se já foi usado em algum cálculo ou fatura, o banco recusa: nesse caso, desative-o.',
      reversibility: 'Não é possível desfazer; cadastre de novo se precisar.',
      tone: 'danger',
      confirmLabel: 'Excluir item',
    })
    if (reason === null) return
    setBusyItemId(item.id)
    try {
      await deleteItem.mutateAsync({ id: item.id, reason })
      showToast('Item excluído.', 'success')
    } catch (failure) {
      showToast(userFacingErrorMessage(failure, 'Não foi possível excluir o item. Se ele já foi usado em cálculo, desative-o.'), 'error')
    } finally {
      setBusyItemId(null)
    }
  }

  const lensOptions = [
    { value: 'todas' as const, label: 'Todas' },
    { value: 'aplicadas' as const, label: `Aplicadas (${counts.applied})` },
    { value: 'aviso' as const, label: `Com aviso (${counts.warning})` },
    { value: 'inativas' as const, label: `Inativas (${counts.inactive})` },
  ]

  return (
    <>
      <div className="app-rates-toolbar">
        <div className="app-rates-toolbar__filters">
          <ChargeScopeFilters
            cargoModeFilter={cargoModeFilter}
            setCargoModeFilter={setCargoModeFilter}
            podFilter={podFilter}
            setPodFilter={setPodFilter}
            pods={pods}
          />
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => setTableModal({ table: null })} className="app-rates-toolbar__primary">
            <Plus size={15} aria-hidden="true" />
            Nova tabela
          </Button>
        ) : null}
      </div>

      <section className="app-surface app-rates-surface" aria-label="Tabelas de Taxas Locais">
        <div className="app-rates-surface__bar">
          <SegmentedControl label="Mostrar tabelas" options={lensOptions} value={lens} onChange={setLens} />
          {data ? (
            <SummaryStrip
              label="Resumo das tabelas"
              items={[
                { label: inScope.length === 1 ? 'tabela' : 'tabelas', value: inScope.length },
                { label: counts.applied === 1 ? 'aplicada no cálculo' : 'aplicadas no cálculo', value: counts.applied },
                { label: 'itens automáticos em uso', value: counts.autoItems },
                ...(counts.warning ? [{ label: counts.warning === 1 ? 'com aviso' : 'com aviso', value: counts.warning, tone: 'warning' as const }] : []),
              ]}
            />
          ) : null}
        </div>
        <p className="app-rates-surface__rule">
          Vale no cálculo a tabela <strong>ativa</strong> de cada modo de carga e POD; entre duas ativas, a de vigência inicial mais recente. A vigência não liga nem desliga tabela (ADR 0040).
        </p>

        {error ? (
          <div className="app-rates-state">
            <InlineError message={data ? 'Não foi possível atualizar as tabelas; a lista abaixo pode estar desatualizada.' : 'Não foi possível consultar as tabelas de taxas.'} />
            <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()} loading={isFetching} loadingLabel="Consultando…">
              Tentar novamente
            </Button>
          </div>
        ) : null}

        {isLoading ? <SkeletonTable rows={4} cols={4} columnTemplate="2fr 1fr 1fr 1fr" label="Carregando tabelas" /> : null}

        {!isLoading && data && tables.length === 0 ? (
          <EmptyState
            title="Nenhuma tabela cadastrada"
            description="Sem tabela ativa no modo de carga e POD do B/L, o cálculo das Taxas Locais fica pendente."
            action={canEdit ? <Button onClick={() => setTableModal({ table: null })}><Plus size={15} aria-hidden="true" />Nova tabela</Button> : undefined}
          />
        ) : null}

        {!isLoading && tables.length > 0 && groups.length === 0 ? (
          <EmptyState
            title="Nenhuma tabela neste recorte"
            description={hasScopeFilter ? 'Não há tabela com esse modo de carga e POD.' : 'Nenhuma tabela nesta situação.'}
            action={hasAnyFilter ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button> : undefined}
          />
        ) : null}

        {groups.length > 0 ? (
          <ChargeTablesList
            groups={groups}
            readings={readings}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            canEdit={canEdit}
            canDelete={canDelete}
            onEditTable={(table) => setTableModal({ table })}
            onAddItem={(table) => setItemModal({ table, item: null })}
            onToggleTableActive={handleToggleTableActive}
            onEditItem={(table, item) => setItemModal({ table, item })}
            onToggleItemActive={handleToggleItemActive}
            onDeleteItem={handleDeleteItem}
            busyTableId={busyTableId}
            busyItemId={busyItemId}
          />
        ) : null}
      </section>

      {tableModal ? (
        <ChargeTableFormModal
          key={tableModal.table?.id ?? 'new'}
          open
          table={tableModal.table}
          tables={tables}
          onClose={() => setTableModal(null)}
          onSave={handleSaveTable}
        />
      ) : null}
      {itemModal ? (
        <ChargeTableItemFormModal
          key={`${itemModal.table.id}-${itemModal.item?.id ?? 'new'}`}
          open
          table={itemModal.table}
          item={itemModal.item}
          onClose={() => setItemModal(null)}
          onSave={handleSaveItem}
        />
      ) : null}
    </>
  )
}
