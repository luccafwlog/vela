import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useBatchCalculateLocalCharges, useCustomerReconciliationQueue, useLocalChargeOperations } from '../../hooks/useLocalCharges'
import { queryKeys } from '../../services/queryKeys'
import { markBlReadyAndCreateInvoice } from '../../services/billing'
import { getBillingBlock, isBlLockedForRecalc } from './validacaoPipeline'
import { ValidacaoControls } from './ValidacaoControls'
import { ValidacaoOperationsTable } from './ValidacaoOperationsTable'
import type { ReasonEvent } from './validacaoBand'
import { getEffectiveAlertType, listFinancialAlerts } from '../../services/alerts'
import type { LocalChargeOperationalRow } from '../../services/charges/chargeOperationsService'
import type { BillingBlockCode, BatchOperation, OpsFilters } from './validacaoTypes'

export function ValidacaoTab({ userId, initialBlockCode, initialBlSearch }: { userId: string | null; initialBlockCode?: BillingBlockCode; initialBlSearch?: string }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [expandedBlId, setExpandedBlId] = useState<string | null>(null)
  const [opsFilters, setOpsFilters] = useState<OpsFilters>({ search: initialBlSearch ?? '', cargoMode: '', pod: '', voyageId: '', blockCode: initialBlockCode ?? '', includeResolved: false })
  const [selectedOpsRows, setSelectedOpsRows] = useState<string[]>([])
  const [exportingOps, setExportingOps] = useState(false)
  const { data: operationsResult, isLoading: operationsLoading, error: operationsError } = useLocalChargeOperations({ search: opsFilters.search, cargoMode: opsFilters.cargoMode, pod: opsFilters.pod, voyageId: opsFilters.voyageId ? Number(opsFilters.voyageId) : null, includeResolved: opsFilters.includeResolved, limit: 1200 })
  const operationsRows = useMemo(() => operationsResult?.rows ?? [], [operationsResult])
  const batchCalculateMutation = useBatchCalculateLocalCharges()
  const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)

  const displayedRows = useMemo(() => {
    return (operationsRows ?? []).filter((row) => {
      const block = getBillingBlock(row)
      // "Pronto para emitir" fica na fila normal com o botão Emitir (decisão de 2026-10-14).
      if (!opsFilters.includeResolved && (block.code === 'faturado' || block.code === 'isento')) return false
      return !opsFilters.blockCode || block.code === opsFilters.blockCode
    })
  }, [operationsRows, opsFilters.blockCode, opsFilters.includeResolved])
  const selectedRows = useMemo(() => new Set(selectedOpsRows), [selectedOpsRows])
  const areAllOpsRowsSelected = displayedRows.length > 0 && displayedRows.every((row) => selectedRows.has(row.id))

  function updateOpsFilter<K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value, ...(field === 'blockCode' && (value === 'faturado' || value === 'isento') ? { includeResolved: true } : {}) }))
    setSelectedOpsRows([])
  }
  function toggleOpsRow(blId: string) { setSelectedOpsRows((current) => current.includes(blId) ? current.filter((id) => id !== blId) : [...current, blId]) }
  function toggleAllOpsRows() { setSelectedOpsRows(areAllOpsRowsSelected ? [] : displayedRows.map((row) => row.id)) }

  async function runBatchOperation(action: BatchOperation, explicitIds?: string[]) {
    const ids = explicitIds ?? selectedOpsRows
    if (!ids.length) return
    const invoiced = new Set((operationsRows ?? []).filter((row) => ids.includes(row.id) && isBlLockedForRecalc(row.financial_status)).map((row) => row.id))
    const eligible = ids.filter((id) => !invoiced.has(id))
    if (!eligible.length) {
      if (invoiced.size) showToast(`${invoiced.size} ignorado(s) (já faturados).`, 'info')
      showToast('Nenhum B/L elegível para recálculo na seleção.', 'info')
      return
    }
    const eligibleRows = eligible.flatMap((id) => {
      const row = (operationsRows ?? []).find((candidate) => candidate.id === id)
      return row ? [row] : []
    })
    const confirmed = await confirm({
      title: 'Recalcular taxas locais',
      message: `Recalcular o cálculo de ${eligible.length} B/L(s) selecionado(s)?`,
      confirmLabel: 'Recalcular',
      affected: {
        summary: `${eligible.length} B/L(s) serão recalculados${invoiced.size ? ` · ${invoiced.size} faturado(s) serão ignorados` : ''}`,
        items: eligibleRows.map((row) => `B/L ${row.id} · ${row.customer?.name ?? 'sem cliente'} · total atual ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.totals.total_brl)}`),
        ...(invoiced.size ? { blocked: [...invoiced].map((id) => ({ label: `B/L ${id}`, reasons: ['já faturado; não será recalculado'] })) } : {}),
      },
      consequence: 'Atualiza as linhas e o total calculado da Taxa Local e registra o resultado da operação. O valor recalculado é definido pela tabela e pelas regras atuais do B/L; este diálogo mostra o valor vigente, não antecipa o novo cálculo.',
      reversibility: 'O cálculo pode ser executado novamente enquanto o B/L não estiver faturado. B/Ls já faturados permanecem bloqueados.',
    })
    if (!confirmed) return
    try {
      const result = await batchCalculateMutation.mutateAsync({ blIds: eligible, actorId: userId, recalculate: action === 'recalculate' })
      const firstError = result.errors[0]?.message ? `: ${result.errors[0].message}` : ''
      const tone: 'success' | 'error' | 'info' = result.errorCount === 0 ? 'success' : result.successCount === 0 ? 'error' : 'info'
      showToast(`${result.successCount} B/L(s) recalculado(s).${result.errorCount ? ` ${result.errorCount} falharam${firstError}.` : ''}`, tone)
      if (invoiced.size) showToast(`${invoiced.size} ignorado(s) (já faturados).`, 'info')
      setSelectedOpsRows([])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao recalcular B/L(s).', 'error')
    }
  }

  // Uma planilha só (decisão de 2026-10-14): uma linha por B/L, uma coluna por
  // taxa; respeita a seleção e, sem seleção, o filtro.
  async function handleExport() {
    const scope = selectedOpsRows.length ? displayedRows.filter((row) => selectedRows.has(row.id)) : displayedRows
    if (!scope.length) return showToast('Não há B/Ls para exportar com o filtro ou a seleção atual.', 'info')
    setExportingOps(true)
    try {
      const { fetchChargeTotalsByBl } = await import('../../services/charges/chargeOperationsService')
      const { exportValidacaoWorkbook } = await import('../../services/exports')
      const totals = await fetchChargeTotalsByBl(scope.map((row) => row.id))
      await exportValidacaoWorkbook(scope.map((row) => ({ row, block: getBillingBlock(row) })), totals)
      showToast(`Exportação concluída com ${scope.length} B/L(s).`, 'success')
    } catch {
      showToast('Falha ao exportar a Validação.', 'error')
    } finally {
      setExportingOps(false)
    }
  }
  async function handleIssueSingleInvoice(row: LocalChargeOperationalRow) {
    if (!row.customer?.id) return showToast('Nao ha cliente vinculado para emitir esta fatura.', 'error')
    const confirmed = await confirm({
      title: 'Emitir fatura individual',
      message: `Emitir uma fatura individual para o B/L ${row.id}?`,
      confirmLabel: 'Emitir fatura',
      affected: {
        summary: `B/L ${row.id} · ${row.customer.name ?? 'cliente sem nome'} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.totals.total_brl)}`,
        items: [`${row.voyage?.vessel?.name ?? 'Navio não informado'} / ${row.voyage?.voyage_number ?? 'viagem não informada'}`, `${row.totals.line_count} linha(s) de cobrança`, ...(row.totals.total_usd ? [`Total em USD: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.totals.total_usd)}`] : [])],
      },
      consequence: 'Cria e emite a invoice, vincula o B/L e atualiza o recebível do ledger. O B/L passa ao estado faturado e deixa de aceitar recálculo.',
      reversibility: 'A invoice não pode ser apagada. Sem pagamentos, o cancelamento é restrito ao perfil Administrativo; pagamentos seguem o fluxo próprio de estorno.',
    })
    if (!confirmed) return
    // "Pronto para emitir" inclui B/L calculado ou revisado: a RPC marca pronto e emite numa transação, como a ficha do B/L.
    try { await markBlReadyAndCreateInvoice({ blId: row.id, customerId: row.customer.id, actorId: userId }); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }), queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }), queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }), queryClient.invalidateQueries({ queryKey: queryKeys.bls.summary() })]); showToast(`Fatura emitida para ${row.id}.`, 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao emitir fatura individual.', 'error') }
  }
  async function handleRecalculateRow(row: LocalChargeOperationalRow) { await runBatchOperation('recalculate', [row.id]) }

  // Mesma consulta dos avisos acima das abas (cache compartilhado): o Alerta
  // aberto do B/L dá a data do fato que explica o motivo.
  const financialAlertsQuery = useQuery({ queryKey: queryKeys.alerts.financial(), queryFn: listFinancialAlerts, staleTime: 60_000 })
  const reasonEvents = useMemo(() => {
    const map = new Map<string, ReasonEvent>()
    for (const alert of financialAlertsQuery.data ?? []) {
      const type = getEffectiveAlertType(alert)
      if (alert.entity_type !== 'bl' || !alert.entity_id || !alert.created_at) continue
      const kind = type === 'billing_auto_issue_failed' ? 'auto_issue_failed' : type === 'billing_calculation_blocked' ? 'calculation_blocked' : null
      if (!kind) continue
      const current = map.get(alert.entity_id)
      // A falha de emissão explica mais que o bloqueio de cálculo; entre iguais, a mais antiga.
      if (!current || (kind === 'auto_issue_failed' && current.kind !== kind) || (kind === current.kind && alert.created_at < current.at)) {
        map.set(alert.entity_id, { kind, at: alert.created_at })
      }
    }
    return map
  }, [financialAlertsQuery.data])

  const exportCount = selectedOpsRows.length || displayedRows.length
  return (
    <Block
      title="Validação"
      headingLevel={2}
      flush
      aside={(
        <>
          <span aria-live="polite">{operationsLoading ? 'Carregando…' : `${displayedRows.length} B/L${displayedRows.length === 1 ? '' : 's'} ${opsFilters.includeResolved ? 'no recorte' : 'aguardando emissão'}${selectedOpsRows.length ? ` · ${selectedOpsRows.length} selecionado${selectedOpsRows.length === 1 ? '' : 's'}` : ''}`}</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void runBatchOperation('recalculate')} loading={batchCalculateMutation.isPending} disabled={!selectedOpsRows.length}>
            <RefreshCw size={14} aria-hidden="true" />Recalcular selecionados
          </Button>
          <Button variant="secondary" className="app-btn--sm" loading={exportingOps} loadingLabel="Exportando…" disabled={!exportCount} onClick={() => void handleExport()}>
            <Download size={14} aria-hidden="true" />Exportar {exportCount} B/L{exportCount === 1 ? '' : 's'}
          </Button>
        </>
      )}
    >
      <div className="app-block__body">
        <ValidacaoControls filters={opsFilters} truncated={Boolean(operationsResult?.truncated)} onUpdateFilter={updateOpsFilter} />
      </div>
      <ValidacaoOperationsTable rows={displayedRows} isLoading={operationsLoading} hasError={Boolean(operationsError)} selectedRowIds={selectedOpsRows} areAllRowsSelected={areAllOpsRowsSelected} expandedBlId={expandedBlId} reconciliationQueue={reconciliationQueue ?? []} reasonEvents={reasonEvents} onToggleAllRows={toggleAllOpsRows} onToggleRow={toggleOpsRow} onToggleExpandedRow={(id) => setExpandedBlId((current) => current === id ? null : id)} onIssueSingleInvoice={(row) => void handleIssueSingleInvoice(row)} onRecalculateRow={(row) => void handleRecalculateRow(row)} />
    </Block>
  )
}
