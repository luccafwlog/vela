import { ChevronRight } from 'lucide-react'
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { cn } from '../../lib/utils'
import { ALERT_LINK_COLORS } from './alertLinkColors'
import {
  ALERT_DEV_ROUTING_LABELS,
  ALERT_LINKS,
  ALERT_LINK_KINDS,
  ALERT_MAP_BANDS,
  ALERT_MAP_STATIONS,
  ALERT_STAKE_INFO,
  isStakeCause,
  type AlertDevRouting,
  type AlertLink,
  type AlertLinkKind,
  type AlertMapNodeId,
  type AlertMapStation,
  type AlertStakeId,
  type InactionWalk,
} from '../../services/alertRulesMap'
import type { AlertRuleSeverity } from '../../services/alertRulesCatalog'

/** O que o cartão mostra: montado pela tela com a gravidade vigente. */
export type AlertMapCard = {
  id: AlertMapNodeId
  label: string
  fullLabel: string
  /** Marco (aviso do sino ou e-mail): sem gravidade nem fila. */
  notice: 'sino' | 'email' | null
  severity: AlertRuleSeverity | null
  escalation: string | null
  /** Siglas de quem recebe (Doc, Equip...). */
  teams: string[]
  dev: AlertDevRouting | null
}

/** O que o mapa destaca: um alerta e as ligações dele, uma coisa que fica parada ou a cascata. */
export type AlertMapFocus =
  | { kind: 'node'; id: AlertMapNodeId }
  | { kind: 'stake'; id: AlertStakeId }
  | { kind: 'walk'; walk: InactionWalk; step: number }

/** Amostra da linha de cada ligação, para a legenda. */
export function AlertLinkSample({ kind }: { kind: AlertLinkKind }) {
  const style = ALERT_LINK_COLORS[kind]
  return (
    <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="5" x2={style.arrow ? 23 : 29} y2="5" style={{ stroke: style.color, strokeDasharray: style.dash }} strokeWidth="2" />
      {style.arrow ? <path d="M22,1 L29,5 L22,9 z" style={{ fill: style.color }} /> : null}
    </svg>
  )
}

function focusLinks(focus: AlertMapFocus | null): AlertLink[] {
  if (!focus) return []
  if (focus.kind === 'node') return ALERT_LINKS.filter((item) => item.from === focus.id || item.to === focus.id)
  if (focus.kind === 'walk') {
    const upto = Math.min(focus.step, focus.walk.steps.length - 1)
    return focus.walk.stepLinks.slice(1, upto + 1).flat()
  }
  return []
}

type Highlight = { lit: boolean; selected: boolean; relation: AlertLinkKind | null; step: number | null }

function highlights(focus: AlertMapFocus | null): Map<AlertMapNodeId, Highlight> {
  const map = new Map<AlertMapNodeId, Highlight>()
  if (!focus) return map
  if (focus.kind === 'node') {
    map.set(focus.id, { lit: true, selected: true, relation: null, step: null })
    for (const item of ALERT_LINKS) {
      if (item.from === focus.id) map.set(item.to, { lit: true, selected: false, relation: item.kind, step: null })
      else if (item.to === focus.id) map.set(item.from, { lit: true, selected: false, relation: item.kind, step: null })
    }
  } else if (focus.kind === 'stake') {
    for (const station of ALERT_MAP_STATIONS) {
      for (const id of station.nodes) if (isStakeCause(id, focus.id)) map.set(id, { lit: true, selected: false, relation: null, step: null })
    }
    // O alerta que avisa (o sintoma) fica marcado como o escolhido; as causas, acesas.
    for (const id of ALERT_STAKE_INFO[focus.id].warn) map.set(id, { lit: true, selected: true, relation: null, step: null })
  } else {
    const upto = Math.min(focus.step, focus.walk.steps.length - 1)
    focus.walk.steps.slice(0, upto + 1).forEach((ids, index) => {
      for (const id of ids) map.set(id, { lit: true, selected: index === 0, relation: null, step: index + 1 })
    })
  }
  return map
}

type Path = { key: string; d: string; kind: AlertLinkKind }

/**
 * Mapa dos alertas (ADR 0134): os momentos da viagem em faixas, cada alerta
 * no momento em que abre, e as ligações do alerta escolhido desenhadas por
 * cima. Os cartões fora do filtro ficam apagados, não somem, para o mapa não
 * mudar de lugar.
 */
export function AlertRulesMap({
  cards,
  matches,
  focus,
  counts,
  onSelect,
}: {
  cards: ReadonlyMap<AlertMapNodeId, AlertMapCard>
  matches: (id: AlertMapNodeId) => boolean
  focus: AlertMapFocus | null
  counts: ReadonlyMap<string, number> | undefined
  onSelect: (id: AlertMapNodeId) => void
}) {
  const uid = useId().replace(/:/g, '')
  const innerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<AlertMapNodeId, HTMLDivElement>())
  const [paths, setPaths] = useState<Path[]>([])
  const links = useMemo(() => focusLinks(focus), [focus])
  const lit = useMemo(() => highlights(focus), [focus])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    function measure() {
      const base = inner!.getBoundingClientRect()
      const next: Path[] = []
      for (const item of links) {
        const a = cardRefs.current.get(item.from)?.getBoundingClientRect()
        const b = cardRefs.current.get(item.to)?.getBoundingClientRect()
        if (!a || !b || (!a.width && !b.width)) continue
        next.push({ key: `${item.from}>${item.to}`, d: curve(a, b, base), kind: item.kind })
      }
      setPaths(next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(inner)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [links])

  // Momento da viagem com muitos alertas ocupa duas colunas, com os cartões lado a lado.
  const wide = (station: AlertMapStation) => station.band === 'viagem' && station.nodes.length > 5
  const stationsOf = (band: string) => ALERT_MAP_STATIONS.filter((station) => station.band === band)
  const renderStation = (station: AlertMapStation, flow: boolean, last: boolean) => (
    <section key={station.id} aria-label={`${station.when}: ${station.what}`} className={cn('min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border-soft)] bg-[var(--app-surface)]', wide(station) && 'col-span-2 max-md:col-span-1')}>
      <header className="relative grid rounded-t-[var(--app-radius)] border-b border-[var(--app-border-soft)] bg-[var(--app-strip)] px-2.5 py-1.5">
        <span className="text-table font-bold text-[var(--app-strip-text)]">{station.when}</span>
        <span className="text-xs text-[var(--app-muted)]">{station.what}</span>
        {flow && !last ? <ChevronRight size={16} aria-hidden="true" className="absolute -right-[13px] top-1/2 z-[1] -translate-y-1/2 text-[var(--app-strip-text)] max-md:hidden" /> : null}
      </header>
      <ul className={cn('grid gap-1.5 p-2 max-md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]', (wide(station) || station.band !== 'viagem') && 'grid-cols-2')}>
        {station.nodes.map((id) => {
          const card = cards.get(id)
          if (!card) return null
          return (
            <li key={id}>
              <MapCard
                card={card}
                highlight={lit.get(id) ?? null}
                dimmed={Boolean(focus) && !lit.has(id)}
                outOfFilter={!matches(id)}
                count={card.notice ? 0 : counts?.get(id) ?? 0}
                onSelect={onSelect}
                cardRef={(element) => {
                  if (element) cardRefs.current.set(id, element)
                  else cardRefs.current.delete(id)
                }}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )

  return (
    <div className="overflow-x-auto pb-1">
      <div ref={innerRef} lang="pt-BR" className="relative grid min-w-[940px] gap-5 px-0.5 pt-2.5 max-md:min-w-0">
        <svg className="pointer-events-none absolute inset-0 z-[4] h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            {(Object.keys(ALERT_LINK_COLORS) as AlertLinkKind[]).map((kind) => (
              <marker key={kind} id={`${uid}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" style={{ fill: ALERT_LINK_COLORS[kind].color }} />
              </marker>
            ))}
          </defs>
          {paths.map((path) => {
            const style = ALERT_LINK_COLORS[path.kind]
            return (
              <g key={path.key} data-link={path.key}>
                <path d={path.d} fill="none" strokeWidth="5" style={{ stroke: 'var(--app-surface)' }} strokeOpacity="0.85" />
                <path
                  d={path.d}
                  fill="none"
                  strokeWidth="2"
                  style={{ stroke: style.color, strokeDasharray: style.dash }}
                  markerEnd={style.arrow ? `url(#${uid}-${path.kind})` : undefined}
                />
              </g>
            )
          })}
        </svg>

        {ALERT_MAP_BANDS.filter((band) => band.id === 'viagem').map((band) => (
          <div key={band.id} className="grid gap-2.5">
            <BandHeader title={band.title} note={band.note} />
            <div className="grid grid-cols-8 items-start gap-2.5 max-md:grid-cols-1">
              {stationsOf(band.id).map((station, index, list) => renderStation(station, true, index === list.length - 1))}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-1 items-start gap-5">
          {ALERT_MAP_BANDS.filter((band) => band.id !== 'viagem').map((band) => (
            <div key={band.id} className="grid gap-2.5">
              <BandHeader title={band.title} note={band.note} />
              <div className="grid grid-cols-3 items-start gap-2.5 max-md:grid-cols-1">
                {stationsOf(band.id).map((station, index, list) => renderStation(station, band.id === 'depois', index === list.length - 1))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function BandHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5">
      <h2 className="text-base font-bold text-[var(--app-text-strong)]">{title}</h2>
      <p className="text-xs text-[var(--app-muted)]">{note}</p>
    </div>
  )
}

function MapCard({
  card,
  highlight,
  dimmed,
  outOfFilter,
  count,
  onSelect,
  cardRef,
}: {
  card: AlertMapCard
  highlight: Highlight | null
  dimmed: boolean
  outOfFilter: boolean
  count: number
  onSelect: (id: AlertMapNodeId) => void
  cardRef: (element: HTMLDivElement | null) => void
}) {
  const relation = highlight?.relation ?? null
  const ring = highlight?.selected
    ? 'border-[var(--app-navy)] shadow-[0_0_0_2px_var(--app-navy)]'
    : relation
      ? 'shadow-[0_0_0_2px_var(--relation)]'
      : highlight?.lit
        ? 'border-[var(--app-danger-border)] shadow-[0_0_0_2px_var(--app-danger-border)]'
        : card.notice
          ? 'border-dashed border-[var(--app-border)]'
          : card.severity === 'critical'
            ? 'border-[var(--app-danger-border)]'
            : 'border-[var(--app-border-soft)]'
  return (
    <div
      ref={cardRef}
      data-node={card.id}
      className={cn(
        'relative rounded-[var(--app-radius-control)] border transition-opacity motion-reduce:transition-none',
        card.notice ? 'bg-[var(--app-bg)]' : 'bg-[var(--app-surface)]',
        ring,
        dimmed ? 'opacity-25' : outOfFilter ? 'opacity-35' : null,
      )}
      style={relation ? { ['--relation' as string]: ALERT_LINK_COLORS[relation].color, borderColor: ALERT_LINK_COLORS[relation].color } : undefined}
    >
      <button
        type="button"
        aria-pressed={Boolean(highlight?.selected)}
        title={card.fullLabel === card.label ? undefined : card.fullLabel}
        onClick={() => onSelect(card.id)}
        className="grid w-full gap-1 rounded-[var(--app-radius-control)] px-2 py-1.5 text-left"
      >
        <span className="hyphens-auto break-words text-xs font-semibold leading-snug text-[var(--app-text-strong)]">
          {card.label}
          {card.fullLabel === card.label ? null : <span className="sr-only"> ({card.fullLabel})</span>}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {card.notice ? <Badge tone="neutral">{card.notice === 'sino' ? 'Aviso do sino' : 'E-mail'}</Badge> : null}
          {card.severity === 'critical' ? <Badge tone="danger">Crítico</Badge> : card.escalation ? <Badge tone="warning" className="max-w-full whitespace-normal">{card.escalation}</Badge> : null}
          {card.teams.map((team) => <Badge key={team} tone="neutral">{team}</Badge>)}
          {card.dev ? <Badge tone="info" title={ALERT_DEV_ROUTING_LABELS[card.dev].sentence}>{ALERT_DEV_ROUTING_LABELS[card.dev].tag}</Badge> : null}
        </span>
      </button>
      {count > 0 ? (
        <Link to={`/alertas?tipo=${card.id}`} className="app-link block px-2 pb-1.5 text-xs">
          {count} na fila
        </Link>
      ) : null}
      {relation ? (
        <span
          className="absolute -top-2 right-1.5 rounded-full px-1.5 text-xs font-semibold leading-4 text-[var(--app-surface)]"
          style={{ background: ALERT_LINK_COLORS[relation].color }}
        >
          {ALERT_LINK_KINDS[relation].short}
        </span>
      ) : null}
      {highlight?.step ? (
        <span aria-hidden="true" className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--app-red)] text-xs font-bold text-[var(--app-surface)]">
          {highlight.step}
        </span>
      ) : null}
    </div>
  )
}

function curve(a: DOMRect, b: DOMRect, base: DOMRect): string {
  const ay = a.top - base.top + a.height / 2
  const by = b.top - base.top + b.height / 2
  const ax = a.left - base.left
  const bx = b.left - base.left
  const acx = ax + a.width / 2
  const bcx = bx + b.width / 2
  if (Math.abs(acx - bcx) < 40) {
    // Mesma coluna: sai pela direita e volta pela direita.
    const x1 = ax + a.width
    const x2 = bx + b.width
    const bulge = Math.min(64, 22 + Math.abs(by - ay) * 0.12)
    return `M${x1},${ay} C${x1 + bulge},${ay} ${x2 + bulge},${by} ${x2 + 1},${by}`
  }
  if (bcx > acx) {
    const sx = ax + a.width
    const dx = Math.max(28, (bx - sx) * 0.45)
    return `M${sx},${ay} C${sx + dx},${ay} ${bx - dx},${by} ${bx},${by}`
  }
  const ex = bx + b.width
  const dx = Math.max(28, (ax - ex) * 0.45)
  return `M${ax},${ay} C${ax - dx},${ay} ${ex + dx},${by} ${ex},${by}`
}
