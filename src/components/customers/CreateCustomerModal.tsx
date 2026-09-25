import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import {
  CUSTOMER_COMMUNICATION_BOXES,
} from '../../services/customerCommunicationBoxes'
import type { CreateCustomerForm, CustomerContactForm, CustomerCreateErrors } from './customerCreateForm'
import { CNPJ_INPUT_MAX_LENGTH, normalizeCnpj } from '../../lib/cnpj'

export function CreateCustomerModal({
  open,
  form,
  errors,
  saving,
  onClose,
  onSubmit,
  onFieldChange,
  onContactChange,
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
  onAddContact: () => void
  onRemoveContact: (index: number) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Novo Cliente">
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="CNPJ" error={errors.cnpjCpf}>
            <Input maxLength={CNPJ_INPUT_MAX_LENGTH} value={form.cnpjCpf} onChange={(event) => onFieldChange('cnpjCpf', normalizeCnpj(event.target.value))} />
          </Field>
          <Field label="Razao Social" error={errors.name}>
            <Input value={form.name} onChange={(event) => onFieldChange('name', event.target.value)} />
          </Field>
          <Field label="Nome fantasia">
            <Input value={form.tradeName} onChange={(event) => onFieldChange('tradeName', event.target.value)} />
          </Field>
          <Field label="Endereço">
            <Input value={form.address} onChange={(event) => onFieldChange('address', event.target.value)} />
          </Field>
          <Field label="Cidade">
            <Input value={form.city} onChange={(event) => onFieldChange('city', event.target.value)} />
          </Field>
          <Field label="UF">
            <Input value={form.state} onChange={(event) => onFieldChange('state', event.target.value.toUpperCase())} />
          </Field>
          <Field label="CEP">
            <Input value={form.zip} onChange={(event) => onFieldChange('zip', event.target.value)} />
          </Field>
        </div>

        <Field label="Notas">
          <Textarea value={form.notes} onChange={(event) => onFieldChange('notes', event.target.value)} />
        </Field>

        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-white">Contatos do cliente</div>
              <div className="text-sm text-slate-400">É obrigatório definir ao menos um contato principal com e-mail válido.</div>
            </div>
            <Button variant="secondary" onClick={onAddContact}>
              <Plus size={16} />
              Adicionar contato
            </Button>
          </div>

          <div className="grid gap-4">
            {form.contacts.map((contact, index) => (
              <ContactForm
                key={contact._id}
                contact={contact}
                index={index}
                onChange={onContactChange}
                onRemove={onRemoveContact}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button loading={saving} onClick={onSubmit}>
            Cadastrar cliente
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ContactForm({
  contact,
  index,
  onChange,
  onRemove,
}: {
  contact: CustomerContactForm
  index: number
  onChange: (index: number, patch: Partial<CustomerContactForm>) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-semibold text-white">Contato {index + 1}</div>
        <Button variant="ghost" onClick={() => onRemove(index)} aria-label="Remover contato">
          <Trash2 size={16} />
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Nome">
          <Input value={contact.name} onChange={(event) => onChange(index, { name: event.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={contact.email} onChange={(event) => onChange(index, { email: event.target.value })} />
        </Field>
        <Field label="Telefone">
          <Input value={contact.phone} onChange={(event) => onChange(index, { phone: event.target.value })} />
        </Field>
        <Field label="Principal">
          <Select
            value={contact.is_primary ? 'sim' : 'nao'}
            onChange={(event) => {
              const isPrimary = event.target.value === 'sim'
              onChange(index, {
                is_primary: isPrimary,
                box_codes: isPrimary
                  ? Array.from(new Set([...contact.box_codes, ...CUSTOMER_COMMUNICATION_BOXES.map((b) => b.code)]))
                  : contact.box_codes,
              })
            }}
          >
            <option value="nao">Não</option>
            <option value="sim">Sim</option>
          </Select>
        </Field>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
        <span className="text-xs font-semibold text-slate-300">Caixas de comunicação:</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
            const checked = contact.box_codes.includes(box.code)
            return (
              <label
                key={box.code}
                className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer ${
                  checked ? 'border-blue-500 bg-blue-950/30' : 'border-[#30363d] opacity-80'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-[#30363d] text-blue-600 focus:ring-blue-500"
                  checked={checked}
                  onChange={() => {
                    const nextBoxes = checked
                      ? contact.box_codes.filter((b) => b !== box.code)
                      : [...contact.box_codes, box.code]
                    onChange(index, { box_codes: nextBoxes })
                  }}
                />
                <div>
                  <div className="font-medium text-white">{box.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{box.description}</div>
                </div>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
