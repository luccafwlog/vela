import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { CUSTOMER_COMMUNICATION_BOXES } from '../../services/customerCommunicationBoxes'
import type { CreateCustomerForm, CustomerContactForm, CustomerCreateErrors } from './customerCreateForm'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../../lib/cnpj'

/**
 * Cadastro manual. Identidade em duas colunas e endereço numa linha compacta
 * (Notas ficam só na ficha); os contatos vêm depois, com um único principal
 * (rádio) e as Caixas de Comunicação de cada um. O principal nasce em todas as
 * caixas. Quem provisiona o Portal pode, no mesmo envio, mandar o convite ao
 * e-mail do contato principal.
 */
export function CreateCustomerModal({
  open,
  form,
  errors,
  saving,
  canInvitePortal,
  cnpjLookup,
  existingCustomer,
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
  /** Documentação e Administrativo: a Edge Function `portal-invite-send` recusa os demais. */
  canInvitePortal: boolean
  /** Consulta do CNPJ na Receita (ADR 0127); null antes de o CNPJ ficar válido. */
  cnpjLookup: CnpjLookupState | null
  /** Cliente já cadastrado com o CNPJ digitado: um Cliente por CNPJ. */
  existingCustomer: { name: string; cnpj: string; message: string } | null
  onClose: () => void
  onSubmit: () => void
  onFieldChange: <K extends keyof Omit<CreateCustomerForm, 'contacts'>>(field: K, value: CreateCustomerForm[K]) => void
  onContactChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onSetPrimary: (index: number) => void
  onAddContact: () => void
  onRemoveContact: (index: number) => void
}) {
  const primaryGroup = useId()
  const primaryEmail = form.contacts.find((contact) => contact.is_primary)?.email.trim().toLowerCase() ?? ''
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
            <Field label="CNPJ" required error={errors.cnpjCpf ?? existingCustomer?.message} hint={cnpjLookupHint(cnpjLookup)}>
              <Input maxLength={CNPJ_INPUT_MAX_LENGTH} inputMode="text" autoComplete="off" value={form.cnpjCpf} onChange={(event) => onFieldChange('cnpjCpf', normalizeCnpj(event.target.value))} />
            </Field>
            <Field label="Razão social" required error={errors.name}>
              <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} />
            </Field>
            {existingCustomer ? (
              <p className="app-customer-form__wide m-0">
                <Link className="app-link" to={`/clientes/${encodeURIComponent(existingCustomer.cnpj)}`}>
                  Abrir a ficha de {existingCustomer.name}
                </Link>
              </p>
            ) : null}
            <Field label="Nome fantasia">
              <Input value={form.tradeName} onChange={(event) => onFieldChange('tradeName', event.target.value)} />
            </Field>
            <Field label="CEP">
              <Input inputMode="numeric" value={form.zip} onChange={(event) => onFieldChange('zip', event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_72px]">
            <Field label="Endereço">
              <Input value={form.address} onChange={(event) => onFieldChange('address', event.target.value)} />
            </Field>
            <Field label="Cidade">
              <Input value={form.city} onChange={(event) => onFieldChange('city', event.target.value)} />
            </Field>
            <Field label="UF">
              <Input maxLength={2} value={form.state} onChange={(event) => onFieldChange('state', event.target.value.toUpperCase())} />
            </Field>
          </div>
        </section>

        {/* O texto sob o CNPJ muda sozinho; esta região o anuncia ao leitor de tela. */}
        <p className="sr-only" role="status">{cnpjLookup && cnpjLookup.state !== 'buscando' ? cnpjLookupHint(cnpjLookup) : ''}</p>

        <section className="app-customer-form__section" aria-labelledby={`${primaryGroup}-contacts`}>
          <div className="app-customer-form__head">
            <div>
              <h3 id={`${primaryGroup}-contacts`} className="app-customer-form__title">Contatos</h3>
              <p className="app-customer-form__intro">Quem recebe os Comunicados. Todo contato precisa de e-mail; o principal recebe todas as caixas.</p>
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

        {canInvitePortal ? (
          <section className="app-customer-form__section" aria-labelledby={`${primaryGroup}-portal`}>
            <h3 id={`${primaryGroup}-portal`} className="app-customer-form__title">Portal do Cliente</h3>
            <label className="app-customer-box" data-checked={form.sendPortalInvite ? 'true' : 'false'}>
              <input
                type="checkbox"
                checked={form.sendPortalInvite}
                onChange={(event) => onFieldChange('sendPortalInvite', event.target.checked)}
              />
              <span>
                <span className="app-customer-box__label">Enviar o convite do Portal agora</span>
                <span className="app-customer-box__desc">
                  {form.sendPortalInvite
                    ? `O convite vai para ${primaryEmail || 'o e-mail do contato principal'} logo depois do cadastro.`
                    : 'Opcional. Sem marcar, o Cliente entra na fila de Clientes › Portal como "Aguardando análise".'}
                </span>
              </span>
            </label>
          </section>
        ) : null}

        {errors.submit ? <InlineError message={errors.submit} /> : null}

        <div className="app-modal__actions">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" loading={saving} loadingLabel="Cadastrando…">
            {canInvitePortal && form.sendPortalInvite ? 'Cadastrar e convidar' : 'Cadastrar cliente'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export type CnpjLookupState =
  | { state: 'buscando' }
  | { state: 'encontrado'; situacao: string }
  | { state: 'nao_encontrado' }
  | { state: 'indisponivel' }

function cnpjLookupHint(lookup: CnpjLookupState | null): string {
  if (!lookup) return 'Com ou sem pontuação; letras são aceitas. Com o CNPJ completo, os dados da Receita entram sozinhos.'
  switch (lookup.state) {
    case 'buscando': return 'Buscando os dados na Receita…'
    case 'nao_encontrado': return 'CNPJ não encontrado na Receita. Preencha os dados à mão.'
    case 'indisponivel': return 'Consulta à Receita indisponível agora. Preencha os dados à mão.'
    case 'encontrado':
      return lookup.situacao && lookup.situacao !== 'ATIVA'
        ? `Situação na Receita: ${lookup.situacao}. Dados preenchidos nos campos vazios; confira antes de cadastrar.`
        : 'Dados da Receita preenchidos nos campos vazios. Confira antes de cadastrar.'
  }
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
        <Field label="E-mail" required>
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
