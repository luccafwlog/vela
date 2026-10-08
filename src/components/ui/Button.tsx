import { type ButtonHTMLAttributes, type Ref } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  /** Ação disparada por este botão em andamento (não use para carregamento da tela). */
  loading?: boolean
  /** Texto específico durante a ação ("Emitindo…"). Sem ele, o rótulo de repouso continua visível. */
  loadingLabel?: string
  ref?: Ref<HTMLButtonElement>
}

const variants = {
  primary: 'app-btn--primary',
  secondary: 'app-btn--secondary',
  danger: 'app-btn--danger',
  ghost: 'app-btn--ghost',
}

/**
 * Botão do design system. Em andamento, o botão fica desativado (impede
 * repetição) e anuncia `aria-busy`; o indicador ocupa o lugar do ícone inicial
 * ou o recuo à esquerda, e `loadingLabel` divide a mesma célula da grade com o
 * rótulo de repouso, para a largura não mudar ao alternar.
 */
export function Button({ className, variant = 'primary', loading, loadingLabel, children, disabled, ...props }: ButtonProps) {
  const spinner = loading ? <Loader2 size={14} className="app-btn__spinner animate-spin" aria-hidden="true" /> : null

  return (
    <button
      className={cn('app-btn', variants[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loadingLabel ? (
        <span className="app-btn__stack">
          <span data-button-label className="app-btn__label inline-flex items-center gap-2" aria-hidden={loading || undefined}>
            {children}
          </span>
          <span className="app-btn__label inline-flex items-center gap-2" aria-hidden={loading ? undefined : true}>
            <Loader2 size={14} className={cn('app-btn__spinner', loading && 'animate-spin')} aria-hidden="true" />
            {loadingLabel}
          </span>
        </span>
      ) : (
        <span data-button-label className="app-btn__label inline-flex items-center gap-2">
          {spinner}
          {children}
        </span>
      )}
    </button>
  )
}
