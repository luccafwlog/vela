import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { NoValue } from '../ui/NoValue'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { ManualChargeFormFields } from '../billing/ManualChargeFormFields'
import { useAuth } from '../../hooks/useAuth'
import { chargeTableColumns, isUsualLine } from './chargeTableColumns'
import {
  useAddManualBlCharge,
  useBlLocalChargeLines,
  useCalculateBlLocalCharges,
  useDeleteManualBlCharge,
  useManualChargeItemsForBl,
  useUpdateManualBlCharge,
} from '../../hooks/useLocalCharges'
import { formatBRL, formatCountLabel, formatDateTime, formatUSD, normalizeText } from '../../lib/utils'
import { ConsolidatedMark, StatusText } from '../ui/StatusText'
import { InvoiceSituation } from '../billing/InvoiceSituation'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import { classifyDbError } from '../../lib/errors'
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
  const { user, isAdmin } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: localChargeLines, isLoading: isLocalChargeLinesLoading, isError: isLocalChargeLinesError, refetch: refetchLocalChargeLines } = useBlLocalChargeLines(bl.id)
  const { data: manualChargeItems, isLoading: isManualChargeItemsLoading } = useManualChargeItemsForBl(bl.id)
  const addManualChargeMutation = useAddManualBlCharge(bl.id)
  const updateManualChargeMutation = useUpdateManualBlCharge(bl.id)
  const deleteManualChargeMutation = useDeleteManualBlCharge(bl.id)
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

  // Emissão manual (ADR 0077): o caminho normal é automático (CE Mercante,
  // Portal pronto, correção do B/L). Este botão cobre a emissão que o
  // automático não fez: Reemissão pendente cuja trava foi resolvida ou falha
  // da emissão automática.
  // Qualquer Departamento emite (ADR 0085, D3; migration 246).
  const canIssue = Boolean(
    !chargesLocked && bl.customer_id && bl.ce_mercante
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
    && Math.abs(localChargeSummary.lines.filter((line) => line.status !== 'exempt').reduce((sum, line) => sum + Number(line.total_value_brl ?? 0), 0) - activeInvoice.total_brl) > 0.01,
  )
  const lines = localChargeSummary.lines
  const { showOrigin, showSituation, showNotes, showActions: showActionsColumn } = chargeTableColumns(lines, chargesLocked)
  const reviewPendingCount = lines.filter((line) => line.status === 'review_required').length
  const columnCount = 4 + Number(showOrigin) + Number(showSituation) + Number(showNotes) + Number(showActionsColumn)
  const totalLabel = (
    <>
      {formatBRL(localChargeSummary.totalBrl)}
      {localChargeSummary.totalUsd ? <> + {formatUSD(localChargeSummary.totalUsd)}</> : null}
    </>
  )

  return (
    <Block
      title="Taxas Locais"
      flush
      aside={chargesLocked ? null : (
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
                {chargesLocked ? null : ' · valores provisórios até a emissão'}
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
        {bl.charge_status === 'not_calculated' ? (
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
                <tr key={line.id}>
                  <td className="app-table__text" title={line.charge_name ?? undefined}>{line.charge_name}</td>
                  {showOrigin ? <td>{line.source === 'manual' ? 'Manual' : <NoValue label="Automática" />}</td> : null}
                  {showSituation ? (
                    <td className="whitespace-nowrap">
                      {line.status === 'review_required' ? <StatusText tone="warning">Em revisão</StatusText>
                        : line.status === 'exempt' ? <StatusText tone="muted">Isenta</StatusText>
                        : isUsualLine(line.status) ? <NoValue label={resolveChargeLineStatusLabel(line.status)} />
                        : resolveChargeLineStatusLabel(line.status)}
                    </td>
                  ) : null}
                  <td className="tabular-nums">{formatNumber(line.quantity)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {line.currency === 'USD' ? formatUSD(line.unit_value_usd ?? 0) : formatBRL(line.unit_value_brl ?? 0)}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {line.currency === 'USD' ? formatUSD(line.total_value_usd ?? 0) : formatBRL(line.total_value_brl ?? 0)}
                  </td>
                  {showNotes ? (
                    <td className="app-table__text app-table__text--wrap">{line.review_reason ?? line.notes ?? <NoValue label="Sem observação" />}</td>
                  ) : null}
                  {showActionsColumn ? (
                    <td>
                      {line.source === 'manual' ? (
                        <div className="flex items-center justify-center gap-2">
                          <Button variant="secondary" className="app-btn--sm" type="button" onClick={() => handleEditManualCharge(line.id)} aria-label="Editar cobrança manual">
                            Editar
                          </Button>
                          {isAdmin ? (
                            // Excluir taxa manual é do Administrativo (migration 088; ADR 0071).
                            <Button variant="danger" className="app-btn--sm" type="button" onClick={() => handleDeleteManualCharge(line.id)} aria-label="Excluir cobrança manual" disabled={deleteManualChargeMutation.isPending}>
                              Excluir
                            </Button>
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

      {chargesLocked || !(manualFormOpen || manualChargeForm.editingChargeCalculationId) ? null : (
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
    </Block>
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
