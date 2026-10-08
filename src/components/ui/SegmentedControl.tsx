import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../../lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

/**
 * Controle segmentado para duas a quatro opções exclusivas que mudam a vista
 * ou o formulário (lente, "Item da tabela" ou "Outra"). Semântica de grupo de
 * rádio: Tab entra na opção marcada e as setas trocam a escolha. Para trocar
 * de seção da página use abas; para listas maiores, select.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Nome acessível do grupo. */
  label: string
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  const groupRef = useRef<HTMLDivElement>(null)
  const enabled = options.filter((option) => !option.disabled)
  // Sem opção marcada, a primeira habilitada recebe o Tab para o grupo não sumir do teclado.
  const tabStop = enabled.some((option) => option.value === value) ? value : enabled[0]?.value

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const index = enabled.findIndex((option) => option.value === value)
    const next = enabled[(index + (forward ? 1 : -1) + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.value)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)]?.focus()
  }

  return (
    <div ref={groupRef} role="radiogroup" aria-label={label} className={cn('app-segmented', className)} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={option.value === tabStop ? 0 : -1}
            disabled={option.disabled}
            className="app-segmented__option"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
