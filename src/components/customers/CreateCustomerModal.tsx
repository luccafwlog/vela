import { useId } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { CUSTOMER_COMMUNICATION_BOXES } from '../../services/customerCommunicationBoxes'
import type { CreateCustomerForm, CustomerContactForm, CustomerCreateErrors } from './customerCreateForm'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../../lib/cnpj'

/**
 * Cadastro manual. Identidade e endereço em duas colunas; os contatos vêm
 * depois, com um único principal (rádio) e as Caixas de Comunicação de cada
 * um. O principal nasce em todas as caixas.
 */
export function CreateCustomerModal({
  open,
  form,
  errors,
  saving,
  onClose,
  onSubmit,
  onFieldChange,
  onContactChange,
  onSetPrimary,
  onAddContact,
  onRemoveContact,
}: {
  open: boolean
  form: CreateCustomerForm
  errors: CustomerCreateErrors
  saving: boolean
  onClose: () => void
  onSubmit: () => void
  onFieldChange: <K extends keyof Omit<CreateCustomerForm, 'contacts'>>(field: K, value: CreateCustomerForm[K]) => void
  onContactChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onSetPrimary: (index: number) => void
  onAddContact: () => void
  onRemoveContact: (index: number) => void
}) {
  const primaryGroup = useId()
  return (
    <Modal open={open} onClose={onClose} title="Novo cliente">
      <form
        className="app-customer-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <section className="app-customer-form__section" aria-labelledby={`${primaryGroup}-identity`}>
          <h3 id={`${primaryGroup}-identity`} className="app-customer-form__title">Dados cadastrais</h3>
          <div className="app-customer-form__grid">
            <Field label="CNPJ" required error={errors.cnpjCpf} hint="Com ou sem pontuação; letras são aceitas.">
              <Input maxLength={CNPJ_INPUT_MAX_LENGTH} inputMode="text" autoComplete="off" value={form.cnpjCpf} onChange={(event) => onFieldChange('cnpjCpf', normalizeCnpj(event.target.value))} />
            </Field>
            <Field label="Razão social" required error={errors.name}>
              <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} />
            </Field>
            <Field label="Nome fantasia">
              <Input value={form.tradeName} onChange={(event) => onFieldChange('tradeName', event.target.value)} />
            </Field>
            <Field label="CEP">
              <Input inputMode="numeric" value={form.zip} onChange={(event) => onFieldChange('zip', event.target.value)} />
            </Field>
            <div className="app-customer-form__wide">
              <Field label="Endereço">
                <Input value={form.address} onChange={(event) => onFieldChange('address', event.target.value)} />
              </Field>
            </div>
            <Field label="Cidade">
              <Input value={form.city} onChange={(event) => onFieldChange('city', event.target.value)} />
            </Field>
            <Field label="UF">
              <Input maxLength={2} value={form.state} onChange={(event) => onFieldChange('state', event.target.value.toUpperCase())} />
            </Field>
            <div className="app-customer-form__wide">
              <Field label="Notas">
                <Textarea rows={2} value={form.notes} onChange={(event) => onFieldChange('notes', event.target.value)} />
              </Field>
            </div>
          </div>
        </section>

        <section className="app-customer-form__section" aria-labelledby={`${primaryGroup}-contacts`}>
          <div className="app-customer-form__head">
            <div>
              <h3 id={`${primaryGroup}-contacts`} className="app-customer-form__title">Contatos</h3>
              <p className="app-customer-form__intro">Quem recebe os Comunicados. O contato principal precisa de e-mail e recebe todas as caixas.</p>
            </div>
            <Button type="button" variant="secondary" onClick={onAddContact}>
              <Plus size={16} aria-hidden="true" />
              Adicionar contato
            </Button>
          </div>

          {form.contacts.map((contact, index) => (
            <ContactFields
              key={contact._id}
              contact={contact}
              index={index}
              radioName={`${primaryGroup}-primary`}
              removable={form.contacts.length > 1}
              onChange={onContactChange}
              onSetPrimary={onSetPrimary}
              onRemove={onRemoveContact}
            />
          ))}
          {errors.contacts ? <InlineError message={errors.contacts} /> : null}
        </section>

        {errors.submit ? <InlineError message={errors.submit} /> : null}

        <div className="app-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" loading={saving} loadingLabel="Cadastrando…">
            Cadastrar cliente
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ContactFields({
  contact,
  index,
  radioName,
  removable,
  onChange,
  onSetPrimary,
  onRemove,
}: {
  contact: CustomerContactForm
  index: number
  radioName: string
  removable: boolean
  onChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onSetPrimary: (index: number) => void
  onRemove: (index: number) => void
}) {
  const legend = contact.name.trim() || `Contato ${index + 1}`
  return (
    <fieldset className="app-customer-contact" data-primary={contact.is_primary ? 'true' : undefined}>
      <legend className="sr-only">{legend}</legend>
      <div className="app-customer-contact__head">
        <label className="app-customer-contact__primary">
          <input type="radio" name={radioName} checked={contact.is_primary} onChange={() => onSetPrimary(index)} />
          <span>Contato principal</span>
        </label>
        {removable ? (
          <Button type="button" variant="ghost" className="app-btn--sm" onClick={() => onRemove(index)} aria-label={`Remover ${legend}`}>
            <Trash2 size={16} aria-hidden="true" />
            Remover
          </Button>
        ) : null}
      </div>
      <div className="app-customer-contact__fields">
        <Field label="Nome">
          <Input value={contact.name} onChange={(event) => onChange(index, { name: event.target.value })} />
        </Field>
        <Field label="E-mail" required={contact.is_primary}>
          <Input type="email" autoComplete="off" value={contact.email} onChange={(event) => onChange(index, { email: event.target.value })} />
        </Field>
        <Field label="Telefone">
          <Input type="tel" value={contact.phone} onChange={(event) => onChange(index, { phone: event.target.value })} />
        </Field>
      </div>
      <BoxChoices
        legend={`Caixas de ${legend}`}
        selected={contact.box_codes}
        lockedAll={contact.is_primary}
        onToggle={(code) => {
          const checked = contact.box_codes.includes(code)
          onChange(index, { box_codes: checked ? contact.box_codes.filter((item) => item !== code) : [...contact.box_codes, code] })
        }}
      />
    </fieldset>
  )
}

/** Caixas de Comunicação como caixas de seleção; o principal fica em todas. */
function BoxChoices({
  legend,
  selected,
  lockedAll,
  onToggle,
}: {
  legend: string
  selected: string[]
  lockedAll: boolean
  onToggle: (code: (typeof CUSTOMER_COMMUNICATION_BOXES)[number]['code']) => void
}) {
  return (
    <fieldset className="app-customer-boxes">
      <legend className="app-customer-boxes__legend">
        Caixas de recebimento
        <span className="sr-only">{` — ${legend}`}</span>
      </legend>
      {lockedAll ? <p className="app-customer-boxes__hint">O contato principal recebe todas as caixas no cadastro.</p> : null}
      <div className="app-customer-boxes__grid">
        {CUSTOMER_COMMUNICATION_BOXES.map((box) => (
          <label key={box.code} className="app-customer-box" data-checked={selected.includes(box.code) ? 'true' : 'false'}>
            <input
              type="checkbox"
              checked={selected.includes(box.code)}
              disabled={lockedAll}
              onChange={() => onToggle(box.code)}
            />
            <span>
              <span className="app-customer-box__label">{box.label}</span>
              <span className="app-customer-box__desc">{box.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
