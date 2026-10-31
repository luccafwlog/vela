import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Input'
import { RowActionButton } from '../ui/RowActionButton'
import { formatScheduleDate } from '../../services/portalScheduleLanes'
import {
  VOYAGE_PORT_SUGGESTIONS,
  resolveVoyagePortStop,
  voyagePortLabel,
  type VoyagePortStop,
} from '../../services/voyageForm'

const KIND_LABEL: Record<VoyagePortStop['kind'], string> = {
  pol: 'Saída na origem · ETD',
  pod: 'Chegada no Brasil · ETA',
}

/**
 * Portos da Nova Viagem por seletor: o operador digita o porto (nome ou
 * LOCODE, com as sugestões da rota do Portal), a data e **Adicionar**. Só os
 * portos adicionados aparecem, origem antes do Brasil, cada um com Remover.
 */
export function VoyagePortsPicker({
  stops,
  onChange,
}: {
  stops: VoyagePortStop[]
  onChange: (next: VoyagePortStop[]) => void
}) {
  const [port, setPort] = useState('')
  const [date, setDate] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)

  function add() {
    const resolved = resolveVoyagePortStop(port)
    const nextPortError = 'error' in resolved
      ? resolved.error
      : stops.some((stop) => stop.code === resolved.code) ? `${resolved.code} já foi adicionado.` : null
    const nextDateError = date ? null : 'Informe a data.'
    setPortError(nextPortError)
    setDateError(nextDateError)
    if (nextPortError || nextDateError || 'error' in resolved) return
    onChange([...stops, { ...resolved, date }])
    setPort('')
    setDate('')
  }

  const ordered = [...stops].sort((left, right) =>
    left.kind === right.kind ? left.date.localeCompare(right.date) : left.kind === 'pol' ? -1 : 1)

  return (
    <div className="grid gap-3">
      <div
        className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
        onKeyDown={(event) => {
          // Enter adiciona o porto em vez de cadastrar a viagem.
          if (event.key === 'Enter') {
            event.preventDefault()
            add()
          }
        }}
      >
        <Field label="Porto" error={portError ?? undefined}>
          <Input
            list="voyage-port-suggestions"
            value={port}
            placeholder="Ex.: Qingdao, BRSSA"
            autoComplete="off"
            onChange={(event) => setPort(event.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Data (ETD ou ETA)" error={dateError ?? undefined}>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button type="button" variant="secondary" className="sm:mt-[22px]" onClick={add}>
          <Plus size={16} aria-hidden="true" /> Adicionar
        </Button>
        <datalist id="voyage-port-suggestions">
          {VOYAGE_PORT_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion.code} value={suggestion.code}>{suggestion.name ?? suggestion.code}</option>
          ))}
        </datalist>
      </div>

      {ordered.length ? (
        <ul className="grid gap-2" aria-label="Portos adicionados">
          {ordered.map((stop) => (
            <li
              key={stop.code}
              className="flex items-center justify-between gap-3 rounded-[var(--app-radius-control)] border border-[var(--app-border)] px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium text-[var(--app-text-strong)]">{voyagePortLabel(stop.code)}</span>
                <span className="text-[var(--app-muted)]"> · {KIND_LABEL[stop.kind]} {formatScheduleDate(stop.date)}</span>
              </span>
              <RowActionButton
                label={`Remover ${stop.code}`}
                icon={X}
                variant="ghost"
                onClick={() => onChange(stops.filter((item) => item.code !== stop.code))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
