import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePendingCodAdjustments, useSettleCodAdjustment } from '../../hooks/useBillingLedger'
import { queryKeys } from '../../services/queryKeys'
import { formatBRL } from '../../lib/utils'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { useToast } from '../ui/Toast'

function actionLabel(action: string): string {
  if (action === 'offset_open_balance') return 'Abater saldo aberto'
  if (action === 'refund_overpayment') return 'Restituição por excedente'
  if (action === 'complementary_invoice') return 'Fatura complementar'
  if (action === 'cancel_and_reissue') return 'Cancelar e reemitir'
  return 'Revisão manual de cobrança'
}

export function CodAdjustmentsPanel() {
  const { can } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const adjustmentsQuery = usePendingCodAdjustments()
  const settleMutation = useSettleCodAdjustment()
  const canSettle = typeof can === 'function' ? can('settle_financial_adjustments') : false
  const rows = adjustmentsQuery.data ?? []
  const [documentIds, setDocumentIds] = useState<Record<number, string>>({})

  if (adjustmentsQuery.isSuccess && rows.length === 0) return null

  async function settle(id: number) {
    try {
      const row = rows.find((candidate) => candidate.id === id)
      const isManualDocument = row?.action === 'complementary_invoice' || row?.action === 'cancel_and_reissue' || row?.action === 'manual_charge_review'
      const documentId = isManualDocument ? Number(documentIds[id]) : null
      if (isManualDocument && (documentId == null || !Number.isInteger(documentId) || documentId <= 0)) {
        showToast('Informe o ID da invoice emitida para concluir este ajuste.', 'error')
        return
      }
      await settleMutation.mutateAsync(isManualDocument
        ? { adjustmentId: id, resultingDocumentId: documentId, resultingDocumentType: 'invoice' }
        : id)
      showToast('Ajuste de COD liquidado. A restituição, quando aplicável, permanece pendente para baixa.', 'success')
      await queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao liquidar ajuste de COD.', 'error')
    }
  }

  return (
    <Card className="mb-5 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#30363d] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Ajustes de COD</h2>
          <p className="mt-1 text-xs text-slate-400">Pendências financeiras originadas por mudança de POD.</p>
        </div>
        <Badge tone={rows.length ? 'yellow' : 'green'}>{rows.length} pendente(s)</Badge>
      </div>

      {adjustmentsQuery.isLoading ? <p className="px-4 py-5 text-sm text-slate-400">Carregando pendências de COD...</p> : null}
      {adjustmentsQuery.error ? <InlineError message="Falha ao carregar ajustes de COD." /> : null}
      {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-slate-400">Nenhuma pendência de ajuste de COD.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3">B/L</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Anterior</th>
                <th className="px-4 py-3">Destino</th>
                <th className="px-4 py-3">Diferença</th>
                <th className="px-4 py-3">Operação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isManualDocument = row.action === 'complementary_invoice' || row.action === 'cancel_and_reissue' || row.action === 'manual_charge_review'
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold text-[var(--app-blue-btn)]">
                      <Link
                        className="hover:underline"
                        to={`/bls/${encodeURIComponent(row.bl_id)}`}
                      >
                        {row.bl_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={isManualDocument ? 'slate' : 'yellow'}>{actionLabel(row.action)}</Badge>
                      {row.manual_review_required ? <div className="mt-1 text-xs text-slate-400">Revisão manual obrigatória</div> : null}
                    </td>
                    <td className="px-4 py-3">{formatBRL(row.original_value_brl)}</td>
                    <td className="px-4 py-3">{formatBRL(row.new_destination_value_brl)}</td>
                    <td className={`px-4 py-3 ${row.difference_brl < 0 ? 'text-emerald-300' : 'text-amber-200'}`}>{formatBRL(row.difference_brl)}</td>
                    <td className="px-4 py-3">
                      {isManualDocument ? (
                        <div className="flex max-w-[390px] flex-wrap items-center gap-2 text-xs text-slate-400">
                          <AlertTriangle size={15} className="shrink-0 text-amber-300" />
                          <span>Ação manual pendente.</span>
                          <Link className="text-[var(--app-blue-btn)] hover:underline" to={`/taxas-locais?tab=invoices&bl=${encodeURIComponent(row.bl_id)}`}>Abrir faturas</Link>
                          <input
                            aria-label={`ID da invoice do ajuste ${row.id}`}
                            className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200"
                            inputMode="numeric"
                            min="1"
                            onChange={(event) => setDocumentIds((current) => ({ ...current, [row.id]: event.target.value }))}
                            placeholder="ID invoice"
                            type="number"
                            value={documentIds[row.id] ?? ''}
                          />
                          <Button
                            variant="secondary"
                            type="button"
                            disabled={!canSettle}
                            loading={settleMutation.isPending && settleMutation.variables === row.id}
                            title={!canSettle ? 'Somente Financeiro, Administrativo ou Admin pode liquidar.' : undefined}
                            onClick={() => void settle(row.id)}
                          >
                            Vincular e concluir
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          type="button"
                          disabled={!canSettle}
                          loading={settleMutation.isPending && settleMutation.variables === row.id}
                          title={!canSettle ? 'Somente Financeiro, Administrativo ou Admin pode liquidar.' : undefined}
                          onClick={() => void settle(row.id)}
                        >
                          {row.action === 'refund_overpayment' ? 'Registrar restituição' : 'Aplicar abatimento'}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  )
}
