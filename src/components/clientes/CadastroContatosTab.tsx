import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useConfirm } from '../ui/ConfirmDialog'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerDetail } from '../../hooks/useCustomers'
import { usePortalProvisioningForCustomer } from '../../hooks/usePortalProvisioning'
import { PortalReviewPanel } from '../portal/PortalReviewPanel'
import { accountSituationLabel, provisioningDecisionLabel, recoveryEmailSourceLabel, deliveryStatusLabel } from '../../lib/portalProvisioningViewModel'
import { formatDate } from '../../lib/utils'
import { updateCustomerWithAudit } from '../../services/customers'
import { queryKeys } from '../../services/queryKeys'
import { CustomerContactConfiguration } from './CustomerContactConfiguration'

type Data = NonNullable<ReturnType<typeof useCustomerDetail>['data']>
type CustomerForm = { name: string; trade_name: string; address: string; city: string; state: string; zip: string; notes: string }

export function CadastroContatosTab({ data, cnpj }: { data: Data; cnpj: string }) {
  const queryClient = useQueryClient()
  const { user, profile, can } = useAuth()
  const canEdit = Boolean(profile || user)
  const canEditContacts = can('customer_communications')
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { data: portalRow } = usePortalProvisioningForCustomer(data.id)
  const [portalOpen, setPortalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [justification, setJustification] = useState('')
  const [form, setForm] = useState<CustomerForm>({ name: data.name, trade_name: data.trade_name ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', zip: data.zip ?? '', notes: data.notes ?? '' })
  const [prevFormData, setPrevFormData] = useState<Data | null>(null)

  if (data !== prevFormData) {
    setPrevFormData(data)
    setForm({ name: data.name, trade_name: data.trade_name ?? '', address: data.address ?? '', city: data.city ?? '', state: data.state ?? '', zip: data.zip ?? '', notes: data.notes ?? '' })
  }

  async function saveCustomer() {
    if (!user || !canEdit) {
      showToast('Edição de clientes restrita ao perfil autorizado.', 'error')
      return
    }
    if (!justification.trim()) {
      showToast('Informe a justificativa para salvar o cadastro.', 'error')
      return
    }

    const changes = [
      { field: 'Razão Social', before: data.name ?? '', after: form.name.trim() },
      { field: 'Nome fantasia', before: data.trade_name ?? '', after: form.trade_name.trim() },
      { field: 'Endereço', before: data.address ?? '', after: form.address.trim() },
      { field: 'Cidade', before: data.city ?? '', after: form.city.trim() },
      { field: 'UF', before: data.state ?? '', after: form.state.trim() },
      { field: 'CEP', before: data.zip ?? '', after: form.zip.trim() },
      { field: 'Notas', before: data.notes ?? '', after: form.notes.trim() },
    ].filter((c) => c.before !== c.after)

    if (changes.length === 0) {
      showToast('Nenhuma alteração para salvar.', 'info')
      return
    }

    const confirmed = await confirm({
      title: 'Salvar cadastro do cliente',
      message: `Salvar as alterações cadastrais do cliente "${data.name}"?`,
      confirmLabel: 'Salvar alterações',
      changes,
      consequence: 'Os dados cadastrais atualizados serão refletidos em todo o sistema e nas novas faturas emitidas.',
      reversibility: 'Os dados do cliente podem ser editados novamente pelo perfil autorizado com nova justificativa.',
    })
    if (!confirmed) return
    setSaving(true)
    try {
      const changed = await updateCustomerWithAudit({
        customerId: data.id,
        original: { name: data.name, trade_name: data.trade_name, address: data.address, city: data.city, state: data.state, zip: data.zip, notes: data.notes },
        values: { name: form.name, trade_name: form.trade_name || null, address: form.address || null, city: form.city || null, state: form.state || null, zip: form.zip || null, notes: form.notes || null },
        changedBy: user.id,
        justification,
      })
      await queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      setJustification('')
      showToast(changed ? 'Cadastro do cliente atualizado.' : 'Nenhuma alteração detectada.', changed ? 'success' : 'info')
    } catch {
      showToast('Falha ao salvar o cadastro do cliente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <Card className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(['name', 'trade_name', 'zip', 'city', 'state', 'address'] as const).map((key) => (
            <Field key={key} label={{ name: 'Nome', trade_name: 'Nome fantasia', zip: 'CEP', city: 'Cidade', state: 'UF', address: 'Endereço' }[key]}>
              <Input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: key === 'state' ? event.target.value.toUpperCase() : event.target.value }))} />
            </Field>
          ))}
        </div>
        <Field label="Notas"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
        <Field label="Justificativa"><Textarea value={justification} onChange={(event) => setJustification(event.target.value)} required /></Field>
        <div className="flex justify-end"><Button loading={saving} onClick={saveCustomer} disabled={!canEdit}>Salvar cadastro</Button></div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Portal do cliente</h2>
          {portalRow ? <Button variant="secondary" onClick={() => setPortalOpen((value) => !value)}>{portalOpen ? 'Fechar gestão' : 'Gerenciar Portal'}</Button> : null}
        </div>
        <p className="mt-1 text-sm text-slate-400">Convites, ativação e suspensão são administrados na fila de provisionamento do Portal.</p>
        {portalRow ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-slate-500">Email de Recuperação</div><div>{portalRow.recovery_email ?? 'Não informado'}</div>{portalRow.recovery_email_source ? <div className="text-xs text-slate-500">{recoveryEmailSourceLabel(portalRow.recovery_email_source)}</div> : null}</div>
          <div><div className="text-xs text-slate-500">Situação</div><div>{accountSituationLabel(portalRow.account_situation)}</div></div>
          <div><div className="text-xs text-slate-500">Decisão</div><div>{provisioningDecisionLabel(portalRow.provisioning_decision)}</div></div>
          <div><div className="text-xs text-slate-500">Entrega</div><div>{deliveryStatusLabel(portalRow.latestDeliveryStatus)}</div></div>
          <div><div className="text-xs text-slate-500">Último evento</div><div>{portalRow.lastActivityAt ? formatDate(portalRow.lastActivityAt) : 'Não informado'}</div></div>
          <div><div className="text-xs text-slate-500">Alerta crítico</div><div>{portalRow.hasCriticalAlert ? 'Sim' : 'Não'}</div></div>
          <div><div className="text-xs text-slate-500">Email compartilhado</div><div>{portalRow.sharedEmailCount > 0 ? 'Sim' : 'Não'}</div></div>
        </div> : null}
        {portalOpen && portalRow ? <div className="mt-4 border-t border-[#30363d] pt-4"><PortalReviewPanel row={portalRow} variant="embedded" onSaved={() => void queryClient.invalidateQueries({ queryKey: ['portal-provisioning', 'customer', data.id] })} /></div> : null}
        <Link to={`/clientes/portal?cliente=${data.id}`} className="mt-4 block text-sm font-medium text-cyan-300">Abrir fila de provisionamento →</Link>
      </Card>

      <Card>
        <CustomerContactConfiguration
          customerId={data.id}
          canEdit={canEditContacts}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['customer-detail', cnpj] })
            void queryClient.invalidateQueries({ queryKey: ['customers'] })
            void queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(data.id) })
          }}
        />
      </Card>
    </div>
  )
}
