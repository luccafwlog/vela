import { useId, useState } from 'react'
import { formatDate } from '../../lib/utils'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Input, Select } from '../ui/Input'
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

export function VoyageFilters({
  filters,
  onChange,
  onClear,
  activeCount,
  visibleCount,
  totalCount,
  loading,
}: VoyageFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panelId = useId()

  const updateFilters = (next: Partial<Filters>) => onChange({ ...filters, ...next })
  const periodLabel = filters.periodo === 'hoje'
    ? 'Hoje'
    : filters.periodo === '7d'
      ? 'Próx. 7 dias'
      : filters.periodo === '30d'
        ? 'Próx. 30 dias'
        : filters.periodo === 'custom'
          ? `${filters.dataInicio ? formatDate(filters.dataInicio) : '…'} a ${filters.dataFim ? formatDate(filters.dataFim) : '…'}`
          : ''
  const statusLabel = filters.status === 'active'
    ? 'Ativas'
    : filters.status === 'completed'
      ? 'Concluídas'
      : filters.status === 'cancelled'
        ? 'Canceladas'
        : ''
  const conciliacaoLabel = filters.conciliacao === 'conciliada' ? 'Conciliada' : filters.conciliacao === 'pendente' ? 'Pendente' : ''

  const chips = [
    filters.periodo !== 'all' ? { key: 'periodo', label: 'Período', value: periodLabel, clear: () => updateFilters({ periodo: 'all', dataInicio: '', dataFim: '' }) } : null,
    filters.status !== 'all' ? { key: 'status', label: 'Status', value: statusLabel, clear: () => updateFilters({ status: 'all' }) } : null,
    filters.conciliacao !== 'all' ? { key: 'conciliacao', label: 'Conciliação', value: conciliacaoLabel, clear: () => updateFilters({ conciliacao: 'all' }) } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; clear: () => void }>

  return (
    <div className="app-voyage-command-bar">
      <div className="app-voyage-command-bar__row">
        <label className="app-voyage-command-bar__search">
          <span className="sr-only">Busca</span>
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Navio, viagem, armador ou porto"
            aria-label="Busca"
          />
          {filters.search ? (
            <button type="button" className="app-voyage-command-bar__clear-search" onClick={() => updateFilters({ search: '' })} aria-label="Limpar busca">
              <X size={14} />
            </button>
          ) : null}
        </label>

        {chips.length ? (
          <div className="app-voyage-command-bar__chips" aria-label="Filtros aplicados">
            {chips.map((chip) => (
              <span key={chip.key} className="app-filter-chip">
                <span>{chip.label}: <strong>{chip.value}</strong></span>
                <button type="button" onClick={chip.clear} aria-label={`Remover filtro ${chip.label}`}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <button type="button" className="app-btn app-btn--secondary app-btn--sm app-voyage-command-bar__filters" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls={panelId}>
          <SlidersHorizontal size={15} />
          Filtros
          {chips.length > 0 ? <span className="app-filter-bar__count">{chips.length}</span> : null}
        </button>

        {activeCount > 0 ? (
          <button type="button" className="app-btn app-btn--ghost app-btn--sm" onClick={onClear}>
            <X size={14} />
            Limpar
          </button>
        ) : null}
        <span className="app-voyage-command-bar__count" aria-live="polite">{loading ? 'Carregando…' : `${visibleCount} de ${totalCount} viagens`}</span>
      </div>

      {filtersOpen ? (
        <div id={panelId} className="app-voyage-command-bar__panel">
          <label className="app-field">
            <span className="app-field__label">Período</span>
            <Select value={filters.periodo} onChange={(e) => updateFilters({ periodo: e.target.value as PeriodoFilter })}>
              <option value="all">Qualquer</option>
              <option value="hoje">Hoje</option>
              <option value="7d">Próximos 7 dias</option>
              <option value="30d">Próximos 30 dias</option>
              <option value="custom">Entre datas</option>
            </Select>
          </label>

          {filters.periodo === 'custom' ? (
            <>
              <label className="app-field">
                <span className="app-field__label">De</span>
                <Input type="date" value={filters.dataInicio ?? ''} onChange={(e) => updateFilters({ dataInicio: e.target.value })} />
              </label>
              <label className="app-field">
                <span className="app-field__label">Até</span>
                <Input type="date" value={filters.dataFim ?? ''} onChange={(e) => updateFilters({ dataFim: e.target.value })} />
              </label>
            </>
          ) : null}

          <label className="app-field">
            <span className="app-field__label">Status</span>
            <Select value={filters.status} onChange={(e) => updateFilters({ status: e.target.value as StatusFilter })}>
              <option value="all">Todas</option>
              <option value="active">Ativas</option>
              <option value="completed">Concluídas</option>
              <option value="cancelled">Canceladas</option>
            </Select>
          </label>

          <label className="app-field">
            <span className="app-field__label">Conciliação</span>
            <Select value={filters.conciliacao} onChange={(e) => updateFilters({ conciliacao: e.target.value as ConciliacaoFilter })}>
              <option value="all">Todas</option>
              <option value="conciliada">Conciliada</option>
              <option value="pendente">Pendente</option>
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  )
}
