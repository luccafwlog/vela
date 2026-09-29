import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../../lib/utils'

type FilterBarProps = {
  /** Conteúdo dos filtros — normalmente um `<div className="app-filter-grid">`. */
  children: ReactNode
  /** Quantidade de filtros ativos; exibida como contador e mantém a barra aberta. */
  activeCount?: number
  /** Chamado ao clicar em "Limpar"; o botão só aparece quando há filtros ativos. */
  onClear?: () => void
  /** Rótulo do cabeçalho. */
  title?: string
  /**
   * Filtros que já estão recortando a lista mas não contam como "ativos" —
   * tipicamente um padrão da tela. Fica visível com a barra recolhida para que
   * o usuário nunca veja um total reduzido sem saber o motivo.
   */
  appliedDefaults?: string[]
  /** Estado inicial. Por padrão abre quando há filtros ativos. */
  defaultOpen?: boolean
}

// Barra de filtros recolhível e reutilizável. Mantém o estado de aberto/fechado
// localmente e exibe um contador de filtros ativos + ação de limpar.
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
  title = 'Filtros',
  appliedDefaults,
  defaultOpen,
}: FilterBarProps) {
  const [open, setOpen] = useState(defaultOpen ?? activeCount > 0)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className={cn('app-filter-bar', open && 'app-filter-bar--open')}
      onKeyDown={(event) => {
        const target = event.target
        if (event.key !== 'Escape' || !open || !(target instanceof HTMLElement) || !bodyRef.current?.contains(target)) return
        if (target.getAttribute('aria-expanded') === 'true') return
        event.preventDefault()
        setOpen(false)
        toggleRef.current?.focus()
      }}
    >
      <div className="app-filter-bar__head">
        <button
          ref={toggleRef}
          type="button"
          className="app-filter-bar__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal size={16} className="shrink-0" />
          <span>{title}</span>
          {activeCount > 0 ? <span className="app-filter-bar__count">{activeCount}</span> : null}
          {!open && appliedDefaults?.length
            ? appliedDefaults.map((label) => (
                <span key={label} className="app-filter-bar__applied">{label}</span>
              ))
            : null}
          <ChevronDown size={16} className="app-filter-bar__chevron" aria-hidden="true" />
        </button>
        {activeCount > 0 && onClear ? (
          <button type="button" className="app-btn app-btn--ghost app-btn--sm app-filter-bar__clear" onClick={onClear}>
            <X size={14} />
            Limpar
          </button>
        ) : null}
      </div>
      {open ? <div ref={bodyRef} className="app-filter-bar__body">{children}</div> : null}
    </div>
  )
}
