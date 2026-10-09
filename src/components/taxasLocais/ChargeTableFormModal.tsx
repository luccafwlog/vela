import { useId, useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { formatDate } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { validateTableInput } from '../../pages/taxasLocaisHelpers'
import type { ChargeTableInput } from '../../services/charges/chargeTableService'
import { CARGO_MODE_OPTIONS, cargoModeLabel, podOptions, previewTableState, type ChargeTable } from './chargePresentation'
import { ChargeChanges, ChargeNoteLine, type ChargeChange } from './ChargeFormParts'
import { EMPTY_TABLE_FORM, type ChargeTableForm } from './chargeForms'

function formFromTable(table: ChargeTable | null): ChargeTableForm {
  if (!table) return EMPTY_TABLE_FORM
  return {
    id: table.id,
    name: table.name ?? '',
    cargoMode: (table.cargo_mode ?? 'container') as ChargeTableForm['cargoMode'],
    pod: table.pod ?? '',
    validFrom: table.valid_from?.slice(0, 10) ?? '',
    validTo: table.valid_to?.slice(0, 10) ?? '',
    active: table.active !== false,
    notes: table.notes ?? '',
  }
}

function tableChanges(original: ChargeTable, form: ChargeTableForm): ChargeChange[] {
  return [
    { field: 'Nome', before: original.name ?? '', after: form.name.trim() },
    { field: 'Modo de carga', before: cargoModeLabel(original.cargo_mode), after: cargoModeLabel(form.cargoMode) },
    { field: 'POD', before: (original.pod ?? '').toUpperCase(), after: form.pod.trim().toUpperCase() },
    { field: 'Vigência inicial', before: formatDate(original.valid_from?.slice(0, 10)), after: formatDate(form.validFrom) },
    { field: 'Vigência final', before: original.valid_to ? formatDate(original.valid_to.slice(0, 10)) : 'Sem data final', after: form.validTo ? formatDate(form.validTo) : 'Sem data final' },
    { field: 'Observações', before: (original.notes ?? '').trim(), after: form.notes.trim() },
  ].filter((change) => change.before !== change.after)
}

/**
 * Cadastro e edição da Tabela de Taxas Locais. Mostra, antes de gravar, o que
 * a tabela vai ser no cálculo do escopo (aplicada, não aplicada, inativa) e,
 * na edição, as alterações campo a campo.
 */
export function ChargeTableFormModal({
  open,
  table,
  tables,
  onClose,
  onSave,
}: {
  open: boolean
  /** Tabela em edição; `null` cadastra uma nova. */
  table: ChargeTable | null
  tables: ChargeTable[]
  onClose: () => void
  onSave: (input: ChargeTableInput) => Promise<void>
}) {
  const [form, setForm] = useState<ChargeTableForm>(() => formFromTable(table))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const podListId = useId()
  const isEdit = Boolean(table)

  const changes = useMemo(() => (table ? tableChanges(table, form) : []), [table, form])
  const preview = useMemo(() => previewTableState(form, tables), [form, tables])
  const pods = useMemo(() => podOptions(tables), [tables])

  function update<K extends keyof ChargeTableForm>(key: K, value: ChargeTableForm[K]) {
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
    const result = validateTableInput(form)
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
        name: form.name,
        cargoMode: form.cargoMode,
        pod: form.pod,
        validFrom: form.validFrom,
        validTo: result.value.validTo,
        active: form.active,
        notes: form.notes || null,
      })
    } catch (error) {
      setSaveError(userFacingErrorMessage(error, 'Não foi possível salvar a tabela.'))
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = isEdit
    ? changes.length === 0 ? 'Nenhuma alteração' : `Salvar ${changes.length === 1 ? '1 alteração' : `${changes.length} alterações`}`
    : 'Cadastrar tabela'

  return (
    <Modal open={open} title={isEdit ? `Editar tabela ${table?.name ?? ''}` : 'Nova tabela de taxas'} onClose={saving ? () => undefined : onClose} size="md">
      <form className="app-rates-form" onSubmit={handleSubmit} noValidate>
        <div className="app-rates-form__grid">
          <div className="app-rates-form__wide">
            <Field label="Nome da tabela" required error={errors.name}>
              <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Ex.: Vitória Container 2027" maxLength={160} />
            </Field>
          </div>
          <Field label="Modo de carga" required>
            <Select value={form.cargoMode} onChange={(event) => update('cargoMode', event.target.value as ChargeTableForm['cargoMode'])}>
              {CARGO_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label="POD" required error={errors.pod} hint="Porto de descarga, em LOCODE (ex.: BRVIT).">
            <Input
              value={form.pod}
              onChange={(event) => update('pod', event.target.value.toUpperCase())}
              list={podListId}
              autoComplete="off"
              maxLength={12}
              className="app-rates-code"
            />
          </Field>
          <datalist id={podListId}>
            {pods.map((pod) => <option key={pod} value={pod} />)}
          </datalist>
          <Field label="Vigência inicial" required error={errors.validFrom}>
            <Input type="date" value={form.validFrom} onChange={(event) => update('validFrom', event.target.value)} />
          </Field>
          <Field label="Vigência final" error={errors.validTo}>
            <Input type="date" value={form.validTo} onChange={(event) => update('validTo', event.target.value)} />
          </Field>
          <p className="app-rates-form__wide app-rates-help">
            A vigência é informativa (ADR 0040): não liga nem desliga a tabela. Vale no cálculo a tabela ativa do modo de carga e POD; entre duas ativas, a de vigência inicial mais recente.
          </p>
          {!isEdit ? (
            <div className="app-rates-form__wide app-field">
              <span className="app-field__label" aria-hidden="true">Situação ao cadastrar</span>
              <SegmentedControl
                label="Situação ao cadastrar"
                value={form.active ? 'ativa' : 'inativa'}
                onChange={(value) => update('active', value === 'ativa')}
                options={[{ value: 'ativa', label: 'Ativa' }, { value: 'inativa', label: 'Inativa (preparar itens antes)' }]}
              />
            </div>
          ) : null}
          {preview ? <ChargeNoteLine note={preview} className="app-rates-form__wide" /> : null}
          <div className="app-rates-form__wide">
            <Field label="Observações">
              <Textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={2} placeholder="Versão, origem dos valores, premissas" />
            </Field>
          </div>
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
