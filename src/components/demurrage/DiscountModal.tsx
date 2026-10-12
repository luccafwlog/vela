import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { DISCOUNT_TYPE_LABELS, type DiscountForm } from '../../services/demurrage/demurrageForms'
import { discountPreview, fmtUSD } from '../../services/demurrage/demurragePresentation'
import type { DemurrageInvoice } from '../../types/database'

export type DiscountFieldErrors = Partial<Record<'discount_value' | 'discount_justification' | 'form', string>>

type Props = {
  open: boolean
  docNumber?: string | null
  totalUsd?: number | null
  hadDiscount?: boolean
  form: DiscountForm
  loading: boolean
  errors?: DiscountFieldErrors
  onFormChange: (form: DiscountForm) => void
  onClose: () => void
  onSubmit: () => void
}

/**
 * Desconto em USD, antes da conversão para BRL (ADR 0014; RPC
 * `apply_demurrage_discount`). A justificativa é exigida pela RPC em toda
 * alteração, inclusive para tirar o desconto.
 */
export function DiscountModal({ open, docNumber, totalUsd, hadDiscount = false, form, loading, errors = {}, onFormChange, onClose, onSubmit }: Props) {
  const preview = totalUsd != null ? discountPreview(totalUsd, form.discount_mode, form.discount_value) : null
  const removing = hadDiscount && !String(form.discount_value ?? '').trim()

  return (
    <Modal open={open} onClose={onClose} title={docNumber ? `Desconto da Invoice ${docNumber}` : 'Desconto'} size="md">
      <form className="app-dem-form" noValidate onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        <div className="app-dem-form__grid">
          <Field label="Tipo de desconto">
            <Select
              value={form.discount_type ?? ''}
              onChange={(event) => onFormChange({ ...form, discount_type: (event.target.value || null) as DemurrageInvoice['discount_type'] })}
            >
              <option value="">Não classificado</option>
              {(Object.entries(DISCOUNT_TYPE_LABELS) as [NonNullable<DemurrageInvoice['discount_type']>, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>
          <div className="app-field">
            <span className="app-field__label" id="dem-discount-mode">Como descontar</span>
            <SegmentedControl
              label="Como descontar"
              value={form.discount_mode}
              onChange={(mode) => onFormChange({ ...form, discount_mode: mode })}
              options={[
                { value: 'percent', label: 'Percentual (%)' },
                { value: 'fixed', label: 'Valor fixo (USD)' },
              ]}
            />
          </div>
        </div>
        <Field
          label={form.discount_mode === 'fixed' ? 'Desconto em USD' : 'Desconto em %'}
          error={errors.discount_value}
          hint={hadDiscount ? 'Deixe em branco para tirar o desconto.' : form.discount_mode === 'fixed' ? 'Não pode passar do total da Invoice.' : 'De 0 a 100.'}
        >
          <Input
            inputMode="decimal"
            value={form.discount_value}
            onChange={(event) => onFormChange({ ...form, discount_value: event.target.value })}
          />
        </Field>
        {totalUsd != null ? (
          <dl className="app-dem-facts" aria-live="polite">
            <div><dt>Total dos itens</dt><dd>{fmtUSD(totalUsd)}</dd></div>
            <div><dt>Desconto</dt><dd>{preview ? `− ${fmtUSD(preview.discountUsd)}` : '—'}</dd></div>
            <div><dt>USD a cobrar</dt><dd className="app-dem-strong">{fmtUSD(preview ? preview.netUsd : totalUsd)}</dd></div>
          </dl>
        ) : null}
        <Field label="Justificativa" required error={errors.discount_justification} hint="Fica no Histórico da Invoice.">
          <Textarea rows={2} value={form.discount_justification} onChange={(event) => onFormChange({ ...form, discount_justification: event.target.value })} />
        </Field>
        <Field label="Aprovador">
          <Input type="text" value={form.discount_approver} onChange={(event) => onFormChange({ ...form, discount_approver: event.target.value })} />
        </Field>
        <p className="app-dem-note">O BRL e o PIX são recalculados na hora. Com desconto, datas alteradas depois não reemitem a Invoice sozinhas: ela sai da Régua e espera reemissão à mão.</p>
        {errors.form ? <p className="app-dem-form__error" role="alert">{errors.form} O desconto não foi alterado.</p> : null}
        <div className="app-dem-form__actions">
          <Button type="button" variant="ghost" onClick={onClose}>Voltar</Button>
          <Button type="submit" loading={loading} loadingLabel="Salvando…">{removing ? 'Tirar desconto' : 'Salvar desconto'}</Button>
        </div>
      </form>
    </Modal>
  )
}
