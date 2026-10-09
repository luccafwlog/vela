import { useEffect, useRef, useState } from 'react'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { VoyageCombobox } from '../shared/VoyageCombobox'
import { MoneyInput } from '../taxasLocais/ChargeFormParts'
import { useCreateManualInvoice } from '../../hooks/useBilling'
import { listBillingCustomers, listBlSuggestions } from '../../services/billing'
import type { ManualInvoiceInput } from '../../services/billing'
import { useManualChargeItemsForBl, useManualInvoiceQuote } from '../../hooks/useLocalCharges'
import { supabase } from '../../services/supabase'
import { manualInvoiceCreationSchema } from '../../services/financialValidation'
import { parseImportNumber } from '../../lib/importNumber'
import { formatBRL, formatCnpjCpf, formatUSD } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'

type Props = {
  open: boolean
  onClose: () => void
}

type ChargeKind = 'table' | 'other'
type FieldErrors = Partial<Record<'customer' | 'bl' | 'item' | 'itemName' | 'quantity' | 'unitValue' | 'voyage' | 'form', string>>

const KIND_OPTIONS = [
  { value: 'table' as const, label: 'Item da tabela' },
  { value: 'other' as const, label: 'Outra' },
]

// O schema ainda devolve mensagens sem acento; o campo mostra a versão da tela.
const SCHEMA_FIELD: Record<string, { field: keyof FieldErrors; message: string }> = {
  customerId: { field: 'customer', message: 'Selecione o Cliente.' },
  itemName: { field: 'itemName', message: 'Informe o nome do item.' },
  quantity: { field: 'quantity', message: 'Informe uma quantidade maior que zero.' },
  unitValueBrl: { field: 'unitValue', message: 'Informe um valor maior que zero.' },
  voyageId: { field: 'voyage', message: 'Viagem inválida.' },
}

function typedNumber(value: string) {
  const parsed = parseImportNumber(value, 'pt-BR')
  return parsed.kind === 'value' ? Number(parsed.decimal) : null
}

/**
 * Fatura avulsa (ADR 0075, migrations 097 e 123). O tipo de cobrança muda o
 * formulário: Item da tabela exige B/L e traz quantidade e valor resolvidos no
 * servidor (tabela + Condição do Cliente, USD pelo ROE); Outra aceita item,
 * quantidade e valor livres em R$, com B/L e Viagem opcionais. A descrição
 * aparece na fatura impressa e no Portal.
 */
export function ManualInvoiceModal({ open, onClose }: Props) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const createMutation = useCreateManualInvoice()
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null)
  const [kind, setKind] = useState<ChargeKind>('other')
  const [itemName, setItemName] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitValueBrl, setUnitValueBrl] = useState('')
  const [chargeItemId, setChargeItemId] = useState<number | null>(null)
  const [blId, setBlId] = useState<string | null>(null)
  const [voyageId, setVoyageId] = useState<number | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formResetKey, setFormResetKey] = useState(0)
  const tableCharge = kind === 'table'
  const manualItems = useManualChargeItemsForBl(tableCharge && blId ? blId : undefined)
  const quoteQuery = useManualInvoiceQuote(tableCharge ? blId : null, tableCharge ? chargeItemId : null)
  const quote = tableCharge ? quoteQuery.data : undefined
  const wasOpenRef = useRef(open)
  const blLookupRef = useRef('')
  const customerId = customer?.id ?? null

  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (!wasOpen || open) return
    // O primeiro render fechado já começa vazio; limpa só quando o pai fecha um modal aberto.
    setCustomer(null)
    setKind('other')
    setItemName('')
    setDescription('')
    setQuantity('1')
    setUnitValueBrl('')
    setChargeItemId(null)
    setBlId(null)
    setVoyageId(null)
    setErrors({})
    setFormResetKey((key) => key + 1)
  }, [open])

  function clearError(field: keyof FieldErrors) {
    setErrors((current) => (current[field] || current.form ? { ...current, [field]: undefined, form: undefined } : current))
  }

  function resetContext() {
    blLookupRef.current = ''
    setChargeItemId(null)
    setBlId(null)
    setVoyageId(null)
  }

  async function selectBl(value: string) {
    const selectedBl = value.trim().toUpperCase()
    blLookupRef.current = selectedBl
    setBlId(selectedBl || null)
    setChargeItemId(null)
    // A Viagem do B/L anterior não pode seguir com o novo enquanto a consulta não volta.
    setVoyageId(null)
    clearError('bl')
    if (!selectedBl) return
    try {
      const { data } = await supabase.from('bls').select('voyage_id').eq('id', selectedBl).maybeSingle()
      // Resposta atrasada de um B/L já trocado não sobrescreve a Viagem do atual.
      if (blLookupRef.current === selectedBl && data?.voyage_id != null) setVoyageId(Number(data.voyage_id))
    } catch {
      // Sem a viagem do B/L, o operador escolhe a viagem; a RPC confere a coerência.
    }
  }

  const otherTotal = (() => {
    const q = typedNumber(quantity)
    const v = typedNumber(unitValueBrl)
    return q != null && v != null && q > 0 && v > 0 ? Math.round(q * v * 100) / 100 : null
  })()
  const total = tableCharge ? quote?.total_brl ?? null : otherTotal

  async function submit() {
    const next: FieldErrors = {}
    if (customerId == null) next.customer = 'Selecione o Cliente.'
    if (tableCharge) {
      if (!blId) next.bl = 'Item da tabela exige o B/L deste Cliente.'
      else if (!chargeItemId) next.item = 'Escolha o item da tabela.'
      else if (!quote || quoteQuery.isFetching) next.item = 'Aguarde o valor da tabela.'
    }
    if (Object.keys(next).length) { setErrors(next); return }
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
      const fieldErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const target = SCHEMA_FIELD[String(issue.path[0])]
        if (target && !fieldErrors[target.field]) fieldErrors[target.field] = target.message
      }
      if (!Object.keys(fieldErrors).length) fieldErrors.form = parsed.error.issues[0]?.message ?? 'Revise os campos.'
      setErrors(fieldErrors)
      return
    }
    setErrors({})

    const amount = quote?.total_brl ?? Math.round(parsed.data.quantity * parsed.data.unitValueBrl * 100) / 100
    const confirmed = await confirm({
      title: 'Emitir fatura avulsa?',
      message: `${formatBRL(amount)} para ${customer?.name ?? 'o Cliente selecionado'}: ${parsed.data.itemName}${parsed.data.blId ? ` (B/L ${parsed.data.blId})` : ''}.`,
      confirmLabel: 'Emitir fatura avulsa',
      consequence: `A fatura sai emitida agora e aparece para o Cliente no Portal${parsed.data.description ? ', com a descrição informada' : ''}. ${quote?.currency === 'USD' ? 'O ROE vigente será conferido na emissão. ' : ''}É uma cobrança adicional: não altera a fatura de Taxas Locais do B/L.`,
      reversibility: 'Sem pagamento, o Administrativo pode cancelá-la depois, com motivo.',
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
      showToast(`Avulsa ${result.invoice_number} emitida (${formatBRL(result.total_brl)}).`, 'success')
      onClose()
    } catch (submitError) {
      const message = userFacingErrorMessage(submitError, 'Falha ao emitir fatura avulsa.')
      setErrors({ form: `${message} Nada foi emitido; revise e tente novamente.` })
    }
  }

  const itemOptions = manualItems.data ?? []

  return (
    <Modal open={open} onClose={onClose} title="Nova fatura avulsa" size="md">
      <form className="app-manual-invoice" data-testid="manual-invoice-main" noValidate onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <div className="app-manual-invoice__full">
          <Combobox
            key={`manual-customer-${formResetKey}`}
            label="Cliente"
            placeholder="Nome ou CNPJ"
            // Invalida na hora: o debounce do Combobox deixaria um Enter enviar o Cliente anterior.
            onInputChange={(value) => {
              if (customer && value !== customer.name) { setCustomer(null); resetContext() }
            }}
            onValueChange={() => undefined}
            fetchOptions={async (query) => (await listBillingCustomers(query)).map((row): ComboOption => ({ value: String(row.id), label: row.name, meta: formatCnpjCpf(row.cnpj_cpf) }))}
            onSelectOption={(option) => {
              setCustomer({ id: Number(option.value), name: option.label })
              resetContext()
              clearError('customer')
            }}
          />
          {errors.customer ? <p role="alert" className="app-field__error">{errors.customer}</p> : null}
        </div>

        <div className="app-manual-invoice__full app-field">
          <span className="app-field__label" aria-hidden="true">Tipo de cobrança</span>
          <SegmentedControl
            label="Tipo de cobrança"
            options={KIND_OPTIONS}
            value={kind}
            // B/L e Viagem ficam em campos que somem ao trocar o tipo; não podem seguir invisíveis na emissão.
            onChange={(value) => { setKind(value); resetContext(); setErrors({}) }}
          />
          <span className="app-field__hint">
            {tableCharge
              ? 'Item manual da tabela do B/L: quantidade e valor vêm da tabela, com a Condição do Cliente quando houver.'
              : 'Cobrança livre em reais. B/L e Viagem são opcionais.'}
          </span>
        </div>

        {tableCharge ? (
          <>
            <div className="app-manual-invoice__full">
              <Combobox
                key={`manual-bl-table-${formResetKey}-${customerId ?? 'none'}`}
                label="B/L"
                placeholder={customerId ? 'Número do B/L deste Cliente' : 'Selecione o Cliente primeiro'}
                disabled={customerId == null}
                onInputChange={(value) => {
                  if (blId && value.trim().toUpperCase() !== blId) { blLookupRef.current = ''; setBlId(null); setChargeItemId(null); setVoyageId(null) }
                }}
                onValueChange={(value) => void selectBl(value)}
                fetchOptions={async (query) => (await listBlSuggestions(query, customerId)).map((id): ComboOption => ({ value: id, label: id }))}
                onSelectOption={(option) => void selectBl(option.value)}
              />
              {errors.bl ? <p role="alert" className="app-field__error">{errors.bl}</p> : null}
            </div>
            <div className="app-manual-invoice__full">
              <Field
                label="Item da tabela"
                required
                error={errors.item}
                hint={!blId ? 'Escolha o B/L para ver os itens vigentes.' : manualItems.isLoading ? 'Consultando os itens do B/L…' : !manualItems.error && itemOptions.length === 0 ? 'Nenhum item manual vigente na tabela deste B/L. Use "Outra".' : undefined}
              >
                <Select
                  value={chargeItemId ?? ''}
                  disabled={!blId || manualItems.isLoading || itemOptions.length === 0}
                  onChange={(event) => { setChargeItemId(event.target.value ? Number(event.target.value) : null); clearError('item') }}
                >
                  <option value="">Selecione o item</option>
                  {itemOptions.map((item) => (
                    <option key={item.charge_item_id} value={item.charge_item_id}>
                      {item.charge_item_name}
                      {item.currency === 'USD' && item.effective_unit_value_usd != null ? ` · ${formatUSD(item.effective_unit_value_usd)}` : item.effective_unit_value_brl != null ? ` · ${formatBRL(item.effective_unit_value_brl)}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {manualItems.error ? <p role="alert" className="app-field__error">Não foi possível consultar os itens da tabela. Feche e abra de novo ou use "Outra".</p> : null}
            </div>
            <div className="app-manual-invoice__full app-manual-invoice__quote" aria-live="polite">
              {!chargeItemId ? <p>Quantidade e valor aparecem depois de escolher o item.</p>
                : quoteQuery.isFetching ? <p>Consultando o valor da tabela…</p>
                  : quoteQuery.error ? <p role="alert" className="app-field__error">{userFacingErrorMessage(quoteQuery.error, 'Não foi possível obter o valor da tabela.')}</p>
                    : quote ? (
                      <>
                        <p className="app-manual-invoice__quote-line">
                          <span>{quote.charge_item_name}</span>
                          <span className="app-manual-invoice__num">{String(quote.quantity).replace('.', ',')} × {formatBRL(quote.unit_value_brl)}</span>
                        </p>
                        {quote.currency === 'USD' ? <p>Item em US$, convertido pelo ROE {String(quote.roe ?? '—').replace('.', ',')}; o câmbio vigente é conferido na emissão.</p> : null}
                      </>
                    ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="app-manual-invoice__full">
              <Field label="Nome do item" required error={errors.itemName}>
                <Input value={itemName} maxLength={160} onChange={(event) => { setItemName(event.target.value); clearError('itemName') }} />
              </Field>
            </div>
            <Field label="Quantidade" required error={errors.quantity}>
              <Input inputMode="decimal" value={quantity} onChange={(event) => { setQuantity(event.target.value); clearError('quantity') }} />
            </Field>
            <Field label="Valor unitário (R$)" required error={errors.unitValue}>
              <MoneyInput prefix="R$" placeholder="0,00" value={unitValueBrl} onChange={(event) => { setUnitValueBrl(event.target.value); clearError('unitValue') }} />
            </Field>
            <fieldset className="app-manual-invoice__full app-manual-invoice__links">
              <legend>Vínculos opcionais</legend>
              <Combobox
                key={`manual-bl-${formResetKey}-${customerId ?? 'none'}`}
                label="B/L (opcional)"
                placeholder={customerId ? 'Número do B/L deste Cliente' : 'Selecione o Cliente primeiro'}
                disabled={customerId == null}
                onInputChange={(value) => { blLookupRef.current = ''; setVoyageId(null); setBlId(value.trim() ? value.trim().toUpperCase() : null) }}
                onValueChange={() => undefined}
                fetchOptions={async (query) => (await listBlSuggestions(query, customerId)).map((id): ComboOption => ({ value: id, label: id }))}
                onSelectOption={(option) => void selectBl(option.value)}
              />
              <VoyageCombobox
                clearable
                label="Navio / Viagem (opcional)"
                selectedVoyageId={voyageId}
                disabled={customerId == null}
                onSelect={setVoyageId}
              />
              <p className="app-field__hint">Contexto exibido na fatura. O B/L precisa ser deste Cliente e da mesma viagem; a avulsa não altera as Taxas Locais do B/L.</p>
              {errors.voyage ? <p role="alert" className="app-field__error">{errors.voyage}</p> : null}
            </fieldset>
          </>
        )}

        <div className="app-manual-invoice__full">
          <Field label="Descrição da cobrança" hint="Aparece na fatura impressa e no Portal do Cliente.">
            <Textarea value={description} rows={3} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>

        {errors.form ? <p role="alert" className="app-manual-invoice__full app-invoice-detail__alert">{errors.form}</p> : null}

        <div className="app-manual-invoice__footer" data-testid="manual-invoice-footer">
          <p className="app-manual-invoice__total">
            <span>Total a emitir</span>
            <strong className="app-manual-invoice__num">{total != null ? formatBRL(total) : '—'}</strong>
          </p>
          <div className="app-manual-invoice__actions">
            <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
            <Button type="submit" loading={createMutation.isPending} loadingLabel="Emitindo…">Emitir fatura avulsa</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
