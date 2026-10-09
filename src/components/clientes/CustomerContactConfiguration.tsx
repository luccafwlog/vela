import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
} from '../../services/customerCommunicationBoxes'
import {
  fetchCustomerContactConfiguration,
  internalSaveCustomerContactConfiguration,
  type PortalContactDraft,
} from '../../services/customerContactConfiguration'
import { extractErrorText } from '../../lib/errors'
import { hasEligibleContactReplacement, isEligibleContact, normalizePrimaryContactBoxes } from '../../lib/customerContactDrafts'

function snapshotOf(drafts: PortalContactDraft[]) {
  return JSON.stringify(drafts.map((draft) => [draft.id, draft.name ?? '', draft.email ?? '', draft.phone ?? '', draft.isPrimary, draft.active, [...draft.boxCodes].sort()]))
}

function formatOrigin(origin?: string): string {
  if (origin === 'bl_automatico') return 'Capturado do B/L'
  if (origin === 'portal') return 'Informado no Portal'
  if (origin === 'sistema') return 'Sistema'
  return 'Cadastrado pela equipe'
}

function formatSuppression(reason?: string | null): string | null {
  if (!reason) return null
  if (reason === 'suprimido_bounce' || reason === 'bounce_permanente') {
    return 'Endereço bloqueado: Falha permanente na entrega (Bounce)'
  }
  if (reason === 'suprimido_complaint' || reason === 'complaint') {
    return 'Endereço bloqueado: Reclamação registrada'
  }
  return `Endereço bloqueado: ${reason}`
}

export function CustomerContactConfiguration({
  customerId,
  canEdit = true,
  onSaved,
}: {
  customerId: number
  canEdit?: boolean
  onSaved?: () => void
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()

  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<PortalContactDraft[]>([])
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [loadError, setLoadError] = useState('')
  // Retrato do que está gravado: o que difere dele é alteração não salva.
  const [savedSnapshot, setSavedSnapshot] = useState('[]')

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    setLoadError('')
    try {
      const data = await fetchCustomerContactConfiguration(customerId)
      const loadedDrafts: PortalContactDraft[] = data.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        isPrimary: c.is_primary,
        active: c.active,
        origin: c.origin,
        boxCodes: [...c.box_codes],
        suppressionReason: c.suppression_reason,
        sendable: c.sendable,
      }))
      setSavedSnapshot(snapshotOf(loadedDrafts))
      setDrafts(canEdit ? normalizePrimaryContactBoxes(loadedDrafts) : loadedDrafts)
    } catch (err) {
      setLoadError(extractErrorText(err) || 'Falha ao carregar os contatos do cliente.')
    } finally {
      setLoading(false)
    }
  }, [customerId, canEdit])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadConfig()
  }, [loadConfig])
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleAddContact() {
    setDrafts((current) => [
      ...current,
      {
        id: null,
        name: '',
        email: '',
        phone: '',
        isPrimary: false,
        active: true,
        origin: 'interno',
        boxCodes: [],
      },
    ])
    setErrorMsg('')
  }

  function handleFieldChange(
    index: number,
    field: 'name' | 'email' | 'phone',
    value: string,
  ) {
    setDrafts((current) => {
      const copy = [...current]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
    setErrorMsg('')
  }

  function handleSetPrimary(index: number) {
    setDrafts((current) => {
      return current.map((draft, i) => {
        if (i === index) {
          const allBoxes = CUSTOMER_COMMUNICATION_BOXES.map((b) => b.code)
          return {
            ...draft,
            isPrimary: true,
            active: true,
            boxCodes: Array.from(new Set([...draft.boxCodes, ...allBoxes])),
          }
        }
        return {
          ...draft,
          isPrimary: false,
        }
      })
    })
    setErrorMsg('')
  }

  async function handleToggleActive(index: number) {
    const target = drafts[index]
    if (target.isPrimary && target.active) {
      setErrorMsg('Para desativar o contato principal, selecione outro contato como principal antes.')
      return
    }

    if (target.active) {
      const ok = await confirm({
        title: 'Desativar contato',
        message: `Desativar o contato "${target.name || target.email || 'adicional'}"? O histórico e vínculos serão preservados, mas ele deixará de receber comunicados.`,
        confirmLabel: 'Desativar',
        tone: 'danger',
      })
      if (!ok) return
    }

    setDrafts((current) => {
      const copy = [...current]
      copy[index] = { ...copy[index], active: !copy[index].active }
      return copy
    })
  }

  function handleToggleBox(index: number, boxCode: CommunicationBoxCode) {
    const target = drafts[index]
    if (!target) return
    const hasBox = target.boxCodes.includes(boxCode)
    if (hasBox && target.isPrimary) {
      const otherHasBox = hasEligibleContactReplacement(drafts, index, boxCode)
      if (!otherHasBox) {
        setErrorMsg(
          'Para retirar o contato principal desta caixa, selecione outro e-mail ativo e apto a receber mensagens para substituí-lo.',
        )
        return
      }
    }
    setErrorMsg('')
    setDrafts((current) => {
      const currentTarget = current[index]
      if (!currentTarget) return current
      const currentHasBox = currentTarget.boxCodes.includes(boxCode)
      const nextBoxCodes = currentHasBox
        ? currentTarget.boxCodes.filter((b) => b !== boxCode)
        : [...currentTarget.boxCodes, boxCode]
      const copy = [...current]
      copy[index] = { ...copy[index], boxCodes: nextBoxCodes }
      return copy
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrorMsg('')

    if (!canEdit) return

    const activeContacts = drafts.filter((d) => d.active)
    const activePrimary = activeContacts.find((d) => d.isPrimary)

    if (!activePrimary) {
      setErrorMsg('O cliente deve ter exatamente um contato principal ativo.')
      return
    }

    if (!activePrimary.email?.trim()) {
      setErrorMsg('O contato principal deve possuir um e-mail válido.')
      return
    }

    for (const d of activeContacts) {
      if (!d.isPrimary && d.boxCodes.length === 0) {
        setErrorMsg(`O contato "${d.name || d.email || 'adicional'}" deve estar vinculado a pelo menos uma caixa.`)
        return
      }
      if (!d.email?.trim() || !d.email.includes('@')) {
        setErrorMsg(`O contato "${d.name || 'sem nome'}" possui um e-mail inválido.`)
        return
      }
    }

    for (const box of CUSTOMER_COMMUNICATION_BOXES) {
      const hasCoverage = activeContacts.some(
        (d) => d.boxCodes.includes(box.code) && isEligibleContact(d),
      )
      if (!hasCoverage) {
        setErrorMsg(`A caixa "${box.label}" não pode ficar sem nenhum contato ativo e elegível vinculado.`)
        return
      }
    }

    setSaving(true)
    try {
      await internalSaveCustomerContactConfiguration(customerId, drafts, justification)
      showToast('Configuração de contatos atualizada com sucesso.', 'success')
      setJustification('')
      await loadConfig()
      onSaved?.()
    } catch (err) {
      setErrorMsg(extractErrorText(err) || 'Falha ao salvar contatos.')
    } finally {
      setSaving(false)
    }
  }

  const dirty = snapshotOf(drafts) !== savedSnapshot

  function handleDiscard() {
    setJustification('')
    void loadConfig()
  }

  if (loading) {
    return <p className="app-customer-muted" role="status">Carregando contatos e Caixas de Comunicação…</p>
  }

  if (loadError) {
    return (
      <div className="app-customer-stack-tight">
        <h2 className="app-customer-section-title">Contatos e Caixas de Comunicação</h2>
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar os contatos: {loadError}</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void loadConfig()}>Tentar novamente</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-customer-contacts">
      <div className="app-customer-section-head">
        <div>
          <h2 className="app-customer-section-title">Contatos e Caixas de Comunicação</h2>
          <p className="app-customer-muted">Quem recebe os Comunicados. Cada caixa precisa de pelo menos um contato ativo com e-mail; sem substituto, o principal recebe.</p>
        </div>
        {canEdit && (
          <Button type="button" variant="secondary" onClick={handleAddContact}>
            <Plus size={16} aria-hidden="true" />
            Adicionar contato
          </Button>
        )}
      </div>

      {/* Quem recebe cada caixa, como a conferência de Comunicados mostra. */}
      <dl className="app-customer-coverage" aria-label="Destinatários por caixa">
        {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
          const linkedContacts = drafts.filter(
            (d) => d.active && d.email && d.boxCodes.includes(box.code),
          )
          return (
            <div key={box.code} className="app-customer-coverage__box" data-empty={linkedContacts.length === 0 ? 'true' : undefined}>
              <dt>
                <span className="app-customer-coverage__label">{box.label}</span>
                <span className="app-customer-coverage__desc">{box.description}</span>
              </dt>
              {linkedContacts.length === 0 ? (
                <dd className="app-customer-note app-customer-note--warning">Nenhum contato com e-mail</dd>
              ) : (
                linkedContacts.map((c, i) => (
                  <dd key={i} className="app-customer-coverage__email">
                    <span className="app-customer-cell__truncate" title={c.email ?? undefined}>{c.email}</span>
                    {c.isPrimary ? <span className="app-customer-coverage__tag">principal</span> : null}
                  </dd>
                ))
              )}
            </div>
          )
        })}
      </dl>

      {!canEdit && (
        <p className="app-customer-notice">
          Somente leitura: seu perfil não possui permissão para editar os contatos do cliente (Documentação, Equipamentos e Administrativo editam).
        </p>
      )}

      <form onSubmit={handleSubmit} className="app-customer-contacts__form" noValidate>
        {drafts.map((contact, index) => {
          const suppressionMsg = formatSuppression(contact.suppressionReason)
          const legendName = contact.name || contact.email || 'novo contato'
          const disabled = !canEdit || !contact.active
          return (
            <fieldset
              key={contact.id ?? `draft-${index}`}
              className="app-customer-contact"
              data-primary={contact.isPrimary ? 'true' : undefined}
              data-active={contact.active ? 'true' : 'false'}
            >
              <legend className="sr-only">{`${contact.isPrimary ? 'Contato principal' : 'Contato adicional'}: ${legendName}`}</legend>
              <div className="app-customer-contact__head">
                <div className="app-customer-contact__tags">
                  {contact.isPrimary ? <Badge tone="info">Contato principal</Badge> : <Badge tone="neutral">Contato adicional</Badge>}
                  {!contact.active ? <Badge tone="warning">Desativado</Badge> : null}
                  <span className="app-customer-muted">{formatOrigin(contact.origin)}</span>
                </div>

                {canEdit && (
                  <div className="app-customer-contact__actions">
                    {!contact.isPrimary && contact.active && (
                      <Button type="button" variant="ghost" className="app-btn--sm" onClick={() => handleSetPrimary(index)}>
                        Tornar principal
                      </Button>
                    )}
                    <Button type="button" variant="ghost" className="app-btn--sm" onClick={() => void handleToggleActive(index)}>
                      {contact.active ? 'Desativar' : 'Reativar'}
                    </Button>
                  </div>
                )}
              </div>

              {suppressionMsg && <p className="app-customer-notice app-customer-notice--warning">{suppressionMsg}</p>}

              <div className="app-customer-contact__fields">
                <Field label="Nome">
                  <Input
                    type="text"
                    disabled={disabled}
                    value={contact.name ?? ''}
                    onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                    placeholder="Nome do contato"
                    autoComplete="off"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    disabled={disabled}
                    value={contact.email ?? ''}
                    onChange={(e) => handleFieldChange(index, 'email', e.target.value)}
                    placeholder="email@empresa.com"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input
                    type="tel"
                    disabled={disabled}
                    value={contact.phone ?? ''}
                    onChange={(e) => handleFieldChange(index, 'phone', e.target.value)}
                    placeholder="(11) 99999-9999"
                    autoComplete="off"
                  />
                </Field>
              </div>

              <fieldset className="app-customer-boxes">
                <legend className="app-customer-boxes__legend">
                  Caixas de recebimento<span className="sr-only">{` de ${legendName}`}</span>
                </legend>
                {contact.isPrimary && canEdit ? (
                  <p className="app-customer-boxes__hint">Para tirar o principal de uma caixa, vincule antes outro contato ativo e apto a receber.</p>
                ) : null}
                <div className="app-customer-boxes__grid">
                  {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
                    const checked = contact.boxCodes.includes(box.code)
                    return (
                      <label key={box.code} className="app-customer-box" data-checked={checked ? 'true' : 'false'} data-disabled={disabled ? 'true' : undefined}>
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={checked}
                          onChange={() => handleToggleBox(index, box.code)}
                        />
                        {/* O que cada caixa recebe está no quadro de destinatários acima. */}
                        <span className="app-customer-box__label">{box.label}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            </fieldset>
          )
        })}

        {errorMsg ? <InlineError message={errorMsg} /> : null}

        {canEdit && (
          <div className="app-customer-savebar" data-dirty={dirty ? 'true' : 'false'} role="region" aria-label="Salvar contatos">
            <p className="app-customer-savebar__summary" aria-live="polite">
              {dirty ? <strong>Alterações não salvas nos contatos.</strong> : 'Sem alterações nos contatos.'}
            </p>
            <Field label="Justificativa da alteração" hint="Opcional. Fica registrada no Histórico do Cliente.">
              <Input value={justification} disabled={saving} onChange={(e) => setJustification(e.target.value)} />
            </Field>
            <div className="app-customer-savebar__actions">
              {dirty ? <Button type="button" variant="secondary" onClick={handleDiscard} disabled={saving}>Descartar</Button> : null}
              <Button type="submit" loading={saving} loadingLabel="Salvando…">Salvar contatos</Button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
