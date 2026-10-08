import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { Car, ChevronLeft, ChevronRight, FileSpreadsheet, Mountain, Pencil } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import { ESTADO_CONCILIACAO_META } from '../../lib/statusLabels'

// Texto do estado usa o primeiro plano semântico (contraste ≥ 4,5:1); a cor de
// sinal fica só no ponto. O dourado puro dava 2,85:1 (auditoria de 2026-10-08).
const RAIL_STATE_TEXT: Partial<Record<string, string>> = {
  red: 'var(--app-danger-fg)',
  yellow: 'var(--app-warning-fg)',
  green: 'var(--app-success-fg)',
}
import type { VoyageRailItem } from '../../services/voyageSummaries'
import { ContainersIcon, VaziosExpIcon, VaziosImpIcon } from '../shared/DomainIcon'

type VoyageRailProps = {
  /** Lista já filtrada e ordenada (a filtragem vive na página / VoyageFilters). */
  items: VoyageRailItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Abre o modal de edição da viagem (ação secundária no hover do item). */
  onEdit?: (id: number) => void
}

/** Rolagem horizontal com setas nas pontas, escondidas quando não há para onde ir. */
function useHorizontalScroller() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  // O efeito roda a cada render (precisa medir depois do layout); só troca o
  // estado quando as bordas realmente mudam para não entrar em loop.
  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = {
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    }
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
  }, [])

  useEffect(() => {
    sync()
    const onResize = () => sync()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [sync])

  const scrollBy = useCallback((direction: -1 | 1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(280, el.clientWidth * 0.8), behavior: 'smooth' })
  }, [])

  return { ref, edges, sync, scrollBy }
}

function ScrollArrow({
  side,
  onClick,
  visible,
}: {
  side: 'left' | 'right'
  onClick: () => void
  visible: boolean
}) {
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Rolar para a esquerda' : 'Rolar para a direita'}
      className={`absolute top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-muted)] shadow-lg transition-colors hover:bg-[var(--app-surface-muted)] hover:text-[var(--app-text)] ${
        side === 'left' ? 'left-1' : 'right-1'
      }`}
    >
      {side === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  )
}

function RailPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-bg-elevated)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-muted)]">
      {children}
    </span>
  )
}

function ScaleBadges({ modules }: { modules: VoyageRailItem['modules'] }) {
  const badges = [
    modules.container ? { label: 'Container', icon: ContainersIcon } : null,
    modules.cargaSolta ? { label: 'Carga solta', icon: FileSpreadsheet } : null,
    modules.veiculos ? { label: 'Veículos', icon: Car } : null,
    modules.vazios ? { label: 'Vazios IMP', icon: VaziosImpIcon } : null,
    modules.vaziosExp ? { label: 'Vazios EXP', icon: VaziosExpIcon } : null,
    modules.granito ? { label: 'Granito', icon: Mountain } : null,
  ].filter(Boolean) as Array<{ label: string; icon: ComponentType<{ size?: number; className?: string }> }>

  return badges.length ? (
    <span className="inline-flex items-center gap-1 text-[var(--app-muted)]" aria-label="Operações da escala">
      {badges.map(({ label, icon: Icon }) => <Icon key={label} size={13} aria-label={label} />)}
    </span>
  ) : null
}

export function VoyageRail({ items, selectedId, onSelect, onEdit }: VoyageRailProps) {
  const { ref, edges, sync, scrollBy } = useHorizontalScroller()

  useLayoutEffect(() => sync(), [items, sync])

  useLayoutEffect(() => {
    if (ref.current && typeof ref.current.scrollTo === 'function') {
      ref.current.scrollTo({ left: 0, behavior: 'auto' })
    }
  }, [ref])

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-5 text-sm text-[var(--app-muted)]">
        Nenhuma viagem para os filtros atuais.
      </div>
    )
  }

  return (
    // min-w-0: sem isso, o item do grid de Viagens.tsx assume a largura mínima
    // de conteúdo (todos os cards lado a lado) em vez de respeitar a largura
    // do container, e a página inteira alonga em vez de rolar horizontalmente.
    <div className="relative min-w-0">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] text-[var(--app-muted-soft)]">Ordenado por próxima escala</span>
        <span className="text-[11px] text-[var(--app-muted-soft)]">{items.length} viagens</span>
      </div>

      <ScrollArrow side="left" visible={edges.left} onClick={() => scrollBy(-1)} />
      <ScrollArrow side="right" visible={edges.right} onClick={() => scrollBy(1)} />

      <div
        ref={ref}
        onScroll={sync}
        className="voyage-rail-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3"
      >
        {items.map((item) => {
          const estado = ESTADO_CONCILIACAO_META[item.estado]
          const isSelected = item.id === selectedId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isSelected}
              className={`group relative flex min-h-[134px] w-[268px] flex-none snap-start flex-col items-start justify-start rounded-2xl border px-3 py-3 text-left transition-colors ${
                isSelected
                  ? 'border-[var(--app-blue-btn)] bg-[var(--app-bg-elevated)]'
                  : 'border-[var(--app-border)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-muted)]'
              }`}
            >
              {/* w-full + min-w-0: a linha é filha de um flex column com
                  items-start, então sem largura explícita ela se dimensiona pelo
                  conteúdo e o rótulo de conciliação vazava do card. */}
              <div className="flex w-full min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: estado.color }}
                  title={`Conciliação: ${estado.label}`}
                />
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted-soft)]">
                  {item.carrierName || 'Armador não informado'}
                </span>
                <span className="voyage-rail-card__state-label flex-none" style={{ color: RAIL_STATE_TEXT[estado.badgeTone] ?? 'var(--app-text)' }}>
                  {estado.label}
                </span>
                {onEdit ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="voyage-rail-card__edit"
                    title="Editar viagem"
                    aria-label={`Editar ${item.vesselName} / ${item.voyageNumber}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(item.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        onEdit(item.id)
                      }
                    }}
                  >
                    <Pencil size={13} />
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-[var(--app-text-strong)]">
                {item.vesselName} / {item.voyageNumber}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.escalasBrasileiras.length > 0 ? (
                  item.escalasBrasileiras.map((escala) => (
                    <span key={escala.port} className="inline-flex items-center gap-1.5">
                      <RailPill>
                      {escala.port}
                      {escala.eta ? ` · ${formatDate(escala.eta)}` : ''}
                      </RailPill>
                    <ScaleBadges modules={{ ...item.modules, ...escala.modules }} />
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--app-muted-soft)]">Sem escala brasileira prevista</span>
                )}
              </div>
              <div className="voyage-rail-card__footer">
                <span><strong>{item.blCount ?? 0}</strong> B/L</span>
                <span aria-hidden="true">·</span>
                <span><strong>{item.containerCount ?? 0}</strong> CNTR</span>
                <span aria-hidden="true">·</span>
                <span>CE {item.ceCoverage?.filled ?? 0}/{item.ceCoverage?.total ?? 0}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
