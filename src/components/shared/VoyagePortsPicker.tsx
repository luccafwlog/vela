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

const SIDE = {
  pol: {
    title: 'Origem',
    effect: 'Saída do navio no exterior (ETD). Vai para Chegadas e Saídas.',
    portLabel: 'Porto de origem',
    dateLabel: 'ETD',
    placeholder: 'Ex.: Qingdao, CNTAO',
    addLabel: 'Adicionar porto de origem',
  },
  pod: {
    title: 'Destino',
    effect: 'Chegada no Brasil (ETA). Cria uma escala da viagem.',
    portLabel: 'Porto de destino',
    dateLabel: 'ETA',
    placeholder: 'Ex.: Salvador, BRSSZ',
    addLabel: 'Adicionar porto de destino',
  },
} as const

/**
 * Um lado dos portos da Nova Viagem, escolhido pelo operador: Origem (ETD do
 * POL, que aparece em Chegadas e Saídas) ou Destino (escala com ETA). Digita o
 * porto (nome ou LOCODE, com as sugestões daquele lado), a data e Adicionar;
 * só os portos adicionados aparecem, cada um com Remover.
 */
export function VoyagePortsPicker({
  kind,
  stops,
  takenCodes,
  onAdd,
  onRemove,
}: {
  kind: VoyagePortStop['kind']
  /** Portos já adicionados deste lado. */
  stops: VoyagePortStop[]
  /** Códigos já adicionados em qualquer lado, para não repetir o porto. */
  takenCodes: string[]
  onAdd: (stop: VoyagePortStop) => void
  onRemove: (code: string) => void
}) {
  const side = SIDE[kind]
  const [port, setPort] = useState('')
  const [date, setDate] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const listId = `voyage-port-suggestions-${kind}`
  const headingId = `voyage-ports-${kind}`

  function add() {
    const resolved = resolveVoyagePortStop(port, kind)
    const nextPortError = 'error' in resolved
      ? resolved.error
      : takenCodes.includes(resolved.code) ? `${resolved.code} já foi adicionado.` : null
    const nextDateError = date ? null : `Informe o ${side.dateLabel}.`
    setPortError(nextPortError)
    setDateError(nextDateError)
    if (nextPortError || nextDateError || 'error' in resolved) return
    onAdd({ code: resolved.code, kind, date })
    setPort('')
    setDate('')
  }

  const ordered = [...stops].sort((left, right) => left.date.localeCompare(right.date))

  return (
    <section className="grid gap-2" aria-labelledby={headingId}>
      <div>
        <h4 id={headingId} className="app-field__label font-semibold text-[var(--app-text-strong)]">{side.title}</h4>
        <p className="app-field__hint">{side.effect}</p>
      </div>
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
        <Field label={side.portLabel} error={portError ?? undefined}>
          <Input
            list={listId}
            value={port}
            placeholder={side.placeholder}
            autoComplete="off"
            onChange={(event) => setPort(event.target.value.toUpperCase())}
          />
        </Field>
        <Field label={side.dateLabel} error={dateError ?? undefined}>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button type="button" variant="secondary" className="sm:mt-[22px]" aria-label={side.addLabel} onClick={add}>
          <Plus size={16} aria-hidden="true" /> Adicionar
        </Button>
        <datalist id={listId}>
          {VOYAGE_PORT_SUGGESTIONS[kind].map((suggestion) => (
            <option key={suggestion.code} value={suggestion.code}>{suggestion.name ?? suggestion.code}</option>
          ))}
        </datalist>
      </div>

      {ordered.length ? (
        <ul className="grid gap-2" aria-label={`Portos de ${side.title.toLowerCase()} adicionados`}>
          {ordered.map((stop) => (
            <li
              key={stop.code}
              className="flex items-center justify-between gap-3 rounded-[var(--app-radius-control)] border border-[var(--app-border)] px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium text-[var(--app-text-strong)]">{voyagePortLabel(stop.code)}</span>
                <span className="text-[var(--app-muted)]"> · {side.dateLabel} {formatScheduleDate(stop.date)}</span>
              </span>
              <RowActionButton
                label={`Remover ${stop.code}`}
                icon={X}
                variant="ghost"
                onClick={() => onRemove(stop.code)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
