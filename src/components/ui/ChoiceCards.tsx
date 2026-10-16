import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type ChoiceCardOption<T extends string> = {
  value: T
  title: ReactNode
  description?: ReactNode
}

/**
 * Escolha entre poucas opções que mudam o efeito de uma ação, cada uma com o
 * que acontece escrito embaixo. Pode começar sem nada marcado (`value` nulo):
 * quem decide é a pessoa, e o botão que depende da escolha fica bloqueado até
 * ela escolher. Para alternar uma visão, use `SegmentedControl`.
 */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: {
  /** Nome acessível do grupo; fica visível como legenda. */
  label: string
  options: ReadonlyArray<ChoiceCardOption<T>>
  value: T | null
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  const name = useId()
  return (
    <fieldset className={cn('app-choice', className)} disabled={disabled}>
      <legend className="app-choice__legend">{label}</legend>
      <div className="app-choice__options">
        {options.map((option) => (
          <label key={option.value} className="app-choice__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="app-choice__input"
            />
            <span className="app-choice__text">
              <span className="app-choice__title">{option.title}</span>
              {option.description ? <span className="app-choice__description">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
