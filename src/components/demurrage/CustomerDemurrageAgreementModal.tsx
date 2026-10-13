import { useCallback, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Field, Input, Textarea } from '../ui/Input'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { useSaveCustomerDemurrageAgreement } from '../../hooks/useCustomerDemurrageAgreements'
import { listOverrideCustomers } from '../../services/charges/chargeRateService'
import { classifyDbError } from '../../lib/errors'
import { saoPauloTodayIso } from '../../lib/dates'
import { formatCnpjCpf, formatDate, formatUSD } from '../../lib/utils'
import type { CustomerDemurrageAgreementListItem } from '../../types/customerDemurrageAgreements'
import { validateAgreementDraft, type AgreementErrors } from './demurrageFormRules'

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
  const confirm = useConfirm()
  const saveMutation = useSaveCustomerDemurrageAgreement()

  const fixedCustomer = initialAgreement
    ? { id: initialAgreement.customer_id, name: initialAgreement.customer?.name ?? `Cliente #${initialAgreement.customer_id}`, cnpj_cpf: initialAgreement.customer?.cnpj_cpf ?? '' }
    : initialCustomer ?? null
  const [customerId, setCustomerId] = useState<number | null>(fixedCustomer?.id ?? null)
  const [customerName, setCustomerName] = useState(fixedCustomer?.name ?? '')
  const [freeDays, setFreeDays] = useState<string>(initialAgreement?.free_days != null ? String(initialAgreement.free_days) : '21')
  const [p1Usd, setP1Usd] = useState<string>(initialAgreement?.p1_usd != null ? String(Number(initialAgreement.p1_usd)) : '')
  const [p2Usd, setP2Usd] = useState<string>(initialAgreement?.p2_usd != null ? String(Number(initialAgreement.p2_usd)) : '')
  const [validFrom, setValidFrom] = useState<string>(initialAgreement?.valid_from ? initialAgreement.valid_from.slice(0, 10) : saoPauloTodayIso())
  const [validTo, setValidTo] = useState<string>(initialAgreement?.valid_to ? initialAgreement.valid_to.slice(0, 10) : '')
  const [active, setActive] = useState<boolean>(initialAgreement?.active ?? true)
  const [notes, setNotes] = useState<string>(initialAgreement?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<AgreementErrors>({})

  const fetchCustomers = useCallback(async (term: string): Promise<ComboOption[]> => {
    const customers = await listOverrideCustomers(term)
    return customers.map((customer) => ({ value: String(customer.id), label: customer.name, meta: formatCnpjCpf(customer.cnpj_cpf) }))
  }, [])

  function clearError(key: keyof AgreementErrors) {
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }))
  }

  async function handleSave() {
    const result = validateAgreementDraft({ customerId, freeDays, p1: p1Usd, p2: p2Usd, validFrom, validTo })
    setErrors(result.errors)
    if (Object.keys(result.errors).length) return
    const { free, p1: p1Val, p2: p2Val } = result

    const rateText = (value: number | null) => (value == null ? 'tabela padrão' : `${formatUSD(value)}/dia`)
    const changes = [
      { field: 'Free Time (dias)', before: initialAgreement ? String(initialAgreement.free_days) : '', after: String(free) },
      { field: 'Tarifa P1 (USD/dia)', before: initialAgreement?.p1_usd == null ? '' : String(Number(initialAgreement.p1_usd)), after: p1Val == null ? '' : String(p1Val) },
      { field: 'Tarifa P2 (USD/dia)', before: initialAgreement?.p2_usd == null ? '' : String(Number(initialAgreement.p2_usd)), after: p2Val == null ? '' : String(p2Val) },
      { field: 'Vigência de', before: initialAgreement ? formatDate(initialAgreement.valid_from.slice(0, 10)) : '', after: formatDate(validFrom) },
      { field: 'Vigência até', before: initialAgreement?.valid_to ? formatDate(initialAgreement.valid_to.slice(0, 10)) : '', after: validTo ? formatDate(validTo) : '' },
      { field: 'Status', before: initialAgreement ? (initialAgreement.active ? 'Ativo' : 'Inativo') : '', after: active ? 'Ativo' : 'Inativo' },
      { field: 'Observações', before: initialAgreement?.notes ?? '', after: notes.trim() },
    ].filter((field) => field.before !== field.after)
    if (initialAgreement && changes.length === 0) {
      setErrors({ form: 'Nenhuma alteração para salvar.' })
      return
    }
    const period = `${formatDate(validFrom)} a ${validTo ? formatDate(validTo) : 'sem data final'}`
    const confirmed = await confirm({
      title: initialAgreement ? 'Salvar acordo de Demurrage' : 'Cadastrar acordo de Demurrage',
      message: `${initialAgreement ? 'Atualizar' : 'Cadastrar'} o acordo de Demurrage de ${customerName || `Cliente #${customerId}`}?`,
      confirmLabel: initialAgreement ? 'Salvar alterações' : 'Cadastrar acordo',
      affected: {
        summary: `${customerName} · ${free} dias de free time · ${period}`,
        ...(!initialAgreement ? { items: [`P1: ${rateText(p1Val)}`, `P2: ${rateText(p2Val)}`, `Status: ${active ? 'Ativo' : 'Inativo'}`] } : {}),
      },
      changes: initialAgreement ? changes : undefined,
      consequence: 'O acordo será selecionado nos cálculos de Demurrage do cliente conforme a data de descarga e a vigência. Esta gravação atualiza a regra comercial; não grava diretamente uma invoice.',
      reversibility: 'O acordo pode ser editado ou desativado novamente. Invoices já emitidas mantêm seu ciclo financeiro e histórico.',
    })
    if (!confirmed) return

    setSaving(true)
    try {
      await saveMutation.mutateAsync({
        id: initialAgreement?.id,
        customer_id: customerId!,
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
      setErrors({ form: classifyDbError(err).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="app-dem-form" onSubmit={(event) => { event.preventDefault(); void handleSave() }} noValidate>
      {fixedCustomer ? (
        <dl className="app-dem-facts">
          <div><dt>Cliente</dt><dd>{fixedCustomer.name}</dd></div>
          {fixedCustomer.cnpj_cpf ? <div><dt>CNPJ</dt><dd>{formatCnpjCpf(fixedCustomer.cnpj_cpf)}</dd></div> : null}
        </dl>
      ) : (
        <div className="app-field">
          <Combobox
            label="Cliente *"
            placeholder="Nome ou CNPJ (2 letras ou mais)"
            minChars={2}
            onInputChange={() => { setCustomerId(null); setCustomerName(''); clearError('customer') }}
            onValueChange={() => undefined}
            fetchOptions={fetchCustomers}
            onSelectOption={(option) => { setCustomerId(Number(option.value)); setCustomerName(option.label); clearError('customer') }}
          />
          {errors.customer ? <span className="app-field__error" role="alert">{errors.customer}</span> : null}
        </div>
      )}

      <Field label="Free Time (dias)" required error={errors.freeDays} hint="Conta a partir da descarga; move só o início da cobrança.">
        <Input inputMode="numeric" value={freeDays} onChange={(e) => { setFreeDays(e.target.value); clearError('freeDays') }} />
      </Field>
      <div className="app-dem-form__grid">
        <Field label="Tarifa P1 (USD/dia)" error={errors.p1} hint="Em branco, vale a tabela padrão.">
          <Input inputMode="decimal" value={p1Usd} onChange={(e) => { setP1Usd(e.target.value); clearError('p1') }} />
        </Field>
        <Field label="Tarifa P2 (USD/dia)" error={errors.p2} hint="Em branco, vale a tabela padrão.">
          <Input inputMode="decimal" value={p2Usd} onChange={(e) => { setP2Usd(e.target.value); clearError('p2') }} />
        </Field>
      </div>
      <div className="app-dem-form__grid">
        <Field label="Vigência de" required error={errors.validFrom} hint="Vale para containers descarregados a partir desta data.">
          <Input type="date" value={validFrom} onChange={(e) => { setValidFrom(e.target.value); clearError('validFrom') }} />
        </Field>
        <Field label="Vigência até" error={errors.validTo} hint="Em branco, sem data final.">
          <Input type="date" value={validTo} min={validFrom || undefined} onChange={(e) => { setValidTo(e.target.value); clearError('validTo') }} />
        </Field>
      </div>
      <label className="app-dem-check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Acordo ativo</span>
      </label>
      <Field label="Observações">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: condição do contrato anual 2026." />
      </Field>
      {errors.form ? <p className="app-dem-form__error" role="alert">{errors.form}</p> : null}
      <div className="app-dem-form__actions">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Voltar</Button>
        <Button type="submit" loading={saving} loadingLabel="Salvando…">{initialAgreement ? 'Salvar Alterações' : 'Cadastrar Acordo'}</Button>
      </div>
    </form>
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
      size="md"
      title={initialAgreement ? 'Editar acordo de Demurrage' : 'Novo acordo de Demurrage'}
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
