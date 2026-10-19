import { FilterBar } from '../ui/FilterBar'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { countMoreLineUpFilters, type LineUpCeFilter, type LineUpFilters as Filters, type LineUpPeriodoFilter, type LineUpPresenceFilter, type LineUpStatusFilter } from '../../lib/lineupFilters'

type LineUpFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
}

/**
 * Filtros do Line-Up no Painel (lote 5a): Busca, Escalas, Período e CEs ficam
 * abertos; os de presença de carga (Veículos, BB, MTY, RTW, Vinculada) vão
 * para "Mais filtros", como na lista de BLs. A contagem de escalas fica na
 * faixa do bloco do Line Up.
 */
export function LineUpFilters({ filters, onChange, onClear, activeCount }: LineUpFiltersProps) {
  const moreCount = countMoreLineUpFilters(filters)
  return (
    <>
      <div className="app-filter-grid">
        <Field label="Busca">
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Navio ou viagem"
          />
        </Field>

        <Field label="Escalas">
          <Select value={filters.status} onChange={(event) => onChange({ ...filters, status: event.target.value as LineUpStatusFilter })}>
            <option value="active">Ativas</option>
            <option value="completed">Concluídas</option>
            <option value="all">Todas</option>
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

        {/* Como na lista de BLs: com filtro só nos campos abertos, o Limpar fica aqui; com "Mais filtros", fica lá. */}
        {activeCount > 0 && moreCount === 0 ? (
          <div><Button variant="ghost" onClick={onClear}>Limpar filtros</Button></div>
        ) : null}
      </div>

      <FilterBar title="Mais filtros" activeCount={moreCount} onClear={onClear}>
        <div className="app-filter-grid">
          <PresenceField label="Veículos" value={filters.vehicles} onChange={(vehicles) => onChange({ ...filters, vehicles })} withLabel="Com veículos" withoutLabel="Sem veículos" />
          <PresenceField label="BB" value={filters.bb} onChange={(bb) => onChange({ ...filters, bb })} withLabel="Com break-bulk" withoutLabel="Sem break-bulk" />
          <PresenceField label="MTY" value={filters.mty} onChange={(mty) => onChange({ ...filters, mty })} withLabel="Com vazios" withoutLabel="Sem vazios" />
          <PresenceField label="RTW" value={filters.rtw} onChange={(rtw) => onChange({ ...filters, rtw })} withLabel="Com restow" withoutLabel="Sem restow" />
          <PresenceField label="Vinculada" value={filters.linked} onChange={(linked) => onChange({ ...filters, linked })} withLabel="Manifesto vinculado" withoutLabel="Sem manifesto" />
        </div>
      </FilterBar>
    </>
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
