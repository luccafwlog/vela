import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../hooks/useAuth'
import { useOverrideCustomers } from '../../hooks/useLocalCharges'
import { formatBRL } from '../../lib/utils'
import { createCustomer, findCustomerIdByDocument } from '../../services/customers'
import { linkBlCustomer } from '../../services/review'
import { queryKeys } from '../../services/queryKeys'
import type { BLDetail } from '../../types/database'

export function BlClienteSection({ bl }: { bl: BLDetail }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [creatingManifestCustomer, setCreatingManifestCustomer] = useState(false)
  const { data: customerOptions } = useOverrideCustomers(customerSearch)

  async function handleLinkCustomer(customerId: number | null) {
    if (!bl || !user) return
    setSavingCustomer(true)
    try {
      await linkBlCustomer({
        blId: bl.id,
        customerId,
        previousCustomerId: bl.customer_id != null ? Number(bl.customer_id) : null,
        changedBy: user.id,
        expectedUpdatedAt: bl.updated_at ?? null,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.detail(bl.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.portal.blStatus(bl.id) }),
      ])
      showToast(customerId != null ? 'Cliente vinculado com sucesso.' : 'Cliente desvinculado.', 'success')
      setCustomerSearch('')
      setSelectedCustomerId(null)
    } catch {
      showToast('Falha ao vincular cliente.', 'error')
    } finally {
      setSavingCustomer(false)
    }
  }

  async function handleCreateManifestCustomer() {
    if (!bl) return
    const name = bl.manifest_customer_name?.trim()
    const cnpj = bl.manifest_customer_cnpj_cpf?.trim()
    const email = bl.manifest_customer_email?.trim()
    if (!name || !cnpj) return

    if (!email || !email.includes('@')) {
      showToast('O cadastro do cliente exige um e-mail válido no manifesto.', 'error')
      return
    }

    setCreatingManifestCustomer(true)
    try {
      const contacts = [
        {
          name: 'Contato manifesto',
          email,
          purpose: 'geral' as const,
          is_primary: true,
          box_codes: ['documentacao_operacao', 'financeiro', 'demurrage'],
        },
      ]
      const customer = await createCustomer({ cnpjCpf: cnpj, name, contacts })
      await handleLinkCustomer(customer.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
      if (msg.includes('duplicate key') || msg.includes('customers_cnpj_cpf_key')) {
        const existingId = await findCustomerIdByDocument(cnpj)
        if (existingId != null) {
          await handleLinkCustomer(existingId)
          return
        }
      }
      showToast('Falha ao cadastrar cliente do manifesto.', 'error')
    } finally {
      setCreatingManifestCustomer(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-white">Cliente</h2>
      <dl className="mb-4 grid gap-3 text-sm">
        <InfoLine label="Cliente vinculado" value={bl.customer?.name ?? 'Não vinculado'} />
        <InfoLine label="CNPJ" value={bl.customer?.cnpj_cpf ?? '-'} />
        <InfoLine label="Saldo pendente" value={formatBRL(bl.customer?.pending_balance ?? 0)} />
      </dl>

      {(bl.manifest_customer_name ?? bl.manifest_customer_cnpj_cpf) ? (
        <div className="mb-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Dados do manifesto</div>
          <dl className="mb-3 grid gap-2 text-sm">
            <InfoLine label="Nome" value={bl.manifest_customer_name ?? '-'} />
            <InfoLine label="CNPJ" value={bl.manifest_customer_cnpj_cpf ?? '-'} />
            <InfoLine label="Email" value={bl.manifest_customer_email ?? '-'} />
          </dl>
          {!bl.customer_id && bl.manifest_customer_name && bl.manifest_customer_cnpj_cpf ? (
            !bl.manifest_customer_email?.trim() ? (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 p-2 text-xs text-amber-900 dark:text-amber-200">
                O manifesto não possui e-mail. Complete o cadastro do cliente manualmente antes de vincular.
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                loading={creatingManifestCustomer}
                onClick={handleCreateManifestCustomer}
              >
                Cadastrar e vincular cliente do manifesto
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Conciliação:</span>
        {bl.customer_reconciliation_status === 'reconciled' ? <Badge tone="green">Reconciliado</Badge>
          : bl.customer_reconciliation_status === 'matched_document' ? <Badge tone="blue">Match CNPJ</Badge>
          : bl.customer_reconciliation_status === 'matched_name' ? <Badge tone="yellow">Match nome</Badge>
          : bl.customer_reconciliation_status === 'rejected' ? <Badge tone="red">Rejeitado</Badge>
          : <Badge tone="yellow">Pendente</Badge>}
        {bl.customer_reconciliation_notes ? (
          <span className="text-xs text-slate-400">{bl.customer_reconciliation_notes}</span>
        ) : null}
      </div>

      <div className="border-t border-[#30363d] pt-4">
        <div className="mb-3 text-sm font-semibold text-white">Vincular cliente</div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Buscar">
            <Input
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Razao social ou CNPJ"
            />
          </Field>
          <Field label="Selecionar">
            <Select
              value={selectedCustomerId != null ? String(selectedCustomerId) : ''}
              onChange={(event) => setSelectedCustomerId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Selecione</option>
              {(customerOptions ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.cnpj_cpf ? ` — ${c.cnpj_cpf}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            onClick={() => handleLinkCustomer(selectedCustomerId)}
            loading={savingCustomer}
            disabled={selectedCustomerId == null || savingCustomer}
          >
            <Save size={15} />
            Vincular
          </Button>
          {bl.customer_id ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => handleLinkCustomer(null)}
              loading={savingCustomer}
              disabled={savingCustomer}
            >
              <X size={15} />
              Desvincular
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#30363d] pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-100">{value}</dd>
    </div>
  )
}
