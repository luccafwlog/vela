import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useBatchCalculateLocalCharges, useCustomerReconciliationQueue, useLocalChargeOperations } from '../../hooks/useLocalCharges'
import { queryKeys } from '../../services/queryKeys'
import { createInvoiceFromBls } from '../../services/billing'
import { runGraniteBatch } from '../../services/graniteBillingWorkflow'
import { getBillingBlock, isBlLockedForRecalc } from './validacaoPipeline'
import { ValidacaoControls } from './ValidacaoControls'
import { ValidacaoOperationsTable } from './ValidacaoOperationsTable'
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
  const [exportingConference, setExportingConference] = useState(false)
  const { data: operationsResult, isLoading: operationsLoading, error: operationsError } = useLocalChargeOperations({ search: opsFilters.search, cargoMode: opsFilters.cargoMode, pod: opsFilters.pod, voyageId: opsFilters.voyageId ? Number(opsFilters.voyageId) : null, includeResolved: opsFilters.includeResolved, limit: 1200 })
  const operationsRows = useMemo(() => operationsResult?.rows ?? [], [operationsResult])
  const batchCalculateMutation = useBatchCalculateLocalCharges()
  const { data: reconciliationQueue } = useCustomerReconciliationQueue('pending', 50)

  const displayedRows = useMemo(() => {
    return (operationsRows ?? []).filter((row) => {
      const block = getBillingBlock(row)
      if (!opsFilters.includeResolved && (block.code === 'faturado' || block.code === 'isento' || block.code === 'pronto')) return false
      return !opsFilters.blockCode || block.code === opsFilters.blockCode
    })
  }, [operationsRows, opsFilters.blockCode, opsFilters.includeResolved])
  const selectedRows = useMemo(() => new Set(selectedOpsRows), [selectedOpsRows])
  const areAllOpsRowsSelected = displayedRows.length > 0 && displayedRows.every((row) => selectedRows.has(row.id))

  function updateOpsFilter<K extends keyof OpsFilters>(field: K, value: OpsFilters[K]) {
    setOpsFilters((current) => ({ ...current, [field]: value, ...(field === 'blockCode' && (value === 'faturado' || value === 'isento' || value === 'pronto') ? { includeResolved: true } : {}) }))
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
      const graniteIds = eligible.filter((id) => (operationsRows ?? []).find((row) => row.id === id)?.cargo_mode === 'granito')
      const localIds = eligible.filter((id) => !graniteIds.includes(id))
      const [graniteResult, localResult] = await Promise.all([
        graniteIds.length ? runGraniteBatch(graniteIds) : Promise.resolve({ total: 0, successCount: 0, errorCount: 0, errors: [] as Array<{ blId: string; message: string }> }),
        localIds.length ? batchCalculateMutation.mutateAsync({ blIds: localIds, actorId: userId, recalculate: action === 'recalculate' }) : Promise.resolve({ total: 0, successCount: 0, errorCount: 0, errors: [] as Array<{ blId: string; message: string }> }),
      ])
      const result = { total: graniteResult.total + localResult.total, successCount: graniteResult.successCount + localResult.successCount, errorCount: graniteResult.errorCount + localResult.errorCount, errors: [...graniteResult.errors, ...localResult.errors] }
      const firstError = result.errors[0]?.message ? `: ${result.errors[0].message}` : ''
      const tone: 'success' | 'error' | 'info' = result.errorCount === 0 ? 'success' : result.successCount === 0 ? 'error' : 'info'
      showToast(`${result.successCount} B/L(s) recalculado(s).${result.errorCount ? ` ${result.errorCount} falharam${firstError}.` : ''}`, tone)
      if (invoiced.size) showToast(`${invoiced.size} ignorado(s) (já faturados).`, 'info')
      setSelectedOpsRows([])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao recalcular B/L(s).', 'error')
    }
  }

  async function handleExportOperations() {
    if (!displayedRows.length) return showToast('Não há dados para exportar com os filtros atuais.', 'info')
    setExportingOps(true)
    try { const { exportLocalChargeOperationsWorkbook } = await import('../../services/exports'); await exportLocalChargeOperationsWorkbook(displayedRows); showToast(`Exportação concluída com ${displayedRows.length} B/L(s).`, 'success') } catch { showToast('Falha ao exportar operação de taxas locais.', 'error') } finally { setExportingOps(false) }
  }
  async function handleExportConference() {
    const scope = selectedOpsRows.length ? selectedOpsRows : displayedRows.map((row) => row.id)
    if (!scope.length) return showToast('Não há B/Ls para exportar com o filtro/seleção atual.', 'info')
    setExportingConference(true)
    try {
      const { buildLocalChargeConferenceRows } = await import('../../services/charges/chargeOperationsService')
      const { exportLocalChargeConferenceWorkbook } = await import('../../services/exports')
      const rows = await buildLocalChargeConferenceRows(scope)
      await exportLocalChargeConferenceWorkbook(rows, selectedOpsRows.length ? `${scope.length} B/L(s) selecionado(s)` : `${scope.length} B/L(s) filtrado(s)`)
      showToast(`Planilha de conferência exportada com ${rows.length} linha(s).`, 'success')
    } catch { showToast('Falha ao exportar planilha de conferência.', 'error') } finally { setExportingConference(false) }
  }
  async function handleIssueSingleInvoice(row: LocalChargeOperationalRow) {
    if (row.cargo_mode === 'granito') return showToast('Granito é apoio operacional; cobrança não está disponível neste fluxo.', 'info')
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
    try { await createInvoiceFromBls({ blIds: [row.id], customerId: row.customer.id, issueNow: true, actorId: userId }); await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.charges.operations() }), queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }), queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }), queryClient.invalidateQueries({ queryKey: queryKeys.bls.summary() })]); showToast(`Fatura emitida para ${row.id}.`, 'success') } catch (error) { showToast(error instanceof Error ? error.message : 'Falha ao emitir fatura individual.', 'error') }
  }
  async function handleRecalculateRow(row: LocalChargeOperationalRow) { await runBatchOperation('recalculate', [row.id]) }

  return <>
    <ValidacaoControls filters={opsFilters} blockedCount={displayedRows.length} truncated={Boolean(operationsResult?.truncated)} selectedCount={selectedOpsRows.length} operationsLoading={operationsLoading} calculatePending={batchCalculateMutation.isPending} exporting={exportingOps} exportingConference={exportingConference} onUpdateFilter={updateOpsFilter} onRunBatchOperation={(action) => void runBatchOperation(action)} onExport={() => void handleExportOperations()} onExportConference={() => void handleExportConference()} />
    <ValidacaoOperationsTable rows={displayedRows} isLoading={operationsLoading} hasError={Boolean(operationsError)} selectedRowIds={selectedOpsRows} areAllRowsSelected={areAllOpsRowsSelected} expandedBlId={expandedBlId} reconciliationQueue={reconciliationQueue ?? []} onToggleAllRows={toggleAllOpsRows} onToggleRow={toggleOpsRow} onToggleExpandedRow={(id) => setExpandedBlId((current) => current === id ? null : id)} onIssueSingleInvoice={(row) => void handleIssueSingleInvoice(row)} onRecalculateRow={(row) => void handleRecalculateRow(row)} />
  </>
}
