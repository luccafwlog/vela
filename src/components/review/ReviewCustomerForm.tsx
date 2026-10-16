import { useEffect, useId, useState } from 'react'
import { Button } from '../ui/Button'
import { ChoiceCards } from '../ui/ChoiceCards'
import { Field, Input } from '../ui/Input'
import { SegmentedControl } from '../ui/SegmentedControl'
import { InlineCustomerPicker } from '../shared/ReviewInlineEditors'
import type { ReviewCustomer } from '../../hooks/useReview'
import { CNPJ_INPUT_MAX_LENGTH, canonicalizeValidCnpj, formatCnpj, normalizeCnpj } from '../../lib/cnpj'

export type ReviewCustomerOnboardingInput = {
  customerId: number | null
  cnpjCpf: string
  name: string
  email: string
  sendPortalInvite: boolean
}

type Mode = 'cadastrar' | 'vincular'
type PortalChoice = 'convidar' | 'depois'

const MODE_OPTIONS = [
  { value: 'cadastrar', label: 'Cadastrar novo cliente' },
  { value: 'vincular', label: 'Vincular a um cliente cadastrado' },
] as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/**
 * Cadastro ou vínculo do Cliente de um grupo da Revisão, numa ordem só: o que
 * fazer (cadastrar ou vincular), os campos, a decisão do Portal (cadastro) e
 * uma faixa que diz o que vai acontecer, com um único botão. O Portal não vem
 * marcado: o botão só libera depois da escolha (decisão de 2026-10-16).
 */
export function ReviewCustomerForm({
  blCount,
  expectedCnpjs,
  initialName,
  initialCnpj,
  initialEmail,
  proposedCnpj = null,
  proposedCustomer = null,
  saving,
  onCnpjChange,
  onOnboard,
  onLink,
}: {
  /** B/Ls do grupo que recebem o cadastro (o Granito do grupo vai junto). */
  blCount: number
  /** CNPJs lidos no B/L; o cadastro só aceita um deles quando há algum. */
  expectedCnpjs: string[]
  initialName: string
  initialCnpj: string
  initialEmail: string
  /** CNPJ escolhido fora do formulário ("Usar este CNPJ"); `seq` muda a cada clique. */
  proposedCnpj?: { cnpj: string; seq: number } | null
  /** Cliente escolhido fora do formulário ("Usar a sugestão"); `seq` muda a cada clique. */
  proposedCustomer?: { customer: ReviewCustomer; seq: number } | null
  saving: boolean
  onCnpjChange?: (cnpj: string | null) => void
  onOnboard: (input: ReviewCustomerOnboardingInput) => void
  onLink: (customer: ReviewCustomer) => void
}) {
  // Escolha feita antes de o formulário aparecer (caso C) já vale ao montar.
  const [mode, setMode] = useState<Mode>(proposedCustomer ? 'vincular' : 'cadastrar')
  const [name, setName] = useState(initialName)
  const [cnpj, setCnpj] = useState(proposedCnpj?.cnpj ?? initialCnpj)
  const [email, setEmail] = useState(initialEmail)
  const [portal, setPortal] = useState<PortalChoice | null>(null)
  const [linkTarget, setLinkTarget] = useState<ReviewCustomer | null>(proposedCustomer?.customer ?? null)
  const blockId = useId()

  // Escolhas feitas fora do formulário ajustam o estado durante o render
  // (padrão "adjusting state when props change").
  const [appliedCnpj, setAppliedCnpj] = useState(proposedCnpj)
  if (proposedCnpj !== appliedCnpj) {
    setAppliedCnpj(proposedCnpj)
    if (proposedCnpj) {
      setMode('cadastrar')
      setCnpj(proposedCnpj.cnpj)
    }
  }
  const [appliedCustomer, setAppliedCustomer] = useState(proposedCustomer)
  if (proposedCustomer !== appliedCustomer) {
    setAppliedCustomer(proposedCustomer)
    if (proposedCustomer) {
      setMode('vincular')
      setLinkTarget(proposedCustomer.customer)
    }
  }

  const validCnpj = canonicalizeValidCnpj(cnpj)
  useEffect(() => {
    onCnpjChange?.(mode === 'cadastrar' ? validCnpj : null)
  }, [mode, validCnpj, onCnpjChange])

  const validEmail = EMAIL_PATTERN.test(email.trim())
  const cnpjMismatch = Boolean(validCnpj && expectedCnpjs.length > 0 && !expectedCnpjs.includes(validCnpj))
  const target = plural(blCount, 'B/L', 'B/Ls')
  const linkTargetCnpj = canonicalizeValidCnpj(linkTarget?.cnpj_cpf)
  const linkMatches = linkTarget && expectedCnpjs.length && linkTargetCnpj ? expectedCnpjs.includes(linkTargetCnpj) : null

  const onboardBlock = saving
    ? null
    : blCount === 0
      ? 'Não há B/L neste grupo para cadastrar.'
      : !name.trim()
        ? 'Informe a razão social.'
        : !validCnpj
          ? 'Informe um CNPJ válido.'
          : cnpjMismatch
            ? 'O CNPJ precisa ser um dos lidos no B/L.'
            : !validEmail
              ? 'Informe um e-mail válido.'
              : !portal
                ? 'Escolha o que fazer com o Portal do Cliente para continuar.'
                : null
  const linkBlock = saving ? null : !linkTarget ? 'Escolha o cliente cadastrado.' : null
  const block = mode === 'cadastrar' ? onboardBlock : linkBlock

  const summary = mode === 'cadastrar'
    ? portal === 'convidar'
      ? <>Vai cadastrar <strong>{name.trim() || 'o cliente'}</strong>, vincular <strong>{target}</strong> e enviar o convite do Portal para <strong>{email.trim().toLowerCase() || 'o e-mail principal'}</strong>.</>
      : portal === 'depois'
        ? <>Vai cadastrar <strong>{name.trim() || 'o cliente'}</strong> e vincular <strong>{target}</strong>. {blCount === 1 ? 'O B/L continua' : 'Os B/Ls continuam'} na Revisão até o Portal ficar ativo.</>
        : null
    : linkTarget
      ? <>Vai vincular <strong>{target}</strong> a <strong>{linkTarget.name}</strong>. Os contatos do Cliente não mudam.</>
      : null

  function submit() {
    if (block) return
    if (mode === 'vincular') {
      if (linkTarget) onLink(linkTarget)
      return
    }
    onOnboard({
      customerId: null,
      cnpjCpf: validCnpj!,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      sendPortalInvite: portal === 'convidar',
    })
  }

  return (
    <div className="grid gap-4">
      <SegmentedControl label="Cadastrar ou vincular o cliente" options={MODE_OPTIONS} value={mode} onChange={setMode} />

      {mode === 'cadastrar' ? (
        <>
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_2fr]">
            <Field label="Razão social" required>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field
              label="CNPJ"
              required
              error={cnpjMismatch ? `${formatCnpj(validCnpj)} não aparece no B/L. Use um dos CNPJs lidos: ${expectedCnpjs.map((value) => formatCnpj(value)).join(', ')}.` : undefined}
            >
              <Input
                maxLength={CNPJ_INPUT_MAX_LENGTH}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                value={cnpj.length === 14 ? formatCnpj(cnpj) : cnpj}
                onChange={(event) => setCnpj(normalizeCnpj(event.target.value))}
              />
            </Field>
            <Field label="E-mail principal" required>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="financeiro@cliente.com.br" />
            </Field>
          </div>
          <ChoiceCards
            label="Portal do Cliente"
            value={portal}
            onChange={setPortal}
            options={[
              {
                value: 'convidar',
                title: 'Enviar o convite agora',
                description: `Para o e-mail principal acima. ${blCount === 1 ? 'O B/L sai' : 'Os B/Ls saem'} da Revisão quando o Cliente ativar a conta.`,
              },
              {
                value: 'depois',
                title: 'Deixar para depois',
                description: `${blCount === 1 ? 'O B/L continua' : 'Os B/Ls continuam'} na Revisão como “Portal não provisionado”.`,
              },
            ]}
          />
        </>
      ) : (
        <div className="grid gap-2">
          <InlineCustomerPicker label="Cliente cadastrado" saving={saving} expectedCnpjs={expectedCnpjs} onSelect={setLinkTarget} />
          {linkTarget ? (
            <p role="status">
              Escolhido: <strong>{linkTarget.name}</strong> · {formatCnpj(linkTarget.cnpj_cpf)}
              {linkMatches === true ? ' · CNPJ confere com o B/L' : null}
              {linkMatches === false ? <span className="app-status-text app-status-text--warning"> · CNPJ diferente do B/L</span> : null}
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--app-border-soft)] pt-3">
        <p className="min-w-0 flex-1 text-[var(--app-muted)]" id={blockId}>{block ?? summary}</p>
        <Button disabled={Boolean(block)} loading={saving} loadingLabel="Salvando…" aria-describedby={blockId} onClick={submit}>
          {mode === 'cadastrar' ? 'Cadastrar e vincular' : `Vincular ${target}`}
        </Button>
      </div>
    </div>
  )
}
