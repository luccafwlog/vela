import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useActiveConditionCount } from '../../hooks/useLocalCharges'
import { userFacingErrorMessage } from '../../lib/errors'
import { validateTableItemInput } from '../../pages/taxasLocaisHelpers'
import type { ChargeTableItemInput } from '../../services/charges/chargeTableService'
import {
  APPLICATION_BASIS_OPTIONS,
  CARGO_PROFILE_OPTIONS,
  basisUnit,
  cargoProfileLabel,
  currencyPrefix,
  formatRate,
  itemEngineNotes,
  itemUnitValue,
  scopeLabel,
  type ChargeItem,
  type ChargeTable,
} from './chargePresentation'
import { ChargeChanges, ChargeNoteList, MoneyInput, type ChargeChange } from './ChargeFormParts'
import { EMPTY_TABLE_ITEM_FORM, type ChargeTableItemForm } from './chargeForms'
import { toAmount } from '../../pages/taxasLocaisHelpers'

function formFromItem(tableId: number, item: ChargeItem | null): ChargeTableItemForm {
  if (!item) return { ...EMPTY_TABLE_ITEM_FORM, chargeTableId: String(tableId) }
  return {
    id: item.id,
    chargeTableId: String(tableId),
    name: item.name ?? '',
    category: item.category === 'other_charge' ? 'other_charge' : 'base',
    applicationBasis: (item.application_basis ?? 'bl') as ChargeTableItemForm['applicationBasis'],
    cargoProfile: (item.cargo_profile ?? 'any') as ChargeTableItemForm['cargoProfile'],
    currency: item.currency === 'USD' ? 'USD' : 'BRL',
    unitValue: String(itemUnitValue(item)).replace('.', ','),
    manualOnly: Boolean(item.manual_only),
    appliesToSoc: item.applies_to_soc !== false,
    active: item.active !== false,
    sortOrder: String(Number(item.sort_order ?? 100)),
  }
}

const CATEGORY_LABEL = { base: 'Taxa base', other_charge: 'Outra cobrança' }

function itemChanges(original: ChargeItem, form: ChargeTableItemForm): ChargeChange[] {
  const value = toAmount(form.unitValue)
  return [
    { field: 'Nome', before: original.name ?? '', after: form.name.trim() },
    { field: 'Entra no cálculo', before: original.manual_only ? 'Só manual' : 'Automático', after: form.manualOnly ? 'Só manual' : 'Automático' },
    { field: 'Incide', before: basisUnit(original.application_basis), after: basisUnit(form.applicationBasis) },
    { field: 'Perfil da carga', before: cargoProfileLabel(original.cargo_profile), after: cargoProfileLabel(form.cargoProfile) },
    {
      field: 'Valor unitário',
      before: formatRate(original.currency, itemUnitValue(original)),
      after: Number.isFinite(value) ? formatRate(form.currency, value) : form.unitValue,
    },
    { field: 'Container SOC', before: original.applies_to_soc === false ? 'Não cobra' : 'Cobra', after: form.appliesToSoc ? 'Cobra' : 'Não cobra' },
    { field: 'Categoria', before: CATEGORY_LABEL[original.category === 'other_charge' ? 'other_charge' : 'base'], after: CATEGORY_LABEL[form.category] },
    { field: 'Ordem de exibição', before: String(Number(original.sort_order ?? 100)), after: form.sortOrder.trim() },
  ].filter((change) => change.before !== change.after)
}

/**
 * Item de Taxa de uma tabela. A tabela vem do contexto (o item nasce dentro
 * dela); ativar e desativar ficam no menu da linha, que é do Administrativo.
 */
export function ChargeTableItemFormModal({
  open,
  table,
  item,
  onClose,
  onSave,
}: {
  open: boolean
  table: ChargeTable
  item: ChargeItem | null
  onClose: () => void
  onSave: (input: ChargeTableItemInput) => Promise<void>
}) {
  const [form, setForm] = useState<ChargeTableItemForm>(() => formFromItem(table.id, item))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(item)
  // Condição de Cliente guarda o valor na moeda do item: com alguma ativa, a
  // moeda fica travada (o banco também recusa, migration 172).
  const conditions = useActiveConditionCount(item?.id ?? null)
  const currencyLocked = isEdit && (conditions.data ?? 0) > 0
  const lockedCurrency = item?.currency === 'USD' ? 'USD' : 'BRL'

  const changes = useMemo(() => (item ? itemChanges(item, form) : []), [item, form])
  const notes = useMemo(
    () => itemEngineNotes({ name: form.name, application_basis: form.applicationBasis, cargo_profile: form.cargoProfile, manual_only: form.manualOnly }),
    [form.name, form.applicationBasis, form.cargoProfile, form.manualOnly],
  )
  const basis = APPLICATION_BASIS_OPTIONS.find((option) => option.value === form.applicationBasis)
  const perContainer = form.applicationBasis === 'container_distinct_voyage'

  function update<K extends keyof ChargeTableItemForm>(key: K, value: ChargeTableItemForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key as string]) return current
      const next = { ...current }
      delete next[key as string]
      return next
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const result = validateTableItemInput(form)
    if (!result.ok) {
      setErrors({ [result.field ?? 'name']: result.error })
      return
    }
    if (isEdit && changes.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({
        id: form.id,
        chargeTableId: result.value.chargeTableId,
        name: form.name,
        category: form.category,
        applicationBasis: form.applicationBasis,
        cargoProfile: form.cargoProfile,
        currency: form.currency,
        unitValue: result.value.unitValue,
        manualOnly: form.manualOnly,
        appliesToSoc: form.appliesToSoc,
        // Ativar/desativar é do Administrativo (ADR 0073): o formulário
        // preserva a situação atual.
        active: form.active,
        sortOrder: result.value.sortOrder,
      })
    } catch (error) {
      setSaveError(userFacingErrorMessage(error, 'Não foi possível salvar o item.'))
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = isEdit
    ? changes.length === 0 ? 'Nenhuma alteração' : `Salvar ${changes.length === 1 ? '1 alteração' : `${changes.length} alterações`}`
    : 'Cadastrar item'

  return (
    <Modal open={open} title={isEdit ? `Editar item ${item?.name ?? ''}` : 'Novo item de taxa'} onClose={saving ? () => undefined : onClose} size="md">
      <form className="app-rates-form" onSubmit={handleSubmit} noValidate>
        <p className="app-rates-form__context">
          Tabela <strong>{table.name}</strong> · {scopeLabel(table.cargo_mode, table.pod)}
        </p>
        <div className="app-rates-form__grid">
          <div className="app-rates-form__wide">
            <Field label="Nome do item" required error={errors.name} hint={'Itens que começam com "THD" separam containers por perfil.'}>
              <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Ex.: THD, B/L Fee, ISPS" maxLength={160} />
            </Field>
          </div>
          <div className="app-rates-form__wide app-field">
            <span className="app-field__label" aria-hidden="true">Entra no cálculo</span>
            <SegmentedControl
              label="Entra no cálculo"
              value={form.manualOnly ? 'manual' : 'auto'}
              onChange={(value) => update('manualOnly', value === 'manual')}
              options={[{ value: 'auto', label: 'Automático' }, { value: 'manual', label: 'Só manual' }]}
            />
            <span className="app-field__hint">
              {form.manualOnly
                ? 'Nunca é aplicado sozinho: fica disponível para lançar na ficha do B/L e na fatura avulsa.'
                : 'Aplicado a todo B/L do escopo quando esta tabela é a aplicada no cálculo.'}
            </span>
          </div>
          <Field label="Incide" required hint={basis?.hint}>
            <Select value={form.applicationBasis} onChange={(event) => update('applicationBasis', event.target.value as ChargeTableItemForm['applicationBasis'])}>
              {APPLICATION_BASIS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {/* TEU nunca foi calculado pelo motor (migration 264): a opção só
                  aparece, desativada, para o item legado abrir com o valor certo. */}
              {form.applicationBasis === 'teu' ? <option value="teu" disabled>Por TEU (legado, não calculado)</option> : null}
            </Select>
          </Field>
          <Field label="Perfil da carga" hint={perContainer ? 'Só itens THD por container separam por perfil.' : 'Não muda a cobrança desta base.'}>
            <Select value={form.cargoProfile} onChange={(event) => update('cargoProfile', event.target.value as ChargeTableItemForm['cargoProfile'])}>
              {CARGO_PROFILE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <div className="app-field">
            <span className="app-field__label" aria-hidden="true">Moeda</span>
            <SegmentedControl
              label="Moeda"
              value={form.currency}
              onChange={(value) => update('currency', value)}
              options={[
                { value: 'BRL', label: 'Real (R$)', disabled: currencyLocked && lockedCurrency !== 'BRL' },
                { value: 'USD', label: 'Dólar (US$)', disabled: currencyLocked && lockedCurrency !== 'USD' },
              ]}
            />
            {currencyLocked ? (
              <span className="app-field__hint">
                {conditions.data === 1 ? '1 condição de Cliente ativa usa' : `${conditions.data} condições de Cliente ativas usam`} o valor nesta moeda. Para cobrar em outra moeda, cadastre um item novo e recadastre as condições nele.
              </span>
            ) : form.currency === 'USD' ? <span className="app-field__hint">Convertido em reais pelo ROE na emissão da fatura.</span> : null}
          </div>
          <Field label={`Valor unitário (${currencyPrefix(form.currency)})`} required error={errors.unitValue} hint={`Cobrado ${basisUnit(form.applicationBasis)}.`}>
            <MoneyInput
              prefix={currencyPrefix(form.currency)}
              suffix={basisUnit(form.applicationBasis)}
              value={form.unitValue}
              onChange={(event) => update('unitValue', event.target.value)}
              placeholder="0,00"
            />
          </Field>
          {perContainer ? (
            <label className="app-rates-form__wide app-rates-check">
              <input type="checkbox" checked={form.appliesToSoc} onChange={(event) => update('appliesToSoc', event.target.checked)} />
              <span>
                Cobrar também de container SOC
                <span className="app-field__hint">Desmarque para taxas que não valem para container do cliente, como Drop Off e Damage Protection.</span>
              </span>
            </label>
          ) : null}
          <Field label="Categoria na fatura">
            <Select value={form.category} onChange={(event) => update('category', event.target.value as ChargeTableItemForm['category'])}>
              <option value="base">Taxa base</option>
              <option value="other_charge">Outra cobrança</option>
            </Select>
          </Field>
          <Field label="Ordem de exibição" error={errors.sortOrder} hint="Menor aparece primeiro na tabela e na fatura.">
            <Input inputMode="numeric" value={form.sortOrder} onChange={(event) => update('sortOrder', event.target.value)} className="app-rates-code" />
          </Field>
          <ChargeNoteList notes={notes} className="app-rates-form__wide" />
        </div>

        {isEdit ? <ChargeChanges changes={changes} consequence="Vale para cálculos novos e recálculos de B/L ainda não faturado. Faturas emitidas não mudam." /> : null}
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
