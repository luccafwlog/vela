import { useEffect, useMemo, useState } from 'react'
import { Ban, MoreVertical, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import { Button } from '../ui/Button'
import { EmptyState, InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SkeletonTable } from '../ui/Skeleton'
import { SummaryStrip } from '../ui/SummaryStrip'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useNarrowViewport } from '../bl/useNarrowViewport'
import {
  useCustomerRateOverrides,
  useDeleteCustomerRateOverride,
  useLocalChargeTables,
  useSaveCustomerRateOverride,
  useSetCustomerRateOverrideActive,
} from '../../hooks/useLocalCharges'
import { extractErrorText } from '../../lib/errors'
import { formatCnpjCpf } from '../../lib/utils'
import { normalizeChargeTablePod, resolveChargeTableStates, type OverridePayload } from '../../pages/taxasLocaisHelpers'
import type { LocalChargeOverrideItem } from '../../services/charges/chargeRateService'
import { ChargeOverrideFormModal } from './ChargeOverrideFormModal'
import { ChargeNoteList } from './ChargeFormParts'
import { ChargeScopeFilters } from './ChargeScopeFilters'
import {
  basisUnit,
  conditionEffectNotes,
  conditionPeriod,
  conditionPeriodLabel,
  describeDifference,
  formatPeriod,
  formatRate,
  itemUnitValue,
  podOptions,
  scopeLabel,
  type ChargeNote,
  type ConditionPeriod,
} from './chargePresentation'
import type { ChargeFilterProps, ConditionsLens } from './chargeForms'

// ponytail: a lista lê até 500 condições (o serviço pagina tudo e corta depois
// de filtrar pelo Cliente e pelo modo). Acima disso, a tela avisa e pede para
// refinar; paginação no servidor é o próximo passo se o cadastro crescer.
const CONDITIONS_LIMIT = 500

function todayIso() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

const LENS_PERIODS: Record<ConditionsLens, ConditionPeriod[] | null> = {
  todas: null,
  vigentes: ['current'],
  futuras: ['future'],
  encerradas: ['ended', 'disabled'],
}

const PERIOD_CLASS: Record<ConditionPeriod, string> = {
  current: 'app-rates-period--current',
  future: 'app-rates-period--future',
  ended: 'app-rates-period--ended',
  disabled: 'app-rates-period--ended',
}

type Row = {
  row: LocalChargeOverrideItem
  period: ConditionPeriod
  periodLabel: string
  notes: ChargeNote[]
  /** Vigente hoje, mas sem efeito no cálculo. */
  withoutEffect: boolean
}

export function ChargeOverridesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  lens,
  setLens,
  customerSearch,
  setCustomerSearch,
  canEdit,
  canDelete,
}: ChargeFilterProps & {
  lens: ConditionsLens
  setLens: (value: ConditionsLens) => void
  customerSearch: string
  setCustomerSearch: (value: string) => void
  canEdit: boolean
  canDelete: boolean
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const narrow = useNarrowViewport()
  const [searchText, setSearchText] = useState(customerSearch)
  const [modal, setModal] = useState<{ row: LocalChargeOverrideItem | null } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // A URL só recebe a busca depois de uma pausa na digitação; voltar à aba ou
  // abrir um link com `?cliente=` preenche o campo.
  const [syncedSearch, setSyncedSearch] = useState(customerSearch)
  if (syncedSearch !== customerSearch) {
    setSyncedSearch(customerSearch)
    setSearchText(customerSearch)
  }
  useEffect(() => {
    if (searchText === customerSearch) return
    const handle = window.setTimeout(() => setCustomerSearch(searchText), 300)
    return () => window.clearTimeout(handle)
  }, [searchText, customerSearch, setCustomerSearch])

  const overrides = useCustomerRateOverrides({
    customerSearch,
    cargoMode: cargoModeFilter,
    limit: CONDITIONS_LIMIT,
  })
  const tablesQuery = useLocalChargeTables()
  const saveOverride = useSaveCustomerRateOverride()
  const deleteOverride = useDeleteCustomerRateOverride()
  const setOverrideActive = useSetCustomerRateOverrideActive()

  const tables = useMemo(() => tablesQuery.data ?? [], [tablesQuery.data])
  const states = useMemo(() => resolveChargeTableStates(tables), [tables])
  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables])
  const today = todayIso()

  const rows = useMemo<Row[]>(() => (overrides.data ?? [])
    .filter((row) => !podFilter || normalizeChargeTablePod(row.charge_item?.charge_table?.pod) === podFilter)
    .map((row) => {
      const period = conditionPeriod(row, today)
      // Sem a lista de tabelas não dá para afirmar se a tabela é a aplicada.
      const notes = tablesQuery.data ? conditionEffectNotes(row.charge_item, states, tablesById) : []
      return { row, period, periodLabel: conditionPeriodLabel(row, today), notes, withoutEffect: period === 'current' && notes.length > 0 }
    }), [overrides.data, podFilter, today, states, tablesById, tablesQuery.data])

  const visible = rows.filter((entry) => !LENS_PERIODS[lens] || LENS_PERIODS[lens]!.includes(entry.period))
  const counts = {
    current: rows.filter((entry) => entry.period === 'current').length,
    future: rows.filter((entry) => entry.period === 'future').length,
    ended: rows.filter((entry) => entry.period === 'ended' || entry.period === 'disabled').length,
    withoutEffect: rows.filter((entry) => entry.withoutEffect).length,
  }
  const hasFilters = Boolean(customerSearch || cargoModeFilter || podFilter || lens !== 'todas')
  const truncated = (overrides.data?.length ?? 0) >= CONDITIONS_LIMIT

  function clearFilters() {
    setSearchText('')
    setCustomerSearch('')
    setCargoModeFilter('')
    setPodFilter('')
    setLens('todas')
  }

  async function handleSave(input: OverridePayload & { id: number | null }) {
    await saveOverride.mutateAsync(input)
    setModal(null)
    showToast(input.id ? 'Condição atualizada.' : 'Condição cadastrada.', 'success')
  }

  async function handleToggleActive(row: LocalChargeOverrideItem) {
    const nextActive = row.active === false
    const who = `${row.customer?.name ?? 'Cliente'} · ${row.charge_item?.name ?? 'item'}`
    const confirmed = await confirm({
      title: nextActive ? 'Reativar condição de Cliente' : 'Desativar condição de Cliente',
      message: `${nextActive ? 'Reativar' : 'Desativar'} a condição ${who}?`,
      consequence: nextActive
        ? 'Cálculos novos deste Cliente voltam a usar o valor negociado dentro da vigência. O banco recusa se outra condição ativa ocupar o mesmo período.'
        : 'Cálculos novos deste Cliente passam a usar o valor da tabela; cálculos e faturas antigos continuam mostrando a condição aplicada.',
      reversibility: nextActive ? 'Pode ser desativada de novo.' : 'Pode ser reativada pelo Administrativo.',
      confirmLabel: nextActive ? 'Reativar condição' : 'Desativar condição',
      tone: nextActive ? 'primary' : 'danger',
    })
    if (!confirmed) return
    setBusyId(row.id)
    try {
      await setOverrideActive.mutateAsync({ id: row.id, active: nextActive })
      showToast(nextActive ? 'Condição reativada.' : 'Condição desativada.', 'success')
    } catch (error) {
      showToast(extractErrorText(error) || 'Não foi possível alterar a condição.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(row: LocalChargeOverrideItem) {
    const reason = await confirmWithReason({
      title: 'Excluir condição de Cliente',
      message: `Excluir a condição ${row.customer?.name ?? 'do Cliente'} · ${row.charge_item?.name ?? 'item'}?`,
      consequence: 'Cálculos novos deste Cliente voltam a usar o valor da tabela. Se a condição já foi usada em cálculo ou fatura, o banco recusa: nesse caso, desative-a.',
      reversibility: 'Não é possível desfazer; cadastre de novo se precisar.',
      tone: 'danger',
      confirmLabel: 'Excluir condição',
    })
    if (reason === null) return
    setBusyId(row.id)
    try {
      await deleteOverride.mutateAsync({ id: row.id, reason })
      showToast('Condição excluída.', 'success')
    } catch (error) {
      showToast(extractErrorText(error) || 'Não foi possível excluir a condição.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function rowMenu(row: LocalChargeOverrideItem): ActionMenuItem[] {
    if (!canDelete) return []
    const busy = busyId === row.id
    return [
      row.active === false
        ? { key: 'on', label: 'Reativar condição', icon: <RotateCcw size={14} aria-hidden="true" />, disabled: busy, onSelect: () => void handleToggleActive(row) }
        : { key: 'off', label: 'Desativar condição', icon: <Ban size={14} aria-hidden="true" />, disabled: busy, onSelect: () => void handleToggleActive(row) },
      { key: 'delete', label: 'Excluir condição', icon: <Trash2 size={14} aria-hidden="true" />, danger: true, disabled: busy, onSelect: () => void handleDelete(row) },
    ]
  }

  // Funções de render, não componentes: um componente declarado aqui seria
  // recriado a cada render e fecharia o menu ⋮ aberto.
  function renderActions(row: LocalChargeOverrideItem) {
    if (!canEdit) return null
    const menu = rowMenu(row)
    const name = `${row.customer?.name ?? 'Cliente'} · ${row.charge_item?.name ?? 'item'}`
    return (
      <div className="app-rates-item__actions">
        <button type="button" className="app-table__icon-button" onClick={() => setModal({ row })} aria-label={`Editar condição ${name}`} title="Editar condição">
          <Pencil size={14} aria-hidden="true" />
        </button>
        {menu.length ? (
          <ActionMenu
            label={`Mais ações da condição ${name}`}
            menuId={`condition-menu-${row.id}`}
            triggerClassName="app-table__icon-button"
            trigger={<MoreVertical size={16} aria-hidden="true" />}
            items={menu}
          />
        ) : null}
      </div>
    )
  }

  function renderValues(row: LocalChargeOverrideItem) {
    const currency = row.charge_item?.currency ?? 'BRL'
    const base = row.charge_item ? itemUnitValue(row.charge_item) : 0
    const negotiated = Number(row.override_value ?? 0)
    const difference = describeDifference(base, negotiated)
    return (
      <div className="app-rates-values">
        <span className="app-rates-num app-rates-values__negotiated">{formatRate(currency, negotiated)}</span>
        <span className="app-rates-unit">{basisUnit(row.charge_item?.application_basis ?? null)}</span>
        <span className="app-rates-unit">
          Tabela: <span className="app-rates-num">{formatRate(currency, base)}</span>
          {difference ? ` (${difference.replace(' em relação à tabela', '')})` : ''}
        </span>
      </div>
    )
  }

  const lensOptions = [
    { value: 'todas' as const, label: 'Todas' },
    { value: 'vigentes' as const, label: `Vigentes hoje (${counts.current})` },
    { value: 'futuras' as const, label: `Futuras (${counts.future})` },
    { value: 'encerradas' as const, label: `Encerradas ou desativadas (${counts.ended})` },
  ]

  return (
    <>
      <div className="app-rates-toolbar">
        <div className="app-rates-toolbar__filters">
          <Field label="Cliente">
            <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Nome ou CNPJ" type="search" />
          </Field>
          <ChargeScopeFilters
            cargoModeFilter={cargoModeFilter}
            setCargoModeFilter={setCargoModeFilter}
            podFilter={podFilter}
            setPodFilter={setPodFilter}
            pods={podOptions(tables)}
          />
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => setModal({ row: null })} className="app-rates-toolbar__primary">
            <Plus size={15} aria-hidden="true" />
            Nova condição
          </Button>
        ) : null}
      </div>

      <section className="app-surface app-rates-surface" aria-label="Condições de Cliente">
        <div className="app-rates-surface__bar">
          <SegmentedControl label="Mostrar condições" options={lensOptions} value={lens} onChange={setLens} />
          {overrides.data ? (
            <SummaryStrip
              label="Resumo das condições"
              items={[
                { label: rows.length === 1 ? 'condição' : 'condições', value: rows.length },
                { label: 'vigentes hoje', value: counts.current },
                ...(counts.withoutEffect ? [{ label: 'vigentes sem efeito no cálculo', value: counts.withoutEffect, tone: 'warning' as const }] : []),
              ]}
            />
          ) : null}
        </div>
        <p className="app-rates-surface__rule">
          O valor negociado substitui o da tabela para o Cliente quando a data de referência do B/L (ETA da escala do POD) cai na vigência. "Vigente hoje" é a leitura de hoje, não a de cada B/L.
        </p>

        {overrides.error ? (
          <div className="app-rates-state">
            <InlineError message="Não foi possível consultar as condições de Cliente." />
            <Button variant="secondary" className="app-btn--sm" onClick={() => void overrides.refetch()} loading={overrides.isFetching} loadingLabel="Consultando…">
              Tentar novamente
            </Button>
          </div>
        ) : null}
        {tablesQuery.error && !overrides.error ? (
          <p className="app-rates-help app-rates-state">Sem a lista de tabelas, a tela não confere se cada condição está na tabela aplicada.</p>
        ) : null}
        {truncated ? (
          <p className="app-rates-help app-rates-state">Mostrando as {CONDITIONS_LIMIT} condições mais recentes deste recorte. Refine pelo Cliente para ver as demais.</p>
        ) : null}

        {overrides.isLoading ? <SkeletonTable rows={4} cols={4} columnTemplate="1.4fr 1.4fr 1fr 1fr" label="Carregando condições" /> : null}

        {!overrides.isLoading && overrides.data && visible.length === 0 ? (
          hasFilters ? (
            <EmptyState
              title="Nenhuma condição neste recorte"
              description={customerSearch ? `Nenhuma condição para "${customerSearch}" com esses filtros.` : 'Nenhuma condição com esses filtros.'}
              action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
            />
          ) : (
            <EmptyState
              title="Nenhuma condição de Cliente"
              description="Sem condição, todo Cliente paga o valor da tabela aplicada."
              action={canEdit ? <Button onClick={() => setModal({ row: null })}><Plus size={15} aria-hidden="true" />Nova condição</Button> : undefined}
            />
          )
        ) : null}

        {visible.length > 0 && narrow ? (
          <ul className="app-rates-item-cards">
            {visible.map(({ row, period, periodLabel, notes }) => (
              <li key={row.id} className="app-rates-item-card" data-inactive={period === 'ended' || period === 'disabled' || undefined}>
                <div className="app-rates-item-card__head">
                  <span>
                    <strong>{row.customer?.name ?? '—'}</strong>
                    <span className="app-rates-unit app-rates-code app-rates-block">{formatCnpjCpf(row.customer?.cnpj_cpf ?? '')}</span>
                  </span>
                  {renderActions(row)}
                </div>
                <p>{row.charge_item?.name ?? '—'} <span className="app-rates-unit">{scopeLabel(row.charge_item?.charge_table?.cargo_mode, row.charge_item?.charge_table?.pod)}</span></p>
                {renderValues(row)}
                <p className={`app-rates-period ${PERIOD_CLASS[period]}`}>{periodLabel} · <span className="app-rates-num">{formatPeriod(row.valid_from, row.valid_to)}</span></p>
                <ChargeNoteList notes={notes} />
                {row.notes ? <p className="app-rates-table__notes">{row.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {visible.length > 0 && !narrow ? (
          <div className="app-table-scroll">
            <table className="app-table app-table--compact app-rates-condition-table text-left">
              <caption className="sr-only">Condições de Cliente</caption>
              <thead>
                <tr>
                  <th scope="col">Cliente</th>
                  <th scope="col">Item de taxa</th>
                  <th scope="col">Vigência</th>
                  <th scope="col" className="text-right">Valor negociado</th>
                  {canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, period, periodLabel, notes }) => (
                  <tr key={row.id} data-inactive={period === 'ended' || period === 'disabled' || undefined}>
                    <td>
                      <div className="app-rates-item__name">{row.customer?.name ?? '—'}</div>
                      <div className="app-rates-unit app-rates-code">{formatCnpjCpf(row.customer?.cnpj_cpf ?? '')}</div>
                    </td>
                    <td>
                      <div className="app-rates-item__name">{row.charge_item?.name ?? '—'}</div>
                      <div className="app-rates-unit">
                        {scopeLabel(row.charge_item?.charge_table?.cargo_mode, row.charge_item?.charge_table?.pod)} · {row.charge_item?.charge_table?.name ?? 'sem tabela'}
                      </div>
                      <ChargeNoteList notes={notes} className="app-rates-item__notes" />
                      {row.notes ? <p className="app-rates-table__notes" title={row.notes}>{row.notes}</p> : null}
                    </td>
                    <td>
                      <div className={`app-rates-period ${PERIOD_CLASS[period]}`}>{periodLabel}</div>
                      <div className="app-rates-unit app-rates-num">{formatPeriod(row.valid_from, row.valid_to)}</div>
                    </td>
                    <td className="text-right">{renderValues(row)}</td>
                    {canEdit ? <td className="app-rates-item__actions-cell">{renderActions(row)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {modal ? (
        <ChargeOverrideFormModal
          key={modal.row?.id ?? 'new'}
          open
          row={modal.row}
          states={states}
          tablesById={tablesById}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      ) : null}
    </>
  )
}
