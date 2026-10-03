import { useEffect, useRef, useState } from 'react'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import { useBillingCustomers, useCreateManualInvoice } from '../../hooks/useBilling'
import { listBlSuggestions } from '../../services/billing'
import type { ManualInvoiceInput } from '../../services/billing'
import { useManualChargeItemsForBl, useManualInvoiceQuote } from '../../hooks/useLocalCharges'
import { supabase } from '../../services/supabase'
import { formatValidationError, manualInvoiceCreationSchema } from '../../services/financialValidation'

type Props = {
  open: boolean
  onClose: () => void
}

function fmtBRL(value: number | null | undefined) {
  return `R$ ${Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ManualInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const createMutation = useCreateManualInvoice()
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [itemName, setItemName] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitValueBrl, setUnitValueBrl] = useState('')
  const [chargeItemId, setChargeItemId] = useState<number | null>(null)
  const [tableCharge, setTableCharge] = useState(false)
  const [blId, setBlId] = useState<string | null>(null)
  const [voyageId, setVoyageId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [formResetKey, setFormResetKey] = useState(0)
  const manualItems = useManualChargeItemsForBl(blId ?? undefined)
  const quoteQuery = useManualInvoiceQuote(blId, chargeItemId)
  const quote = tableCharge ? quoteQuery.data : undefined
  const customerPickerRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(open)
  const { data: customerOptions } = useBillingCustomers(customerSearch)

  useEffect(() => {
    if (!customerPickerOpen) return

    function onPointerDown(event: PointerEvent) {
      if (!customerPickerRef.current?.contains(event.target as Node)) setCustomerPickerOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCustomerPickerOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [customerPickerOpen])

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (!wasOpen || open) return
    // The initial closed render already starts with the empty form; reset only
    // when the parent actually closes an open modal.
    setCustomerId(null)
    setCustomerSearch('')
    setCustomerPickerOpen(false)
    setItemName('')
    setDescription('')
    setQuantity('1')
    setUnitValueBrl('')
    setChargeItemId(null)
    setTableCharge(false)
    setBlId(null)
    setVoyageId(null)
    setError('')
    setFormResetKey((key) => key + 1)
  }, [open])

  function resetContext() {
    setChargeItemId(null)
    setTableCharge(false)
    setBlId(null)
    setVoyageId(null)
  }

  function clearCustomer() {
    setCustomerId(null)
    setCustomerSearch('')
    setCustomerPickerOpen(false)
    resetContext()
  }

  function close() {
    onClose()
  }

  async function submit() {
    setError('')
    if (customerId == null) {
      setError('Cliente obrigatorio.')
      return
    }

    if (tableCharge && (!blId || !chargeItemId || !quote || quoteQuery.isFetching)) {
      setError(!blId ? 'B/L obrigatório para item da tabela.' : 'Selecione um item e aguarde o valor da tabela.')
      return
    }
    const parsed = manualInvoiceCreationSchema.safeParse({
      customerId,
      itemName: quote?.charge_item_name ?? itemName,
      description,
      quantity: quote?.quantity ?? quantity,
      unitValueBrl: quote?.unit_value_brl ?? unitValueBrl,
      blId,
      voyageId,
    })
    if (!parsed.success) {
      setError(formatValidationError(parsed.error))
      return
    }

    const confirmed = await confirm({
      title: 'Emitir fatura avulsa?',
      message: `Emitir fatura avulsa para ${customerSearch || 'o cliente selecionado'}?`,
      confirmLabel: 'Emitir fatura',
      consequence: `Será criada uma fatura emitida de ${fmtBRL(quote?.total_brl ?? parsed.data.quantity * parsed.data.unitValueBrl)}, com o item ${parsed.data.itemName}${parsed.data.blId ? ` para o B/L ${parsed.data.blId}` : ''}. ${quote?.currency === 'USD' ? 'O ROE vigente será conferido na emissão. ' : ''}Esta cobrança é adicional e não altera a fatura de Taxas Locais.`,
      reversibility: 'A fatura poderá ser cancelada depois, conforme a permissão financeira vigente.',
    })
    if (!confirmed) return

    const input: ManualInvoiceInput = {
      ...(tableCharge && chargeItemId != null ? { chargeItemId } : {}),
      customerId: parsed.data.customerId,
      itemName: parsed.data.itemName,
      quantity: parsed.data.quantity,
      unitValueBrl: parsed.data.unitValueBrl,
    }
    if (parsed.data.description) input.description = parsed.data.description
    if (parsed.data.blId) input.blId = parsed.data.blId
    if (parsed.data.voyageId != null) input.voyageId = parsed.data.voyageId

    try {
      const result = await createMutation.mutateAsync(input)
      showToast(`Avulsa ${result.invoice_number} emitida (${fmtBRL(result.total_brl)}).`, 'success')
      close()
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Falha ao emitir fatura avulsa.'
      setError(message)
      showToast(message, 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nova fatura avulsa"
      className="invoice-create-dialog"
      bodyClassName="invoice-create-dialog__body"
    >
      <form className="invoice-create-modal" data-testid="manual-invoice-main" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <section className="invoice-create-modal__filters" data-testid="manual-invoice-fields">
          <div className="invoice-create-modal__filters-grid">
            <div className="app-field invoice-create-modal__field--customer">
              <span className="app-field__label">
                Cliente<span className="app-field__required" aria-hidden="true"> *</span>
              </span>
              <div ref={customerPickerRef} className="invoice-search-field">
                <Input
                  aria-label="Cliente"
                  placeholder="Buscar cliente..."
                  role="combobox"
                  aria-expanded={customerPickerOpen}
                  autoComplete="off"
                  value={customerSearch}
                  onChange={(event) => {
                    setCustomerId(null)
                    resetContext()
                    setCustomerSearch(event.target.value)
                    setCustomerPickerOpen(true)
                  }}
                  onClick={() => setCustomerPickerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && customerPickerOpen) {
                      event.stopPropagation()
                      setCustomerPickerOpen(false)
                    }
                  }}
                  style={customerId ? { paddingRight: 34 } : undefined}
                />
                {customerId != null ? (
                  <button type="button" className="invoice-search-field__clear" aria-label="Limpar cliente" onClick={clearCustomer}>
                    ×
                  </button>
                ) : null}
                {customerPickerOpen && (customerOptions?.length ?? 0) > 0 ? (
                  <div className="invoice-search-field__menu" role="listbox">
                    {customerOptions!.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        role="option"
                        aria-selected={customer.id === customerId}
                        className={`invoice-search-field__option${customer.id === customerId ? ' invoice-search-field__option--active' : ''}`}
                        onClick={() => {
                          setCustomerId(customer.id)
                          setCustomerSearch(customer.name)
                          setCustomerPickerOpen(false)
                          resetContext()
                        }}
                      >
                        <div className="invoice-search-field__option-name">{customer.name}</div>
                        <div className="invoice-search-field__option-meta">{customer.cnpj_cpf}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <Field label="Tipo de cobrança" required>
              <Select aria-label="Tipo de cobrança" value={tableCharge ? String(chargeItemId ?? 'table') : 'other'}
                onChange={(event) => {
                  const value = event.target.value
                  setTableCharge(value !== 'other')
                  setChargeItemId(value === 'other' || value === 'table' ? null : Number(value))
                }}>
                <option value="other">Outra</option>
                <option value="table">Item da tabela (B/L obrigatório)</option>
                {(manualItems.data ?? []).map((item) => <option key={item.charge_item_id} value={item.charge_item_id}>{item.charge_item_name}</option>)}
              </Select>
              {tableCharge && !blId ? <p role="alert">B/L obrigatório para item da tabela. Selecione o B/L para consultar os itens vigentes.</p> : null}
              {tableCharge && quoteQuery.error ? <p role="alert">{quoteQuery.error.message}</p> : null}
              {tableCharge && manualItems.error ? <p role="alert">Falha ao consultar os itens da tabela. Tente novamente.</p> : null}
              {quote ? <p>Valor da tabela e Condição do Cliente: {fmtBRL(quote.total_brl)}. {quote.currency === 'USD' ? `Convertido pelo ROE ${quote.roe}; o câmbio vigente será conferido na emissão.` : ''}</p> : null}
            </Field>

            <Field label="Nome do item" required>
              <Input aria-label="Nome do item" readOnly={tableCharge} value={tableCharge ? quote?.charge_item_name ?? '' : itemName} onChange={(event) => setItemName(event.target.value)} />
            </Field>

            <Field label="Descrição da cobrança">
              <Textarea aria-label="Descrição da cobrança" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            </Field>

            <Field label="Quantidade" required>
              <Input aria-label="Quantidade" inputMode="decimal" readOnly={tableCharge} value={tableCharge ? quote ? String(quote.quantity) : '' : quantity} onChange={(event) => setQuantity(event.target.value)} />
            </Field>

            <Field label="Valor unitário (BRL)" required>
              <Input aria-label="Valor unitário (BRL)" inputMode="decimal" readOnly={tableCharge} value={tableCharge ? quote ? String(quote.unit_value_brl) : '' : unitValueBrl} onChange={(event) => setUnitValueBrl(event.target.value)} />
            </Field>

            <div className="invoice-create-modal__field--bl">
              <Combobox
                key={`manual-bl-${formResetKey}-${customerId ?? 'none'}`}
                label={tableCharge ? 'B/L (obrigatório)' : 'B/L (opcional)'}
                placeholder={customerId ? 'Buscar B/L...' : 'Selecione o cliente primeiro'}
                disabled={customerId == null}
                onValueChange={(value) => { setChargeItemId(null); setVoyageId(null); setBlId(value.trim() ? value.trim().toUpperCase() : null) }}
                fetchOptions={async (query) => (await listBlSuggestions(query, customerId)).map((id): ComboOption => ({ value: id, label: id }))}
                onSelectOption={async (option) => {
                  const selectedBl = option.value.trim().toUpperCase()
                  setBlId(selectedBl)
                  try {
                    const { data } = await supabase.from('bls').select('voyage_id').eq('id', selectedBl).maybeSingle()
                    if (data?.voyage_id != null) {
                      setVoyageId(Number(data.voyage_id))
                    }
                  } catch {
                    // Ignora erro de rede; o operador pode selecionar a viagem manualmente se necessário
                  }
                }}
              />
            </div>

            <div className="invoice-create-modal__field--voyage">
              <VoyageCombobox
                clearable
                label="Navio / Viagem"
                selectedVoyageId={voyageId}
                disabled={customerId == null}
                onSelect={setVoyageId}
              />
            </div>
          </div>
          {error ? <div role="alert" style={{ color: 'var(--app-danger, #dc2626)', fontSize: 13 }}>{error}</div> : null}
        </section>

        <div className="invoice-create-modal__footer" data-testid="manual-invoice-footer">
          <div style={{ fontSize: 13, color: 'var(--app-muted)' }}>
            A fatura será emitida imediatamente.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" variant="ghost" onClick={close}>Voltar</Button>
            <Button type="submit" disabled={tableCharge && (!blId || !quote || quoteQuery.isFetching)} loading={createMutation.isPending}>Emitir fatura avulsa</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
