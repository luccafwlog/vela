import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { ManualChargeFormFields } from '../billing/ManualChargeFormFields'
import { useAuth } from '../../hooks/useAuth'
import {
  useAddManualBlCharge,
  useBlLocalChargeLines,
  useCalculateBlLocalCharges,
  useDeleteManualBlCharge,
  useManualChargeItemsForBl,
  useMarkBlChargesReviewed,
  useMarkBlReadyForBilling,
  useUpdateManualBlCharge,
} from '../../hooks/useLocalCharges'
import { formatBRL, formatUSD, normalizeText } from '../../lib/utils'
import { FINANCIAL_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import { classifyDbError } from '../../lib/errors'
import { markBlReadyAndCreateInvoice, type InvoiceLinkInfo } from '../../services/billing'
import {
  formatNumber,
  resolveChargeLineStatusLabel,
  resolveChargeLineStatusTone,
  resolveChargeStatusLabel,
  resolveChargeStatusTone,
} from '../../pages/blDetalheHelpers'
import type { BLDetail } from '../../types/database'

type ManualChargeForm = {
  chargeItemId: string
  quantity: string
  notes: string
  editingChargeCalculationId: number | null
}

const EMPTY_MANUAL_CHARGE_FORM: ManualChargeForm = {
  chargeItemId: '',
  quantity: '1',
  notes: '',
  editingChargeCalculationId: null,
}

// Taxas Locais do B/L: linhas calculadas, cobranças manuais e fluxo de revisão/faturamento.
export function BlCobrancasSection({ bl, activeInvoice = null }: { bl: BLDetail; activeInvoice?: InvoiceLinkInfo | null }) {
  const queryClient = useQueryClient()
  const { user, isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: localChargeLines, isLoading: isLocalChargeLinesLoading } = useBlLocalChargeLines(bl.id)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(bl.id)
  const addManualChargeMutation = useAddManualBlCharge(bl.id)
  const updateManualChargeMutation = useUpdateManualBlCharge(bl.id)
  const deleteManualChargeMutation = useDeleteManualBlCharge(bl.id)
  const markReviewedMutation = useMarkBlChargesReviewed(bl.id)
  const markReadyForBillingMutation = useMarkBlReadyForBilling(bl.id)
  const calculateChargesMutation = useCalculateBlLocalCharges(bl.id)
  const [manualChargeForm, setManualChargeForm] = useState<ManualChargeForm>(EMPTY_MANUAL_CHARGE_FORM)
  const [manualFormOpen, setManualFormOpen] = useState(false)

  const localChargeSummary = useMemo(() => {
    const lines = localChargeLines ?? []
    const totalBrl = lines.reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0)
    const totalUsd = lines.reduce((sum, line) => sum + Number(line.total_value_usd ?? 0), 0)
    const hasReviewRequired = lines.some((line) => line.status === 'review_required')
    return {
      lines,
      totalBrl,
      totalUsd,
      hasReviewRequired,
    }
  }, [localChargeLines])

  // Apos o B/L ser faturado, as taxas viram fonte da fatura emitida — nao podem mais
  // ser editadas aqui (o RPC tambem bloqueia; a UI apenas evita a tentativa).
  const chargesLocked = isBlFinanciallyLocked(bl.financial_status)

  async function handleSaveManualCharge() {
    if (!bl || !user) return

    const chargeItemId = Number(manualChargeForm.chargeItemId)
    const quantity = Number(String(manualChargeForm.quantity).replace(',', '.'))

    if (!Number.isInteger(chargeItemId) || chargeItemId <= 0) {
      showToast('Selecione um item de Other Charge.', 'error')
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast('Quantidade inválida para a linha manual.', 'error')
      return
    }

    const item = manualChargeItems?.find((i) => i.charge_item_id === chargeItemId)
    const itemName = item?.charge_item_name ?? `Item #${chargeItemId}`

    if (manualChargeForm.editingChargeCalculationId) {
      const line = localChargeSummary.lines.find((entry) => entry.id === manualChargeForm.editingChargeCalculationId)
      const changes = [
        { field: 'Quantidade', before: String(Number(line?.quantity ?? 1)), after: String(quantity) },
        { field: 'Observações', before: line?.notes ?? '', after: manualChargeForm.notes.trim() },
      ].filter((c) => c.before !== c.after)

      if (changes.length === 0) {
        showToast('Nenhuma alteração para salvar.', 'info')
        return
      }

      const confirmed = await confirm({
        title: 'Salvar taxa manual',
        message: `Salvar alterações na cobrança manual "${itemName}" deste B/L?`,
        confirmLabel: 'Salvar alterações',
        changes,
        consequence: 'O valor da cobrança manual será recalculado e refletido no total de taxas locais deste B/L.',
        reversibility: 'A linha manual pode ser editada ou excluída enquanto o faturamento não for fechado.',
      })
      if (!confirmed) return
    } else {
      const confirmed = await confirm({
        title: 'Adicionar taxa manual',
        message: `Adicionar cobrança manual de "${itemName}" a este B/L?`,
        confirmLabel: 'Adicionar cobrança',
        affected: {
          summary: `${itemName} · Quantidade: ${quantity}${manualChargeForm.notes.trim() ? ` · Obs: ${manualChargeForm.notes.trim()}` : ''}`,
        },
        consequence: 'A taxa manual será somada às taxas locais do B/L.',
        reversibility: 'A cobrança manual pode ser editada ou excluída antes da emissão de fatura.',
      })
      if (!confirmed) return
    }

    try {
      if (manualChargeForm.editingChargeCalculationId) {
        await updateManualChargeMutation.mutateAsync({
          chargeCalculationId: manualChargeForm.editingChargeCalculationId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user.id,
        })
        showToast('Linha manual atualizada.', 'success')
      } else {
        await addManualChargeMutation.mutateAsync({
          chargeItemId,
          quantity,
          notes: manualChargeForm.notes || null,
          actorId: user.id,
        })
        showToast('Other Charge adicionado com sucesso.', 'success')
      }

      setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
      setManualFormOpen(false)
    } catch {
      showToast('Falha ao salvar linha manual de taxa.', 'error')
    }
  }

  function handleEditManualCharge(lineId: number) {
    const line = localChargeSummary.lines.find((entry) => entry.id === lineId && entry.source === 'manual')
    if (!line) return

    setManualChargeForm({
      chargeItemId: String(line.charge_item_id ?? ''),
      quantity: String(Number(line.quantity ?? 1)),
      notes: line.notes ?? '',
      editingChargeCalculationId: line.id,
    })
  }

  function handleCancelManualChargeEdit() {
    setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
  }

  async function handleDeleteManualCharge(lineId: number) {
    if (!user) return
    if (!(await confirm({ title: 'Excluir taxa manual', message: 'Excluir esta taxa manual do B/L?', consequence: 'A taxa sai das cobranças do B/L e do próximo faturamento.', reversibility: 'Lance a taxa de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' }))) return

    try {
      await deleteManualChargeMutation.mutateAsync({
        chargeCalculationId: lineId,
        actorId: user.id,
      })
      showToast('Linha manual removida.', 'success')
      if (manualChargeForm.editingChargeCalculationId === lineId) {
        setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
      }
    } catch {
      showToast('Falha ao excluir linha manual.', 'error')
    }
  }

  async function handleCalculateCharges() {
    if (!user) return
    try {
      await calculateChargesMutation.mutateAsync({ actorId: user.id })
      showToast('Taxas locais calculadas.', 'success')
    } catch {
      showToast('Falha ao calcular as taxas locais deste B/L.', 'error')
    }
  }

  async function handleMarkChargesReviewed() {
    if (!user) return
    try {
      await markReviewedMutation.mutateAsync({ actorId: user.id })
      showToast('Taxas marcadas como revisadas.', 'success')
    } catch {
      showToast('Falha ao marcar taxas como revisadas.', 'error')
    }
  }

  async function handleMarkReadyForBilling() {
    if (!user || !bl) return
    try {
      if (bl.customer_id) {
        await markBlReadyAndCreateInvoice({ blId: bl.id, customerId: bl.customer_id, actorId: user.id })
        await queryClient.invalidateQueries({ queryKey: ['invoices'] })
        await queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] })
        await queryClient.invalidateQueries({ queryKey: ['bls'] })
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        await queryClient.invalidateQueries({ queryKey: ['op-count'] })
        showToast('B/L pronto para faturar. Fatura emitida automaticamente.', 'success')
      } else {
        await markReadyForBillingMutation.mutateAsync({ actorId: user.id })
        showToast('B/L marcado como pronto para faturar. Sem cliente vinculado — gere a fatura manualmente em Faturamento.', 'success')
      }
    } catch (error) {
      const classified = classifyDbError(error)
      const message = classified.message
      const normalizedMessage = normalizeText(message)
      if (normalizedMessage.includes('pendencia de revisao')) {
        showToast('Ainda existem linhas com pendência de revisão.', 'error')
        return
      }
      if (normalizedMessage.includes('nao possui cliente vinculado') || normalizedMessage.includes('p0003')) {
        showToast('B/L sem cliente vinculado. Vincule o cliente na Visão Geral antes de faturar.', 'error')
        return
      }
      if (normalizedMessage.includes('faturamento bloqueado pelo portal')) {
        showToast(message, 'error')
        return
      }
      showToast(
        message
          ? `Falha ao marcar B/L como pronto para faturar: ${message}`
          : 'Falha ao marcar B/L como pronto para faturar.',
        'error',
      )
    }
  }

  const invoiceDiverges = Boolean(
    activeInvoice?.status === 'issued'
    && activeInvoice.total_brl != null
    && Math.abs(localChargeSummary.lines.filter((line) => line.status !== 'exempt').reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0) - activeInvoice.total_brl) > 0.01,
  )
  const hasManualLines = localChargeSummary.lines.some((line) => line.source === 'manual')
  const showActionsColumn = !chargesLocked && hasManualLines
  const reviewPendingCount = localChargeSummary.lines.filter((line) => line.status === 'review_required').length
  const busy = markReviewedMutation.isPending || markReadyForBillingMutation.isPending
  const columnCount = showActionsColumn ? 8 : 7

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">Taxas Locais</h2>
            {chargesLocked
              ? <Badge tone="green">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status ?? 'invoiced')}</Badge>
              : <Badge tone={resolveChargeStatusTone(bl.charge_status)}>{resolveChargeStatusLabel(bl.charge_status)}</Badge>}
            {bl.charge_exemption_reason ? <Badge tone="slate">{bl.charge_exemption_reason}</Badge> : null}
          </div>
          {activeInvoice ? (
            <Link className="text-sm font-semibold text-[var(--app-link)] hover:underline" to={`/taxas-locais?invoice=${activeInvoice.id}`}>
              Fatura ativa: {activeInvoice.invoice_number ?? `INV-${activeInvoice.id}`}
            </Link>
          ) : null}
        </div>
        {!chargesLocked ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleMarkChargesReviewed} loading={markReviewedMutation.isPending} disabled={busy} type="button">
              Marcar revisado
            </Button>
            <Button onClick={handleMarkReadyForBilling} loading={markReadyForBillingMutation.isPending} disabled={busy} type="button">
              Pronto para faturar
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total BRL" value={formatBRL(localChargeSummary.totalBrl)} />
        <Stat label="Total USD" value={formatUSD(localChargeSummary.totalUsd)} />
        <Stat label="Linhas" value={String(localChargeSummary.lines.length)} />
        <Stat label="Pendências de revisão" value={String(reviewPendingCount)} warn={reviewPendingCount > 0} />
      </dl>

      {bl.charge_status === 'not_calculated' ? (
        <Notice tone="warn">
          <span>As taxas deste B/L ainda não foram calculadas.</span>
          <Button variant="secondary" onClick={handleCalculateCharges} loading={calculateChargesMutation.isPending} type="button">
            Calcular taxas
          </Button>
        </Notice>
      ) : null}
      {invoiceDiverges ? (
        <Notice tone="warn">As taxas mudaram depois da emissão: o total atual difere da fatura ativa.</Notice>
      ) : null}
      {chargesLocked ? (
        <Notice>Este B/L já foi faturado. As taxas estão bloqueadas para edição; para alterar, cancele a fatura em Faturamento.</Notice>
      ) : null}

      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[860px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col">Taxa</th>
              <th scope="col">Origem</th>
              <th scope="col">Status</th>
              <th scope="col" className="text-right">Qtd.</th>
              <th scope="col" className="text-right">Unitário</th>
              <th scope="col" className="text-right">Total</th>
              <th scope="col">Observação</th>
              {showActionsColumn ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {isLocalChargeLinesLoading ? (
              <tr>
                <td className="text-[var(--app-muted)]" colSpan={columnCount}>Carregando taxas…</td>
              </tr>
            ) : localChargeSummary.lines.length ? (
              localChargeSummary.lines.map((line) => (
                <tr key={line.id}>
                  <td className="font-semibold text-[var(--app-text-strong)]">{line.charge_name}</td>
                  <td>{line.source === 'manual' ? 'Manual' : 'Automática'}</td>
                  <td>
                    <Badge tone={resolveChargeLineStatusTone(line.status)}>{resolveChargeLineStatusLabel(line.status)}</Badge>
                  </td>
                  <td className="text-right tabular-nums">{formatNumber(line.quantity)}</td>
                  <td className="text-right tabular-nums">
                    {line.currency === 'USD' ? formatUSD(line.unit_value_usd ?? 0) : formatBRL(line.unit_value_brl ?? 0)}
                  </td>
                  <td className="text-right font-medium tabular-nums">
                    {line.currency === 'USD' ? formatUSD(line.total_value_usd ?? 0) : formatBRL(line.total_value_brl ?? 0)}
                  </td>
                  <td className="text-[var(--app-muted)]">{line.review_reason ?? line.notes ?? '—'}</td>
                  {showActionsColumn ? (
                    <td>
                      {line.source === 'manual' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="app-table__icon-button"
                            type="button"
                            onClick={() => handleEditManualCharge(line.id)}
                            title="Editar cobrança manual"
                            aria-label="Editar cobrança manual"
                          >
                            <Pencil size={13} />
                          </button>
                          {isAdmin ? (
                            // Excluir taxa manual é do Administrativo (migration 088; ADR 0071).
                            <button
                              className="app-table__icon-button app-table__icon-button--danger"
                              type="button"
                              onClick={() => handleDeleteManualCharge(line.id)}
                              title="Excluir cobrança manual"
                              aria-label="Excluir cobrança manual"
                              disabled={deleteManualChargeMutation.isPending}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <td className="text-[var(--app-muted)]" colSpan={columnCount}>Nenhuma taxa calculada para este B/L.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {chargesLocked ? null : manualFormOpen || manualChargeForm.editingChargeCalculationId ? (
        <div className="mt-4">
          <ManualChargeFormFields
            form={manualChargeForm}
            items={manualChargeItems ?? []}
            itemsLoading={isManualChargeItemsLoading}
            saving={addManualChargeMutation.isPending || updateManualChargeMutation.isPending}
            deleting={deleteManualChargeMutation.isPending}
            onPatch={(patch) => setManualChargeForm((current) => ({ ...current, ...patch }))}
            onSave={handleSaveManualCharge}
            onCancel={() => { handleCancelManualChargeEdit(); setManualFormOpen(false) }}
          />
        </div>
      ) : (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setManualFormOpen(true)}>
            <Plus size={15} />
            Adicionar cobrança manual
          </Button>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] px-3 py-2">
      <dt className="text-xs text-[var(--app-muted)]">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${warn ? 'text-amber-500' : 'text-[var(--app-text-strong)]'}`}>{value}</dd>
    </div>
  )
}

function Notice({ tone, children }: { tone?: 'warn'; children: ReactNode }) {
  return (
    <div
      className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tone === 'warn'
        ? 'border-amber-400/40 bg-amber-400/10 text-[var(--app-text)]'
        : 'border-[var(--app-border)] bg-[var(--app-surface-muted)] text-[var(--app-muted)]'}`}
    >
      {children}
    </div>
  )
}
