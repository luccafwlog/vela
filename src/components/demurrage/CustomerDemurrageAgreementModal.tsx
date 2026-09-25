import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useSaveCustomerDemurrageAgreement } from '../../hooks/useCustomerDemurrageAgreements'
import { listOverrideCustomers } from '../../services/charges/chargeRateService'
import { formatCnpjCpf } from '../../lib/utils'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'

export type CustomerDemurrageAgreementModalProps = {
  open: boolean
  onClose: () => void
  initialAgreement?: CustomerDemurrageAgreementListItem | null
  initialCustomer?: { id: number; name: string; cnpj_cpf: string } | null
}

function CustomerDemurrageAgreementForm({
  onClose,
  initialAgreement,
  initialCustomer,
}: Omit<CustomerDemurrageAgreementModalProps, 'open'>) {
  const { showToast } = useToast()
  const saveMutation = useSaveCustomerDemurrageAgreement()

  const [customerId, setCustomerId] = useState<number | null>(
    initialAgreement?.customer_id ?? initialCustomer?.id ?? null,
  )
  const [selectedCustomerLabel, setSelectedCustomerLabel] = useState<string>(
    initialAgreement?.customer
      ? `${initialAgreement.customer.name} (${formatCnpjCpf(initialAgreement.customer.cnpj_cpf)})`
      : initialAgreement
        ? `Cliente #${initialAgreement.customer_id}`
        : initialCustomer
          ? `${initialCustomer.name} (${formatCnpjCpf(initialCustomer.cnpj_cpf)})`
          : '',
  )
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerOptions, setCustomerOptions] = useState<Array<{ id: number; name: string; cnpj_cpf: string }>>([])
  const [searchingCustomers, setSearchingCustomers] = useState(false)

  const [freeDays, setFreeDays] = useState<string>(
    initialAgreement?.free_days != null ? String(initialAgreement.free_days) : '21',
  )
  const [p1Usd, setP1Usd] = useState<string>(
    initialAgreement?.p1_usd != null ? String(Number(initialAgreement.p1_usd)) : '',
  )
  const [p2Usd, setP2Usd] = useState<string>(
    initialAgreement?.p2_usd != null ? String(Number(initialAgreement.p2_usd)) : '',
  )
  const [validFrom, setValidFrom] = useState<string>(
    initialAgreement?.valid_from
      ? initialAgreement.valid_from.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  )
  const [validTo, setValidTo] = useState<string>(
    initialAgreement?.valid_to ? initialAgreement.valid_to.slice(0, 10) : '',
  )
  const [active, setActive] = useState<boolean>(initialAgreement?.active ?? true)
  const [notes, setNotes] = useState<string>(initialAgreement?.notes ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (initialCustomer || initialAgreement) return
    const query = customerSearch.trim()
    if (!query) return

    let isMounted = true
    const timer = setTimeout(() => {
      setSearchingCustomers(true)
      listOverrideCustomers(query)
        .then((data) => {
          if (isMounted) setCustomerOptions(data)
        })
        .catch(() => {
          if (isMounted) setCustomerOptions([])
        })
        .finally(() => {
          if (isMounted) setSearchingCustomers(false)
        })
    }, 250)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [customerSearch, initialCustomer, initialAgreement])

  async function handleSave() {
    if (!customerId) {
      showToast('Selecione o cliente para o acordo.', 'error')
      return
    }
    const free = Number(freeDays)
    if (!Number.isFinite(free) || free < 0) {
      showToast('Informe um número válido de dias de free time (≥ 0).', 'error')
      return
    }
    if (!validFrom) {
      showToast('Informe a data de início da vigência.', 'error')
      return
    }
    if (validTo && validTo < validFrom) {
      showToast('A data de término não pode ser anterior ao início.', 'error')
      return
    }

    const p1Val = p1Usd.trim() ? Number(p1Usd.replace(',', '.')) : null
    const p2Val = p2Usd.trim() ? Number(p2Usd.replace(',', '.')) : null
    if (p1Val != null && (!Number.isFinite(p1Val) || p1Val < 0)) {
      showToast('Tarifa P1 deve ser um valor numérico positivo ou nulo.', 'error')
      return
    }
    if (p2Val != null && (!Number.isFinite(p2Val) || p2Val < 0)) {
      showToast('Tarifa P2 deve ser um valor numérico positivo ou nulo.', 'error')
      return
    }

    setSaving(true)
    try {
      await saveMutation.mutateAsync({
        id: initialAgreement?.id,
        customer_id: customerId,
        free_days: free,
        p1_usd: p1Val,
        p2_usd: p2Val,
        valid_from: validFrom,
        valid_to: validTo || null,
        active,
        notes: notes.trim() || null,
      })
      showToast(initialAgreement ? 'Acordo de Demurrage atualizado.' : 'Acordo de Demurrage cadastrado.', 'success')
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar acordo de Demurrage.'
      showToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4">
      {/* Customer Select / Fixed */}
      {initialCustomer || initialAgreement ? (
        <Field label="Cliente">
          <Input value={selectedCustomerLabel} readOnly disabled className="opacity-80" />
        </Field>
      ) : (
        <div>
          <Field label="Buscar Cliente (Razão Social ou CNPJ)">
            <Input
              placeholder="Digite o nome ou CNPJ do cliente..."
              value={customerSearch}
              onChange={(e) => {
                const val = e.target.value
                setCustomerSearch(val)
                if (!val.trim()) {
                  setCustomerOptions([])
                }
                setCustomerId(null)
                setSelectedCustomerLabel('')
              }}
            />
          </Field>
          {selectedCustomerLabel ? (
            <div className="mt-1 text-xs text-emerald-400">
              Cliente selecionado: <strong>{selectedCustomerLabel}</strong>
            </div>
          ) : null}
          {searchingCustomers ? (
            <div className="mt-1 text-xs text-slate-400">Buscando clientes...</div>
          ) : customerOptions.length > 0 && !customerId ? (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-1">
              {customerOptions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-[#161b22] hover:text-white"
                  onClick={() => {
                    setCustomerId(c.id)
                    setSelectedCustomerLabel(`${c.name} (${formatCnpjCpf(c.cnpj_cpf)})`)
                    setCustomerOptions([])
                  }}
                >
                  <span className="font-semibold">{c.name}</span>
                  <span className="ml-2 text-slate-400">{formatCnpjCpf(c.cnpj_cpf)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Free Time and Rates */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Free Time (dias) *">
          <Input
            type="number"
            min={0}
            value={freeDays}
            onChange={(e) => setFreeDays(e.target.value)}
            placeholder="Ex: 28"
          />
        </Field>
        <Field label="Tarifa P1 (USD/dia)">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={p1Usd}
            onChange={(e) => setP1Usd(e.target.value)}
            placeholder="Padrão geral"
          />
        </Field>
        <Field label="Tarifa P2 (USD/dia)">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={p2Usd}
            onChange={(e) => setP2Usd(e.target.value)}
            placeholder="Padrão geral"
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-400">
        Deixe as tarifas P1/P2 em branco caso o acordo negocie apenas dias de Free Time extras mantendo os valores diários padrão do armador.
      </p>

      {/* Validity */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vigência de *">
          <Input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </Field>
        <Field label="Vigência até (opcional)">
          <Input
            type="date"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
          />
        </Field>
      </div>

      {/* Active Toggle */}
      <div className="flex items-center gap-2 pt-1">
        <input
          id="agreement-active"
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="agreement-active" className="text-sm font-medium text-slate-200">
          Acordo Ativo
        </label>
      </div>

      {/* Notes */}
      <Field label="Observações">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ex: Condição negociada com diretoria comercial (contrato anual 2026)."
        />
      </Field>

      {/* Actions */}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          Voltar
        </Button>
        <Button type="button" onClick={() => void handleSave()} loading={saving}>
          {initialAgreement ? 'Salvar Alterações' : 'Cadastrar Acordo'}
        </Button>
      </div>
    </div>
  )
}

export function CustomerDemurrageAgreementModal({
  open,
  onClose,
  initialAgreement,
  initialCustomer,
}: CustomerDemurrageAgreementModalProps) {
  const formKey = `${initialAgreement?.id ?? initialCustomer?.id ?? 'new'}-${open}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initialAgreement ? 'Editar Acordo de Demurrage' : 'Novo Acordo de Demurrage'}
    >
      {open ? (
        <CustomerDemurrageAgreementForm
          key={formKey}
          onClose={onClose}
          initialAgreement={initialAgreement}
          initialCustomer={initialCustomer}
        />
      ) : null}
    </Modal>
  )
}
