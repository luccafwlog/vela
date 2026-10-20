import { type AnchorHTMLAttributes } from 'react'
import { Link, type To } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

type BaseProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'aria-label' | 'href'> & {
  /** Nome da ação (Abrir B/L, Ver faturas…): vai para o `title` e para o leitor de tela. */
  label: string
  icon: LucideIcon
  /** `primary` só quando a ação é o próximo passo da linha (Analisar). */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Dica ao passar o mouse quando diz mais que o nome. Sem ela, o `title` é o próprio `label`. */
  title?: string
}

type RowActionLinkProps = BaseProps & (
  /** Destino dentro do app (react-router). */
  | { to: To; href?: never }
  /** Endereço fora do app (MarineTraffic): `<a>` comum. */
  | { href: string; to?: never }
)

const variants = {
  primary: 'app-btn--primary',
  secondary: 'app-btn--secondary',
  ghost: 'app-btn--ghost',
}

/**
 * Ação de linha de tabela que navega, só com ícone (regra 9 da identidade): a
 * mesma cara do `RowActionButton`, mas é um link, para abrir em nova aba e
 * mostrar o destino. Use `to` para telas do app e `href` para endereço externo.
 */
export function RowActionLink({ label, icon: Icon, variant = 'secondary', className, title, to, href, ...props }: RowActionLinkProps) {
  const shared = {
    className: cn('app-btn', variants[variant], 'app-btn--icon', className),
    'aria-label': label,
    title: title ?? label,
    ...props,
  }
  const icon = <Icon size={15} aria-hidden="true" />
  if (to !== undefined) return <Link to={to} {...shared}>{icon}</Link>
  return <a href={href} {...shared}>{icon}</a>
}
