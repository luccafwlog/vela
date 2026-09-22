import { useState } from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewCustomer } from '../../hooks/useReview'
import { CNPJ_INPUT_MAX_LENGTH, canonicalizeValidCnpj, formatCnpj, normalizeCnpj } from '../../lib/cnpj'
import type { ReviewGroup } from '../../pages/revisaoHelpers'

type CustomerLookupResult = ReviewCustomer & { city?: string | null; state?: string | null }

export type ReviewCustomerOnboardingInput = {
  customerId: number | null
  cnpjCpf: string
  name: string
  email: string
  sendPortalInvite: boolean
}

export function ReviewCustomerOnboarding({
  group,
  existingCustomerId,
  existingCustomer,
  initialName,
  initialCnpj,
  initialEmail,
  saving,
  onSelectExistingCustomer,
  onSubmit,
}: {
  group: ReviewGroup
  existingCustomerId: number | null
  existingCustomer: ReviewCustomer | null
  initialName: string
  initialCnpj: string
  initialEmail: string
  saving: boolean
  onSelectExistingCustomer: (customer: ReviewCustomer) => void
  onSubmit: (input: ReviewCustomerOnboardingInput) => void
}) {
  const [name, setName] = useState(initialName)
  const [cnpj, setCnpj] = useState(initialCnpj)
  const [email, setEmail] = useState(initialEmail)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(existingCustomerId)
  const [selectedCustomer, setSelectedCustomer] = useState<ReviewCustomer | null>(existingCustomer)
  const [sendPortalInvite, setSendPortalInvite] = useState(false)
  const validCnpj = canonicalizeValidCnpj(cnpj)
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const lookup = useCustomerLookup(search)
  const expectedCnpjs = group.candidateCnpjs.length ? group.candidateCnpjs : group.cnpj ? [group.cnpj] : []
  const selectedCustomerCnpjMismatch = Boolean(validCnpj && expectedCnpjs.length > 0 && !expectedCnpjs.includes(validCnpj))
  const canSubmit = Boolean(validCnpj && name.trim() && validEmail && !selectedCustomerCnpjMismatch && !saving && group.items.some((item) => item.source === 'bl'))
  const count = group.items.filter((item) => item.source === 'bl').length
  const customerAlreadyHasEmail = Boolean(selectedCustomer?.customer_contacts?.some((contact) => contact.email?.trim()))
  const cnpjHint = selectedCustomerCnpjMismatch
    ? 'O CNPJ selecionado não corresponde às evidências deste grupo.'
    : validCnpj
      ? `Confirmado: ${formatCnpj(validCnpj)}`
      : selectedId
        ? 'O cliente selecionado não possui um CNPJ válido para o onboarding; use o vínculo de cliente existente.'
        : undefined

  function clearSelectedCustomer() {
    setSelectedId(null)
    setSelectedCustomer(null)
  }

  function selectCustomer(customer: CustomerLookupResult) {
    const next: ReviewCustomer = { id: customer.id, name: customer.name, cnpj_cpf: customer.cnpj_cpf, customer_contacts: customer.customer_contacts ?? [] }
    setSelectedId(customer.id)
    setSelectedCustomer(next)
    setName(customer.name)
    setCnpj(customer.cnpj_cpf)
    setEmail(customer.customer_contacts?.find((contact) => contact.email?.trim())?.email ?? '')
    onSelectExistingCustomer(next)
  }

  return (
    <Card className="review-onboarding-card grid gap-4">
      <div>
        <div className="review-onboarding-card__title">Cadastrar ou vincular cliente</div>
        <p className="review-onboarding-card__intro">A ação vale para {count} B/Ls deste grupo. O vínculo só ocorre depois da confirmação do CNPJ.</p>
      </div>
      <Field label="Buscar cliente existente">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite ao menos 2 caracteres" />
      </Field>
      {lookup.data?.length ? (
        <div className="review-onboarding-card__lookup-results">
          {lookup.data.map((customer) => <button key={customer.id} type="button" className="review-onboarding-card__lookup-option" onClick={() => selectCustomer(customer as CustomerLookupResult)}><div className="font-semibold text-[var(--app-text-strong)]">{customer.name}</div><div className="text-xs text-[var(--app-muted)]">{formatCnpj(customer.cnpj_cpf)}</div></button>)}
        </div>
      ) : null}
      <div className="review-onboarding-card__identity-fields grid gap-3 md:grid-cols-2">
        <Field label="Razão social" required><Input value={name} onChange={(event) => { clearSelectedCustomer(); setName(event.target.value) }} /></Field>
        <Field label="CNPJ" required hint={cnpjHint}><Input maxLength={CNPJ_INPUT_MAX_LENGTH} placeholder="00.000.000/0000-00" value={cnpj} onChange={(event) => { clearSelectedCustomer(); setCnpj(normalizeCnpj(event.target.value)) }} /></Field>
      </div>
      <Field label="E-mail principal do cliente" required hint={email.trim() ? 'Será salvo como contato do cliente.' : 'O cliente precisa ter pelo menos um e-mail cadastrado.'}>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
      </Field>
      <div className="review-onboarding-card__invite-row">
        <label className="review-onboarding-card__invite">
          <input className="review-onboarding-card__checkbox" type="checkbox" checked={sendPortalInvite} onChange={(event) => setSendPortalInvite(event.target.checked)} />
          <span className="review-onboarding-card__invite-copy">Enviar convite do Portal para este mesmo e-mail <span className="review-onboarding-card__invite-hint">{sendPortalInvite ? `O convite será iniciado para ${email.trim().toLowerCase() || 'o e-mail informado acima'}.` : 'Opcional — você poderá iniciar o convite depois em Provisionamento do Portal.'}</span></span>
        </label>
        <div className="review-onboarding-card__footer">
          <Button disabled={!canSubmit} loading={saving} onClick={() => onSubmit({ customerId: selectedId, cnpjCpf: validCnpj!, name: name.trim(), email: email.trim().toLowerCase(), sendPortalInvite })}>
            {selectedId ? `Adicionar e-mail e vincular ${count} B/Ls` : `Criar cliente e vincular ${count} B/Ls`}
          </Button>
        </div>
      </div>
      {selectedId && selectedCustomer && customerAlreadyHasEmail ? <div className="review-onboarding-card__existing-note">Cliente existente selecionado. O e-mail informado será mantido como contato adicional se ainda não existir.</div> : null}
    </Card>
  )
}
