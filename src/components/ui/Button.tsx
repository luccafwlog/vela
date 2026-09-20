import { type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
  loadingLabel?: string
}

const variants = {
  primary: 'app-btn--primary',
  secondary: 'app-btn--secondary',
  danger: 'app-btn--danger',
  ghost: 'app-btn--ghost',
}

export function Button({ className, variant = 'primary', loading, loadingLabel = 'Carregando…', children, disabled, 'aria-label': ariaLabel, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'app-btn',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={loading ? loadingLabel : ariaLabel}
      {...props}
    >
      <span data-button-label className={loading ? 'invisible' : undefined}>{children}</span>
      {loading ? <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true"><Loader2 size={14} className="animate-spin" /></span> : null}
    </button>
  )
}
