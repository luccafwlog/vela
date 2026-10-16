import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, MoreVertical, RotateCcw, Trash2 } from 'lucide-react'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import { Button } from '../ui/Button'
import { Block } from '../ui/Block'
import { MetricCard } from '../ui/MetricCard'
import { StatusText } from '../ui/StatusText'
import { NoValue } from '../ui/NoValue'
import { EmptyState, InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { SkeletonTable } from '../ui/Skeleton'
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
import { normalizeChargeTablePod, resolveChargeTableStates, type OverridePayload } from '../../pages/taxasLocaisHelpers'
import type { LocalChargeOverrideItem } from '../../services/charges/chargeRateService'
import { ChargeOverrideFormModal } from './ChargeOverrideFormModal'
import { ChargeScopeFilters } from './ChargeScopeFilters'
import {
  basisUnit,
  conditionEffectNotes,
  conditionPeriod,
  conditionPeriodLabel,
  formatPeriod,
  formatRate,
  itemDisplayName,
  itemUnitValue,
  podOptions,
  scopeLabel,
  shortDifference,
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

const LENS_PERIODS: Record<Exclude<ConditionsLens, 'sem-efeito'>, ConditionPeriod[] | null> = {
  todas: null,
  vigentes: ['current'],
  futuras: ['future'],
  encerradas: ['ended', 'disabled'],
}

function matchesLens(lens: ConditionsLens, entry: Row) {
  if (lens === 'sem-efeito') return entry.withoutEffect
  const periods = LENS_PERIODS[lens]
  return !periods || periods.includes(entry.period)
}

type Row = {
  row: LocalChargeOverrideItem
  period: ConditionPeriod
  periodLabel: string
  notes: ChargeNote[]
  /** Vigente hoje, mas sem efeito no cálculo. */
  withoutEffect: boolean
}

function noop() {}

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
  creating = false,
  onCreateDone = noop,
}: ChargeFilterProps & {
  lens: ConditionsLens
  setLens: (value: ConditionsLens) => void
  customerSearch: string
  setCustomerSearch: (value: string) => void
  canEdit: boolean
  canDelete: boolean
  /** "+ Nova condição" do título da página pediu o formulário em branco. */
  creating?: boolean
  onCreateDone?: () => void
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

  const visible = rows.filter((entry) => matchesLens(lens, entry))
  const counts = {
    current: rows.filter((entry) => entry.period === 'current').length,
    future: rows.filter((entry) => entry.period === 'future').length,
    ended: rows.filter((entry) => entry.period === 'ended' || entry.period === 'disabled').length,
    withoutEffect: rows.filter((entry) => entry.withoutEffect).length,
  }
  const hasFilters = Boolean(customerSearch || cargoModeFilter || podFilter || lens !== 'todas')
  const truncated = (overrides.data?.length ?? 0) >= CONDITIONS_LIMIT

  function closeModal() {
    setModal(null)
    onCreateDone()
  }

  function clearFilters() {
    setSearchText('')
    setCustomerSearch('')
    setCargoModeFilter('')
    setPodFilter('')
    setLens('todas')
  }

  async function handleSave(input: OverridePayload & { id: number | null }) {
    await saveOverride.mutateAsync(input)
    closeModal()
    showToast(input.id ? 'Condição atualizada.' : 'Condição cadastrada.', 'success')
  }

  async function handleToggleActive(row: LocalChargeOverrideItem) {
    const nextActive = row.active === false
    const who = `${row.customer?.name ?? 'Cliente'} · ${row.charge_item ? itemDisplayName(row.charge_item) : 'item'}`
    // B13: reativar pede motivo (ADR 0072), gravado pela RPC reactivate_catalog_row (migration 261).
    const confirmOptions = {
      title: nextActive ? 'Reativar condição de Cliente' : 'Desativar condição de Cliente',
      message: `${nextActive ? 'Reativar' : 'Desativar'} a condição ${who}?`,
      consequence: nextActive
        ? 'Cálculos novos deste Cliente voltam a usar o valor negociado dentro da vigência. O banco recusa se outra condição ativa ocupar o mesmo período.'
        : 'Cálculos novos deste Cliente passam a usar o valor da tabela; cálculos e faturas antigos continuam mostrando a condição aplicada.',
      reversibility: nextActive ? 'Pode ser desativada de novo.' : 'Pode ser reativada pelo Administrativo.',
      confirmLabel: nextActive ? 'Reativar condição' : 'Desativar condição',
      tone: nextActive ? ('primary' as const) : ('danger' as const),
    }
    const reason = nextActive ? await confirmWithReason(confirmOptions) : (await confirm(confirmOptions)) ? '' : null
    if (reason === null) return
    setBusyId(row.id)
    try {
      await setOverrideActive.mutateAsync({ id: row.id, active: nextActive, reason })
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
      message: `Excluir a condição ${row.customer?.name ?? 'do Cliente'} · ${row.charge_item ? itemDisplayName(row.charge_item) : 'item'}?`,
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
    const name = `${row.customer?.name ?? 'Cliente'} · ${row.charge_item ? itemDisplayName(row.charge_item) : 'item'}`
    return (
      <div className="app-rates-item__actions">
        <Button variant="secondary" className="app-btn--sm" onClick={() => setModal({ row })} aria-label={`Editar condição ${name}`}>
          Editar
        </Button>
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
    const difference = shortDifference(base, negotiated)
    return {
      negotiated: `${formatRate(currency, negotiated)} ${basisUnit(row.charge_item?.application_basis ?? null)}`,
      table: `${formatRate(currency, base)}${difference ? ` (${difference})` : ''}`,
    }
  }

  function renderSituation({ periodLabel, notes, withoutEffect }: Row) {
    if (withoutEffect) {
      const reason = notes.map((note) => note.text).join(' ')
      return (
        <span title={reason}>
          <StatusText tone="warning">Sem efeito no cálculo</StatusText>
          <span className="sr-only">: {reason}</span>
        </span>
      )
    }
    return periodLabel
  }

  function tableLabel(row: LocalChargeOverrideItem) {
    const table = row.charge_item?.charge_table
    return `${scopeLabel(table?.cargo_mode, table?.pod)} · ${table?.name ?? 'sem tabela'}`
  }

  function customerCell(row: LocalChargeOverrideItem) {
    if (!row.customer?.name) return <NoValue label="Sem Cliente" />
    return row.customer.cnpj_cpf
      ? <Link className="app-link" to={`/clientes/${encodeURIComponent(row.customer.cnpj_cpf)}`}>{row.customer.name}</Link>
      : row.customer.name
  }

  const lensCards: Array<{ value: ConditionsLens; label: string; count: number; warn?: boolean }> = [
    { value: 'todas', label: 'Condições', count: rows.length },
    { value: 'vigentes', label: 'Vigentes hoje', count: counts.current },
    { value: 'futuras', label: 'Futuras', count: counts.future },
    { value: 'encerradas', label: 'Encerradas ou desativadas', count: counts.ended },
    { value: 'sem-efeito', label: 'Sem efeito no cálculo', count: counts.withoutEffect, warn: true },
  ]

  return (
    <>
      <div className="app-metric-row" role="group" aria-label="Filtrar condições por situação">
        {lensCards.map((card) => (
          <MetricCard
            key={card.value}
            label={card.label}
            value={overrides.data ? card.count : <NoValue label="Carregando" />}
            tone={card.warn && card.count > 0 ? 'warning' : 'secondary'}
            selected={lens === card.value}
            onSelect={() => setLens(lens === card.value ? 'todas' : card.value)}
          />
        ))}
      </div>

      <div className="app-filter-grid">
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

      {overrides.error ? (
        <div className="app-rates-state">
          <InlineError message="Não foi possível consultar as condições de Cliente." />
          <Button variant="secondary" className="app-btn--sm" onClick={() => void overrides.refetch()} loading={overrides.isFetching} loadingLabel="Consultando…">
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {tablesQuery.error && !overrides.error ? (
        <p className="app-rates-help app-rates-state">Sem a lista de tabelas, a tela não confere se cada condição está na tabela em uso no cálculo.</p>
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
            description="Sem condição, todo Cliente paga o valor da tabela em uso no cálculo."
          />
        )
      ) : null}

      {visible.length > 0 ? (
        <Block
          title="Condições de Cliente"
          aside="o valor negociado vale quando a chegada do navio no POD cai na vigência"
          flush
        >
          {narrow ? (
            <div className="app-block__body">
            <ul className="app-rates-item-cards">
              {visible.map((entry) => {
                const { row, period } = entry
                const values = renderValues(row)
                return (
                  <li key={row.id} className="app-rates-item-card" data-inactive={period === 'ended' || period === 'disabled' || undefined}>
                    <div className="app-rates-item-card__head">
                      <strong>{customerCell(row)}</strong>
                      {renderActions(row)}
                    </div>
                    <p title={row.notes ?? undefined}>{row.charge_item ? itemDisplayName(row.charge_item) : <NoValue label="Sem item de taxa" />} <span className="app-rates-unit">{tableLabel(row)}</span></p>
                    <p><span className="app-rates-num">{values.negotiated}</span> <span className="app-rates-unit">Tabela: {values.table}</span></p>
                    <p>{renderSituation(entry)} · <span className="app-rates-num">{formatPeriod(row.valid_from, row.valid_to)}</span></p>
                  </li>
                )
              })}
            </ul>
            </div>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table app-table--compact">
                <caption className="sr-only">Condições de Cliente</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Cliente</th>
                    <th scope="col" className="app-table__text-head">Item de taxa</th>
                    <th scope="col" className="app-table__text-head">Tabela</th>
                    <th scope="col">Vigência</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Valor negociado</th>
                    <th scope="col">Valor da tabela</th>
                    {canEdit ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => {
                    const { row, period } = entry
                    const values = renderValues(row)
                    return (
                      <tr key={row.id} className={period === 'ended' || period === 'disabled' ? 'app-table__row--muted' : undefined}>
                        <td className="app-table__text">{customerCell(row)}</td>
                        <td className="app-table__text" title={row.notes ?? undefined}>
                          {row.charge_item ? itemDisplayName(row.charge_item) : <NoValue label="Sem item de taxa" />}
                        </td>
                        <td className="app-table__text">{tableLabel(row)}</td>
                        <td className="tabular-nums">{formatPeriod(row.valid_from, row.valid_to)}</td>
                        <td>{renderSituation(entry)}</td>
                        <td className="tabular-nums">{values.negotiated}</td>
                        <td className="tabular-nums">{values.table}</td>
                        {canEdit ? <td>{renderActions(row)}</td> : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      ) : null}

      {modal || creating ? (
        <ChargeOverrideFormModal
          key={modal?.row?.id ?? 'new'}
          open
          row={modal?.row ?? null}
          states={states}
          tablesById={tablesById}
          onClose={closeModal}
          onSave={handleSave}
        />
      ) : null}
    </>
  )
}
