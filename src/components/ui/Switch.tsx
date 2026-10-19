import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Chave de ligar e desligar (lote 5a): o estado escrito ao lado do trilho,
 * para não depender só da cor. O clique pede a troca (`onChange`); quem usa
 * decide se confirma antes, como o envio real da Comunicação. Para escolher
 * entre opções, `ChoiceCards` ou `SegmentedControl`.
 */
export function Switch({
  checked,
  onChange,
  children,
  disabled = false,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** O que a chave liga, com o estado ("Envio real ligado"). */
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cn('app-switch', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="app-switch__track" aria-hidden="true" />
      <span>{children}</span>
    </button>
  )
}
