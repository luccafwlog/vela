import { useState } from 'react'
import { Ban, Pencil, Save, Trash2, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, EmptyState, InlineError } from '../ui/Card'
import { FilterBar } from '../ui/FilterBar'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  useCustomerRateOverrides,
  useDeleteCustomerRateOverride,
  useSetCustomerRateOverrideActive,
  useOverrideChargeItems,
  useOverrideCustomers,
  useSaveCustomerRateOverride,
} from '../../hooks/useLocalCharges'
import { formatBRL, formatUSD } from '../../lib/utils'
import { extractErrorText } from '../../lib/errors'
import { validateOverrideInput } from '../../pages/taxasLocaisHelpers'
import { EMPTY_OVERRIDE_FORM, type ChargeFilterProps, type OverrideForm } from './chargeForms'

export function ChargeOverridesTab({
  cargoModeFilter,
  setCargoModeFilter,
  podFilter,
  setPodFilter,
  initialCustomerSearch = '',
  canEdit,
  canDelete,
}: ChargeFilterProps & { initialCustomerSearch?: string; canEdit: boolean; canDelete: boolean }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const [overrideCustomerSearch, setOverrideCustomerSearch] = useState(initialCustomerSearch)
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(EMPTY_OVERRIDE_FORM)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideDeletingId, setOverrideDeletingId] = useState<number | null>(null)
  const { data: overrideRows, isLoading: overridesLoading, error: overridesError } = useCustomerRateOverrides({
    customerSearch: overrideCustomerSearch,
    cargoMode: cargoModeFilter,
    pod: podFilter,
    limit: 300,
  })
  const { data: overrideChargeItems } = useOverrideChargeItems()
  const { data: overrideCustomers } = useOverrideCustomers(overrideCustomerSearch)
  const saveOverrideMutation = useSaveCustomerRateOverride()
  const deleteOverrideMutation = useDeleteCustomerRateOverride()
  const setOverrideActiveMutation = useSetCustomerRateOverrideActive()

  async function handleSaveOverride() {
    const result = validateOverrideInput(overrideForm)
    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    setOverrideSaving(true)
    try {
      await saveOverrideMutation.mutateAsync({
        id: overrideForm.id,
        ...result.value,
      })

      showToast(overrideForm.id ? 'Override atualizado com sucesso.' : 'Override criado com sucesso.', 'success')
      setOverrideForm(EMPTY_OVERRIDE_FORM)
    } catch (error) {
      // Etapa 10 do plano de faturamento (ADR 0038 decisão 5, achado 5):
      // condição sobreposta lança um Error com a vigência conflitante — mostra
      // esse texto em vez do genérico, para o operador saber com o quê colidiu.
      showToast(extractErrorText(error) || 'Falha ao salvar override de cliente.', 'error')
    } finally {
      setOverrideSaving(false)
    }
  }

  function handleEditOverride(id: number) {
    const row = overrideRows?.find((item) => item.id === id)
    if (!row) return

    setOverrideForm({
      id: row.id,
      customerId: String(row.customer_id ?? ''),
      chargeItemId: String(row.charge_item_id ?? ''),
      overrideValue: String(Number(row.override_value ?? 0)),
      validFrom: row.valid_from ?? '',
      validTo: row.valid_to ?? '',
      notes: row.notes ?? '',
    })
  }

  async function handleToggleOverrideActive(id: number, current: boolean) {
    const nextActive = !current
    const confirmed = await confirm({
      title: nextActive ? 'Reativar override' : 'Desativar override',
      message: nextActive ? 'Reativar este override de cliente?' : 'Desativar este override de cliente?',
      consequence: nextActive
        ? 'Cálculos novos deste cliente voltam a usar o valor do override, dentro da vigência.'
        : 'Cálculos novos deste cliente passam a usar o valor da tabela; os cálculos antigos continuam mostrando o override aplicado.',
      reversibility: nextActive ? 'Desative de novo se precisar.' : 'Reativar override.',
      confirmLabel: nextActive ? 'Reativar' : 'Desativar',
      tone: nextActive ? 'primary' : 'danger',
    })
    if (!confirmed) return
    try {
      await setOverrideActiveMutation.mutateAsync({ id, active: nextActive })
      showToast(nextActive ? 'Override reativado.' : 'Override desativado.', 'success')
    } catch (error) {
      showToast(extractErrorText(error) || 'Falha ao alterar o override.', 'error')
    }
  }

  async function handleDeleteOverride(id: number) {
    const reason = await confirmWithReason({ title: 'Excluir override', message: 'Excluir este override de cliente?', consequence: 'Cálculos novos deste cliente voltam a usar o valor da tabela.', reversibility: 'Não é possível desfazer; cadastre de novo se precisar.', tone: 'danger', confirmLabel: 'Excluir' })
    if (reason === null) return
    setOverrideDeletingId(id)
    try {
      await deleteOverrideMutation.mutateAsync({ id, reason })
      showToast('Override excluído.', 'success')
      if (overrideForm.id === id) {
        setOverrideForm(EMPTY_OVERRIDE_FORM)
      }
    } catch (error) {
      showToast(extractErrorText(error) || 'Falha ao excluir override.', 'error')
    } finally {
      setOverrideDeletingId(null)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="app-table__cell-stack">
          <div className="app-panel__title">Overrides por cliente</div>
          <div className="app-table__cell-meta">Sobrescreva valores pontuais sem contaminar a tabela base.</div>
        </div>
        <Badge tone="blue">{formatOverrideCount(overrideRows?.length ?? 0)} na visão</Badge>
      </div>
      <FilterBar
        activeCount={(overrideCustomerSearch.trim() ? 1 : 0) + (cargoModeFilter ? 1 : 0) + (podFilter.trim() ? 1 : 0)}
        onClear={() => { setOverrideCustomerSearch(''); setCargoModeFilter(''); setPodFilter('') }}
      >
        <div className="app-filter-grid">
          <Field label="Buscar cliente">
            <Input
              value={overrideCustomerSearch}
              onChange={(event) => setOverrideCustomerSearch(event.target.value)}
              placeholder="Razao social ou CNPJ"
            />
          </Field>
          <Field label="Modo de carga">
            <Select value={cargoModeFilter} onChange={(event) => setCargoModeFilter(event.target.value as ChargeFilterProps['cargoModeFilter'])}>
              <option value="">Todos</option>
              <option value="container">Container</option>
              <option value="carga_solta">Carga Solta</option>
              <option value="granito">Granito</option>
            </Select>
          </Field>
          <Field label="POD">
            <Input value={podFilter} onChange={(event) => setPodFilter(event.target.value.toUpperCase())} placeholder="BRVIT / BRSSA" />
          </Field>
        </div>
      </FilterBar>

      {canEdit ? (
        <Card className="mb-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="app-panel__title">{overrideForm.id ? 'Editar override' : 'Novo override'}</h2>
            {overrideForm.id ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => setOverrideForm(EMPTY_OVERRIDE_FORM)}
              >
                <X size={15} />
                Cancelar edição
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Cliente">
              <Select
                value={overrideForm.customerId}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, customerId: event.target.value }))}
              >
                <option value="">Selecione</option>
                {(overrideCustomers ?? []).map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} ({customer.cnpj_cpf})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Item de taxa">
              <Select
                value={overrideForm.chargeItemId}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, chargeItemId: event.target.value }))}
              >
                <option value="">Selecione</option>
                {(overrideChargeItems ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.charge_table?.cargo_mode === 'carga_solta' ? 'BB' : 'CNTR'} | {item.charge_table?.pod ?? '-'} | {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Valor override">
              <Input
                value={overrideForm.overrideValue}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, overrideValue: event.target.value }))}
                placeholder="Ex: 1500.00"
              />
            </Field>
            <Field label="Vigencia inicial">
              <Input
                type="date"
                value={overrideForm.validFrom}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, validFrom: event.target.value }))}
              />
            </Field>
            <Field label="Vigencia final">
              <Input
                type="date"
                value={overrideForm.validTo}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, validTo: event.target.value }))}
              />
            </Field>
            <Field label="Observações">
              <Textarea
                value={overrideForm.notes}
                onChange={(event) => setOverrideForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={handleSaveOverride} loading={overrideSaving || saveOverrideMutation.isPending}>
              <Save size={15} />
              {overrideForm.id ? 'Salvar override' : 'Criar override'}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {overridesError ? <InlineError message="Falha ao consultar overrides." /> : null}
        <div className="app-table-scroll">
          <table className="app-table app-table--compact min-w-[1220px] text-left text-sm whitespace-nowrap">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Taxa</th>
                <th scope="col" className="px-4 py-3">Modo/POD</th>
                <th scope="col" className="px-4 py-3">Vigência</th>
                <th scope="col" className="px-4 py-3">Valor base</th>
                <th scope="col" className="px-4 py-3">Override</th>
                <th scope="col" className="px-4 py-3">Obs</th>
                {canEdit ? <th scope="col" className="px-4 py-3">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {overridesLoading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-[var(--app-muted)]" colSpan={canEdit ? 8 : 7}>
                    Carregando overrides...
                  </td>
                </tr>
              ) : null}
              {!overridesLoading && (overrideRows?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="p-0">
                    <EmptyState title="Nenhum override encontrado." />
                  </td>
                </tr>
              ) : null}
              {overrideRows?.map((row) => {
                const currency = row.charge_item?.currency ?? 'BRL'
                const baseValue =
                  currency === 'USD'
                    ? Number(row.charge_item?.unit_value_usd ?? 0)
                    : Number(row.charge_item?.unit_value_brl ?? 0)
                const today = new Date().toISOString().slice(0, 10)
                const validFrom = row.valid_from
                const validTo = row.valid_to
                const overrideStatus: 'ativa' | 'futura' | 'vencida' | 'aberta' =
                  !validFrom && !validTo
                    ? 'aberta'
                    : validTo && today > validTo
                      ? 'vencida'
                      : validFrom && today < validFrom
                        ? 'futura'
                        : 'ativa'
                const statusStyle = {
                  ativa: 'text-emerald-400',
                  aberta: 'text-emerald-400',
                  futura: 'text-blue-400',
                  vencida: 'text-[var(--app-muted)] line-through',
                }[overrideStatus]
                return (
                  <tr key={row.id} className={overrideStatus === 'vencida' ? 'opacity-60' : undefined}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--app-text-strong)]">{row.customer?.name ?? '-'}</div>
                      <div className="text-xs text-[var(--app-muted)]">{row.customer?.cnpj_cpf ?? '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-[var(--app-text-strong)]">{row.charge_item?.name ?? '-'}</td>
                    <td className="px-4 py-3">
                      {(row.charge_item?.charge_table?.cargo_mode ?? '').toUpperCase()} / {row.charge_item?.charge_table?.pod ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-xs font-medium uppercase tracking-wide ${row.active === false ? 'text-[var(--app-muted)]' : statusStyle}`}>
                        {row.active === false ? 'desativado' : overrideStatus}
                      </div>
                      <div className="text-xs text-[var(--app-muted)]">
                        {validFrom ?? '-'}{validTo ? ` ate ${validTo}` : validFrom ? ' (aberta)' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">{currency === 'USD' ? formatUSD(baseValue) : formatBRL(baseValue)}</td>
                    <td className="px-4 py-3 font-semibold text-green-700">
                      {currency === 'USD' ? formatUSD(Number(row.override_value ?? 0)) : formatBRL(Number(row.override_value ?? 0))}
                    </td>
                    <td className="px-4 py-3">{row.notes ?? '-'}</td>
                    {canEdit ? (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            className="app-table__icon-button"
                            type="button"
                            onClick={() => handleEditOverride(row.id)}
                            aria-label="Editar override"
                            title="Editar override"
                          >
                            <Pencil size={14} />
                          </button>
                          {canDelete ? (
                            <button
                              className="app-table__icon-button"
                              type="button"
                              onClick={() => handleToggleOverrideActive(row.id, row.active !== false)}
                              aria-label={row.active === false ? 'Reativar override' : 'Desativar override'}
                              title={row.active === false ? 'Reativar override' : 'Desativar override'}
                            >
                              {row.active === false ? <Save size={14} /> : <Ban size={14} />}
                            </button>
                          ) : null}
                          {canDelete ? (
                          <button
                            className="app-table__icon-button app-table__icon-button--danger"
                            type="button"
                            onClick={() => handleDeleteOverride(row.id)}
                            aria-label="Excluir override"
                            title="Excluir override"
                            disabled={overrideDeletingId === row.id}
                          >
                            <Trash2 size={14} />
                          </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function formatOverrideCount(count: number) {
  return `${count} ${count === 1 ? 'override' : 'overrides'}`
}
