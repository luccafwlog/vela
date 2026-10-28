import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, CircleDollarSign, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { RowActionButton } from '../ui/RowActionButton'
import { NoValue } from '../ui/NoValue'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { ManualChargeFormFields } from '../billing/ManualChargeFormFields'
import { useAuth } from '../../hooks/useAuth'
import { chargeTableColumns, isUsualLine } from './chargeTableColumns'
import { BlChargeValueModal } from './BlChargeValueModal'
import { BlChargeHistory } from './BlChargeHistory'
import {
  adjustmentTooltip,
  chargeLineActions,
  chargedTotalValue,
  formatChargeMoney,
  isAdjustedLine,
  isExcludedLine,
  tableTotalValue,
  tableUnitValue,
} from './blChargeAdjustmentPresentation'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'
import {
  useAddManualBlCharge,
  useBlLocalChargeLines,
  useCalculateBlLocalCharges,
  useChangeBlCharge,
  useDeleteManualBlCharge,
  useManualChargeItemsForBl,
  useUpdateManualBlCharge,
} from '../../hooks/useLocalCharges'
import { formatBRL, formatCountLabel, formatDateTime, formatUSD, normalizeText } from '../../lib/utils'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { InvoiceSituation } from '../billing/InvoiceSituation'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import { classifyDbError, userFacingErrorMessage } from '../../lib/errors'
import { invoiceTypeLabel, markBlReadyAndCreateInvoice, type InvoiceLinkInfo } from '../../services/billing'
import {
  formatNumber,
  resolveChargeLineStatusLabel,
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
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const changeChargeMutation = useChangeBlCharge(bl.id)
  const [valueModalLine, setValueModalLine] = useState<LocalChargeLine | null>(null)
  const { data: localChargeLines, isLoading: isLocalChargeLinesLoading, isError: isLocalChargeLinesError, refetch: refetchLocalChargeLines } = useBlLocalChargeLines(bl.id)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(bl.id)
  const addManualChargeMutation = useAddManualBlCharge(bl.id)
  const updateManualChargeMutation = useUpdateManualBlCharge(bl.id)
  const deleteManualChargeMutation = useDeleteManualBlCharge()
  const [issuing, setIssuing] = useState(false)
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
  // B/L cancelado é somente leitura (TAX-D09): sem cálculo, cobrança manual nem emissão.
  const cancelled = Boolean((bl as BLDetail & { cancelled_at?: string | null }).cancelled_at)
  const readOnly = chargesLocked || cancelled

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
    } catch (error) {
      showToast(`Não foi possível salvar a cobrança manual: ${userFacingErrorMessage(error)}`, 'error')
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

  // Justificativa de ao menos 10 caracteres, como no banco (migration 491).
  async function askJustification(options: Parameters<typeof confirmWithReason>[0]) {
    const reason = await confirmWithReason({ reasonLabel: 'Justificativa (interna)', ...options })
    if (reason == null) return null
    if (reason.trim().length < 10) {
      showToast('Escreva a justificativa (ao menos 10 caracteres).', 'error')
      return null
    }
    return reason.trim()
  }

  async function handleDeleteManualCharge(line: LocalChargeLine) {
    if (!user) return
    // Qualquer setor exclui a cobrança manual, com justificativa (ADR 0111,
    // supersede o item 11 da ADR 0071).
    const justification = await askJustification({
      title: 'Excluir cobrança manual',
      message: `Excluir a cobrança manual ${line.charge_name} (${formatChargeMoney(chargedTotalValue(line), line.currency)}) deste B/L?`,
      consequence: 'A cobrança sai das Taxas Locais do B/L e do próximo faturamento. A ação fica no Histórico das taxas.',
      reversibility: 'Lance a cobrança de novo se precisar.',
      tone: 'danger',
      confirmLabel: 'Excluir',
    })
    if (!justification) return

    try {
      await deleteManualChargeMutation.mutateAsync({ chargeCalculationId: line.id, justification, actorId: user.id })
      showToast('Cobrança manual excluída.', 'success')
      if (manualChargeForm.editingChargeCalculationId === line.id) {
        setManualChargeForm(EMPTY_MANUAL_CHARGE_FORM)
      }
    } catch (error) {
      showToast(`Não foi possível excluir a cobrança manual: ${userFacingErrorMessage(error)}`, 'error')
    }
  }

  async function handleChargeLineAction(line: LocalChargeLine, action: 'exclude' | 'restore' | 'reinclude') {
    if (!user || !line.calculation_key) return
    const money = (value: number) => formatChargeMoney(value, line.currency)
    const texts = {
      exclude: {
        title: 'Excluir taxa',
        message: `A taxa ${line.charge_name} (${money(chargedTotalValue(line))}) sai da cobrança deste B/L e da fatura. A linha continua na ficha, riscada.`,
        reversibility: 'Volte com Incluir taxa de novo, com justificativa.',
        confirmLabel: 'Excluir taxa',
        tone: 'danger' as const,
        success: 'Taxa excluída da cobrança.',
        failure: 'excluir a taxa',
      },
      restore: {
        title: 'Voltar ao valor da tabela',
        message: `A taxa ${line.charge_name} volta a ${money(tableUnitValue(line))} (tabela), total ${money(tableTotalValue(line))}.`,
        reversibility: 'Altere o valor de novo quando quiser, com justificativa.',
        confirmLabel: 'Voltar ao valor da tabela',
        tone: 'primary' as const,
        success: 'Taxa de volta ao valor da tabela.',
        failure: 'voltar a taxa ao valor da tabela',
      },
      reinclude: {
        title: 'Incluir taxa de novo',
        message: `A taxa ${line.charge_name} volta à cobrança pelo valor da tabela, ${money(tableTotalValue(line))}.`,
        reversibility: 'Exclua de novo quando quiser, com justificativa.',
        confirmLabel: 'Incluir taxa de novo',
        tone: 'primary' as const,
        success: 'Taxa incluída de novo.',
        failure: 'incluir a taxa de novo',
      },
    }[action]
    const justification = await askJustification({
      title: texts.title,
      message: texts.message,
      reversibility: texts.reversibility,
      confirmLabel: texts.confirmLabel,
      tone: texts.tone,
    })
    if (!justification) return
    try {
      await changeChargeMutation.mutateAsync({
        action: action === 'exclude' ? 'exclude' : 'restore', lineKey: line.calculation_key, justification, actorId: user.id,
      })
      showToast(texts.success, 'success')
    } catch (error) {
      showToast(`Não foi possível ${texts.failure}: ${userFacingErrorMessage(error)}`, 'error')
    }
  }

  async function handleCalculateCharges() {
    if (!user) return
    try {
      await calculateChargesMutation.mutateAsync({ actorId: user.id })
      showToast('Taxas locais calculadas.', 'success')
    } catch (error) {
      showToast(`Não foi possível calcular as taxas: ${userFacingErrorMessage(error)}`, 'error')
    }
  }

  // Emissão manual (ADR 0077): o caminho normal é automático (CE Mercante,
  // Portal pronto, correção do B/L). Este botão cobre a emissão que o
  // automático não fez: Reemissão pendente cuja trava foi resolvida ou falha
  // da emissão automática.
  // Qualquer Departamento emite (ADR 0085, D3; migration 246).
  const canIssue = Boolean(
    !readOnly && bl.customer_id && bl.ce_mercante
      && bl.charge_status !== 'not_calculated' && bl.charge_status !== 'exempt',
  )

  async function handleIssueInvoice() {
    if (!user || !bl.customer_id) return
    const confirmed = await confirm({
      title: 'Emitir fatura',
      message: `Emitir a fatura de Taxas Locais do B/L ${bl.id}?`,
      affected: {
        summary: `B/L ${bl.id} · ${formatBRL(localChargeSummary.totalBrl)}${localChargeSummary.totalUsd ? ` + ${formatUSD(localChargeSummary.totalUsd)} (convertido pelo câmbio fixado quando o B/L entrou)` : ''}`,
        items: [`${localChargeSummary.lines.length} linha(s) de cobrança`],
      },
      consequence: 'Cria e emite a fatura, que aparece no Portal do Cliente. O B/L passa a faturado e deixa de aceitar recálculo.',
      reversibility: 'A fatura não pode ser apagada. Se o B/L for corrigido depois, a fatura é reemitida automaticamente (sem pagamento) ou ajustada pelo saldo e restituição (com pagamento).',
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

  const invoiceDiverges = Boolean(
    localChargeLines != null
    && activeInvoice?.status === 'issued'
    && activeInvoice.total_brl != null
    && Math.abs(localChargeSummary.lines.filter((line) => line.status !== 'exempt' && line.status !== 'excluded').reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0) - activeInvoice.total_brl) > 0.01,
  )
  const lines = localChargeSummary.lines
  const { showOrigin, showSituation, showNotes, showActions: showActionsColumn } = chargeTableColumns(lines, readOnly)
  const reviewPendingCount = lines.filter((line) => line.status === 'review_required').length
  const columnCount = 4 + Number(showOrigin) + Number(showSituation) + Number(showNotes) + Number(showActionsColumn)
  const totalLabel = (
    <>
      {formatBRL(localChargeSummary.totalBrl)}
      {localChargeSummary.totalUsd ? <> + {formatUSD(localChargeSummary.totalUsd)}</> : null}
    </>
  )

  return (
    <>
    <Block
      title="Taxas Locais"
      flush
      aside={readOnly ? null : (
        <span className="flex flex-wrap items-center gap-2">
          {manualFormOpen || manualChargeForm.editingChargeCalculationId ? null : (
            <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => setManualFormOpen(true)}>
              <Plus size={15} aria-hidden="true" />
              Adicionar cobrança manual
            </Button>
          )}
          {canIssue ? (
            <Button
              className="app-btn--sm"
              onClick={handleIssueInvoice}
              loading={issuing}
              loadingLabel="Emitindo…"
              disabled={issuing || localChargeSummary.hasReviewRequired}
              aria-describedby={localChargeSummary.hasReviewRequired ? 'bl-issue-blocked' : undefined}
              type="button"
            >
              Emitir fatura
            </Button>
          ) : null}
        </span>
      )}
    >
      <div className="app-block__body">
        {chargesLocked && activeInvoice?.total_brl != null ? (
          <LeadValue detail="valor da fatura">{formatBRL(activeInvoice.total_brl)}</LeadValue>
        ) : (
          <LeadValue
            detail={(
              <>
                {formatCountLabel(lines.length, 'cobrança', 'cobranças')}
                {readOnly ? null : ' · valores provisórios até a emissão'}
                {reviewPendingCount ? <> · <StatusText tone="warning"><span id="bl-issue-blocked">{formatCountLabel(reviewPendingCount, 'linha em revisão', 'linhas em revisão')}: corrija e recalcule antes de emitir</span></StatusText></> : null}
              </>
            )}
          >
            {totalLabel}
          </LeadValue>
        )}
        <FactList columns={4}>
          <Fact label="Fatura">
            {activeInvoice ? (
              <>
                <Link className="app-link" to={`/taxas-locais?invoice=${activeInvoice.id}`}>{activeInvoice.invoice_number ?? `#${activeInvoice.id}`}</Link>
                {activeInvoice.invoice_type === 'consolidated' ? <ConsolidatedMark /> : null}
                {activeInvoice.invoice_type && activeInvoice.invoice_type !== 'consolidated' ? ` · ${invoiceTypeLabel(activeInvoice.invoice_type)}` : ''}
              </>
            ) : 'Não emitida'}
          </Fact>
          {activeInvoice ? (
            <Fact label="Situação"><InvoiceSituation status={activeInvoice.status} /></Fact>
          ) : bl.charges_calculated_at ? (
            <Fact label="Cálculo">{formatDateTime(bl.charges_calculated_at)}</Fact>
          ) : null}
          {bl.charge_exemption_reason ? <Fact label="Isenção">{bl.charge_exemption_reason}</Fact> : null}
          {bl.charge_status === 'exempt' && !bl.charge_exemption_reason ? <Fact label="Situação"><StatusText tone="muted">Isento</StatusText></Fact> : null}
        </FactList>
        {bl.charge_status === 'not_calculated' && !cancelled ? (
          <Notice tone="warn">
            <span>As taxas deste B/L ainda não foram calculadas.</span>
            <Button variant="secondary" onClick={handleCalculateCharges} loading={calculateChargesMutation.isPending} loadingLabel="Calculando…" type="button">
              Calcular taxas
            </Button>
          </Notice>
        ) : null}
        {invoiceDiverges ? (
          <Notice tone="warn">As taxas mudaram depois da emissão: o total atual difere da fatura ativa. A reemissão ou o ajuste é tratado no Faturamento.</Notice>
        ) : null}
        {cancelled && !chargesLocked ? (
          <p className="app-facts__detail">B/L cancelado: as taxas ficam só para consulta.</p>
        ) : null}
        {chargesLocked ? (
          <p className="app-facts__detail">Faturado: as taxas são a base da fatura e não se editam aqui. Correções no B/L reemitem ou ajustam a fatura automaticamente.</p>
        ) : null}
      </div>

      <div className="app-table-scroll">
        <table className="app-table app-table--compact">
          <caption className="sr-only">Cobranças de Taxas Locais do B/L</caption>
          <thead>
            <tr>
              <th scope="col" className="app-table__text-head">Taxa</th>
              {showOrigin ? <th scope="col">Origem</th> : null}
              {showSituation ? <th scope="col">Situação</th> : null}
              <th scope="col">Qtd.</th>
              <th scope="col">Unitário</th>
              <th scope="col">Total</th>
              {showNotes ? <th scope="col" className="app-table__text-head">Observação</th> : null}
              {showActionsColumn ? <th scope="col"><span className="sr-only">Ações</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {isLocalChargeLinesLoading ? (
              <tr>
                <td className="text-[var(--app-muted)]" colSpan={columnCount}>Carregando taxas…</td>
              </tr>
            ) : isLocalChargeLinesError ? (
              <tr>
                <td colSpan={columnCount}>
                  <span role="alert">Não foi possível carregar as taxas deste B/L.</span>{' '}
                  <Button variant="secondary" className="app-btn--sm" onClick={() => void refetchLocalChargeLines()}>Tentar novamente</Button>
                </td>
              </tr>
            ) : lines.length ? (
              lines.map((line) => (
                <tr key={line.id} className={isExcludedLine(line) ? 'text-[var(--app-muted)]' : undefined}>
                  <td className="app-table__text" title={line.adjustment_id != null ? adjustmentTooltip(line) : line.charge_name ?? undefined}>
                    <span className={isExcludedLine(line) ? 'line-through' : undefined}>{line.charge_name}</span>
                    {isAdjustedLine(line) ? <> <StatusText tone="warning">Alterada</StatusText></> : null}
                    {isExcludedLine(line) ? <> <StatusText tone="muted">Excluída</StatusText></> : null}
                  </td>
                  {showOrigin ? <td>{line.source === 'manual' ? 'Manual' : <NoValue label="Automática" />}</td> : null}
                  {showSituation ? (
                    <td className="whitespace-nowrap">
                      {line.status === 'review_required' ? <StatusText tone="warning">Em revisão</StatusText>
                        : line.status === 'exempt' ? <StatusText tone="muted">Isenta</StatusText>
                        : isExcludedLine(line) ? <StatusText tone="muted">Excluída</StatusText>
                        : isUsualLine(line.status) ? <NoValue label={resolveChargeLineStatusLabel(line.status)} />
                        : resolveChargeLineStatusLabel(line.status)}
                    </td>
                  ) : null}
                  <td className="tabular-nums">{formatNumber(line.quantity)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {line.currency === 'USD' ? formatUSD(line.unit_value_usd ?? 0) : formatBRL(line.unit_value_brl ?? 0)}
                  </td>
                  <td className={`whitespace-nowrap tabular-nums ${isExcludedLine(line) ? 'line-through' : ''}`}>
                    {/* A linha excluída mostra o valor que teria (o da tabela) e não entra no Total. */}
                    {isExcludedLine(line) ? formatChargeMoney(tableTotalValue(line), line.currency)
                      : line.currency === 'USD' ? formatUSD(line.total_value_usd ?? 0) : formatBRL(line.total_value_brl ?? 0)}
                  </td>
                  {showNotes ? (
                    <td className="app-table__text app-table__text--wrap">{line.review_reason ?? line.notes ?? <NoValue label="Sem observação" />}</td>
                  ) : null}
                  {showActionsColumn ? (
                    <td>
                      <div className="flex items-center justify-center gap-2">
                        {chargeLineActions(line, readOnly).map((action) => {
                          const busy = changeChargeMutation.isPending || deleteManualChargeMutation.isPending
                          switch (action) {
                            case 'editManual':
                              return <RowActionButton key={action} label="Editar cobrança manual" icon={Pencil} onClick={() => handleEditManualCharge(line.id)} />
                            case 'alter':
                              return <RowActionButton key={action} label="Alterar valor da taxa" icon={CircleDollarSign} onClick={() => setValueModalLine(line)} disabled={busy} />
                            case 'restore':
                              return <RowActionButton key={action} label="Voltar ao valor da tabela" icon={Undo2} onClick={() => void handleChargeLineAction(line, 'restore')} disabled={busy} />
                            case 'reinclude':
                              return <RowActionButton key={action} label="Incluir taxa de novo" icon={Undo2} onClick={() => void handleChargeLineAction(line, 'reinclude')} disabled={busy} />
                            case 'exclude':
                              return <RowActionButton key={action} label="Excluir taxa" icon={Ban} variant="danger" onClick={() => void handleChargeLineAction(line, 'exclude')} disabled={busy} />
                            case 'deleteManual':
                              return <RowActionButton key={action} label="Excluir cobrança manual" icon={Trash2} variant="danger" onClick={() => void handleDeleteManualCharge(line)} disabled={busy} />
                          }
                        })}
                      </div>
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
          {lines.length ? (
            <tfoot>
              <tr>
                <td className="app-table__text font-semibold" colSpan={3 + Number(showOrigin) + Number(showSituation)}>Total</td>
                <td className="whitespace-nowrap font-semibold tabular-nums">{totalLabel}</td>
                {showNotes || showActionsColumn ? <td colSpan={Number(showNotes) + Number(showActionsColumn)} /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {readOnly || !(manualFormOpen || manualChargeForm.editingChargeCalculationId) ? null : (
        <div className="app-block__body">
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
      )}
      {valueModalLine ? <BlChargeValueModal blId={bl.id} line={valueModalLine} onClose={() => setValueModalLine(null)} /> : null}
    </Block>
    <BlChargeHistory blId={bl.id} />
    </>
  )
}

function Notice({ tone, children }: { tone?: 'warn'; children: ReactNode }) {
  return (
    <div
      className={`app-bl-notice app-bl-notice--row ${tone === 'warn' ? 'app-bl-notice--warning' : ''}`}
    >
      {children}
    </div>
  )
}
