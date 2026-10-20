import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select } from '../ui/Input'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import type { BillingBlockCode, OpsFilters } from './validacaoTypes'

/**
 * Filtros da Validação (lote 1 da identidade): Busca, Motivo e Navio / Viagem
 * abertos; Modo de carga, POD e Incluir resolvidos em "Mais filtros".
 */
export function ValidacaoControls({
  filters, truncated, onUpdateFilter,
}: {
  filters: OpsFilters
  truncated: boolean
  onUpdateFilter: <K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) => void
}) {
  const moreCount = [filters.cargoMode, filters.pod, filters.includeResolved ? 'sim' : ''].filter(Boolean).length
  return (
    <div className="grid gap-3">
      <div className="app-filter-grid">
        <Field label="Buscar B/L ou Cliente"><Input type="search" value={filters.search} onChange={(e) => onUpdateFilter('search', e.target.value)} placeholder="Ex.: COSU6401234502" /></Field>
        <Field label="Motivo"><Select value={filters.blockCode} onChange={(e) => onUpdateFilter('blockCode', e.target.value as BillingBlockCode | '')}><option value="">Todos</option><option value="sem_cliente">Sem cliente vinculado</option><option value="calculo_incompleto">Cálculo sem linhas, incompleto ou taxa em revisão</option><option value="aguardando_ce">Aguardando CE Mercante</option><option value="portal_nao_provisionado">Conta do Portal não ativa</option><option value="pronto">Pronto para emitir</option><option value="faturado">Faturado</option><option value="isento">Isento</option></Select></Field>
        <VoyageCombobox clearable label="Navio / Viagem" selectedVoyageId={filters.voyageId} onSelect={(id) => onUpdateFilter('voyageId', id == null ? '' : String(id))} />
      </div>
      <FilterBar title="Mais filtros" activeCount={moreCount}>
        <div className="app-filter-grid">
          <Field label="Modo de carga"><Select value={filters.cargoMode} onChange={(e) => onUpdateFilter('cargoMode', e.target.value as OpsFilters['cargoMode'])}><option value="">Todos</option><option value="container">Container</option><option value="carga_solta">Carga Solta</option><option value="misto">Misto</option></Select></Field>
          <Field label="POD"><Input value={filters.pod} onChange={(e) => onUpdateFilter('pod', e.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={filters.includeResolved} onChange={(e) => onUpdateFilter('includeResolved', e.target.checked)} /> Incluir faturados e isentos</label>
        </div>
      </FilterBar>
      {truncated ? <p className="app-facts__detail" role="status">Limite de 1200 B/Ls atingido; refine os filtros.</p> : null}
    </div>
  )
}
