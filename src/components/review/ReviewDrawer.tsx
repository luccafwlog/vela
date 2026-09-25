import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewQueueItem } from '../../hooks/useReview'
import { formatCnpj } from '../../lib/cnpj'
import { isBreakbulkCargoMode, isContainerCargoMode } from '../../lib/cargoMode'
import { logOperationalEvent } from '../../services/operationalEvents'
import { ConcurrentEditError, saveBlReview, saveGraniteBlReview } from '../../services/review'
import { tryAutoIssueInvoice } from '../../services/reviewBillingAutomation'
import { invalidateReviewQueueCaches } from './reviewCaches'

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
  const [shipper, setShipper] = useState('')
  const [consignee, setConsignee] = useState('')
  const [pol, setPol] = useState('')
  const [pod, setPod] = useState('')
  const [totalWeightKg, setTotalWeightKg] = useState('')
  const [totalCbm, setTotalCbm] = useState('')
  const [bbWeightTon, setBbWeightTon] = useState('')
  const [bbCbm, setBbCbm] = useState('')
  const [notes, setNotes] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [selectedCustomerDisplay, setSelectedCustomerDisplay] = useState<string | null>(null)
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const customerLookup = useCustomerLookup(customerSearch)

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
    setNotes(item.notes ?? '')
    setSelectedCustomerId(item.customer_id ?? null)
    setSelectedCustomerDisplay(item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : null)
    setCustomerSearch('')
    setJustification('')
  }

  async function handleSave() {
    if (!item || !user) return

    setSaving(true)
    try {
      if (item.source === 'granite') {
        if (!selectedCustomerId) {
          showToast('Selecione um cliente para vincular.', 'error')
          setSaving(false)
          return
        }
        await saveGraniteBlReview({ graniteBlId: item.id, clientId: selectedCustomerId, changedBy: user.id })
        await invalidateReviewQueueCaches(queryClient, { blId: item.id, includeCustomers: true, includeAudit: true })
        onReviewSaved(item)
        showToast('Cliente vinculado ao Granito.', 'success')
        onSaved(true)
        return
      }

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
          notes: item.notes,
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
          notes,
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
        showToast('B/L revisado e fatura emitida automaticamente.', 'success')
      } else if (!result.resolved) {
        showToast(`B/L salvo, mas ainda falta: ${result.pendencias.join(', ')}.`, 'info')
      } else if (autoInvoiceMessage) {
        showToast(`B/L revisado, mas o faturamento automático não concluiu: ${autoInvoiceMessage}`, 'info')
      } else {
        showToast('B/L revisado. Pronto para faturamento.', 'success')
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
  const pendencies = item?.review_reasons?.length ? item.review_reasons : ['Pendente de revisão']

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      className="app-drawer"
      title={item ? (isGranite ? `Vincular cliente — Granito ${item.bl_number}` : `Revisar B/L ${item.id}`) : 'Revisar'}
    >
      {item ? (
        <div className="grid gap-5">
          {totalItems > 1 && currentIndex >= 0 ? (
            <div className="review-drawer__pager flex items-center justify-between rounded-lg px-3 py-2 text-sm">
              <button
                type="button"
                disabled={!canGoPrev}
                onClick={() => canGoPrev && onNavigate(siblingIds[currentIndex - 1])}
                className="review-drawer__pager-button flex items-center gap-1 disabled:opacity-30"
              >
                <ChevronLeft size={15} />
                Anterior
              </button>
              <span className="review-drawer__pager-count text-xs">
                {currentIndex + 1} de {totalItems}
              </span>
              <button
                type="button"
                disabled={!canGoNext}
                onClick={() => canGoNext && onNavigate(siblingIds[currentIndex + 1])}
                className="review-drawer__pager-button flex items-center gap-1 disabled:opacity-30"
              >
                Próximo
                <ChevronRight size={15} />
              </button>
            </div>
          ) : null}

          <div className="review-drawer__warning rounded-xl p-3 text-sm">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertTriangle size={16} />
              Pendências a resolver
            </div>
            <div className="flex flex-wrap gap-2">
              {pendencies.map((reason) => (
                <Badge key={reason} tone="yellow">
                  {reason}
                </Badge>
              ))}
            </div>
          </div>

          {!isGranite ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
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
                {/* Cada modalidade edita as SUAS colunas. Um B/L misto mostra
                    os dois pares, porque satisfaz os dois predicados. */}
                {showContainerCargo ? (
                  <>
                    <Field label="Peso contêiner (kg)">
                      <Input type="number" value={totalWeightKg} onChange={(event) => setTotalWeightKg(event.target.value)} />
                    </Field>
                    <Field label="CBM contêiner (m³)">
                      <Input type="number" value={totalCbm} onChange={(event) => setTotalCbm(event.target.value)} />
                    </Field>
                  </>
                ) : null}
                {showBreakbulkCargo ? (
                  <>
                    <Field label="Peso carga solta (ton)">
                      <Input type="number" value={bbWeightTon} onChange={(event) => setBbWeightTon(event.target.value)} />
                    </Field>
                    <Field label="CBM carga solta (m³)">
                      <Input type="number" value={bbCbm} onChange={(event) => setBbCbm(event.target.value)} />
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
              <Field label="Notas da revisão">
                <Textarea className="review-drawer__notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </>
          ) : null}

          {canSelectCustomer ? <Card className="review-drawer__customer-card grid gap-4">
            {item.source === 'granite' && item.suggested_customer?.name ? (
              <div className="review-drawer__suggestion rounded-lg px-3 py-2 text-sm">
                Sugestao por nome — confirme o documento antes de vincular: <strong>{item.suggested_customer.name}</strong>{' '}
                ({formatCnpj(item.suggested_customer.cnpj_cpf)})
              </div>
            ) : null}
            <div className="font-semibold text-[var(--app-text-strong)]">
              {isGranite ? 'Vinculação de cliente' : 'Vinculação individual de cliente'}
            </div>
            {!isGranite ? <p className="text-sm text-[var(--app-muted)]">Use esta ação para confirmar o cliente deste B/L quando as evidências documentais estiverem divergentes.</p> : null}
            <Field label="Buscar cliente por nome ou CNPJ">
              <div className="relative">
                <Input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Digite ao menos 2 caracteres" />
                <Search className="pointer-events-none absolute right-3 top-2.5 text-[var(--app-muted)]" size={16} />
              </div>
            </Field>
            {customerLookup.data?.length ? (
              <div className="grid gap-2">
                {customerLookup.data.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`review-drawer__customer-option rounded-lg border px-3 py-2 text-left text-sm transition ${
                      selectedCustomerId === customer.id
                        ? 'review-drawer__customer-option--selected'
                        : ''
                    }`}
                    onClick={() => {
                      setSelectedCustomerId(customer.id)
                      setSelectedCustomerDisplay(`${customer.name} (${formatCnpj(customer.cnpj_cpf)})`)
                      setCustomerSearch(`${customer.name} ${formatCnpj(customer.cnpj_cpf)}`)
                    }}
                  >
                    <div className="font-semibold">{customer.name}</div>
                    <div className="text-xs text-[var(--app-muted)]">{formatCnpj(customer.cnpj_cpf)}</div>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedCustomerId ? (
              <div className="review-drawer__selected-customer rounded-lg px-3 py-2 text-xs">
                <div>Cliente selecionado para vinculação.</div>
                <div className="mt-1">{item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : selectedCustomerDisplay ?? 'Cliente'}.</div>
              </div>
            ) : null}

          </Card> : (
            <div className="review-drawer__group-note rounded-xl p-3 text-sm">
              <div className="font-semibold text-[var(--app-text-strong)]">Cliente definido pelo grupo</div>
              <div className="mt-1">{item.customer ? `${item.customer.name} (${formatCnpj(item.customer.cnpj_cpf)})` : 'O cadastro e o vínculo são tratados no cartão do grupo.'}</div>
            </div>
          )}

          <Field label="Justificativa (opcional)">
            <Textarea
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Se vazia, registra 'Revisão manual' no histórico."
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Voltar
            </Button>
            <Button loading={saving} onClick={handleSave}>
              Marcar como revisado
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
