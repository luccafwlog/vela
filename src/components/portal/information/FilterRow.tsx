import type { ReactNode } from 'react'

/**
 * Filtros da seção em linha, acima do conteúdo, sem cartão em volta
 * (rodada 2), com a nota da seção ao lado.
 */
export function FilterRow({ children, note }: { children?: ReactNode; note?: ReactNode }) {
  if (!children && !note) return null
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      {children}
      {note ? <p className="m-0 pb-3 text-sm text-[var(--app-muted)]">{note}</p> : null}
    </div>
  )
}
