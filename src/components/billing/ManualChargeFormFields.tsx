import { Pencil, Save, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { formatBRL, formatUSD } from '../../lib/utils'
import type { ManualChargeItemForBl } from '../../services/charges/chargeOperationsService'

// Campos apresentacionais de Other Charges; o pai mantém estado e mutations.
export type ManualChargeFormValue = {
  chargeItemId: string
  quantity: string
  notes: string
  editingChargeCalculationId: number | null
}

export function ManualChargeFormFields({
  form,
  items,
  itemsLoading,
  saving,
  deleting,
  onPatch,
  onSave,
  onCancel,
}: {
  form: ManualChargeFormValue
  items: ManualChargeItemForBl[]
  itemsLoading: boolean
  saving: boolean
  deleting: boolean
  onPatch: (patch: Partial<ManualChargeFormValue>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const isEditing = Boolean(form.editingChargeCalculationId)

  return (
    <div className="mb-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
      <div className="mb-3 text-sm font-semibold text-white">Outras cobranças (manuais)</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Item">
          <Select
            value={form.chargeItemId}
            onChange={(event) => onPatch({ chargeItemId: event.target.value })}
            disabled={itemsLoading || isEditing}
          >
            <option value="">Selecione</option>
            {items.map((item) => (
              <option key={item.charge_item_id} value={item.charge_item_id}>
                {item.charge_item_name} ({item.currency}){' '}
                {item.currency === 'USD'
                  ? formatUSD(item.effective_unit_value_usd ?? 0)
                  : formatBRL(item.effective_unit_value_brl ?? 0)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantidade">
          <Input
            value={form.quantity}
            onChange={(event) => onPatch({ quantity: event.target.value })}
          />
        </Field>
        <Field label="Observação">
          <Input
            value={form.notes}
            onChange={(event) => onPatch({ notes: event.target.value })}
            placeholder="Justificativa operacional"
          />
        </Field>
        <div className="flex items-end gap-2 xl:col-span-2">
          <Button type="button" onClick={onSave} loading={saving} disabled={deleting}>
            {isEditing ? <Pencil size={16} /> : <Save size={16} />}
            {isEditing ? 'Salvar edição' : 'Adicionar cobrança manual'}
          </Button>
          {isEditing ? (
            <Button variant="ghost" type="button" onClick={onCancel}>
              <X size={15} />
              Voltar
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
