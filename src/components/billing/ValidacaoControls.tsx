import { Download, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import type { BatchOperation, BillingBlockCode, OpsFilters } from './validacaoTypes'

export function ValidacaoControls({
  filters, blockedCount, truncated, selectedCount, operationsLoading, calculatePending, exporting, exportingConference,
  onUpdateFilter, onRunBatchOperation, onExport, onExportConference,
}: {
  filters: OpsFilters
  blockedCount: number
  truncated: boolean
  selectedCount: number
  operationsLoading: boolean
  calculatePending: boolean
  exporting: boolean
  exportingConference: boolean
  onUpdateFilter: <K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) => void
  onRunBatchOperation: (action: BatchOperation) => void
  onExport: () => void
  onExportConference: () => void
}) {
  const hasSelection = selectedCount > 0
  return (
    <div className="mb-5 space-y-3">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <Field label="Texto livre"><Input value={filters.search} onChange={(e) => onUpdateFilter('search', e.target.value)} placeholder="B/L ou cliente" /></Field>
        <Field label="Modo"><Select value={filters.cargoMode} onChange={(e) => onUpdateFilter('cargoMode', e.target.value as OpsFilters['cargoMode'])}><option value="">Todos</option><option value="container">Container</option><option value="carga_solta">Carga Solta</option><option value="misto">Misto</option><option value="granito">Granito</option></Select></Field>
        <VoyageCombobox clearable label="Viagem" selectedVoyageId={filters.voyageId} onSelect={(id) => onUpdateFilter('voyageId', id == null ? '' : String(id))} />
        <Field label="POD"><Input value={filters.pod} onChange={(e) => onUpdateFilter('pod', e.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" /></Field>
          <Field label="Motivo"><Select value={filters.blockCode} onChange={(e) => onUpdateFilter('blockCode', e.target.value as BillingBlockCode | '')}><option value="">Todos</option><option value="sem_cliente">Sem cliente vinculado</option><option value="calculo_incompleto">Cálculo incompleto</option><option value="aguardando_ce">Aguardando CE Mercante</option><option value="portal_nao_provisionado">Portal não provisionado</option><option value="pronto">Pronto para emitir</option><option value="operacao_granito">Apoio operacional — Granito</option><option value="faturado">Faturado</option><option value="isento">Isento</option></Select></Field>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={filters.includeResolved} onChange={(e) => onUpdateFilter('includeResolved', e.target.checked)} /> Incluir resolvidos</label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--app-muted)]">
        <span>{operationsLoading ? 'Carregando…' : `${blockedCount} B/L bloqueados — ${selectedCount} selecionados`}</span>
        {truncated ? <span className="text-amber-700">Limite de 1200 B/L atingido; refine os filtros.</span> : null}
        <span className="flex-1" />
        <Button variant="secondary" onClick={() => onRunBatchOperation('recalculate')} loading={calculatePending} disabled={!hasSelection}><RefreshCw size={15} />Recalcular</Button>
        <details className="relative"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 py-2"><Download size={15} />Exportar</summary><div className="absolute right-0 z-10 mt-1 grid min-w-56 gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-2 shadow-lg"><button type="button" className="px-3 py-2 text-left text-sm" onClick={onExport} disabled={exporting}>Visão filtrada (XLSX)</button><button type="button" className="px-3 py-2 text-left text-sm" onClick={onExportConference} disabled={exportingConference}>Conferência do escopo (XLSX)</button></div></details>
      </div>
    </div>
  )
}
