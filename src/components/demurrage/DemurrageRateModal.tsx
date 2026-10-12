import { useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import type { DemurrageRate } from '../../types/database'
import type { DemurrageRateUpsertInput } from '../../services/demurrage/demurrageRateUpsertPayload'
import { toDraftFromRate, validateRateDraft, type RateDraft, type RateErrors } from './demurrageFormRules'

type Props = {
  open: boolean
  rate: DemurrageRate | null
  saving: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (input: Omit<DemurrageRateUpsertInput, 'id' | 'active'>) => void
}

function RateForm({ rate, saving, error, onClose, onSubmit }: Omit<Props, 'open'>) {
  const [draft, setDraft] = useState<RateDraft>(() => toDraftFromRate(rate))
  const [errors, setErrors] = useState<RateErrors>({})

  function set<K extends keyof RateDraft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function submit() {
    const result = validateRateDraft(draft)
    setErrors(result.errors)
    if (result.input) onSubmit(result.input)
  }

  return (
    <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
      <div className="app-dem-form__grid">
        <Field label="Tipo de container" required error={errors.container_type} hint="Código ISO ou grupo, como 20GP, 40HC ou 40RF.">
          <Input value={draft.container_type} onChange={(event) => set('container_type', event.target.value.toUpperCase())} placeholder="20GP" className="app-dem-code" />
        </Field>
        <Field label="Free time (dias)" required error={errors.free_days}>
          <Input inputMode="numeric" value={draft.free_days} onChange={(event) => set('free_days', event.target.value)} />
        </Field>
      </div>
      <fieldset className="app-dem-fieldset">
        <legend>P1, primeira faixa</legend>
        <div className="app-dem-form__grid app-dem-form__grid--3">
          <Field label="Do dia" required error={errors.p1_day_from}>
            <Input inputMode="numeric" value={draft.p1_day_from} onChange={(event) => set('p1_day_from', event.target.value)} />
          </Field>
          <Field label="Até o dia" required error={errors.p1_day_to}>
            <Input inputMode="numeric" value={draft.p1_day_to} onChange={(event) => set('p1_day_to', event.target.value)} />
          </Field>
          <Field label="Diária (USD)" required error={errors.p1_usd}>
            <Input inputMode="decimal" value={draft.p1_usd} onChange={(event) => set('p1_usd', event.target.value)} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="app-dem-fieldset">
        <legend>P2, segunda faixa</legend>
        <div className="app-dem-form__grid">
          <Field label="A partir do dia" required error={errors.p2_day_from}>
            <Input inputMode="numeric" value={draft.p2_day_from} onChange={(event) => set('p2_day_from', event.target.value)} />
          </Field>
          <Field label="Diária (USD)" required error={errors.p2_usd}>
            <Input inputMode="decimal" value={draft.p2_usd} onChange={(event) => set('p2_usd', event.target.value)} />
          </Field>
        </div>
      </fieldset>
      <p className="app-dem-note">O free time do B/L ou do acordo do Cliente move só o início da cobrança; as faixas P1 e P2 continuam as desta tabela.</p>
      <div className="app-dem-form__grid">
        <Field label="Vigência de" hint="Em branco, vale a partir de hoje.">
          <Input type="date" value={draft.valid_from} onChange={(event) => set('valid_from', event.target.value)} />
        </Field>
        <Field label="Vigência até" error={errors.valid_to} hint="Em branco, sem data final.">
          <Input type="date" value={draft.valid_to} onChange={(event) => set('valid_to', event.target.value)} />
        </Field>
      </div>
      <Field label="Observações">
        <Input value={draft.notes} onChange={(event) => set('notes', event.target.value)} />
      </Field>
      {error ? <p className="app-dem-form__error" role="alert">{error} A tarifa não foi salva.</p> : null}
      <div className="app-dem-form__actions">
        <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
        <Button type="submit" loading={saving} loadingLabel="Salvando…">{rate ? 'Salvar tarifa' : 'Cadastrar tarifa'}</Button>
      </div>
    </form>
  )
}

export function DemurrageRateModal({ open, rate, ...props }: Props) {
  return (
    <Modal open={open} onClose={props.onClose} title={rate ? `Tarifa ${rate.container_type}` : 'Nova tarifa de Demurrage'} size="md">
      {open ? <RateForm key={rate?.id ?? 'new'} rate={rate} {...props} /> : null}
    </Modal>
  )
}
