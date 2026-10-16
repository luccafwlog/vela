import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import type { ConciliacaoFilter, PeriodoFilter, StatusFilter, VoyageFilters as Filters } from '../../lib/viagensFilters'

type VoyageFiltersProps = {
  filters: Filters
  onChange: (next: Filters) => void
  onClear: () => void
  activeCount: number
  /** Total de viagens visíveis após filtro / total bruto, para o contador. */
  visibleCount: number
  totalCount: number
  loading?: boolean
}

/**
 * Filtros da lista de Viagens sempre abertos (lote 2, 2026-10-16), como na
 * lista de BLs: Busca, Período, Status e Conciliação, valendo para a faixa e a
 * tabela.
 */
export function VoyageFilters({
  filters,
  onChange,
  onClear,
  activeCount,
  visibleCount,
  totalCount,
  loading,
}: VoyageFiltersProps) {
  const updateFilters = (next: Partial<Filters>) => onChange({ ...filters, ...next })

  return (
    <div className="app-filter-grid">
      <Field label="Buscar">
        <Input
          type="search"
          value={filters.search}
          onChange={(e) => updateFilters({ search: e.target.value })}
          placeholder="Navio, viagem, armador ou porto"
        />
      </Field>
      <Field label="Período">
        <Select value={filters.periodo} onChange={(e) => updateFilters({ periodo: e.target.value as PeriodoFilter })}>
          <option value="all">Qualquer</option>
          <option value="hoje">Hoje</option>
          <option value="7d">Próximos 7 dias</option>
          <option value="30d">Próximos 30 dias</option>
          <option value="custom">Entre datas</option>
        </Select>
      </Field>
      {filters.periodo === 'custom' ? (
        <>
          <Field label="De">
            <Input type="date" value={filters.dataInicio ?? ''} onChange={(e) => updateFilters({ dataInicio: e.target.value })} />
          </Field>
          <Field label="Até">
            <Input type="date" value={filters.dataFim ?? ''} onChange={(e) => updateFilters({ dataFim: e.target.value })} />
          </Field>
        </>
      ) : null}
      <Field label="Status">
        <Select value={filters.status} onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}>
          <option value="all">Todas</option>
          <option value="active">Ativas</option>
          <option value="completed">Concluídas</option>
          <option value="cancelled">Canceladas</option>
        </Select>
      </Field>
      <Field label="Conciliação">
        <Select value={filters.conciliacao} onChange={(e) => updateFilters({ conciliacao: e.target.value as ConciliacaoFilter })}>
          <option value="all">Todas</option>
          <option value="conciliada">Conciliada</option>
          <option value="pendente">Pendente</option>
        </Select>
      </Field>
      <div className="flex items-end gap-3">
        {activeCount > 0 ? <Button variant="ghost" onClick={onClear}>Limpar filtros</Button> : null}
        <span className="app-voyage-command-bar__count" aria-live="polite">{loading ? 'Carregando…' : `${visibleCount} de ${totalCount} viagens`}</span>
      </div>
    </div>
  )
}
