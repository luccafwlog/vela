import { useEffect, useId, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { InlineCustomerPicker } from '../shared/ReviewInlineEditors'
import type { ReviewCustomer } from '../../hooks/useReview'
import { CNPJ_INPUT_MAX_LENGTH, canonicalizeValidCnpj, formatCnpj, normalizeCnpj } from '../../lib/cnpj'
import type { ReviewGroup } from '../../pages/revisaoHelpers'

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
  embedded = false,
  proposedCnpj = null,
  remainingNote,
  onCnpjChange,
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
  embedded?: boolean
  /** CNPJ escolhido nas evidências ("Usar este CNPJ"); `seq` muda a cada clique. */
  proposedCnpj?: { cnpj: string; seq: number } | null
  /** O que continuará pendente depois de concluir (por exemplo peso). */
  remainingNote?: string | null
  /** Avisa o CNPJ válido do formulário, para as evidências mostrarem qual está em uso. */
  onCnpjChange?: (cnpj: string | null) => void
  onSelectExistingCustomer: (customer: ReviewCustomer) => void
  onSubmit: (input: ReviewCustomerOnboardingInput) => void
}) {
  const [name, setName] = useState(initialName)
  const [cnpj, setCnpj] = useState(initialCnpj)
  const [email, setEmail] = useState(initialEmail)
  const [selectedId, setSelectedId] = useState<number | null>(existingCustomerId)
  const [selectedCustomer, setSelectedCustomer] = useState<ReviewCustomer | null>(existingCustomer)
  const [sendPortalInvite, setSendPortalInvite] = useState(false)
  const blockId = useId()

  // CNPJ escolhido nas evidências: ajusta o campo durante o render quando a
  // escolha muda (padrão "adjusting state when props change").
  const [appliedProposal, setAppliedProposal] = useState(proposedCnpj)
  if (proposedCnpj !== appliedProposal) {
    setAppliedProposal(proposedCnpj)
    if (proposedCnpj) {
      setCnpj(proposedCnpj.cnpj)
      if (selectedCustomer && canonicalizeValidCnpj(selectedCustomer.cnpj_cpf) !== proposedCnpj.cnpj) {
        setSelectedId(null)
        setSelectedCustomer(null)
      }
    }
  }

  const validCnpj = canonicalizeValidCnpj(cnpj)
  useEffect(() => {
    onCnpjChange?.(validCnpj)
  }, [validCnpj, onCnpjChange])
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const expectedCnpjs = group.candidateCnpjs.length ? group.candidateCnpjs : group.cnpj ? [group.cnpj] : []
  const selectedCustomerCnpjMismatch = Boolean(validCnpj && expectedCnpjs.length > 0 && !expectedCnpjs.includes(validCnpj))
  const count = group.items.filter((item) => item.source === 'bl').length
  const hasBl = count > 0
  const canSubmit = Boolean(validCnpj && name.trim() && validEmail && !selectedCustomerCnpjMismatch && !saving && hasBl)
  const customerAlreadyHasEmail = Boolean(selectedCustomer?.customer_contacts?.some((contact) => contact.email?.trim()))
  const cnpjHint = selectedCustomerCnpjMismatch
    ? undefined
    : validCnpj
      ? `Confirmado: ${formatCnpj(validCnpj)}`
      : selectedId
        ? 'O cliente selecionado não possui um CNPJ válido para o cadastro; vincule-o como cliente cadastrado.'
        : undefined
  const cnpjError = selectedCustomerCnpjMismatch
    ? `${formatCnpj(validCnpj)} não aparece no B/L. Use um dos CNPJs lidos: ${expectedCnpjs.map((value) => formatCnpj(value)).join(', ')}.`
    : undefined

  const blockReason = saving
    ? null
    : !hasBl
      ? 'Não há B/L neste grupo para vincular.'
      : !validCnpj
        ? 'Informe um CNPJ válido.'
        : selectedCustomerCnpjMismatch
          ? 'O CNPJ precisa ser um dos lidos no B/L.'
          : !name.trim()
            ? 'Informe a razão social.'
            : !validEmail
              ? 'Informe um e-mail válido.'
              : null

  function clearSelectedCustomer() {
    setSelectedId(null)
    setSelectedCustomer(null)
  }

  function selectCustomer(customer: ReviewCustomer) {
    const next: ReviewCustomer = { id: customer.id, name: customer.name, cnpj_cpf: customer.cnpj_cpf, customer_contacts: customer.customer_contacts ?? [] }
    setSelectedId(customer.id)
    setSelectedCustomer(next)
    setName(customer.name)
    setCnpj(customer.cnpj_cpf)
    setEmail(customer.customer_contacts?.find((contact) => contact.email?.trim())?.email ?? '')
    onSelectExistingCustomer(next)
  }

  const targetLabel = embedded ? 'este B/L' : `${count} ${count === 1 ? 'B/L' : 'B/Ls'}`
  const effect = selectedId
    ? `${embedded ? 'O B/L passa' : count === 1 ? 'O B/L passa' : 'Os B/Ls passam'} a ${selectedCustomer?.name ?? name.trim()}. Se o Portal desse cliente estiver ativo e não sobrar outra pendência, as taxas são recalculadas e a fatura pode ser emitida automaticamente.`
    : `Cliente novo ainda não tem Portal ativo: ${embedded || count === 1 ? 'o B/L continua' : 'os B/Ls continuam'} em revisão como “Portal não provisionado” até o Portal ficar ativo ou o Administrativo conceder a Liberação de faturamento sem Portal.`

  return (
    <section className={embedded ? 'review-onboarding review-onboarding--embedded' : 'review-onboarding'} aria-label="Cadastrar ou vincular cliente">
      <div>
        <h3 className="review-section-title">Cadastrar ou vincular cliente</h3>
        <p className="review-onboarding__intro">
          {embedded ? 'Vale somente para este B/L.' : `Vale para ${targetLabel} deste grupo.`} Escolha um cliente cadastrado ou preencha os dados para criar um novo.
        </p>
      </div>
      <InlineCustomerPicker
        label="Buscar cliente cadastrado"
        saving={saving}
        expectedCnpjs={expectedCnpjs}
        onSelect={selectCustomer}
      />
      {selectedId && selectedCustomer ? (
        <p className="review-onboarding__selected" role="status">
          Cliente cadastrado escolhido: <strong>{selectedCustomer.name}</strong>.
          {customerAlreadyHasEmail ? ' O e-mail abaixo já é contato dele; um endereço novo entra como contato adicional.' : ' Ele ainda não tem e-mail de contato; o informado abaixo será o principal.'}
          {' '}
          <button type="button" className="review-link-button" onClick={clearSelectedCustomer}>Criar cliente novo em vez disso</button>
        </p>
      ) : null}
      <div className="review-onboarding__fields">
        <Field label="Razão social" required><Input value={name} onChange={(event) => { clearSelectedCustomer(); setName(event.target.value) }} /></Field>
        <Field label="CNPJ" required hint={cnpjHint} error={cnpjError}><Input maxLength={CNPJ_INPUT_MAX_LENGTH} placeholder="00.000.000/0000-00" inputMode="numeric" value={cnpj.length === 14 ? formatCnpj(cnpj) : cnpj} onChange={(event) => { clearSelectedCustomer(); setCnpj(normalizeCnpj(event.target.value)) }} /></Field>
      </div>
      <Field label="E-mail principal do cliente" required hint={email.trim() ? 'Será salvo como contato do cliente. Nenhum e-mail é enviado por esta ação.' : 'O cliente precisa ter pelo menos um e-mail cadastrado.'}>
        <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
      </Field>
      <label className="review-onboarding__invite">
        <input className="review-onboarding__checkbox" type="checkbox" checked={sendPortalInvite} onChange={(event) => setSendPortalInvite(event.target.checked)} />
        <span>
          Enviar convite do Portal para este mesmo e-mail
          <span className="review-onboarding__invite-hint">{sendPortalInvite ? `O convite será enviado para ${email.trim().toLowerCase() || 'o e-mail informado acima'} depois do cadastro.` : 'Opcional — você poderá iniciar o convite depois em Provisionamento do Portal.'}</span>
        </span>
      </label>
      <div className="review-onboarding__footer">
        <div className="review-onboarding__effect">
          <p><strong>Ao concluir:</strong> {effect}</p>
          {remainingNote ? <p>{remainingNote}</p> : null}
        </div>
        <div className="review-onboarding__submit">
          <Button
            disabled={!canSubmit}
            loading={saving}
            loadingLabel="Salvando…"
            aria-describedby={blockReason ? blockId : undefined}
            onClick={() => onSubmit({ customerId: selectedId, cnpjCpf: validCnpj!, name: name.trim(), email: email.trim().toLowerCase(), sendPortalInvite })}
          >
            {selectedId ? `Adicionar e-mail e vincular ${targetLabel}` : `Criar cliente e vincular ${targetLabel}`}
          </Button>
          {blockReason ? <p id={blockId} className="review-onboarding__block">{blockReason}</p> : null}
        </div>
      </div>
    </section>
  )
}
