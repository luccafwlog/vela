import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import type { LineUpCeFilter, LineUpFilters as Filters, LineUpPeriodoFilter, LineUpPresenceFilter, LineUpStatusFilter } from '../../lib/lineupFilters'

type LineUpFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
  /** Total de escalas visíveis após filtro / total bruto, para o contador. */
  visibleCount: number
  totalCount: number
  loading?: boolean
}

// `status` nasce em 'active' e, por isso, não entra em `countActiveLineUpFilters`.
// Com a barra recolhida ele continuaria recortando a lista sem aparecer em lugar
// nenhum — daí o rótulo explícito em `appliedDefaults`.
const STATUS_LABELS: Record<LineUpStatusFilter, string> = {
  active: 'Escalas ativas',
  completed: 'Escalas concluídas',
  all: 'Todas as escalas',
}

export function LineUpFilters({ filters, onChange, onClear, activeCount, visibleCount, totalCount, loading }: LineUpFiltersProps) {
  return (
    <FilterBar
      title={loading ? '—' : `${visibleCount} de ${totalCount} escalas`}
      activeCount={activeCount}
      appliedDefaults={filters.status === 'all' ? undefined : [STATUS_LABELS[filters.status]]}
      onClear={onClear}
    >
      <div className="app-filter-grid">
        <Field label="Busca">
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Navio ou viagem"
          />
        </Field>

        <Field label="Status">
          <Select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value as LineUpStatusFilter })}>
            <option value="active">Escalas ativas</option>
            <option value="completed">Escalas concluídas</option>
            <option value="all">Todas as escalas</option>
          </Select>
        </Field>

        <Field label="Período">
          <Select value={filters.periodo} onChange={(event) => onChange({ ...filters, periodo: event.target.value as LineUpPeriodoFilter })}>
            <option value="all">Qualquer</option>
            <option value="custom">Entre datas</option>
          </Select>
        </Field>

        {filters.periodo === 'custom' ? (
          <>
            <Field label="De">
              <Input type="date" value={filters.dataInicio} onChange={(event) => onChange({ ...filters, dataInicio: event.target.value })} />
            </Field>
            <Field label="Até">
              <Input type="date" value={filters.dataFim} onChange={(event) => onChange({ ...filters, dataFim: event.target.value })} />
            </Field>
          </>
        ) : null}

        <Field label="CEs">
          <Select value={filters.ces} onChange={(event) => onChange({ ...filters, ces: event.target.value as LineUpCeFilter })}>
            <option value="all">Todos</option>
            <option value="waiting">Aguardando</option>
            <option value="received">Recebido</option>
            <option value="launching">Lançando</option>
            <option value="approving">Em aprovação</option>
            <option value="approved">Aprovado</option>
          </Select>
        </Field>

        <PresenceField label="Veículos" value={filters.vehicles} onChange={(vehicles) => onChange({ ...filters, vehicles })} withLabel="Com veículos" withoutLabel="Sem veículos" />
        <PresenceField label="BB" value={filters.bb} onChange={(bb) => onChange({ ...filters, bb })} withLabel="Com break-bulk" withoutLabel="Sem break-bulk" />
        <PresenceField label="MTY" value={filters.mty} onChange={(mty) => onChange({ ...filters, mty })} withLabel="Com vazios" withoutLabel="Sem vazios" />
        <PresenceField label="RTW" value={filters.rtw} onChange={(rtw) => onChange({ ...filters, rtw })} withLabel="Com restow" withoutLabel="Sem restow" />
        <PresenceField label="Linked" value={filters.linked} onChange={(linked) => onChange({ ...filters, linked })} withLabel="Manifesto vinculado" withoutLabel="Sem manifesto" />
      </div>
    </FilterBar>
  )
}

function PresenceField({
  label,
  value,
  onChange,
  withLabel,
  withoutLabel,
}: {
  label: string
  value: LineUpPresenceFilter
  onChange: (next: LineUpPresenceFilter) => void
  withLabel: string
  withoutLabel: string
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(event) => onChange(event.target.value as LineUpPresenceFilter)}>
        <option value="all">Todos</option>
        <option value="with">{withLabel}</option>
        <option value="without">{withoutLabel}</option>
      </Select>
    </Field>
  )
}
