import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCheck, FileText, Receipt } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePendingCodAdjustments, useSettleCodAdjustment } from '../../hooks/useBillingLedger'
import { queryKeys } from '../../services/queryKeys'
import { formatBRL } from '../../lib/utils'
import { Badge } from '../ui/Badge'
import { RowActionButton } from '../ui/RowActionButton'
import { RowActionLink } from '../ui/RowActionLink'
import { Card, InlineError } from '../ui/Card'
import { CopyValue } from '../ui/CopyValue'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'

function actionLabel(action: string): string {
  if (action === 'offset_open_balance') return 'Abater saldo aberto'
  if (action === 'refund_overpayment') return 'Restituição por excedente'
  if (action === 'complementary_invoice') return 'Fatura complementar'
  if (action === 'cancel_and_reissue') return 'Reemissão automática'
  return 'Revisão manual de cobrança'
}

export function CodAdjustmentsPanel() {
  const { can } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const adjustmentsQuery = usePendingCodAdjustments()
  const settleMutation = useSettleCodAdjustment()
  const canSettle = typeof can === 'function' ? can('settle_financial_adjustments') : false
  const rows = adjustmentsQuery.data ?? []
  const [documentIds, setDocumentIds] = useState<Record<number, string>>({})
  // `variables` é o id no ajuste automático e um objeto no vínculo manual; a linha em andamento vem daqui.
  const variables = settleMutation.variables as number | { adjustmentId: number } | undefined
  const settlingId = settleMutation.isPending ? (typeof variables === 'object' ? variables?.adjustmentId : variables) : null

  if (adjustmentsQuery.isSuccess && rows.length === 0) return null

  async function settle(id: number) {
    try {
      const row = rows.find((candidate) => candidate.id === id)
      if (!row) return
      const isManualDocument = row?.action === 'complementary_invoice' || row?.action === 'manual_charge_review'
      const documentId = isManualDocument ? Number(documentIds[id]) : null
      if (isManualDocument && (documentId == null || !Number.isInteger(documentId) || documentId <= 0)) {
        showToast('Informe o ID da invoice emitida para concluir este ajuste.', 'error')
        return
      }
      const action = actionLabel(row.action)
      const confirmed = await confirm({
        title: 'Liquidar ajuste de COD',
        message: isManualDocument
          ? `Vincular a invoice ${documentId} ao ajuste ${id} e concluir a pendência?`
          : `Aplicar “${action}” ao B/L ${row.bl_id} e concluir o ajuste ${id}?`,
        confirmLabel: 'Liquidar ajuste',
        affected: {
          summary: `B/L ${row.bl_id} · ${action} · diferença ${formatBRL(row.difference_brl)}`,
          items: [
            `Valor original: ${formatBRL(row.original_value_brl)}`,
            `Valor no destino: ${formatBRL(row.new_destination_value_brl)}`,
            `Saldo em aberto: ${formatBRL(row.outstanding_balance_brl)}`,
            `Abatimento: ${formatBRL(row.offset_amount_brl)}`,
            `Restituição a registrar: ${formatBRL(row.refund_amount_brl)}`,
            ...(isManualDocument ? [`Invoice emitida vinculada: ${documentId}`] : []),
          ],
        },
        consequence: isManualDocument
          ? 'Vincula a invoice existente ao ajuste e retira a pendência da fila; a invoice não é criada por esta ação.'
          : row.action === 'refund_overpayment'
            ? `Aplica ${formatBRL(row.offset_amount_brl)} ao saldo aberto, registra ${formatBRL(row.refund_amount_brl)} como restituição pendente e conclui o ajuste. Esta ação não transfere dinheiro.`
            : `Aplica ${formatBRL(row.offset_amount_brl)} ao saldo aberto e conclui o ajuste financeiro.`,
        reversibility: 'A liquidação não tem ação de desfazer. Se os valores ou o documento estiverem incorretos, o Financeiro precisa registrar uma correção separada, preservando a trilha de auditoria.',
      })
      if (!confirmed) return
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--app-text-strong)]">Ajustes de COD · {rows.length}</h2>
          <p className="mt-1 text-xs text-[var(--app-muted)]">Pendências financeiras originadas por mudança de POD.{!canSettle && rows.length ? ' Somente Financeiro ou Administrativo conclui os ajustes.' : ''}</p>
        </div>
      </div>

      {adjustmentsQuery.isLoading ? <p className="px-4 py-5 text-sm text-[var(--app-muted)]">Carregando pendências de COD...</p> : null}
      {adjustmentsQuery.error ? <InlineError message="Falha ao carregar ajustes de COD." /> : null}
      {!adjustmentsQuery.isLoading && !adjustmentsQuery.error && rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[var(--app-muted)]">Nenhuma pendência de ajuste de COD.</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[980px] text-sm">
            <caption className="sr-only">Pendências de ajuste COD</caption>
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
                const isManualDocument = row.action === 'complementary_invoice' || row.action === 'manual_charge_review'
                // Sem pagamento, a correção reemite a fatura e o ajuste se liquida com a
                // sucessora (ADR 0083, item 11; migration 249): não há ato no painel.
                const awaitingReissue = row.action === 'cancel_and_reissue'
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-semibold text-[var(--app-blue-btn)]">
                      <CopyValue value={row.bl_id} label="número do B/L">
                        <Link
                          className="hover:underline"
                          to={`/bls/${encodeURIComponent(row.bl_id)}`}
                        >
                          {row.bl_id}
                        </Link>
                      </CopyValue>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={isManualDocument || awaitingReissue ? 'slate' : 'yellow'}>{actionLabel(row.action)}</Badge>
                      {row.manual_review_required ? <div className="mt-1 text-xs text-[var(--app-muted)]">Revisão manual obrigatória</div> : null}
                    </td>
                    <td className="px-4 py-3">{formatBRL(row.original_value_brl)}</td>
                    <td className="px-4 py-3">{formatBRL(row.new_destination_value_brl)}</td>
                    <td className={`px-4 py-3 tabular-nums ${row.difference_brl < 0 ? 'text-[var(--app-success-fg)]' : 'text-[var(--app-warning-fg)]'}`}>{formatBRL(row.difference_brl)}</td>
                    <td className="px-4 py-3">
                      {awaitingReissue ? (
                        <div className="flex max-w-[390px] flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                          <span>A fatura é reemitida sozinha e este ajuste se liquida com ela. Se a reemissão travou, resolva o motivo e use Emitir fatura na ficha do B/L.</span>
                          <RowActionLink to={`/bls/${encodeURIComponent(row.bl_id)}`} label="Abrir B/L" icon={FileText} />
                        </div>
                      ) : isManualDocument ? (
                        <div className="flex max-w-[390px] flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                          <AlertTriangle size={15} className="shrink-0 text-[var(--app-warning-fg)]" />
                          <span>Emita a fatura (avulsa, se for complemento) e informe o número interno dela.</span>
                          <RowActionLink to={`/taxas-locais?tab=invoices&bl=${encodeURIComponent(row.bl_id)}`} label="Abrir faturas" icon={Receipt} />
                          <input
                            aria-label={`Número interno da fatura do ajuste ${row.id}`}
                            className="app-input w-28"
                            inputMode="numeric"
                            min="1"
                            onChange={(event) => setDocumentIds((current) => ({ ...current, [row.id]: event.target.value }))}
                            placeholder="Nº interno"
                            type="number"
                            value={documentIds[row.id] ?? ''}
                          />
                          <RowActionButton
                            label="Vincular e concluir"
                            icon={CheckCheck}
                            disabled={!canSettle}
                            loading={settleMutation.isPending && settlingId === row.id}
                            title={!canSettle ? 'Vincular e concluir: somente Financeiro, Administrativo ou Admin pode liquidar.' : undefined}
                            onClick={() => void settle(row.id)}
                          />
                        </div>
                      ) : (
                        <RowActionButton
                          label={row.action === 'refund_overpayment' ? 'Registrar restituição' : 'Aplicar abatimento'}
                          icon={CheckCheck}
                          disabled={!canSettle}
                          loading={settleMutation.isPending && settlingId === row.id}
                          title={!canSettle ? `${row.action === 'refund_overpayment' ? 'Registrar restituição' : 'Aplicar abatimento'}: somente Financeiro, Administrativo ou Admin pode liquidar.` : undefined}
                          onClick={() => void settle(row.id)}
                        />
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
