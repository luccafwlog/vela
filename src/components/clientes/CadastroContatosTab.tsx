import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useConfirm } from '../ui/ConfirmDialog'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerDetail } from '../../hooks/useCustomers'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { PortalReviewPanel } from '../portal/PortalReviewPanel'
import { accountSituationLabel, deliveryStatusLabel, hasBrokenRecoveryEmail, recoveryEmailSourceLabel } from '../../lib/portalProvisioningViewModel'
import { userFacingErrorMessage } from '../../lib/errors'
import { formatCnpjCpf, formatDate } from '../../lib/utils'
import { updateCustomerWithAudit } from '../../services/customers'
import { queryKeys } from '../../services/queryKeys'
import { CustomerContactConfiguration } from './CustomerContactConfiguration'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type CustomerForm = { name: string; trade_name: string; address: string; city: string; state: string; zip: string; notes: string }

const FIELD_LABELS: Record<keyof CustomerForm, string> = {
  name: 'Razão Social',
  trade_name: 'Nome fantasia',
  address: 'Endereço',
  city: 'Cidade',
  state: 'UF',
  zip: 'CEP',
  notes: 'Notas',
}

function formFromData(data: Data): CustomerForm {
  return { name: data.name, trade_name: data.trade_name ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', zip: data.zip ?? '', notes: data.notes ?? '' }
}

/** Campos alterados, na ordem do formulário: alimenta o aviso e a confirmação. */
function changedFields(data: Data, form: CustomerForm) {
  const original = formFromData(data)
  return (Object.keys(FIELD_LABELS) as (keyof CustomerForm)[])
    .map((key) => ({ key, field: FIELD_LABELS[key], before: original[key] ?? '', after: form[key].trim() }))
    .filter((change) => change.before.trim() !== change.after)
}

export function CadastroContatosTab({ data, cnpj }: { data: Data; cnpj: string }) {
  const queryClient = useQueryClient()
  const { user, profile, can } = useAuth()
  // A política de `customers` aceita qualquer usuário interno ativo (migration 295).
  const canEdit = Boolean(profile || user)
  const canEditContacts = can('customer_communications')
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const [justification, setJustification] = useState('')
  const [errors, setErrors] = useState<{ name?: string; justification?: string; submit?: string }>({})
  const [form, setForm] = useState<CustomerForm>(() => formFromData(data))
  const [prevFormData, setPrevFormData] = useState<Data | null>(null)

  if (data !== prevFormData) {
    setPrevFormData(data)
    setForm(formFromData(data))
  }

  const changes = changedFields(data, form)
  const dirty = changes.length > 0

  function update(key: keyof CustomerForm, value: string) {
    setForm((current) => ({ ...current, [key]: key === 'state' ? value.toUpperCase() : value }))
    setErrors((current) => ({ ...current, [key === 'name' ? 'name' : 'submit']: undefined }))
  }

  function discard() {
    setForm(formFromData(data))
    setJustification('')
    setErrors({})
  }

  async function saveCustomer() {
    if (!user || !canEdit) {
      setErrors({ submit: 'Edição de clientes restrita ao perfil autorizado.' })
      return
    }
    const nextErrors: typeof errors = {}
    if (form.name.trim().length < 2) nextErrors.name = 'Informe a razão social (mínimo de 2 caracteres).'
    if (!justification.trim()) nextErrors.justification = 'Informe a justificativa: ela fica registrada na auditoria do cadastro.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    const confirmed = await confirm({
      title: 'Salvar cadastro do cliente',
      message: `Salvar as alterações cadastrais do cliente "${data.name}"?`,
      confirmLabel: 'Salvar alterações',
      changes: changes.map(({ field, before, after }) => ({ field, before, after })),
      consequence: 'Os dados cadastrais atualizados serão refletidos em todo o sistema e nas novas faturas emitidas.',
      reversibility: 'Os dados do cliente podem ser editados novamente pelo perfil autorizado com nova justificativa.',
    })
    if (!confirmed) return
    setSaving(true)
    try {
      const changed = await updateCustomerWithAudit({
        customerId: data.id,
        original: { name: data.name, trade_name: data.trade_name, address: data.address, city: data.city, state: data.state, zip: data.zip, notes: data.notes },
        values: { name: form.name.trim(), trade_name: form.trade_name.trim() || null, address: form.address.trim() || null, city: form.city.trim() || null, state: form.state.trim() || null, zip: form.zip.trim() || null, notes: form.notes.trim() || null },
        changedBy: user.id,
        justification,
      })
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      await queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(data.id) })
      setJustification('')
      showToast(changed ? 'Cadastro do cliente atualizado.' : 'Nenhuma alteração detectada.', changed ? 'success' : 'info')
    } catch (cause) {
      setErrors({ submit: userFacingErrorMessage(cause, 'Não foi possível salvar o cadastro. Tente de novo.') })
    } finally {
      setSaving(false)
    }
  }

  const fieldsDisabled = !canEdit || saving

  return (
    <div className="app-customer-stack">
      <Card className="app-customer-sheet">
        <form
          className="app-customer-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (dirty) void saveCustomer()
          }}
        >
          <div className="app-customer-section-head">
            <div>
              <h2 className="app-customer-section-title">Dados cadastrais</h2>
              <p className="app-customer-muted">Saem nas faturas emitidas depois da alteração. Toda alteração pede justificativa e fica no Histórico.</p>
            </div>
          </div>
          <dl className="app-customer-facts app-customer-facts--inline">
            <div>
              <dt>CNPJ</dt>
              <dd className="tabular-nums">{formatCnpjCpf(data.cnpj_cpf)}</dd>
              <dd className="app-customer-facts__sub">Alterado só pelo Administrativo, com auditoria, em Acesso ao Portal › Gerenciar.</dd>
            </div>
          </dl>
          <div className="app-customer-form__grid app-customer-form__grid--three">
            <div className="app-customer-form__span2">
              <Field label="Razão social" required error={errors.name}>
                <Input value={form.name} disabled={fieldsDisabled} onChange={(event) => update('name', event.target.value)} />
              </Field>
            </div>
            <Field label="Nome fantasia">
              <Input value={form.trade_name} disabled={fieldsDisabled} onChange={(event) => update('trade_name', event.target.value)} />
            </Field>
            <div className="app-customer-form__span2">
              <Field label="Endereço">
                <Input value={form.address} disabled={fieldsDisabled} onChange={(event) => update('address', event.target.value)} />
              </Field>
            </div>
            <Field label="CEP">
              <Input inputMode="numeric" value={form.zip} disabled={fieldsDisabled} onChange={(event) => update('zip', event.target.value)} />
            </Field>
            <Field label="Cidade">
              <Input value={form.city} disabled={fieldsDisabled} onChange={(event) => update('city', event.target.value)} />
            </Field>
            <Field label="UF">
              <Input maxLength={2} value={form.state} disabled={fieldsDisabled} onChange={(event) => update('state', event.target.value)} />
            </Field>
            <div className="app-customer-form__wide">
              <Field label="Notas" hint="Uso interno; não aparece para o Cliente.">
                <Textarea rows={2} value={form.notes} disabled={fieldsDisabled} onChange={(event) => update('notes', event.target.value)} />
              </Field>
            </div>
          </div>

          {dirty ? (
            <div className="app-customer-savebar" role="region" aria-label="Alterações não salvas">
              <p className="app-customer-savebar__summary">
                <strong>{changes.length === 1 ? '1 alteração não salva' : `${changes.length} alterações não salvas`}:</strong>{' '}
                {changes.map((change) => change.field).join(', ')}
              </p>
              <Field label="Justificativa" required error={errors.justification}>
                <Textarea rows={2} value={justification} disabled={saving} onChange={(event) => { setJustification(event.target.value); setErrors((current) => ({ ...current, justification: undefined })) }} />
              </Field>
              {errors.submit ? <p className="app-customer-error" role="alert">{errors.submit}</p> : null}
              <div className="app-customer-savebar__actions">
                <Button type="button" variant="secondary" onClick={discard} disabled={saving}>Descartar</Button>
                <Button type="submit" loading={saving} loadingLabel="Salvando…" disabled={!canEdit}>Salvar cadastro</Button>
              </div>
            </div>
          ) : errors.submit ? <p className="app-customer-error" role="alert">{errors.submit}</p> : null}
        </form>
      </Card>

      <Card className="app-customer-sheet">
        <CustomerContactConfiguration
          customerId={data.id}
          canEdit={canEditContacts}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
            void queryClient.invalidateQueries({ queryKey: ['customers'] })
            // "Sem e-mail de contato" da lista depende dos contatos.
            void queryClient.invalidateQueries({ queryKey: ['customers-summary'] })
            void queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(data.id) })
          }}
        />
      </Card>

      <PortalAccessSection customerId={data.id} />
    </div>
  )
}

/**
 * Acesso ao Portal: situação da conta e Email de Recuperação. Não é contato:
 * o Email de Recuperação só recebe convite e recuperação de senha.
 */
function PortalAccessSection({ customerId }: { customerId: number }) {
  const queryClient = useQueryClient()
  const { data: portalRow, isLoading, isError, refetch } = usePortalProvisioningForCustomer(customerId)
  const [portalOpen, setPortalOpen] = useState(false)
  const panelId = `portal-panel-${customerId}`

  return (
    <Card className="app-customer-sheet">
      <div className="app-customer-section-head">
        <div>
          <h2 className="app-customer-section-title">Acesso ao Portal</h2>
          <p className="app-customer-muted">
            O Email de Recuperação recebe só o convite e a recuperação de senha; não recebe Comunicados nem faturas.
          </p>
        </div>
        <div className="app-customer-section-links">
          {portalRow ? (
            <Button variant="secondary" aria-expanded={portalOpen} aria-controls={panelId} onClick={() => setPortalOpen((value) => !value)}>
              {portalOpen ? 'Fechar gestão' : 'Gerenciar aqui'}
            </Button>
          ) : null}
          <Link className="app-customer-text-link" to={`/clientes/portal?cliente=${customerId}`}>
            Abrir no Provisionamento do Portal <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {isLoading ? <p className="app-customer-muted" role="status">Carregando a situação do Portal…</p> : null}
      {isError ? (
        <div className="app-customer-notice app-customer-notice--danger" role="alert">
          <span>Não foi possível carregar a situação do Portal.</span>
          <Button variant="secondary" className="app-btn--sm" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      ) : null}
      {!isLoading && !isError && !portalRow ? (
        <p className="app-customer-muted">Este Cliente ainda não está na fila do Portal. A fila é criada no cadastro; abra o Provisionamento para conferir.</p>
      ) : null}

      {portalRow && !portalOpen ? (
        <>
          <dl className="app-customer-facts">
            <div><dt>Situação da conta</dt><dd>{accountSituationLabel(portalRow.account_situation)}</dd></div>
            <div>
              <dt>Email de Recuperação</dt>
              <dd className="app-customer-facts__break">{portalRow.recovery_email ?? 'Não informado'}</dd>
              {portalRow.recovery_email ? <dd className="app-customer-facts__sub">{recoveryEmailSourceLabel(portalRow.recovery_email_source)}</dd> : null}
            </div>
            <div><dt>Entrega do último envio</dt><dd>{deliveryStatusLabel(portalRow.latestDeliveryStatus)}</dd></div>
            <div><dt>Último evento</dt><dd className="tabular-nums">{portalRow.lastActivityAt ? formatDate(portalRow.lastActivityAt) : 'Nenhum'}</dd></div>
          </dl>
          {portalRow.hasCriticalAlert || hasBrokenRecoveryEmail(portalRow) || portalRow.sharedEmailCount > 0 ? (
            <ul className="app-customer-warnings">
              {portalRow.hasCriticalAlert ? <li>Há um alerta crítico do Portal aberto para este Cliente.</li> : null}
              {hasBrokenRecoveryEmail(portalRow) ? <li>O Email de Recuperação {portalRow.recoveryEmailSuppressed ? 'está bloqueado para envio' : 'apresentou falha permanente'}: a recuperação de senha não chega.</li> : null}
              {portalRow.sharedEmailCount > 0 ? <li>O Email de Recuperação também é usado por {portalRow.sharedEmailCount === 1 ? 'outro CNPJ' : `outros ${portalRow.sharedEmailCount} CNPJs`}.</li> : null}
            </ul>
          ) : null}
        </>
      ) : null}

      {portalOpen && portalRow ? (
        <div id={panelId} className="app-customer-embedded">
          <PortalReviewPanel row={portalRow} variant="embedded" onSaved={() => void queryClient.invalidateQueries({ queryKey: ['portal-provisioning', 'customer', customerId] })} />
        </div>
      ) : null}
    </Card>
  )
}
