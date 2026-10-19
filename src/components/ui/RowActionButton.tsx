import { type ButtonHTMLAttributes, type Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'

type RowActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
  /** Nome da ação (Editar, Excluir…): vai para o `title` e para o leitor de tela. */
  label: string
  icon: LucideIcon
  variant?: 'secondary' | 'danger' | 'ghost'
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * Ação de linha de tabela só com ícone (regra 9 da identidade, decisão de
 * 2026-10-19). Ações do cabeçalho da tela, da faixa do bloco e das janelas
 * continuam em `Button` com texto.
 */
export function RowActionButton({ label, icon: Icon, variant = 'secondary', className, type = 'button', ...props }: RowActionButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      className={['app-btn--icon', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={15} aria-hidden="true" />
    </Button>
  )
}
