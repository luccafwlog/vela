import { cn } from '../../lib/utils'

/**
 * Tom da tag de estado. Prefira os nomes semânticos (`success`, `warning`,
 * `danger`, `info`, `neutral`); os nomes de cor continuam aceitos e mapeiam
 * para o mesmo par de tokens.
 */
export type BadgeTone = 'blue' | 'green' | 'red' | 'yellow' | 'slate'
export type SemanticBadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const tones: Record<BadgeTone | SemanticBadgeTone, string> = {
  blue: 'app-badge--blue',
  green: 'app-badge--green',
  red: 'app-badge--red',
  yellow: 'app-badge--yellow',
  slate: 'app-badge--slate',
  info: 'app-badge--blue',
  success: 'app-badge--green',
  danger: 'app-badge--red',
  warning: 'app-badge--yellow',
  neutral: 'app-badge--slate',
}

export function Badge({
  children,
  tone = 'slate',
  className,
  title,
}: {
  children: React.ReactNode
  tone?: BadgeTone | SemanticBadgeTone
  className?: string
  title?: string
}) {
  return (
    <span className={cn('app-badge', tones[tone], className)} title={title}>
      {children}
    </span>
  )
}
