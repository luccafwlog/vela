import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { Car, ChevronLeft, ChevronRight, FileSpreadsheet, Mountain, Pencil } from 'lucide-react'
import { formatShortDateSafe } from '../../lib/utils'
import { isEtaOverdue } from '../../services/voyageSummaries'
import { ESTADO_CONCILIACAO_META } from '../../lib/statusLabels'
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

type RailEscala = VoyageRailItem['escalasBrasileiras'][number]

/** Escala no card: porto, data e de onde vem a data (✓ chegou, ! ETA vencido). */
function RailEscalaPill({ escala }: { escala: RailEscala }) {
  const overdue = !escala.ata && isEtaOverdue(escala.eta)
  const date = escala.ata ?? escala.eta
  const state = escala.ata ? 'actual' : overdue ? 'overdue' : date ? 'forecast' : 'missing'
  const description = escala.ata ? 'chegou' : overdue ? 'ETA vencido' : date ? 'ETA previsto' : 'ETA não informado'
  return (
    <span className={`voyage-rail-pill voyage-rail-pill--${state}`} title={`${escala.port}: ${description}`}>
      {escala.port}
      {date ? ` · ${escala.ata ? '✓ ' : ''}${formatShortDateSafe(date)}` : ' · sem ETA'}
      {overdue ? <span aria-hidden="true"> !</span> : null}
      <span className="sr-only">, {description}</span>
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
    <span className="inline-flex items-center gap-1 text-[var(--app-muted)]">
      {badges.map(({ label, icon: Icon }) => (
        <span key={label} title={label} className="inline-flex"><Icon size={14} aria-hidden="true" /><span className="sr-only">{label}</span></span>
      ))}
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
      <div className="voyage-rail__empty" role="status">
        Nenhuma viagem para os filtros atuais.
      </div>
    )
  }

  return (
    // min-w-0: sem isso, o item do grid de Viagens.tsx assume a largura mínima
    // de conteúdo (todos os cards lado a lado) em vez de respeitar a largura
    // do container, e a página inteira alonga em vez de rolar horizontalmente.
    <div className="relative min-w-0">
      <p className="voyage-rail__caption">Ordenadas pela próxima escala</p>

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
          const label = `${item.vesselName} / ${item.voyageNumber}`
          return (
            // O card tem duas ações irmãs: abrir (o card inteiro) e editar. Um
            // botão dentro de outro não é alcançável de forma confiável por
            // teclado nem por leitor de tela.
            <div
              key={item.id}
              className={`voyage-rail-card group${isSelected ? ' voyage-rail-card--selected' : ''}${onEdit ? ' voyage-rail-card--editable' : ''}`}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isSelected ? 'page' : undefined}
                className="voyage-rail-card__main"
              >
                <span className="voyage-rail-card__top">
                  <span className="voyage-rail-card__carrier">{item.carrierName || 'Armador não informado'}</span>
                  <span className="voyage-rail-card__state" style={{ color: estado.color }}>
                    <span className="voyage-rail-card__dot" style={{ backgroundColor: estado.color }} aria-hidden="true" />
                    <span className="sr-only">Conciliação: </span>{estado.label}
                  </span>
                </span>
                <span className="voyage-rail-card__title">{label}</span>
                {item.status !== 'active' ? (
                  <span className="voyage-rail-card__status">{item.status === 'cancelled' ? 'Cancelada' : 'Concluída'}</span>
                ) : null}
                <span className="voyage-rail-card__escalas">
                  {item.escalasBrasileiras.length > 0 ? (
                    item.escalasBrasileiras.map((escala) => (
                      <span key={escala.port} className="voyage-rail-card__escala">
                        <RailEscalaPill escala={escala} />
                        <ScaleBadges modules={{ ...item.modules, ...escala.modules }} />
                      </span>
                    ))
                  ) : (
                    <span className="voyage-rail-card__empty">Sem escala brasileira prevista</span>
                  )}
                </span>
                <span className="voyage-rail-card__footer">
                  <span><strong>{item.blCount ?? 0}</strong> B/L</span>
                  <span aria-hidden="true">·</span>
                  <span><strong>{item.containerCount ?? 0}</strong> CNTR</span>
                  <span aria-hidden="true">·</span>
                  <span>CE {item.ceCoverage?.filled ?? 0}/{item.ceCoverage?.total ?? 0}</span>
                </span>
              </button>
              {onEdit ? (
                <button
                  type="button"
                  className="voyage-rail-card__edit"
                  title="Editar viagem"
                  aria-label={`Editar ${label}`}
                  onClick={() => onEdit(item.id)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
