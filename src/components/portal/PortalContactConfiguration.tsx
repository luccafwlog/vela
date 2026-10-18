import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { usePortalContactConfiguration } from '../../hooks/usePortalContactConfiguration'
import { usePortalScope } from '../../hooks/usePortalScope'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
} from '../../services/customerCommunicationBoxes'
import type { PortalContactDraft, PortalContactItem } from '../../services/portalContactConfiguration'
import { isPortalReadOnly } from '../../services/portalScope'
import { hasEligibleContactReplacement, isEligibleContact, normalizePrimaryContactBoxes } from '../../lib/customerContactDrafts'
import { ProfileSaveBar } from './ProfileSaveBar'

function formatOrigin(origin?: string): string {
  if (origin === 'bl_automatico') return 'Capturado do B/L'
  if (origin === 'portal') return 'Informado no Portal'
  return 'Contato do Cliente'
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

const boxLabels = (codes: readonly string[]) => codes
  .map((code) => CUSTOMER_COMMUNICATION_BOXES.find((box) => box.code === code)?.label ?? code)
  .sort()
  .join(', ') || 'nenhuma'

/**
 * O que mudou em cada contato em relação ao que foi carregado, uma linha por
 * contato. Vazio = nada a salvar (o botão fica apagado).
 */
function contactChanges(drafts: PortalContactDraft[], originals: readonly PortalContactItem[]) {
  const originalById = new Map(originals.map((contact) => [contact.id, contact]))
  return drafts.flatMap((draft) => {
    const original = draft.id == null ? undefined : originalById.get(draft.id)
    const changes = original ? [
      ['Nome', original.name || '—', draft.name || '—'],
      ['E-mail', original.email || '—', draft.email || '—'],
      ['Telefone', original.phone || '—', draft.phone || '—'],
      ['Papel', original.is_primary ? 'Principal' : 'Adicional', draft.isPrimary ? 'Principal' : 'Adicional'],
      ['Situação', original.active ? 'Ativo' : 'Inativo', draft.active ? 'Ativo' : 'Inativo'],
      ['Caixas', boxLabels(original.box_codes), boxLabels(draft.boxCodes)],
    ].filter(([, before, after]) => before !== after)
      .map(([field, before, after]) => `${field}: ${before} → ${after}`)
    : [`Novo contato ${draft.name || draft.email}: ${draft.email}; ${draft.isPrimary ? 'principal' : 'adicional'}; caixas: ${boxLabels(draft.boxCodes)}.`]
    return changes.length > 0
      ? [`${draft.name || draft.email || 'Contato'} — ${changes.join('; ')}`]
      : []
  })
}

export function PortalContactConfiguration({ readOnly = false }: { readOnly?: boolean }) {
  const { data, isLoading, isError, error, saveConfiguration, errorMessage } =
    usePortalContactConfiguration()
  const scope = usePortalScope()
  const isInspect = readOnly || isPortalReadOnly(scope)
  const { showToast } = useToast()
  const confirm = useConfirm()

  const [drafts, setDrafts] = useState<PortalContactDraft[]>([])
  const [localError, setLocalError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Rascunho local nao pode ser descartado por refetch de fundo (reconnect /
  // polling do overview): mesmo padrao do PortalProfile, que inicializa o form
  // uma vez e nao sincroniza por cima de edicao suja.
  const dirtyRef = useRef(false)
  const changedContacts = useMemo(() => contactChanges(drafts, data?.contacts ?? []), [drafts, data])

  useEffect(() => {
    if (data?.contacts && !dirtyRef.current) {
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
      setDrafts(isInspect ? loadedDrafts : normalizePrimaryContactBoxes(loadedDrafts))
    }
  }, [data, isInspect])

  function markDirty() {
    dirtyRef.current = true
  }

  function handleAddContact() {
    markDirty()
    setDrafts((current) => [
      ...current,
      {
        id: null,
        name: '',
        email: '',
        phone: '',
        isPrimary: false,
        active: true,
        origin: 'portal',
        boxCodes: [],
      },
    ])
    setLocalError('')
  }

  function handleFieldChange(
    index: number,
    field: 'name' | 'email' | 'phone',
    value: string,
  ) {
    markDirty()
    setDrafts((current) => {
      const copy = [...current]
      copy[index] = { ...copy[index], [field]: value }
      return copy
    })
    setLocalError('')
  }

  function handleSetPrimary(index: number) {
    markDirty()
    setDrafts((current) => {
      return current.map((draft, i) => {
        if (i === index) {
          // O novo principal recebe todas as caixas ativas
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
    setLocalError('')
  }

  function handleToggleActive(index: number) {
    const target = drafts[index]
    if (!target) return
    if (target.isPrimary && target.active) {
      setLocalError(
        'Para desativar o contato principal, selecione outro contato como principal antes.',
      )
      return
    }
    markDirty()
    setDrafts((current) => {
      if (!current[index]) return current
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
      // Se for o contato principal, verificar se há outro contato ativo cobrindo esta caixa
      const otherHasBox = hasEligibleContactReplacement(drafts, index, boxCode)
      if (!otherHasBox) {
        setLocalError(
          'Para retirar o contato principal desta caixa, selecione outro e-mail ativo e apto a receber mensagens para substituí-lo.',
        )
        return
      }
    }
    markDirty()
    setLocalError('')
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
    setLocalError('')

    if (isInspect) return

    // Validação local antes do envio
    const activeContacts = drafts.filter((d) => d.active)
    const activePrimary = activeContacts.find((d) => d.isPrimary)

    if (!activePrimary) {
      setLocalError('O cliente deve ter exatamente um contato principal ativo.')
      return
    }

    if (!activePrimary.email?.trim()) {
      setLocalError('O contato principal deve possuir um e-mail válido.')
      return
    }

    for (const d of activeContacts) {
      if (!d.isPrimary && d.boxCodes.length === 0) {
        setLocalError(
          `O contato "${d.name || d.email || 'adicional'}" deve estar vinculado a pelo menos uma caixa.`,
        )
        return
      }
      if (!d.email?.trim() || !d.email.includes('@')) {
        setLocalError(`O contato "${d.name || 'sem nome'}" possui um e-mail inválido.`)
        return
      }
    }

    // Checar se todas as caixas continuam cobertas por contatos ativos e elegíveis
    for (const box of CUSTOMER_COMMUNICATION_BOXES) {
      const hasCoverage = activeContacts.some(
        (d) => d.boxCodes.includes(box.code) && isEligibleContact(d),
      )
      if (!hasCoverage) {
        setLocalError(
          `A caixa "${box.label}" não pode ficar sem nenhum contato ativo e elegível vinculado.`,
        )
        return
      }
    }

    if (changedContacts.length === 0) {
      dirtyRef.current = false
      showToast('Nenhuma alteração detectada.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Confirmar contatos e recebimento',
      message: `Salvar alterações em ${changedContacts.length} contato(s)?`,
      confirmLabel: 'Salvar contatos',
      affected: {
        summary: `${changedContacts.length} contato(s) novo(s) ou alterado(s)`,
        items: changedContacts,
      },
      consequence: 'A configuração define quem receberá os próximos comunicados em cada caixa. Esta gravação não envia mensagens agora.',
      reversibility: 'Edite os contatos e as caixas novamente para corrigir a configuração.',
    })
    if (!confirmed) return

    setSubmitting(true)
    try {
      await saveConfiguration.mutateAsync(drafts)
      dirtyRef.current = false
      showToast('Contatos e recebimento atualizados com sucesso.', 'success')
    } catch (err) {
      setLocalError(errorMessage(err, 'Falha ao salvar contatos.'))
    } finally {
      setSubmitting(false)
    }
  }

  const loadErrMsg = isError
    ? errorMessage(error, 'Falha ao carregar contatos do cliente.')
    : ''

  if (isLoading) {
    return (
      <Block title="Quem recebe os comunicados">
        <p className="m-0 text-sm text-[var(--app-muted)]" role="status">Carregando contatos…</p>
      </Block>
    )
  }

  // Cada contato é um grupo nomeado (fieldset + legenda) com o próprio bloco:
  // o leitor de tela ouve "Contato principal: Maria" antes de "Nome",
  // "E-mail" e das caixas daquele contato.
  return (
    <Block
      title="Quem recebe os comunicados"
      aside={<>
        cada caixa precisa de um contato ativo
        {!isInspect && (
          <Button type="button" variant="secondary" className="app-btn--sm" onClick={handleAddContact}>
            <Plus size={14} aria-hidden="true" />
            Adicionar contato
          </Button>
        )}
      </>}
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        {drafts.map((contact, index) => {
          const suppressionMsg = formatSuppression(contact.suppressionReason)
          const legendName = contact.name || contact.email || 'novo contato'
          const title = [legendName, contact.isPrimary ? 'contato principal' : null, contact.active ? null : 'desativado'].filter(Boolean).join(' · ')
          const fieldsDisabled = isInspect || !contact.active
          return (
            <fieldset key={contact.id ?? `draft-${index}`} className="m-0 min-w-0 border-0 p-0">
              <legend className="sr-only">{`${contact.isPrimary ? 'Contato principal' : 'Contato adicional'}: ${legendName}`}</legend>
              <Block title={title} aside={formatOrigin(contact.origin)} headingLevel={3}>
                {suppressionMsg && (
                  <div className="app-callout app-callout--warning">
                    {suppressionMsg}
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
                  <Field label="Nome">
                    <Input
                      type="text"
                      disabled={fieldsDisabled}
                      value={contact.name ?? ''}
                      onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                      placeholder="Nome do contato"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      type="email"
                      disabled={fieldsDisabled}
                      value={contact.email ?? ''}
                      onChange={(e) => handleFieldChange(index, 'email', e.target.value)}
                      placeholder="email@empresa.com"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Telefone / WhatsApp">
                    <Input
                      type="tel"
                      disabled={fieldsDisabled}
                      value={contact.phone ?? ''}
                      onChange={(e) => handleFieldChange(index, 'phone', e.target.value)}
                      placeholder="(11) 99999-9999"
                      autoComplete="off"
                    />
                  </Field>
                </div>

                {/* Caixas de recebimento em linha; a descrição aparece ao passar
                    o mouse e é lida pelo leitor de tela. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2" role="group" aria-label={`Caixas de recebimento de ${legendName}`}>
                  {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
                    const checked = contact.boxCodes.includes(box.code)
                    const descriptionId = `contato-${contact.id ?? `novo-${index}`}-${box.code}`
                    return (
                      <label
                        key={box.code}
                        title={box.description}
                        className={`inline-flex min-h-11 items-center gap-2 text-sm ${fieldsDisabled ? 'cursor-not-allowed text-[var(--app-muted)]' : 'cursor-pointer'}`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--app-blue-btn)]"
                          disabled={fieldsDisabled}
                          checked={checked}
                          aria-describedby={descriptionId}
                          onChange={() => handleToggleBox(index, box.code)}
                        />
                        <span>{box.label}</span>
                        <span id={descriptionId} hidden>{box.description}</span>
                      </label>
                    )
                  })}
                  {!isInspect && (
                    <span className="ml-auto flex flex-wrap gap-2">
                      {!contact.isPrimary && contact.active && (
                        <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => handleSetPrimary(index)}>
                          Tornar principal
                        </Button>
                      )}
                      <Button type="button" variant="secondary" className="app-btn--sm" onClick={() => handleToggleActive(index)}>
                        {contact.active ? 'Desativar contato' : 'Reativar contato'}
                      </Button>
                    </span>
                  )}
                </div>
              </Block>
            </fieldset>
          )
        })}

        {loadErrMsg || localError ? (
          <InlineError message={localError || loadErrMsg} />
        ) : null}

        <ProfileSaveBar status={isInspect ? null : changedContacts.length > 0 ? 'Contatos alterados, ainda não salvos.' : 'Nada alterado.'}>
          <Button
            type="submit"
            disabled={isInspect || isError || changedContacts.length === 0}
            loading={submitting}
            loadingLabel="Salvando..."
            title={
              isInspect
                ? 'Ação do cliente — indisponível em Modo Inspeção'
                : undefined
            }
          >
            Salvar contatos
          </Button>
        </ProfileSaveBar>
      </form>
    </Block>
  )
}
