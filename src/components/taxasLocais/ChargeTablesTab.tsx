import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { MetricCard } from '../ui/MetricCard'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
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
import { describeActiveFilters, describeEmptyState } from '../../lib/operationalState'
import { userFacingErrorMessage } from '../../lib/errors'
import { formatCountLabel } from '../../lib/utils'
import { validateTableInput, validateTableItemInput } from '../../pages/taxasLocaisHelpers'
import { ChargeTableFormCard } from './ChargeTableFormCard'
import { ChargeTableItemFormCard } from './ChargeTableItemFormCard'
import { ChargeTablesList } from './ChargeTablesList'
import {
  EMPTY_TABLE_FORM,
  EMPTY_TABLE_ITEM_FORM,
  type ChargeFilterProps,
  type ChargeTableForm,
  type ChargeTableItemForm,
} from './chargeForms'

export function ChargeTablesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  canEdit,
  canDelete,
}: ChargeFilterProps & { canEdit: boolean; canDelete: boolean }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const [formsOpen, setFormsOpen] = useState(false)
  const [tableForm, setTableForm] = useState<ChargeTableForm>(EMPTY_TABLE_FORM)
  const [tableItemForm, setTableItemForm] = useState<ChargeTableItemForm>(EMPTY_TABLE_ITEM_FORM)
  const { data: tables, isLoading: tablesLoading, error: tablesError } = useLocalChargeTables({
    cargoMode: cargoModeFilter,
    pod: podFilter,
  })
  const saveChargeTableMutation = useSaveChargeTable()
  const setChargeTableActiveMutation = useSetChargeTableActive()
  const setChargeTableItemActiveMutation = useSetChargeTableItemActive()
  const saveChargeTableItemMutation = useSaveChargeTableItem()
  const deleteChargeTableItemMutation = useDeleteChargeTableItem()
  const currentTables = useMemo(() => tables ?? [], [tables])

  const tableSummary = useMemo(() => ({
    tables: currentTables.length,
    active: currentTables.filter((item) => item.active).length,
    items: currentTables.reduce((sum, item) => sum + item.charge_table_items.length, 0),
    manualOnly: currentTables.reduce(
      (sum, item) => sum + item.charge_table_items.filter((row) => row.manual_only).length,
      0,
    ),
  }), [currentTables])
  const tableFilterDescription = describeActiveFilters([
    { label: 'Modo', value: cargoModeFilter },
    { label: 'POD', value: podFilter },
  ])
  const tableEmptyState = describeEmptyState({
    entitySingular: 'tabela',
    entityPlural: 'tabelas',
    hasActiveFilters: Boolean(cargoModeFilter || podFilter.trim()),
    emptyWithoutFilters: 'Nenhuma tabela cadastrada ainda.',
  })

  async function handleSaveTable() {
    const result = validateTableInput(tableForm)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    const originalTable = tableForm.id ? currentTables.find((row) => row.id === tableForm.id) : null
    const changes = originalTable
      ? [
          { field: 'Nome da tabela', before: originalTable.name ?? '', after: tableForm.name },
          { field: 'Modalidade', before: originalTable.cargo_mode ?? '', after: tableForm.cargoMode },
          { field: 'Porto de descarga (POD)', before: originalTable.pod ?? '', after: tableForm.pod },
          { field: 'Vigência de', before: originalTable.valid_from ? originalTable.valid_from.slice(0, 10) : '', after: tableForm.validFrom },
          { field: 'Vigência até', before: originalTable.valid_to ? originalTable.valid_to.slice(0, 10) : '', after: result.value.validTo ?? '' },
          { field: 'Status', before: originalTable.active ? 'Ativa' : 'Inativa', after: tableForm.active ? 'Ativa' : 'Inativa' },
          { field: 'Observações', before: originalTable.notes ?? '', after: tableForm.notes },
        ].filter((c) => c.before !== c.after)
      : []

    if (originalTable && changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return
    }

    const confirmed = await confirm({
      title: tableForm.id ? 'Salvar tabela de taxas' : 'Cadastrar tabela de taxas',
      message: tableForm.id
        ? `Salvar as alterações da tabela "${tableForm.name}"?`
        : `Cadastrar a nova tabela de taxas "${tableForm.name}"?`,
      confirmLabel: tableForm.id ? 'Salvar alterações' : 'Cadastrar tabela',
      changes: originalTable ? changes : undefined,
      affected: !originalTable
        ? { summary: `${tableForm.name} · ${tableForm.cargoMode} · POD ${tableForm.pod} · ${tableForm.validFrom} a ${result.value.validTo || 'sem data final'}` }
        : undefined,
      consequence: 'A tabela define as taxas locais aplicáveis aos B/Ls da respectiva modalidade e porto dentro da vigência.',
      reversibility: 'A tabela pode ser editada ou desativada no cadastro.',
    })
    if (!confirmed) return

    try {
      const savedTableId = await saveChargeTableMutation.mutateAsync({
        id: tableForm.id,
        name: tableForm.name,
        cargoMode: tableForm.cargoMode,
        pod: tableForm.pod,
        validFrom: tableForm.validFrom,
        validTo: result.value.validTo,
        active: tableForm.active,
        notes: tableForm.notes || null,
      })
      showToast(tableForm.id ? 'Tabela atualizada.' : 'Tabela criada.', 'success')
      setTableForm(EMPTY_TABLE_FORM)
      setTableItemForm((current) => ({
        ...current,
        chargeTableId: String(tableForm.id ?? savedTableId),
      }))
    } catch {
      showToast('Falha ao salvar tabela.', 'error')
    }
  }

  function handleEditTable(id: number) {
    const table = currentTables.find((row) => row.id === id)
    if (!table) return
    setFormsOpen(true)
    setTableForm({
      id: table.id,
      name: table.name ?? '',
      cargoMode: (table.cargo_mode ?? 'container') as 'container' | 'carga_solta' | 'granito',
      pod: table.pod ?? '',
      validFrom: table.valid_from,
      validTo: table.valid_to ?? '',
      active: Boolean(table.active),
      notes: table.notes ?? '',
    })
    setTableItemForm((current) => ({ ...current, chargeTableId: String(table.id) }))
  }

  async function handleToggleTableActive(id: number, current: boolean | null) {
    const nextActive = current !== true
    const table = currentTables.find((row) => row.id === id)
    const confirmed = await confirm({
      title: nextActive ? 'Reativar tabela de taxas' : 'Desativar tabela de taxas',
      message: nextActive
        ? `Reativar a tabela "${table?.name ?? id}"?`
        : `Desativar a tabela "${table?.name ?? id}"?`,
      confirmLabel: nextActive ? 'Reativar' : 'Desativar',
      tone: nextActive ? 'primary' : 'danger',
      consequence: nextActive
        ? 'A tabela volta a ser utilizada nos cálculos de novos faturamentos.'
        : 'A tabela não será aplicada a novos cálculos; faturamentos já emitidos ou calculados não são afetados.',
      reversibility: nextActive ? 'Desative de novo se precisar.' : 'Reative a tabela quando precisar.',
    })
    if (!confirmed) return

    try {
      await setChargeTableActiveMutation.mutateAsync({ id, active: nextActive })
      showToast(nextActive ? 'Tabela reativada.' : 'Tabela desativada.', 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao alterar status da tabela.'), 'error')
    }
  }

  async function handleToggleTableItemActive(id: number, current: boolean | null) {
    const nextActive = current !== true
    const confirmed = await confirm({
      title: nextActive ? 'Reativar item de taxa' : 'Desativar item de taxa',
      message: nextActive ? 'Reativar este item da tabela de taxas?' : 'Desativar este item da tabela de taxas?',
      consequence: nextActive
        ? 'O item volta a entrar nos cálculos novos.'
        : 'O item deixa de entrar em cálculos novos; os cálculos e faturas antigos continuam mostrando de onde veio o valor.',
      reversibility: nextActive ? 'Desative de novo se precisar.' : 'Reativar item.',
      confirmLabel: nextActive ? 'Reativar' : 'Desativar',
      tone: nextActive ? 'primary' : 'danger',
    })
    if (!confirmed) return
    try {
      await setChargeTableItemActiveMutation.mutateAsync({ id, active: nextActive })
      showToast(nextActive ? 'Item reativado.' : 'Item desativado.', 'success')
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Falha ao alterar o item.'), 'error')
    }
  }

  async function handleSaveTableItem() {
    const result = validateTableItemInput(tableItemForm)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }
    const { chargeTableId, unitValue, sortOrder } = result.value

    const table = currentTables.find((row) => row.id === chargeTableId)
    const originalItem = tableItemForm.id
      ? table?.charge_table_items.find((row) => row.id === tableItemForm.id)
      : null

    const changes = originalItem
      ? [
          { field: 'Nome do item', before: originalItem.name ?? '', after: tableItemForm.name },
          { field: 'Categoria', before: originalItem.category === 'other_charge' ? 'Other Charge' : 'Taxa Base', after: tableItemForm.category === 'other_charge' ? 'Other Charge' : 'Taxa Base' },
          { field: 'Base de aplicação', before: originalItem.application_basis ?? '', after: tableItemForm.applicationBasis },
          { field: 'Perfil de carga', before: originalItem.cargo_profile ?? '', after: tableItemForm.cargoProfile },
          { field: 'Moeda', before: originalItem.currency ?? '', after: tableItemForm.currency },
          { field: 'Valor unitário', before: `${originalItem.currency} ${originalItem.currency === 'USD' ? originalItem.unit_value_usd : originalItem.unit_value_brl}`, after: `${tableItemForm.currency} ${unitValue}` },
          { field: 'Somente manual', before: originalItem.manual_only ? 'Sim' : 'Não', after: tableItemForm.manualOnly ? 'Sim' : 'Não' },
          { field: 'Status', before: originalItem.active ? 'Ativo' : 'Inativo', after: tableItemForm.active ? 'Ativo' : 'Inativo' },
        ].filter((c) => c.before !== c.after)
      : []

    if (originalItem && changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return
    }

    const confirmed = await confirm({
      title: tableItemForm.id ? 'Salvar item de taxa' : 'Cadastrar item de taxa',
      message: tableItemForm.id
        ? `Salvar as alterações do item "${tableItemForm.name}"?`
        : `Cadastrar o item "${tableItemForm.name}" na tabela "${table?.name ?? chargeTableId}"?`,
      confirmLabel: tableItemForm.id ? 'Salvar alterações' : 'Cadastrar item',
      changes: originalItem ? changes : undefined,
      affected: !originalItem
        ? { summary: `${tableItemForm.name} · ${tableItemForm.currency} ${unitValue} · Base: ${tableItemForm.applicationBasis}` }
        : undefined,
      consequence: 'O item será considerado na composição do cálculo de taxas locais para os B/Ls da tabela.',
      reversibility: 'O item pode ser editado ou desativado na tabela de taxas.',
    })
    if (!confirmed) return

    try {
      await saveChargeTableItemMutation.mutateAsync({
        id: tableItemForm.id,
        chargeTableId,
        name: tableItemForm.name,
        category: tableItemForm.category,
        applicationBasis: tableItemForm.applicationBasis,
        cargoProfile: tableItemForm.cargoProfile,
        currency: tableItemForm.currency,
        unitValue,
        manualOnly: tableItemForm.manualOnly,
        active: tableItemForm.active,
        sortOrder,
      })
      showToast(tableItemForm.id ? 'Item de taxa atualizado.' : 'Item de taxa criado.', 'success')
      setTableItemForm(EMPTY_TABLE_ITEM_FORM)
    } catch {
      showToast('Falha ao salvar item de taxa.', 'error')
    }
  }

  function handleEditTableItem(tableId: number, itemId: number) {
    const table = currentTables.find((row) => row.id === tableId)
    const item = table?.charge_table_items.find((row) => row.id === itemId)
    if (!table || !item) return
    setFormsOpen(true)

    const unitValue = item.currency === 'USD' ? Number(item.unit_value_usd ?? 0) : Number(item.unit_value_brl ?? 0)
    setTableItemForm({
      id: item.id,
      chargeTableId: String(table.id),
      name: item.name ?? '',
      category: (item.category === 'other_charge' ? 'other_charge' : 'base') as 'base' | 'other_charge',
      applicationBasis: (item.application_basis ?? 'bl') as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
      cargoProfile: (item.cargo_profile ?? 'any') as 'standard' | 'imo' | 'oog' | 'any',
      currency: (item.currency === 'USD' ? 'USD' : 'BRL') as 'BRL' | 'USD',
      unitValue: String(unitValue),
      manualOnly: Boolean(item.manual_only),
      active: Boolean(item.active),
      sortOrder: String(Number(item.sort_order ?? 100)),
    })
  }

  async function handleDeleteTableItem(itemId: number) {
    const reason = await confirmWithReason({ title: 'Excluir item de taxa', message: 'Excluir este item da tabela de taxas?', consequence: 'O item sai da tabela e não entra em cálculos novos. O banco recusa se ele já foi usado em cálculo.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' })
    if (reason === null) return
    try {
      await deleteChargeTableItemMutation.mutateAsync({ id: itemId, reason })
      showToast('Item de taxa removido.', 'success')
      if (tableItemForm.id === itemId) setTableItemForm(EMPTY_TABLE_ITEM_FORM)
    } catch {
      showToast('Falha ao remover item de taxa. Pode haver calculos vinculados.', 'error')
    }
  }

  function handlePrepareTableItem(tableId: number) {
    setFormsOpen(true)
    setTableItemForm({ ...EMPTY_TABLE_ITEM_FORM, chargeTableId: String(tableId) })
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="app-table__cell-stack">
          <div className="app-panel__title">Cobertura das tabelas</div>
          <div className="app-table__cell-meta">Refine por modo e POD antes de editar estrutura tarifária ou publicar novos itens.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">{formatCountLabel(tableSummary.active, 'ativa', 'ativas')}</Badge>
          <Badge tone="blue">{formatCountLabel(tableSummary.items, 'item', 'itens')}</Badge>
          <Badge tone="slate">{formatCountLabel(tableSummary.manualOnly, 'manual', 'manuais')}</Badge>
        </div>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <MetricCard label="Tabelas" value={String(tableSummary.tables)} />
        <MetricCard label="Itens ativos" value={String(tableSummary.items - tableSummary.manualOnly)} />
      </div>
      <FilterBar activeCount={(cargoModeFilter ? 1 : 0) + (podFilter.trim() ? 1 : 0)} onClear={() => { setCargoModeFilter(''); setPodFilter('') }}>
        <div className="app-filter-grid">
          <Field label="Modo de carga">
            <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as ChargeFilterProps['cargoModeFilter'])}>
              <option value="">Todos</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="granito">Granito</option>
            </Select>
          </Field>
          <Field label="POD">
            <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
          </Field>
        </div>
      </FilterBar>

      {canEdit ? (
        <div className="mb-5 flex justify-end">
          <Button type="button" variant={formsOpen ? 'secondary' : 'primary'} onClick={() => setFormsOpen((open) => !open)}>
            <Plus size={15} />
            {formsOpen ? 'Ocultar formulários' : 'Nova tabela / Novo item'}
          </Button>
        </div>
      ) : null}

      {canEdit && formsOpen ? (
        <div className="mb-5 grid gap-5 xl:grid-cols-2">
          <ChargeTableFormCard
            tableForm={tableForm}
            setTableForm={setTableForm}
            onSave={handleSaveTable}
            saving={saveChargeTableMutation.isPending}
          />
          <ChargeTableItemFormCard
            tables={currentTables}
            tableItemForm={tableItemForm}
            setTableItemForm={setTableItemForm}
            onSave={handleSaveTableItem}
            saving={saveChargeTableItemMutation.isPending}
          />
        </div>
      ) : null}

      <ChargeTablesList
        tables={currentTables}
        tablesLoading={tablesLoading}
        tablesError={tablesError}
        tableCount={tableSummary.tables}
        filterDescription={tableFilterDescription}
        emptyState={tableEmptyState}
        canEdit={canEdit}
        canDelete={canDelete}
        onEditTable={handleEditTable}
        onPrepareTableItem={handlePrepareTableItem}
        onToggleTableActive={handleToggleTableActive}
        onEditTableItem={handleEditTableItem}
        onDeleteTableItem={handleDeleteTableItem}
        onToggleTableItemActive={handleToggleTableItemActive}
        togglingTableActive={setChargeTableActiveMutation.isPending}
        deletingTableItem={deleteChargeTableItemMutation.isPending}
      />
    </>
  )
}
