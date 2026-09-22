import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { Button } from '../ui/Button'
import { InlineError } from '../ui/Card'
import { Field, Input, Textarea } from '../ui/Input'
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

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const data = await fetchCustomerContactConfiguration(customerId)
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
    } catch (err) {
      setErrorMsg(extractErrorText(err) || 'Falha ao carregar contatos do cliente.')
    } finally {
      setLoading(false)
    }
  }, [customerId])

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
      const otherHasBox = drafts.some(
        (d, i) => i !== index && d.active && d.boxCodes.includes(boxCode),
      )
      if (!otherHasBox) {
        setErrorMsg(
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
        (d) => d.boxCodes.includes(box.code) && d.sendable !== false && !d.suppressionReason,
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

  if (loading) {
    return <div className="text-sm text-slate-400">Carregando contatos e caixas de comunicação...</div>
  }

  return (
    <div className="grid gap-6">
      {/* Resumo visual dos destinatários agrupados por caixa */}
      <div className="grid gap-3 sm:grid-cols-3">
        {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
          const linkedContacts = drafts.filter(
            (d) => d.active && d.email && d.boxCodes.includes(box.code),
          )
          return (
            <div
              key={box.code}
              className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--app-text-strong)] text-sm">{box.label}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 font-medium">
                    {linkedContacts.length} {linkedContacts.length === 1 ? 'e-mail' : 'e-mails'}
                  </span>
                </div>
                <p className="text-xs text-[var(--app-muted)] mt-1">{box.description}</p>
              </div>

              <div className="mt-3 border-t border-[var(--app-border)] pt-2 space-y-1">
                {linkedContacts.length === 0 ? (
                  <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Nenhum contato vinculado</span>
                ) : (
                  linkedContacts.map((c, i) => (
                    <div key={i} className="text-xs text-[var(--app-text)] flex items-center justify-between">
                      <span className="truncate max-w-[180px]">{c.email}</span>
                      {c.isPrimary && (
                        <span className="text-[10px] text-[var(--app-link)] font-medium ml-1">principal</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-slate-500 italic">
        Nota: Finalidades legadas (Geral, Operacional, Faturamento) não controlam mais o envio de mensagens. O roteamento é governado exclusivamente pelas caixas acima.
      </p>

      {!canEdit && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 p-3 text-xs text-amber-900 dark:text-amber-200">
          Seu perfil de usuário não possui permissão para editar os contatos do cliente.
        </div>
      )}

      {/* Editor de contatos */}
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--app-text-strong)]">Contatos do cliente</h3>
          {canEdit && (
            <Button type="button" variant="secondary" onClick={handleAddContact}>
              + Novo contato
            </Button>
          )}
        </div>

        {drafts.map((contact, index) => {
          const suppressionMsg = formatSuppression(contact.suppressionReason)
          return (
            <div
              key={contact.id ?? `draft-${index}`}
              className={`rounded-xl border p-4 transition-colors ${
                !contact.active
                  ? 'border-[var(--app-border)] bg-[var(--app-surface-muted)] opacity-75'
                  : contact.isPrimary
                  ? 'border-[var(--app-blue)] bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-[var(--app-border)] bg-[var(--app-surface)]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--app-border)]">
                <div className="flex items-center gap-2">
                  {contact.isPrimary ? (
                    <span className="inline-flex items-center rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 px-2 py-0.5 text-xs font-semibold">
                      Contato Principal
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 px-2 py-0.5 text-xs font-medium">
                      Contato Adicional
                    </span>
                  )}
                  <span className="text-xs text-[var(--app-muted)]">{formatOrigin(contact.origin)}</span>
                  {!contact.active && (
                    <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 text-xs font-medium">
                      Desativado
                    </span>
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center gap-2">
                    {!contact.isPrimary && contact.active && (
                      <button
                        type="button"
                        onClick={() => handleSetPrimary(index)}
                        className="text-xs text-[var(--app-link)] hover:underline font-medium"
                      >
                        Tornar principal
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleToggleActive(index)}
                      className="text-xs text-slate-400 hover:text-red-400 font-medium ml-2"
                    >
                      {contact.active ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                )}
              </div>

              {suppressionMsg && (
                <div className="mt-2 rounded bg-amber-50 dark:bg-amber-950/40 p-2 text-xs text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/40">
                  {suppressionMsg}
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="Nome">
                  <Input
                    type="text"
                    disabled={!canEdit || !contact.active}
                    value={contact.name ?? ''}
                    onChange={(e) => handleFieldChange(index, 'name', e.target.value)}
                    placeholder="Nome do contato"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    disabled={!canEdit || !contact.active}
                    value={contact.email ?? ''}
                    onChange={(e) => handleFieldChange(index, 'email', e.target.value)}
                    placeholder="email@empresa.com"
                  />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input
                    type="text"
                    disabled={!canEdit || !contact.active}
                    value={contact.phone ?? ''}
                    onChange={(e) => handleFieldChange(index, 'phone', e.target.value)}
                    placeholder="(11) 99999-9999"
                  />
                </Field>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--app-border)]">
                <span className="text-xs font-semibold text-[var(--app-text-strong)]">
                  Caixas de recebimento vinculadas:
                </span>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {CUSTOMER_COMMUNICATION_BOXES.map((box) => {
                    const checked = contact.boxCodes.includes(box.code)
                    return (
                      <label
                        key={box.code}
                        className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer ${
                          checked
                            ? 'border-[var(--app-blue)] bg-blue-50/70 dark:bg-blue-950/30'
                            : 'border-[var(--app-border)] opacity-80'
                        } ${!contact.active || !canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-[#30363d] text-blue-600 focus:ring-blue-500"
                          disabled={!canEdit || !contact.active}
                          checked={checked}
                          onChange={() => handleToggleBox(index, box.code)}
                        />
                        <div>
                          <div className="font-medium text-[var(--app-text-strong)]">{box.label}</div>
                          <div className="text-[10px] text-[var(--app-muted)] mt-0.5">{box.description}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}

        {canEdit && (
          <Field label="Justificativa da alteração">
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Obrigatório registrar justificativa para auditoria interna"
            />
          </Field>
        )}

        {errorMsg ? <InlineError message={errorMsg} /> : null}

        {canEdit && (
          <div className="flex justify-end mt-2">
            <Button type="submit" loading={saving}>
              Salvar alterações de contatos
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}
