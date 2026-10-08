import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot, type LineUpRow, type LineUpSnapshot } from '../services/lineup'
import { formatDateOnlyToBRShort, formatShortDateSafe } from '../lib/utils'
import { arrivalDisplay, deriveEscalaState } from '../lib/escalaState'
import { isCycleStartRow } from '../lib/lineupCycle'
import { lineUpCeStatus, type LineUpStatusTone } from '../components/lineup/lineUpStatus'

const DISPLAY_VISIBLE_ROWS = 8
const DISPLAY_MIN_ROW_HEIGHT = 74
const DISPLAY_ROW_TRAVEL_MS = 3000
// A coluna Terminal passou a carregar codigo de terminal (PORTMAC) e ate dois
// codigos separados por ' / '. Com 6fr ela cortava 'PORTMAC' para 'ORTMA'.
const DISPLAY_GRID_TEMPLATE = '16fr 5fr 7fr 10fr 6fr 6fr 5fr 6fr 6fr 7fr 5fr 5fr 7fr 9fr 6fr'
const DISPLAY_COLUMNS = ['Vessel', 'Voy', 'POD', 'Terminal', 'ETA', 'ETB', 'VIN', 'VIN CNTR', 'CG', 'Total', 'MTY', 'RTW', 'BB', 'CEs', 'Linked']

function useIsMobileDisplay() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth <= 1024
  })

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}

export function LineUpTVDisplay() {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const slideTimeoutRef = useRef<number | null>(null)
  const restartFrameRef = useRef<number | null>(null)
  const [rowHeight, setRowHeight] = useState(DISPLAY_MIN_ROW_HEIGHT)
  const [startIndex, setStartIndex] = useState(0)
  const [isSliding, setIsSliding] = useState(false)
  const isMobile = useIsMobileDisplay()

  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [flashRefresh, setFlashRefresh] = useState(false)
  const previousSnapshotRef = useRef<LineUpSnapshot | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['lineup-tv-display-v2'],
    queryFn: async () => {
      const snapshot = await fetchLineUpSnapshot(60, previousSnapshotRef.current)
      previousSnapshotRef.current = snapshot
      return snapshot
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  // Marca o refresh quando um novo snapshot chega — os setStates síncronos
  // saem do effect (ajuste durante o render); o timer que apaga o flash
  // continua em useEffect, re-armado a cada snapshot como antes.
  const [prevData, setPrevData] = useState<typeof data>(undefined)
  if (data && data !== prevData) {
    setPrevData(data)
    setRefreshedAt(new Date())
    setFlashRefresh(true)
  }

  useEffect(() => {
    if (!data) return
    const t = setTimeout(() => setFlashRefresh(false), 1200)
    return () => clearTimeout(t)
  }, [data])

  // Escalas omitidas continuam visíveis para a operação, mas não são
  // pendências de chegada: o navio não atracará naquele POD.
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => !row.atd || row.omitted), [data?.rows])
  const firstRoute = rows[0] ?? null
  const hasAnimatedLoop = !isMobile && rows.length > DISPLAY_VISIBLE_ROWS
  const placeholderCount = hasAnimatedLoop ? 0 : Math.max(0, DISPLAY_VISIBLE_ROWS - rows.length)
  const displayRows = useMemo(() => {
    if (!hasAnimatedLoop) return rows

    return Array.from({ length: DISPLAY_VISIBLE_ROWS + 1 }, (_, offsetIndex) => {
      const row = rows[(startIndex + offsetIndex) % rows.length]
      return {
        ...row,
        id: `${row.id}::display-track-${startIndex}-${offsetIndex}`,
      }
    })
  }, [hasAnimatedLoop, rows, startIndex])

  const lastUpdate = data?.lastChangedAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
        new Date(data.lastChangedAt),
      )
    : '-'
  const firstRouteLabel = firstRoute ? buildDisplayLeadLabel(firstRoute) : '-'
  const boardStyle = useMemo(
    () =>
      ({
        ['--lineup-display-columns' as string]: DISPLAY_GRID_TEMPLATE,
        ['--lineup-display-row-height' as string]: `${rowHeight}px`,
        ['--lineup-display-row-shift' as string]: isSliding ? `-${rowHeight}px` : '0px',
      }) as CSSProperties,
    [isSliding, rowHeight],
  )

  useEffect(() => {
    if (isMobile) return
    const root = document.documentElement
    const body = document.body
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [isMobile])

  useEffect(() => {
    const element = document.documentElement
    const requestFullScreen = async () => {
      try {
        if (document.fullscreenElement) return
        if (element.requestFullscreen) {
          await element.requestFullscreen()
        }
      } catch {
        // Browser may require explicit user gesture; keep display usable without blocking.
      }
    }

    void requestFullScreen()
  }, [])

  // Reinicia o carrossel quando o conteúdo muda — ajuste durante o render.
  const carouselResetKey = `${data?.lastChangedAt ?? ''}:${rows.length}`
  const [prevCarouselResetKey, setPrevCarouselResetKey] = useState(carouselResetKey)
  if (carouselResetKey !== prevCarouselResetKey) {
    setPrevCarouselResetKey(carouselResetKey)
    setStartIndex(0)
    setIsSliding(false)
  }

  useEffect(() => {
    if (isMobile || !hasAnimatedLoop || rowHeight <= 0) return

    const runCycle = () => {
      setIsSliding(true)
      slideTimeoutRef.current = window.setTimeout(() => {
        setIsSliding(false)
        setStartIndex((currentIndex) => (currentIndex + 1) % rows.length)
        restartFrameRef.current = window.requestAnimationFrame(() => {
          restartFrameRef.current = window.requestAnimationFrame(runCycle)
        })
      }, DISPLAY_ROW_TRAVEL_MS)
    }

    restartFrameRef.current = window.requestAnimationFrame(() => {
      restartFrameRef.current = window.requestAnimationFrame(runCycle)
    })

    return () => {
      if (slideTimeoutRef.current !== null) {
        window.clearTimeout(slideTimeoutRef.current)
        slideTimeoutRef.current = null
      }
      if (restartFrameRef.current !== null) {
        window.cancelAnimationFrame(restartFrameRef.current)
        restartFrameRef.current = null
      }
    }
  }, [hasAnimatedLoop, isMobile, rowHeight, rows.length])

  useLayoutEffect(() => {
    if (isMobile) return
    const viewport = viewportRef.current
    if (!viewport) return

    const recalculate = () => {
      const nextHeight = Math.max(DISPLAY_MIN_ROW_HEIGHT, Math.floor(viewport.clientHeight / DISPLAY_VISIBLE_ROWS))
      setRowHeight(nextHeight)
    }

    if (typeof ResizeObserver === 'undefined') {
      recalculate()
      return
    }

    const observer = new ResizeObserver(recalculate)
    observer.observe(viewport)
    requestAnimationFrame(recalculate)

    return () => observer.disconnect()
  }, [isMobile, rows.length])

  return (
    <main className="app-lineup-display-shell">
      <header className="app-lineup-display-header">
        <div className="app-lineup-display-brand">
          <img
            src="/branding/vela-mark.svg"
            alt="Símbolo Vela"
            className="app-lineup-display-brand__logo"
          />
          <span className="app-lineup-display-brand__name">Vela</span>
        </div>
        <div className="app-lineup-display-meta">
          <div className="app-lineup-display-meta__group">
            <span className="app-lineup-display-meta__label">Início do ciclo</span>
            <strong className="app-lineup-display-meta__value app-lineup-display-meta__value--route">{firstRouteLabel}</strong>
          </div>
          <div className="app-lineup-display-meta__group">
            <span className="app-lineup-display-meta__label">Última alteração</span>
            <strong className="app-lineup-display-meta__value">{lastUpdate}</strong>
          </div>
          <div className="app-lineup-display-meta__group">
            {/* Falha com dados anteriores: o quadro fica e o cabeçalho diz desde quando. */}
            <span className="app-lineup-display-meta__label">{error && data ? 'Sem atualização desde' : 'Atualizado às'}</span>
            <strong
              className="app-lineup-display-meta__value"
              style={{ transition: 'color 0.4s', color: flashRefresh ? '#4ade80' : undefined }}
            >
              {refreshedAt
                ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(refreshedAt)
                : '-'}
            </strong>
          </div>
        </div>
      </header>

      <section className="app-lineup-display-body">
        {error && !data ? (
          <div className="app-lineup-display-error">Falha ao carregar o quadro da TV.</div>
        ) : null}

        {isLoading ? (
          <div className="app-lineup-display-loading">Carregando line up...</div>
        ) : rows.length === 0 ? (
          <div className="app-lineup-display-loading">Nenhuma escala disponivel.</div>
        ) : isMobile ? (
          <div className="app-lineup-mobile">
            {rows.map((row) => (
              <LineUpMobileCard key={row.id} row={row} cycleStart={isCycleStartRow(row.id, firstRoute?.id)} />
            ))}
          </div>
        ) : (
          <div className="app-lineup-display-table-frame">
            <section className="app-lineup-display-board" style={boardStyle}>
              <header className="app-lineup-display-board__header">
                {DISPLAY_COLUMNS.map((label) => (
                  <div key={label} className="app-lineup-display-board__head">
                    {label}
                  </div>
                ))}
              </header>

              <div ref={viewportRef} className="app-lineup-display-board__viewport">
                <div className="app-lineup-display-board__track">
                  {displayRows.map((row, slotIndex) => {
                    const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
                    const isBerthed = deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'
                    const isCycleStart = isCycleStartRow(row.id, firstRoute?.id)
                    return (
                    <article
                      key={row.id}
                      className={`app-lineup-display-board__row ${isSliding ? 'app-lineup-display-board__row--sliding' : ''} ${row.rowType === 'export' ? 'app-lineup-display-board__row--export' : ''} ${isBerthed ? 'app-lineup-display-board__row--berthed' : ''} ${isCycleStart ? 'app-lineup-display-board__row--cycle-start' : ''}`}
                      style={{ top: `${slotIndex * rowHeight}px` }}
                    >
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--vessel">{row.vesselName}</div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--accent">{row.voyageNumber}</div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--accent">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          <span>{row.pod}</span>
                          {row.omitted ? <OmittedChip /> : null}
                        </div>
                      </div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--accent app-lineup-display-board__cell--terminal">{row.rowType === 'export' ? row.exportTerminal : row.importTerminal}</div>
                      <div className={`app-lineup-display-board__cell ${arrival.isActual ? 'text-green-600' : ''}`}>{formatShortDate(arrival.value)}</div>
                      <div className="app-lineup-display-board__cell">{formatShortDate(row.etb)}</div>
                      {row.rowType === 'export' ? (
                        <>
                          <div
                            className="app-lineup-display-board__cell app-lineup-display-board__cell--export-label"
                            style={{ gridColumn: 'span 7' }}
                          >
                            {buildExportLabel(row)}
                          </div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                            {renderDisplayCeStatus(row.exportCeStatus ?? 'waiting')}
                          </div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                            <span className={`app-lineup-display-status ${row.exportLinked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                              {row.exportLinked ? 'SIM' : 'NÃO'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--accent">{formatInteger(row.vin)}</div>
                          <div className="app-lineup-display-board__cell">{formatInteger(row.car)}</div>
                          <div className="app-lineup-display-board__cell">{formatInteger(row.cg)}</div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--total">{formatInteger(row.total)}</div>
                          <div className="app-lineup-display-board__cell">{formatInteger(row.mty)}</div>
                          <div className="app-lineup-display-board__cell">{row.rtw === null ? '-' : formatInteger(row.rtw)}</div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--bb">
                            <div className="app-lineup-display-board__bb">
                              <span>{formatInteger(row.bbMachines)} MAQ</span>
                              <span>{formatInteger(row.bbPackages)} PACK</span>
                              <span>{formatInteger(row.bbTotal)} TOTAL</span>
                            </div>
                          </div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                            {renderDisplayCeStatus(row.ceStatus)}
                          </div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                            <span className={`app-lineup-display-status ${row.linked ? 'app-lineup-display-status--green' : 'app-lineup-display-status--amber'}`}>
                              {row.linked ? 'SIM' : 'NÃO'}
                            </span>
                          </div>
                        </>
                      )}
                    </article>
                    )
                  })}

                  {Array.from({ length: placeholderCount }).map((_, index) => (
                    <article
                      key={`lineup-display-placeholder-${index}`}
                      className="app-lineup-display-board__row app-lineup-display-board__row--placeholder"
                      style={{ top: `${(displayRows.length + index) * rowHeight}px` }}
                      aria-hidden="true"
                    >
                      {Array.from({ length: DISPLAY_COLUMNS.length }).map((__, columnIndex) => (
                        <div key={columnIndex} className="app-lineup-display-board__cell">
                          &nbsp;
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

// Mesmo status de CE do Painel (lineUpCeStatus); só as cores são do quadro.
const CE_TONE_COLOR: Record<LineUpStatusTone, 'green' | 'blue' | 'amber' | 'red'> = {
  success: 'green',
  info: 'blue',
  warning: 'amber',
  danger: 'red',
}

function renderDisplayCeStatus(status: LineUpRow['ceStatus']) {
  const ce = lineUpCeStatus(status)
  return <span className={`app-lineup-display-status app-lineup-display-status--${CE_TONE_COLOR[ce.tone]}`}>{ce.label}</span>
}

function ceStatusLabel(status: LineUpRow['ceStatus']) {
  return lineUpCeStatus(status).label
}

function ceStatusColorClass(status: LineUpRow['ceStatus']) {
  return `app-lineup-card__field-value--${CE_TONE_COLOR[lineUpCeStatus(status).tone]}`
}

function CardField({ label, value, accent, actual }: { label: string; value: string; accent?: boolean; actual?: boolean }) {
  return (
    <div className="app-lineup-card__field">
      <span className="app-lineup-card__field-label">{label}</span>
      <span className={`app-lineup-card__field-value ${accent ? 'app-lineup-card__field-value--accent' : ''} ${actual ? 'text-green-600' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function LineUpMobileCard({ row, cycleStart }: { row: LineUpRow; cycleStart: boolean }) {
  const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
  const isBerthed = deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'
  return (
    <article className={`app-lineup-card ${isBerthed ? 'app-lineup-card--berthed' : ''} ${cycleStart ? 'app-lineup-display-board__row--cycle-start' : ''}`}>
      <div className="app-lineup-card__head">
        <span className="app-lineup-card__vessel">{row.vesselName}</span>
        <span className="app-lineup-card__voy">Voy {row.voyageNumber}</span>
      </div>
      <div className="app-lineup-card__pod">
        <span className="app-lineup-card__pod-label">POD</span>
        <span>{row.pod}</span>
        {row.omitted ? <OmittedChip /> : null}
      </div>
      <div className="app-lineup-card__grid">
        <CardField label="Terminal" value={row.rowType === 'export' ? row.exportTerminal : row.importTerminal} />
        <CardField label="ETA" value={formatShortDate(arrival.value)} actual={arrival.isActual} />
        <CardField label="ETB" value={formatShortDate(row.etb)} />
        <CardField label="VIN" value={formatInteger(row.vin)} />
        <CardField label="VIN CNTR" value={formatInteger(row.car)} />
        <CardField label="CG" value={formatInteger(row.cg)} />
        <CardField label="Total" value={formatInteger(row.total)} accent />
        <CardField label="MTY" value={formatInteger(row.mty)} />
        <CardField label="RTW" value={row.rtw === null ? '-' : formatInteger(row.rtw)} />
        <div className="app-lineup-card__field app-lineup-card__field--wide">
          <span className="app-lineup-card__field-label">BB</span>
          <span className="app-lineup-card__field-value">
            {formatInteger(row.bbMachines)} MAQ · {formatInteger(row.bbPackages)} PACK · {formatInteger(row.bbTotal)} TOTAL
          </span>
        </div>
        <div className="app-lineup-card__field">
          <span className="app-lineup-card__field-label">CEs</span>
          <span className={`app-lineup-card__field-value ${ceStatusColorClass(row.ceStatus)}`}>
            {ceStatusLabel(row.ceStatus)}
          </span>
        </div>
        <div className="app-lineup-card__field">
          <span className="app-lineup-card__field-label">Linked</span>
          <span
            className={`app-lineup-card__field-value ${row.linked ? 'app-lineup-card__field-value--green' : 'app-lineup-card__field-value--amber'}`}
          >
            {row.linked ? 'SIM' : 'NÃO'}
          </span>
        </div>
      </div>
    </article>
  )
}


function buildExportLabel(row: LineUpRow) {
  const parts: string[] = ['EXP']
  if (row.exportHasGranite) parts.push('GRANITE')
  if (row.exportContainersQty !== null) {
    const moves = row.exportMovementsQty !== null ? ` - ${formatInteger(row.exportMovementsQty)} MOVES` : ''
    parts.push(`${formatInteger(row.exportContainersQty)} CNTRS${moves}`)
  }
  return parts.join(' | ')
}

function OmittedChip() {
  return (
    <span
      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
      title="Escala omitida — o navio não atracou neste porto."
    >
      Omitida
    </span>
  )
}

function buildDisplayLeadLabel(row: LineUpRow) {
  const etaLabel = formatDisplayLeadDate('ETA', arrivalDisplay({ eta: row.eta, ata: row.ata }).value)
  if (etaLabel) return `${etaLabel} | ${row.vesselName} | ${row.pod}`

  const etbLabel = formatDisplayLeadDate('ETB', row.etb)
  if (etbLabel) return `${etbLabel} | ${row.vesselName} | ${row.pod}`

  return `${row.vesselName} | ${row.pod}`
}

function formatDisplayLeadDate(label: 'ETA' | 'ETB', value: string | null) {
  if (!value) return null
  const shortDate = formatDateOnlyToBRShort(value)
  if (shortDate) return `${label} ${shortDate}`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${label} ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(parsed)}`
}

function formatShortDate(value: string | null) {
  return formatShortDateSafe(value)
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Number(value ?? 0))
}
