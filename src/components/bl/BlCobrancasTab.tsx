import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
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
  useUpdateManualBlCharge,
} from '../../hooks/useLocalCharges'
import { formatBRL, formatUSD, normalizeText } from '../../lib/utils'
import { FINANCIAL_STATUS_LABELS, statusLabel } from '../../lib/statusLabels'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import { classifyDbError } from '../../lib/errors'
import { markBlReadyAndCreateInvoice } from '../../services/billing'
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

// Aba Cobrancas: linhas de taxas locais do B/L, other charges manuais e fluxo de revisão/faturamento.
export function BlCobrancasSection({ bl }: { bl: BLDetail }) {
  const queryClient = useQueryClient()
  const { user, isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: localChargeLines, isLoading: isLocalChargeLinesLoading } = useBlLocalChargeLines(bl.id)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(bl.id)
  const addManualChargeMutation = useAddManualBlCharge(bl.id)
  const updateManualChargeMutation = useUpdateManualBlCharge(bl.id)
  const deleteManualChargeMutation = useDeleteManualBlCharge(bl.id)
  const [issuing, setIssuing] = useState(false)
  const calculateChargesMutation = useCalculateBlLocalCharges(bl.id)
  const [manualChargeForm, setManualChargeForm] = useState<ManualChargeForm>(EMPTY_MANUAL_CHARGE_FORM)

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

  // Emissão manual (ADR 0077): o caminho normal é automático (CE Mercante,
  // Portal pronto, reimportação). Este botão cobre a emissão que o automático
  // não fez ou desfez: reemissão depois de Cancelar e reemitir, Reemissão
  // pendente cuja trava foi resolvida, ou falha da emissão automática.
  const canIssue = Boolean(
    isAdmin && !chargesLocked && bl.customer_id && bl.ce_mercante
      && bl.charge_status !== 'not_calculated' && bl.charge_status !== 'exempt',
  )

  async function handleIssueInvoice() {
    if (!user || !bl.customer_id) return
    const confirmed = await confirm({
      title: 'Emitir fatura',
      message: `Emitir a fatura de Taxas Locais do B/L ${bl.id}?`,
      affected: {
        summary: `B/L ${bl.id} · ${formatBRL(localChargeSummary.totalBrl)}${localChargeSummary.totalUsd ? ` + ${formatUSD(localChargeSummary.totalUsd)} (convertido pelo ROE na emissão)` : ''}`,
        items: [`${localChargeSummary.lines.length} linha(s) de cobrança`],
      },
      consequence: 'Cria e emite a fatura, que aparece no Portal do Cliente. O B/L passa a faturado e deixa de aceitar recálculo.',
      reversibility: 'A fatura não pode ser apagada. Sem pagamento, o Administrativo pode cancelar e reemitir.',
      confirmLabel: 'Emitir fatura',
    })
    if (!confirmed) return
    setIssuing(true)
    try {
      await markBlReadyAndCreateInvoice({ blId: bl.id, customerId: bl.customer_id, actorId: user.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', bl.id] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['op-count'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-operations'] }),
      ])
      showToast('Fatura emitida.', 'success')
    } catch (error) {
      const message = classifyDbError(error).message
      const normalizedMessage = normalizeText(message)
      if (normalizedMessage.includes('pendencia de revisao')) {
        showToast('Há linhas que precisam de revisão: corrija o B/L e recalcule antes de emitir.', 'error')
        return
      }
      showToast(message ? `Falha ao emitir a fatura: ${message}` : 'Falha ao emitir a fatura.', 'error')
    } finally {
      setIssuing(false)
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Taxas Locais</h2>
          <div className="mt-1 text-sm text-slate-400">
            Motor Etapa A: cálculo automático por B/L com base em POD, modo de carga e perfil IMO/OOG.
          </div>
        </div>
        {canIssue ? (
          <Button
            onClick={handleIssueInvoice}
            loading={issuing}
            disabled={issuing || localChargeSummary.hasReviewRequired}
            title={localChargeSummary.hasReviewRequired ? 'Há linhas que precisam de revisão: corrija o B/L e recalcule.' : undefined}
            type="button"
          >
            Emitir fatura
          </Button>
        ) : null}
      </div>

      {bl.charge_status === 'not_calculated' ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <span>As taxas deste B/L ainda não foram calculadas.</span>
          <Button
            variant="secondary"
            onClick={handleCalculateCharges}
            loading={calculateChargesMutation.isPending}
            type="button"
          >
            Calcular taxas
          </Button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {chargesLocked
          ? <Badge tone="green">{statusLabel(FINANCIAL_STATUS_LABELS, bl.financial_status ?? 'invoiced')}</Badge>
          : <Badge tone={resolveChargeStatusTone(bl.charge_status)}>{resolveChargeStatusLabel(bl.charge_status)}</Badge>}
        <Badge tone="green">Subtotal BRL: {formatBRL(localChargeSummary.totalBrl)}</Badge>
        <Badge tone="blue">Subtotal USD: {formatUSD(localChargeSummary.totalUsd)}</Badge>
        {localChargeSummary.hasReviewRequired ? <Badge tone="yellow">Com pendências de revisão</Badge> : null}
        {bl.charge_exemption_reason ? <Badge tone="slate">{bl.charge_exemption_reason}</Badge> : null}
      </div>

      {chargesLocked ? (
        <div className="mb-4 rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-slate-400">
          Este B/L já foi faturado. As taxas estão bloqueadas para edição — para alterar,
          cancele a fatura correspondente em Faturamento.
        </div>
      ) : (
        <ManualChargeFormFields
          form={manualChargeForm}
          items={manualChargeItems ?? []}
          itemsLoading={isManualChargeItemsLoading}
          saving={addManualChargeMutation.isPending || updateManualChargeMutation.isPending}
          deleting={deleteManualChargeMutation.isPending}
          onPatch={(patch) => setManualChargeForm((current) => ({ ...current, ...patch }))}
          onSave={handleSaveManualCharge}
          onCancel={handleCancelManualChargeEdit}
        />
      )}

      <div className="app-table-scroll">
        <table className="app-table app-table--compact min-w-[980px] text-left text-sm">
          <thead className="bg-[#0d1117] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="py-2">Taxa</th>
              <th scope="col" className="py-2">Origem</th>
              <th scope="col" className="py-2">Status</th>
              <th scope="col" className="py-2">Qtd.</th>
              <th scope="col" className="py-2">Moeda</th>
              <th scope="col" className="py-2">Unitário</th>
              <th scope="col" className="py-2">Total</th>
              <th scope="col" className="py-2">Observacao</th>
              <th scope="col" className="py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#30363d]">
            {isLocalChargeLinesLoading ? (
              <tr>
                <td className="py-3 text-slate-400" colSpan={9}>
                  Carregando linhas de taxas...
                </td>
              </tr>
            ) : localChargeSummary.lines.length ? (
              localChargeSummary.lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2 font-semibold text-white">{line.charge_name}</td>
                  <td className="py-2">{line.source ?? '-'}</td>
                  <td className="py-2">
                    <Badge tone={resolveChargeLineStatusTone(line.status)}>{resolveChargeLineStatusLabel(line.status)}</Badge>
                  </td>
                  <td className="py-2">{formatNumber(line.quantity)}</td>
                  <td className="py-2">{line.currency ?? '-'}</td>
                  <td className="py-2">
                    {line.currency === 'USD'
                      ? formatUSD(line.unit_value_usd ?? 0)
                      : formatBRL(line.unit_value_brl ?? 0)}
                  </td>
                  <td className="py-2">
                    {line.currency === 'USD'
                      ? formatUSD(line.total_value_usd ?? 0)
                      : formatBRL(line.total_value_brl ?? 0)}
                  </td>
                  <td className="py-2">{line.review_reason ?? line.notes ?? '-'}</td>
                  <td className="py-2">
                    {line.source === 'manual' && !chargesLocked ? (
                      <div className="flex items-center gap-2">
                        <button
                          className="app-table__icon-button"
                          type="button"
                          onClick={() => handleEditManualCharge(line.id)}
                          title="Editar linha manual"
                          aria-label="Editar linha manual"
                        >
                          <Pencil size={13} />
                        </button>
                        {isAdmin ? (
                          // Excluir taxa manual e do Administrativo (migration 088; ADR 0071).
                        <button
                          className="app-table__icon-button app-table__icon-button--danger"
                          type="button"
                          onClick={() => handleDeleteManualCharge(line.id)}
                          title="Excluir linha manual"
                          aria-label="Excluir linha manual"
                          disabled={deleteManualChargeMutation.isPending}
                        >
                          <Trash2 size={13} />
                        </button>
                        ) : null}
                      </div>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-3 text-slate-400" colSpan={9}>
                  Nenhuma taxa calculada ainda para este B/L.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function BlCobrancasTab({ active, bl }: { active: boolean; bl: BLDetail }) {
  if (!active) return null
  return <BlCobrancasSection bl={bl} />
}
