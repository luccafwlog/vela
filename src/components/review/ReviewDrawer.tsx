import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { InlineCustomerPicker } from '../shared/ReviewInlineEditors'
import { useAuth } from '../../hooks/useAuth'
import type { ReviewCustomer, ReviewQueueItem } from '../../hooks/useReview'
import { canonicalizeValidCnpj, formatCnpj } from '../../lib/cnpj'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { logOperationalEvent } from '../../services/operationalEvents'
import { ConcurrentEditError, saveBlReview, saveGraniteBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import {
  getReviewItemCauses,
  getReviewItemDocumentCandidates,
  REVIEW_CAUSE_LABELS,
  splitReviewNotes,
  type ReviewCause,
} from '../../pages/revisaoHelpers'
import { invalidateReviewQueueCaches } from './reviewCaches'

function customerLabel(customer: Pick<ReviewCustomer, 'name' | 'cnpj_cpf'>) {
  return `${customer.name} (${formatCnpj(customer.cnpj_cpf)})`
}

/** Onde cada causa se resolve, para a pessoa não salvar esperando o que o drawer não faz. */
function whereToResolve(cause: ReviewCause, canSelectCustomer: boolean, isGranite: boolean) {
  switch (cause) {
    case 'cliente':
      return canSelectCustomer ? 'Escolha o cliente abaixo.' : 'Resolva no grupo do cliente, na fila: cadastrar ou vincular.'
    case 'granito':
      return 'Escolha o cliente abaixo.'
    case 'peso':
      return 'Informe o peso em toneladas abaixo.'
    case 'portal':
      return 'Depende do Portal ativo ou da Liberação de faturamento sem Portal; o B/L sai da fila sozinho quando um dos dois acontecer.'
    default:
      return isGranite ? 'Escolha o cliente abaixo.' : 'Salve para o sistema reavaliar o B/L.'
  }
}

export function ReviewDrawer({
  item,
  currentIndex,
  totalItems,
  onClose,
  onSaved,
  onReviewSaved,
  onNavigate,
  siblingIds,
  allowCustomerLink = false,
}: {
  item: ReviewQueueItem | null
  currentIndex: number
  totalItems: number
  onClose: () => void
  onSaved: (resolved: boolean) => void
  onReviewSaved: (item: ReviewQueueItem) => void
  onNavigate: (id: string) => void
  siblingIds: string[]
  allowCustomerLink?: boolean
}) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [shipper, setShipper] = useState('')
  const [consignee, setConsignee] = useState('')
  const [pol, setPol] = useState('')
  const [pod, setPod] = useState('')
  const [totalWeightKg, setTotalWeightKg] = useState('')
  const [totalCbm, setTotalCbm] = useState('')
  const [bbWeightTon, setBbWeightTon] = useState('')
  const [bbCbm, setBbCbm] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Pick<ReviewCustomer, 'id' | 'name' | 'cnpj_cpf'> | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-baseia o formulário quando o item em revisão muda — ajuste durante
  // o render (padrão "adjusting state when props change" do React).
  const [prevItem, setPrevItem] = useState<typeof item | null>(null)
  if (item && item !== prevItem) {
    setPrevItem(item)
    setShipper(item.shipper ?? '')
    setConsignee(item.consignee ?? '')
    setPol(item.pol ?? '')
    setPod(item.pod ?? '')
    setTotalWeightKg(item.total_weight_kg ? String(item.total_weight_kg) : '')
    setTotalCbm(item.total_cbm ? String(item.total_cbm) : '')
    setBbWeightTon('bb_weight_ton' in item && item.bb_weight_ton ? String(item.bb_weight_ton) : '')
    setBbCbm('bb_cbm' in item && item.bb_cbm ? String(item.bb_cbm) : '')
    setNotes(splitReviewNotes(item.notes))
    setSelectedCustomer(item.customer ? { id: item.customer.id, name: item.customer.name, cnpj_cpf: item.customer.cnpj_cpf } : null)
    setJustification('')
  }

  const selectedCustomerId = selectedCustomer?.id ?? null
  const selectedCustomerDisplay = selectedCustomer ? customerLabel(selectedCustomer) : null

  async function handleSave() {
    if (!item || !user) return
    if (item.source === 'granite') {
      if (!selectedCustomer) return
      const confirmed = await confirm({
        title: 'Vincular cliente ao Granito',
        message: `Vincular ${selectedCustomerDisplay} ao registro de Granito ${item.bl_number}?`,
        confirmLabel: 'Vincular cliente',
        affected: { summary: `Granito ${item.bl_number} · cliente ${selectedCustomerDisplay}` },
        consequence: 'Atualiza o cliente associado ao registro operacional e reavalia se há cálculo de apoio pendente.',
        reversibility: 'O vínculo pode ser corrigido novamente pela Revisão enquanto não houver documento financeiro emitido.',
      })
      if (!confirmed) return
    } else {
      const changes: Array<{ field: string; before: string; after: string }> = []
      const addChange = (field: string, before: string | number | null | undefined, after: string | number | null | undefined) => {
        const beforeText = before == null ? '' : String(before)
        const afterText = after == null ? '' : String(after)
        if (beforeText !== afterText) changes.push({ field, before: beforeText, after: afterText })
      }
      addChange('Shipper', item.shipper, shipper.trim() || null)
      addChange('Consignatário', item.consignee, consignee.trim() || null)
      addChange('POL', item.pol, pol.trim() || null)
      addChange('POD', item.pod, pod.trim() || null)
      addChange('Peso contêiner (kg)', item.total_weight_kg, totalWeightKg === '' ? null : Number(totalWeightKg))
      addChange('CBM contêiner (m³)', item.total_cbm, totalCbm === '' ? null : Number(totalCbm))
      addChange('Peso carga solta (ton)', 'bb_weight_ton' in item ? item.bb_weight_ton : null, bbWeightTon === '' ? null : Number(bbWeightTon))
      addChange('CBM carga solta (m³)', 'bb_cbm' in item ? item.bb_cbm : null, bbCbm === '' ? null : Number(bbCbm))
      addChange('Notas da revisão', splitReviewNotes(item.notes) || null, notes.trim() || null)
      if ((item.customer_id ?? null) !== selectedCustomerId) {
        changes.push({
          field: 'Cliente',
          before: item.customer ? customerLabel(item.customer) : '',
          after: selectedCustomerDisplay ?? '',
        })
      }
      const confirmed = await confirm({
        title: 'Salvar revisão do B/L',
        message: changes.length
          ? `Salvar as correções do B/L ${item.id} e reavaliar as pendências?`
          : `Nenhum campo mudou. Reavaliar as pendências do B/L ${item.id}?`,
        confirmLabel: 'Salvar revisão',
        affected: { summary: `B/L ${item.id} · ${item.customer?.name ?? selectedCustomer?.name ?? 'sem cliente vinculado'}` },
        changes,
        consequence: 'Atualiza os dados documentais e o servidor recalcula as pendências. Se nenhuma sobrar e os demais gates estiverem atendidos, a emissão da fatura poderá ocorrer automaticamente.',
        reversibility: 'Os campos podem ser corrigidos novamente antes da emissão. Uma fatura emitida não pode ser apagada; sem pagamento, seu cancelamento é restrito ao perfil Administrativo.',
      })
      if (!confirmed) return
    }

    setSaving(true)
    try {
      if (item.source === 'granite') {
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: selectedCustomerId!, changedBy: user.id })
        await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true, includeAudit: true })
        onReviewSaved(item)
        showToast('Cliente vinculado ao Granito.', 'success')
        onSaved(true)
        return
      }

      const humanNotes = splitReviewNotes(item.notes)
      const result = await saveBlReview({
        blId: item.id,
        original: {
          shipper: item.shipper,
          consignee: item.consignee,
          pol: item.pol,
          pod: item.pod,
          total_weight_kg: item.total_weight_kg,
          total_cbm: item.total_cbm,
          bb_weight_ton: 'bb_weight_ton' in item ? item.bb_weight_ton : null,
          bb_cbm: 'bb_cbm' in item ? item.bb_cbm : null,
          // Só a parte humana: a linha técnica é regravada pela RPC.
          notes: humanNotes || null,
        },
        // Os quatro campos viajam sempre; `saveBlReview` só persiste o que
        // mudou, e a tela só deixa mexer no par da modalidade do B/L.
        values: {
          shipper,
          consignee,
          pol,
          pod,
          total_weight_kg: totalWeightKg === '' ? null : Number(totalWeightKg),
          total_cbm: totalCbm === '' ? null : Number(totalCbm),
          bb_weight_ton: bbWeightTon === '' ? null : Number(bbWeightTon),
          bb_cbm: bbCbm === '' ? null : Number(bbCbm),
          notes: notes.trim() || null,
        },
        customerId: selectedCustomerId,
        previousCustomerId: item.customer_id ?? null,
        changedBy: user.id,
        justification: justification.trim() || 'Revisão manual',
        expectedUpdatedAt: item.updated_at ?? null,
      })

      let autoInvoiceIssued = false
      let autoInvoiceMessage: string | null = null
      if (result.resolved && selectedCustomerId) {
        const autoInvoice = await tryAutoIssueInvoice({ blId: item.id, customerId: selectedCustomerId, actorId: user.id })
        autoInvoiceIssued = autoInvoice.status === 'invoiced'
        autoInvoiceMessage = autoInvoice.status === 'blocked' ? autoInvoice.message : null
      }

      await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true, includeAudit: true })

      if (autoInvoiceIssued) {
        showToast(`B/L ${item.id} saiu da revisão e a fatura foi emitida automaticamente.`, 'success')
      } else if (!result.resolved) {
        // O painel continua aberto neste B/L e a lista de pendências se atualiza.
        showToast(`B/L ${item.id} salvo. Continua em revisão.`, 'info')
      } else if (autoInvoiceMessage) {
        showToast(`B/L ${item.id} saiu da revisão, mas o faturamento automático não concluiu: ${autoInvoiceMessage}`, 'info')
      } else {
        showToast(`B/L ${item.id} saiu da revisão e está pronto para faturamento.`, 'success')
      }

      if (!autoInvoiceIssued) {
        onReviewSaved(item)
      }
      onSaved(result.resolved)
    } catch (error) {
      if (error instanceof ConcurrentEditError) {
        void logOperationalEvent({
          code: 'bl_review_concurrent_conflict',
          message: error.message,
          changedBy: user?.id ?? null,
          entityId: item.id,
          context: { source: 'review_drawer' },
        })
        await queryClient.invalidateQueries({ queryKey: ['review-queue'] })
        showToast('Este B/L foi alterado por outro usuário. A fila foi recarregada.', 'error')
        return
      }
      showToast('Falha ao salvar a revisão do B/L.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canGoPrev = currentIndex > 0
  const canGoNext = currentIndex >= 0 && currentIndex < totalItems - 1
  const isGranite = item?.source === 'granite'
  const canSelectCustomer = Boolean(isGranite || allowCustomerLink)
  // Mesmos predicados do resto do sistema, e não uma terceira regra local.
  const cargoMode = item && !isGranite ? item.cargo_mode : null
  const showContainerCargo = !cargoMode || isContainerCargoMode(cargoMode)
  const showBreakbulkCargo = Boolean(cargoMode) && isBreakbulkCargoMode(cargoMode)
  const causes = item ? getReviewItemCauses(item) : []
  const evidenceCnpjs = item && !isGranite ? getReviewItemDocumentCandidates(item) : []
  const selectedCnpj = canonicalizeValidCnpj(selectedCustomer?.cnpj_cpf)
  const selectedMatches = evidenceCnpjs.length && selectedCnpj ? evidenceCnpjs.includes(selectedCnpj) : null
  const customerChanged = item ? (item.customer_id ?? null) !== selectedCustomerId : false
  const saveBlocked = isGranite && !selectedCustomer ? 'Escolha um cliente para vincular.' : null

  return (
    <Drawer
      open={Boolean(item)}
      onClose={onClose}
      title={item ? (isGranite ? `Vincular cliente — Granito ${item.bl_number}` : `Revisar B/L ${item.id}`) : 'Revisar'}
    >
      {item ? (
        <div className="review-drawer">
          {totalItems > 1 && currentIndex >= 0 ? (
            <nav className="review-drawer__pager" aria-label="Navegar pela fila">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => canGoPrev && onNavigate(siblingIds[currentIndex - 1])}
                className="review-drawer__pager-button"
                aria-label="Registro anterior"
              >
                <ChevronLeft size={15} aria-hidden="true" />
                Anterior
              </button>
              <span className="review-drawer__pager-count">{currentIndex + 1} de {totalItems}</span>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => canGoNext && onNavigate(siblingIds[currentIndex + 1])}
                className="review-drawer__pager-button"
                aria-label="Próximo registro"
              >
                Próximo
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </nav>
          ) : null}

          <section className="review-drawer__pending" aria-label="O que falta">
            <h3 className="review-section-title">O que falta</h3>
            <ul>
              {causes.map((cause) => (
                <li key={cause}>
                  <strong>{cause === 'outros' ? 'Pendente de revisão' : REVIEW_CAUSE_LABELS[cause]}</strong>
                  <span>{whereToResolve(cause, canSelectCustomer, Boolean(isGranite))}</span>
                </li>
              ))}
            </ul>
          </section>

          {!isGranite ? (
            <>
              <section className="review-drawer__section" aria-label="Dados do documento">
                <h3 className="review-section-title">Documento</h3>
                <div className="review-drawer__grid">
                  <Field label="Shipper">
                    <Input value={shipper} onChange={(event) => setShipper(event.target.value)} />
                  </Field>
                  <Field label="Consignatário">
                    <Input value={consignee} onChange={(event) => setConsignee(event.target.value)} />
                  </Field>
                  <Field label="POL">
                    <Input value={pol} onChange={(event) => setPol(event.target.value)} />
                  </Field>
                  <Field label="POD">
                    <Input value={pod} onChange={(event) => setPod(event.target.value)} />
                  </Field>
                </div>
              </section>
              <section className="review-drawer__section" aria-label="Carga">
                <h3 className="review-section-title">Carga</h3>
                <div className="review-drawer__grid">
                  {/* Cada modalidade edita as SUAS colunas. Um B/L misto mostra
                      os dois pares, porque satisfaz os dois predicados. */}
                  {showContainerCargo ? (
                    <>
                      <Field label="Peso contêiner (kg)">
                        <Input type="number" inputMode="decimal" value={totalWeightKg} onChange={(event) => setTotalWeightKg(event.target.value)} />
                      </Field>
                      <Field label="CBM contêiner (m³)">
                        <Input type="number" inputMode="decimal" value={totalCbm} onChange={(event) => setTotalCbm(event.target.value)} />
                      </Field>
                    </>
                  ) : null}
                  {showBreakbulkCargo ? (
                    <>
                      <Field label="Peso carga solta (ton)" required={causes.includes('peso')}>
                        <Input type="number" inputMode="decimal" value={bbWeightTon} onChange={(event) => setBbWeightTon(event.target.value)} />
                      </Field>
                      <Field label="CBM carga solta (m³)">
                        <Input type="number" inputMode="decimal" value={bbCbm} onChange={(event) => setBbCbm(event.target.value)} />
                      </Field>
                    </>
                  ) : null}
                </div>
                <Field label="Descrição da carga do B/L" hint="Texto extraído do documento; não é alterado nesta revisão.">
                  <Textarea
                    className="review-drawer__cargo-description"
                    value={item.cargo_description ?? ''}
                    placeholder="Descrição não extraída do B/L."
                    readOnly
                  />
                </Field>
              </section>
            </>
          ) : null}

          {canSelectCustomer ? (
            <section className="review-drawer__section" aria-label="Cliente">
              <h3 className="review-section-title">Cliente</h3>
              {!isGranite ? <p className="review-drawer__note">Vale só para este B/L. Use quando as evidências divergem ou para trocar o cliente vinculado.</p> : null}
              {item.source === 'granite' && item.suggested_customer?.name ? (
                <div className="review-drawer__suggestion">
                  <p>
                    Sugestão por nome: <strong>{item.suggested_customer.name}</strong> ({formatCnpj(item.suggested_customer.cnpj_cpf)}). Confira o CNPJ antes de vincular.
                  </p>
                  {selectedCustomerId !== item.suggested_customer.id ? (
                    <button type="button" className="review-link-button" onClick={() => setSelectedCustomer(item.suggested_customer!)}>Usar a sugestão</button>
                  ) : null}
                </div>
              ) : null}
              <InlineCustomerPicker
                label="Buscar cliente por nome ou CNPJ"
                saving={saving}
                expectedCnpjs={evidenceCnpjs}
                onSelect={(customer) => setSelectedCustomer({ id: customer.id, name: customer.name, cnpj_cpf: customer.cnpj_cpf })}
              />
              {selectedCustomer ? (
                <p className="review-drawer__selected" role="status">
                  {customerChanged ? 'Será vinculado: ' : 'Cliente atual: '}<strong>{selectedCustomerDisplay}</strong>
                  {selectedMatches === true ? <span className="review-picker__match review-picker__match--ok">CNPJ confere com o B/L</span> : null}
                  {selectedMatches === false ? <span className="review-picker__match review-picker__match--diff">CNPJ diferente do B/L</span> : null}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="review-drawer__note">
              <strong>Cliente: </strong>
              {item.customer ? customerLabel(item.customer) : 'cadastro e vínculo ficam no grupo do cliente, na fila.'}
            </p>
          )}

          {!isGranite ? (
            <section className="review-drawer__section" aria-label="Registro">
              <Field label="Notas da revisão" hint="As pendências técnicas são gravadas pelo sistema e não aparecem aqui.">
                <Textarea className="review-drawer__notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <Field label="Justificativa (opcional)" hint="Vai para o histórico do B/L. Se vazia, registra “Revisão manual”.">
                <Textarea value={justification} onChange={(event) => setJustification(event.target.value)} />
              </Field>
            </section>
          ) : null}

          <div className="review-drawer__footer">
            <p className="review-drawer__effect">
              {isGranite
                ? 'Granito não gera fatura; o vínculo libera o cálculo de apoio.'
                : 'Ao salvar, o sistema recalcula as pendências. Sem nenhuma, o B/L sai da revisão e a fatura pode ser emitida automaticamente.'}
            </p>
            {saveBlocked ? <p className="review-drawer__block">{saveBlocked}</p> : null}
            <div className="review-drawer__actions">
              <Button variant="secondary" onClick={onClose}>
                Voltar
              </Button>
              <Button loading={saving} loadingLabel="Salvando…" disabled={Boolean(saveBlocked)} onClick={handleSave}>
                {isGranite ? 'Vincular cliente' : 'Salvar revisão'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  )
}
