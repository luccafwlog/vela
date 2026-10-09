import { useCallback, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useOverrideChargeItems, useOverrideCustomerLookup } from '../../hooks/useLocalCharges'
import { extractErrorText } from '../../lib/errors'
import { formatCnpjCpf, formatDate, normalizeText } from '../../lib/utils'
import { toAmount, validateOverrideInput, type ChargeTableEngineState, type OverridePayload } from '../../pages/taxasLocaisHelpers'
import type { LocalChargeOverrideItem, OverrideChargeItemOption } from '../../services/charges/chargeRateService'
import {
  basisUnit,
  conditionEffectNotes,
  currencyPrefix,
  describeDifference,
  formatRate,
  itemUnitValue,
  scopeLabel,
  type ChargeTable,
} from './chargePresentation'
import { ChargeChanges, ChargeNoteList, MoneyInput, type ChargeChange } from './ChargeFormParts'
import { EMPTY_OVERRIDE_FORM, type OverrideForm } from './chargeForms'

type ItemLike = Pick<OverrideChargeItemOption, 'id' | 'name' | 'currency' | 'unit_value_brl' | 'unit_value_usd' | 'application_basis'> & {
  active?: boolean | null
  charge_table: { id: number; name: string; cargo_mode: string | null; pod: string | null } | null
}

function itemLabel(item: ItemLike) {
  return `${item.name} — ${item.charge_table?.name ?? 'sem tabela'}`
}

function formFromRow(row: LocalChargeOverrideItem | null): OverrideForm {
  if (!row) return EMPTY_OVERRIDE_FORM
  return {
    id: row.id,
    customerId: String(row.customer_id ?? ''),
    chargeItemId: String(row.charge_item_id ?? ''),
    overrideValue: String(Number(row.override_value ?? 0)).replace('.', ','),
    validFrom: row.valid_from ?? '',
    validTo: row.valid_to ?? '',
    notes: row.notes ?? '',
  }
}

function conditionChanges(row: LocalChargeOverrideItem, form: OverrideForm): ChargeChange[] {
  const currency = row.charge_item?.currency ?? 'BRL'
  const value = toAmount(form.overrideValue)
  return [
    {
      field: 'Valor negociado',
      before: formatRate(currency, Number(row.override_value ?? 0)),
      after: Number.isFinite(value) ? formatRate(currency, value) : form.overrideValue,
    },
    { field: 'Vigência inicial', before: row.valid_from ? formatDate(row.valid_from) : 'Sem data inicial', after: form.validFrom ? formatDate(form.validFrom) : 'Sem data inicial' },
    { field: 'Vigência final', before: row.valid_to ? formatDate(row.valid_to) : 'Sem data final', after: form.validTo ? formatDate(form.validTo) : 'Sem data final' },
    { field: 'Observações', before: (row.notes ?? '').trim(), after: form.notes.trim() },
  ].filter((change) => change.before !== change.after)
}

/**
 * Condição de Cliente: o valor negociado com um Cliente para um Item de Taxa,
 * no lugar do valor da tabela, durante a vigência. Cliente e item ficam fixos
 * na edição — trocar um deles é outra condição.
 */
export function ChargeOverrideFormModal({
  open,
  row,
  states,
  tablesById,
  onClose,
  onSave,
}: {
  open: boolean
  row: LocalChargeOverrideItem | null
  states: Map<number, ChargeTableEngineState>
  tablesById: Map<number, ChargeTable>
  onClose: () => void
  onSave: (input: OverridePayload & { id: number | null }) => Promise<void>
}) {
  const [form, setForm] = useState<OverrideForm>(() => formFromRow(row))
  const [customerLabel, setCustomerLabel] = useState(row?.customer ? row.customer.name : '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const lookupCustomers = useOverrideCustomerLookup()
  const itemsQuery = useOverrideChargeItems()
  const isEdit = Boolean(row)

  const items = useMemo<ItemLike[]>(() => {
    const options = (itemsQuery.data ?? []) as ItemLike[]
    // Primeiro os itens da tabela aplicada no cálculo, depois os demais.
    return [...options].sort((a, b) => {
      const rank = (item: ItemLike) => (states.get(item.charge_table?.id ?? -1)?.kind === 'applied' ? 0 : 1)
      return rank(a) - rank(b) || itemLabel(a).localeCompare(itemLabel(b), 'pt-BR')
    })
  }, [itemsQuery.data, states])

  const selectedItem: ItemLike | null = row?.charge_item
    ? (row.charge_item as unknown as ItemLike)
    : items.find((item) => String(item.id) === form.chargeItemId) ?? null
  const currency = selectedItem?.currency ?? 'BRL'
  const tableValue = selectedItem ? itemUnitValue(selectedItem) : null
  const negotiated = toAmount(form.overrideValue)
  const difference = tableValue != null && Number.isFinite(negotiated) && form.overrideValue.trim() ? describeDifference(tableValue, negotiated) : null
  const notes = selectedItem ? conditionEffectNotes(selectedItem, states, tablesById) : []
  const changes = useMemo(() => (row ? conditionChanges(row, form) : []), [row, form])

  function update<K extends keyof OverrideForm>(key: K, value: OverrideForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key as string]) return current
      const next = { ...current }
      delete next[key as string]
      return next
    })
  }

  const fetchCustomers = useCallback(async (term: string): Promise<ComboOption[]> => {
    const customers = await lookupCustomers(term)
    return customers.map((customer) => ({ value: String(customer.id), label: customer.name, meta: formatCnpjCpf(customer.cnpj_cpf) }))
  }, [lookupCustomers])

  const fetchItems = useCallback(async (term: string): Promise<ComboOption[]> => {
    // Cada palavra digitada precisa aparecer no item, na tabela ou no POD, em
    // qualquer ordem e sem pontuação ("thd vitoria", "THD — Vitoria 2026").
    const words = normalizeText(term).split(/[^\p{L}\p{N}/]+/u).filter(Boolean)
    return items
      .filter((item) => {
        const haystack = normalizeText(`${item.name} ${item.charge_table?.name ?? ''} ${item.charge_table?.pod ?? ''}`)
        return words.every((word) => haystack.includes(word))
      })
      .slice(0, 40)
      .map((item) => {
        const state = states.get(item.charge_table?.id ?? -1)
        const situation = state?.kind === 'applied' ? '' : state?.kind === 'shadowed' ? ' · tabela não aplicada' : ' · tabela inativa'
        return {
          value: String(item.id),
          label: itemLabel(item),
          meta: `${scopeLabel(item.charge_table?.cargo_mode, item.charge_table?.pod)} · ${formatRate(item.currency, itemUnitValue(item))} ${basisUnit(item.application_basis)}${situation}`,
        }
      })
  }, [items, states])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const result = validateOverrideInput(form)
    if (!result.ok) {
      setErrors({ [result.field ?? 'overrideValue']: result.error })
      return
    }
    if (isEdit && changes.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({ id: form.id, ...result.value })
    } catch (error) {
      // Conflito de vigência (ADR 0038 decisão 5) chega com a condição que
      // colide; o texto vai junto do período.
      setSaveError(extractErrorText(error) || 'Não foi possível salvar a condição.')
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = isEdit
    ? changes.length === 0 ? 'Nenhuma alteração' : `Salvar ${changes.length === 1 ? '1 alteração' : `${changes.length} alterações`}`
    : 'Cadastrar condição'

  return (
    <Modal open={open} title={isEdit ? 'Editar condição de Cliente' : 'Nova condição de Cliente'} onClose={saving ? () => undefined : onClose} size="md">
      <form className="app-rates-form" onSubmit={handleSubmit} noValidate>
        <div className="app-rates-form__grid">
          <div className="app-rates-form__wide">
            {isEdit ? (
              <div className="app-rates-fixed">
                <span className="app-rates-fixed__label">Cliente</span>
                <span>{row?.customer?.name ?? '—'} <span className="app-rates-unit">{formatCnpjCpf(row?.customer?.cnpj_cpf ?? '')}</span></span>
              </div>
            ) : (
              <>
                <Combobox
                  label="Cliente *"
                  placeholder="Nome ou CNPJ (2 letras ou mais)"
                  minChars={2}
                  initialValue={customerLabel}
                  onValueChange={(text) => {
                    if (text !== customerLabel) {
                      update('customerId', '')
                      setCustomerLabel('')
                    }
                  }}
                  fetchOptions={fetchCustomers}
                  onSelectOption={(option) => {
                    update('customerId', option.value)
                    setCustomerLabel(option.label)
                  }}
                />
                {errors.customerId ? <span className="app-field__error" role="alert">{errors.customerId}</span> : null}
              </>
            )}
          </div>
          <div className="app-rates-form__wide">
            {isEdit ? (
              <div className="app-rates-fixed">
                <span className="app-rates-fixed__label">Item de taxa</span>
                <span>
                  {row?.charge_item?.name ?? '—'}{' '}
                  <span className="app-rates-unit">
                    {row?.charge_item?.charge_table?.name} · {scopeLabel(row?.charge_item?.charge_table?.cargo_mode, row?.charge_item?.charge_table?.pod)}
                  </span>
                </span>
              </div>
            ) : (
              <>
                <Combobox
                  label="Item de taxa *"
                  placeholder={itemsQuery.isLoading ? 'Carregando itens…' : 'Ex.: THD, B/L Fee, nome da tabela'}
                  disabled={itemsQuery.isLoading}
                  onValueChange={(text) => {
                    const current = selectedItem ? itemLabel(selectedItem) : ''
                    if (text !== current) update('chargeItemId', '')
                  }}
                  fetchOptions={fetchItems}
                  refreshKey={items.length}
                  onSelectOption={(option) => update('chargeItemId', option.value)}
                />
                {itemsQuery.error ? <span className="app-field__error" role="alert">Não foi possível carregar os itens de taxa.</span> : null}
                {errors.chargeItemId ? <span className="app-field__error" role="alert">{errors.chargeItemId}</span> : null}
                <span className="app-field__hint">Só itens automáticos ativos. Item manual não recebe condição pelo cadastro.</span>
              </>
            )}
          </div>
          {selectedItem ? (
            <p className="app-rates-form__wide app-rates-form__context">
              Valor da tabela: <strong className="app-rates-num">{formatRate(currency, tableValue)}</strong> {basisUnit(selectedItem.application_basis)}
            </p>
          ) : null}
          <Field label={`Valor negociado (${currencyPrefix(currency)})`} required error={errors.overrideValue} hint={difference ?? `Cobrado ${selectedItem ? basisUnit(selectedItem.application_basis) : 'na mesma base do item'}.`}>
            <MoneyInput
              prefix={currencyPrefix(currency)}
              suffix={selectedItem ? basisUnit(selectedItem.application_basis) : undefined}
              value={form.overrideValue}
              onChange={(event) => update('overrideValue', event.target.value)}
              placeholder="0,00"
            />
          </Field>
          <div className="app-rates-form__spacer" aria-hidden="true" />
          <Field label="Vigência inicial">
            <Input type="date" value={form.validFrom} onChange={(event) => update('validFrom', event.target.value)} />
          </Field>
          <Field label="Vigência final" error={errors.validTo}>
            <Input type="date" value={form.validTo} onChange={(event) => update('validTo', event.target.value)} />
          </Field>
          <p className="app-rates-form__wide app-rates-help">
            Vale para o B/L cuja data de referência (ETA da escala do POD; sem ela, ETA da viagem ou a data do cálculo) cai no período. Vazio é sem limite. Não pode sobrepor outra condição ativa do mesmo Cliente e item: para trocar o valor, encerre a anterior.
          </p>
          <ChargeNoteList notes={notes} className="app-rates-form__wide" />
          <div className="app-rates-form__wide">
            <Field label="Observações">
              <Textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={2} placeholder="Contrato, proposta ou negociação de origem" />
            </Field>
          </div>
        </div>

        {isEdit ? <ChargeChanges changes={changes} consequence="Vale para cálculos novos e recálculos de B/L ainda não faturado deste Cliente. Faturas emitidas não mudam." /> : null}
        {saveError ? <InlineError message={saveError} /> : null}

        <div className="app-rates-form__footer">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button type="submit" loading={saving} loadingLabel="Salvando…" disabled={isEdit && changes.length === 0}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
