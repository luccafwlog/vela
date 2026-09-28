import { useState } from 'react'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { useCustomerLookup } from '../../hooks/useCustomers'
import type { ReviewCustomer } from '../../hooks/useReview'
import { formatCnpjCpf } from '../../lib/utils'

// Editores inline da fila de revisão; salvamento e seleção ficam com o pai.

export function InlineCustomerPicker({ saving, onSelect }: { saving: boolean; onSelect: (customer: ReviewCustomer) => void }) {
  const [search, setSearch] = useState('')
  const lookup = useCustomerLookup(search)

  return (
    <div className="relative w-56">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Vincular cliente..."
        className="py-1 text-xs"
        disabled={saving}
      />
      {lookup.data?.length ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[#30363d] bg-[#161b22] shadow-xl">
          {lookup.data.map((customer) => (
            <button
              key={customer.id}
              type="button"
              disabled={saving}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-[#21262d] disabled:opacity-50"
              onClick={() => onSelect(customer)}
            >
              <div className="font-medium text-white">{customer.name}</div>
              <div className="text-[11px] text-slate-500">{formatCnpjCpf(customer.cnpj_cpf)}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function InlineFieldEditor({
  type,
  placeholder,
  initial,
  saving,
  onSave,
}: {
  type: 'text' | 'number'
  placeholder: string
  initial: string
  saving: boolean
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type={type}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="w-36 py-1 text-xs"
        disabled={saving}
      />
      <Button variant="secondary" className="px-2.5 py-1 text-xs" loading={saving} onClick={() => onSave(value)}>
        Salvar
      </Button>
    </div>
  )
}
