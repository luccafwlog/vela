import { type ButtonHTMLAttributes, type Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'

type RowActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  /** Nome da ação (Editar, Excluir…): vai para o `title` e para o leitor de tela. */
  label: string
  icon: LucideIcon
  /** `primary` só quando a ação é o próximo passo da linha (Emitir, Analisar). */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
  /**
   * Dica ao passar o mouse quando diz mais que o nome (destino de "Resolver",
   * motivo de estar desativado). Sem ela, o `title` é o próprio `label`.
   */
  title?: string
  ref?: Ref<HTMLButtonElement>
}

/**
 * Ação de linha de tabela só com ícone (regra 9 da identidade, decisão de
 * 2026-10-19). Ações do cabeçalho da tela, da faixa do bloco e das janelas
 * continuam em `Button` com texto.
 */
export function RowActionButton({ label, icon: Icon, variant = 'secondary', className, type = 'button', title, ...props }: RowActionButtonProps) {
  return (
    <Button
      type={type}
      variant={variant}
      className={['app-btn--icon', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      <Icon size={15} aria-hidden="true" />
    </Button>
  )
}
