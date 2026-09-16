import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { Card, InlineError } from '../ui/Card'
import { Field, Input } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { usePortalContactConfiguration } from '../../hooks/usePortalContactConfiguration'
import { usePortalScope } from '../../hooks/usePortalScope'
import {
  CUSTOMER_COMMUNICATION_BOXES,
  type CommunicationBoxCode,
} from '../../services/customerCommunicationBoxes'
import type { PortalContactDraft } from '../../services/portalContactConfiguration'
import { isPortalReadOnly } from '../../services/portalScope'

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

export function PortalContactConfiguration({ readOnly = false }: { readOnly?: boolean }) {
  const { data, isLoading, isError, error, saveConfiguration, errorMessage } =
    usePortalContactConfiguration()
  const scope = usePortalScope()
  const isInspect = readOnly || isPortalReadOnly(scope)
  const { showToast } = useToast()

  const [drafts, setDrafts] = useState<PortalContactDraft[]>([])
  const [localError, setLocalError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Rascunho local nao pode ser descartado por refetch de fundo (reconnect /
  // polling do overview): mesmo padrao do PortalProfile, que inicializa o form
  // uma vez e nao sincroniza por cima de edicao suja.
  const dirtyRef = useRef(false)

  useEffect(() => {
    if (data?.contacts && !dirtyRef.current) {
      setDrafts(
        data.contacts.map((c) => ({
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
        })),
      )
    }
  }, [data])

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
    markDirty()
    const hasBox = target.boxCodes.includes(boxCode)
    if (hasBox && target.isPrimary) {
      // Se for o contato principal, verificar se há outro contato ativo cobrindo esta caixa
      const otherHasBox = drafts.some(
        (d, i) => i !== index && d.active && d.boxCodes.includes(boxCode),
      )
      if (!otherHasBox) {
        setLocalError(
          'Para retirar o contato principal desta caixa, selecione outro e-mail para substituí-lo.',
        )
      }
    }
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
        (d) => d.boxCodes.includes(box.code) && d.sendable !== false && !d.suppressionReason,
      )
      if (!hasCoverage) {
        setLocalError(
          `A caixa "${box.label}" não pode ficar sem nenhum contato ativo e elegível vinculado.`,
        )
        return
      }
    }

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
    return <div className="text-sm text-[var(--app-muted)]">Carregando contatos...</div>
  }

  return (
    <div className="mt-8 border-t border-[var(--app-border)] pt-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
            Contatos e recebimento
          </h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            Administre o contato principal e contatos adicionais para recebimento dos comunicados da sua carga.
          </p>
        </div>
        {!isInspect && (
          <Button
            type="button"
            variant="secondary"
            onClick={handleAddContact}
            className="mt-2 sm:mt-0"
          >
            + Novo contato
          </Button>
        )}
      </div>

      <form className="mt-6 grid gap-6" onSubmit={handleSubmit}>
        {drafts.map((contact, index) => {
          const suppressionMsg = formatSuppression(contact.suppressionReason)
          return (
            <Card
              key={contact.id ?? `draft-${index}`}
              className={`p-4 border transition-colors ${
                !contact.active
                  ? 'border-[var(--app-border)] bg-[var(--app-muted)]/10 opacity-75'
                  : contact.isPrimary
                  ? 'border-blue-500/50 bg-blue-50/20 dark:bg-blue-950/10'
                  : 'border-[var(--app-border)]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--app-border)]">
                <div className="flex items-center gap-2">
                  {contact.isPrimary ? (
                    <span className="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
                      Contato Principal
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Contato Adicional
                    </span>
                  )}
                  <span className="text-xs text-[var(--app-muted)]">
                    {formatOrigin(contact.origin)}
                  </span>
                  {!contact.active && (
                    <span className="inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                      Desativado
                    </span>
                  )}
                </div>

                {!isInspect && (
                  <div className="flex items-center gap-2">
                    {!contact.isPrimary && contact.active && (
                      <button
                        type="button"
                        onClick={() => handleSetPrimary(index)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        Tornar principal
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleToggleActive(index)}
                      className="text-xs text-[var(--app-muted)] hover:text-red-500 font-medium ml-2"
                    >
                      {contact.active ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                )}
              </div>

              {suppressionMsg && (
                <div className="mt-2 rounded bg-amber-50 dark:bg-amber-950/40 p-2 text-xs text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/40">
                  {suppressionMsg}
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Nome">
                  <Input
                    type="text"
                    disabled={isInspect || !contact.active}
                    value={contact.name ?? ''}
                    onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                    placeholder="Nome do contato"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    disabled={isInspect || !contact.active}
                    value={contact.email ?? ''}
                    onChange={(e) => handleFieldChange(index, 'email', e.target.value)}
                    placeholder="email@empresa.com"
                  />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input
                    type="text"
                    disabled={isInspect || !contact.active}
                    value={contact.phone ?? ''}
                    onChange={(e) => handleFieldChange(index, 'phone', e.target.value)}
                    placeholder="(11) 99999-9999"
                  />
                </Field>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--app-border)]/60">
                <span className="text-xs font-semibold text-[var(--app-text-strong)]">
                  Caixas de recebimento:
                </span>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
                    const checked = contact.boxCodes.includes(box.code)
                    return (
                      <label
                        key={box.code}
                        className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer ${
                          checked
                            ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/20'
                            : 'border-[var(--app-border)] opacity-80'
                        } ${!contact.active || isInspect ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-[var(--app-border)] text-blue-600 focus:ring-blue-500"
                          disabled={isInspect || !contact.active}
                          checked={checked}
                          onChange={() => handleToggleBox(index, box.code)}
                        />
                        <div>
                          <div className="font-medium text-[var(--app-text-strong)]">
                            {box.label}
                          </div>
                          <div className="text-[10px] text-[var(--app-muted)] mt-0.5">
                            {box.description}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </Card>
          )
        })}

        {loadErrMsg || localError ? (
          <InlineError message={localError || loadErrMsg} />
        ) : null}

        <div className="flex justify-end mt-2">
          <Button
            type="submit"
            disabled={isInspect || isError}
            loading={submitting}
            title={
              isInspect
                ? 'Ação do cliente — indisponível em Modo Inspeção'
                : undefined
            }
          >
            Salvar contatos
          </Button>
        </div>
      </form>
    </div>
  )
}
