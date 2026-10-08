import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLineUpSnapshot, type LineUpRow, type LineUpSnapshot } from '../services/lineup'
import { formatDateOnlyToBRShort, formatShortDateSafe } from '../lib/utils'
import { arrivalDisplay, deriveEscalaState } from '../lib/escalaState'
import { isCycleStartRow } from '../lib/lineupCycle'
import {
  formatLineUpInteger,
  lineUpCeStatus,
  lineUpExportLabel,
  lineUpLinked,
  type LineUpStatusTone,
} from '../components/lineup/lineUpStatus'

const DISPLAY_VISIBLE_ROWS = 8
const DISPLAY_MIN_ROW_HEIGHT = 74
// O quadro para em cada posição e só então desliza uma linha: um rolamento
// contínuo obrigava a ler um alvo em movimento a vários metros da tela.
export const DISPLAY_ROW_DWELL_MS = 4000
export const DISPLAY_ROW_TRAVEL_MS = 900
// A coluna Terminal carrega código de terminal (PORTMAC) e até dois códigos
// separados por ' / '; cortar no meio produz outro código.
const DISPLAY_GRID_TEMPLATE = '15fr 6fr 6.5fr 9fr 6fr 6fr 5fr 6fr 5fr 6fr 5fr 5fr 6.5fr 9.5fr 8fr'
const DISPLAY_COLUMNS = ['Navio', 'Viagem', 'POD', 'Terminal', 'ETA', 'ETB', 'VIN', 'VIN CNTR', 'CG', 'Total', 'MTY', 'RTW', 'BB', 'CEs', 'Vinculada']
const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

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
  const timeoutRef = useRef<number | null>(null)
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
  // saem do effect (ajuste durante o render); o timer que apaga o destaque
  // continua em useEffect, re-armado a cada snapshot.
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

  const lastUpdate = data?.lastChangedAt ? TIME_FORMAT.format(new Date(data.lastChangedAt)) : '—'
  const firstRouteLabel = firstRoute ? buildDisplayLeadLabel(firstRoute) : '—'
  const boardStyle = useMemo(
    () =>
      ({
        ['--lineup-display-columns' as string]: DISPLAY_GRID_TEMPLATE,
        ['--lineup-display-row-height' as string]: `${rowHeight}px`,
        ['--lineup-display-row-shift' as string]: isSliding ? `-${rowHeight}px` : '0px',
        ['--lineup-display-travel' as string]: `${DISPLAY_ROW_TRAVEL_MS}ms`,
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
        // O navegador pode exigir gesto do usuário; o quadro segue utilizável.
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

    // Parado → desliza uma linha → avança o índice → parado de novo.
    const dwell = () => {
      timeoutRef.current = window.setTimeout(slide, DISPLAY_ROW_DWELL_MS)
    }
    const slide = () => {
      setIsSliding(true)
      timeoutRef.current = window.setTimeout(() => {
        setIsSliding(false)
        setStartIndex((currentIndex) => (currentIndex + 1) % rows.length)
        dwell()
      }, DISPLAY_ROW_TRAVEL_MS)
    }
    dwell()

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
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

  // Falha com dados anteriores não apaga o quadro: avisa no cabeçalho que a
  // tela está parada e mantém as escalas conhecidas.
  const staleSince = error && data && refreshedAt ? TIME_FORMAT.format(refreshedAt) : null

  return (
    <main className="app-lineup-display-shell">
      <header className="app-lineup-display-header">
        <div className="app-lineup-display-brand">
          <img
            src="/branding/vela-mark-dark.svg"
            alt=""
            className="app-lineup-display-brand__logo"
          />
          <h1 className="app-lineup-display-brand__name">Line-Up</h1>
        </div>
        <dl className="app-lineup-display-meta">
          <div className="app-lineup-display-meta__group app-lineup-display-meta__group--route">
            <dt className="app-lineup-display-meta__label">Início do ciclo</dt>
            <dd className="app-lineup-display-meta__value">{firstRouteLabel}</dd>
          </div>
          <div className="app-lineup-display-meta__group">
            <dt className="app-lineup-display-meta__label">Última alteração</dt>
            <dd className="app-lineup-display-meta__value">{lastUpdate}</dd>
          </div>
          <div className="app-lineup-display-meta__group" aria-live="polite">
            {staleSince ? (
              <>
                <dt className="app-lineup-display-meta__label">Sem atualização desde</dt>
                <dd className="app-lineup-display-meta__value app-lineup-display-meta__value--stale">{staleSince}</dd>
              </>
            ) : (
              <>
                <dt className="app-lineup-display-meta__label">Atualizado às</dt>
                <dd className={`app-lineup-display-meta__value${flashRefresh ? ' app-lineup-display-meta__value--fresh' : ''}`}>
                  {refreshedAt ? TIME_FORMAT.format(refreshedAt) : '—'}
                </dd>
              </>
            )}
          </div>
        </dl>
      </header>

      <section className="app-lineup-display-body" aria-label="Escalas do Line-Up">
        {error && !data ? (
          <div className="app-lineup-display-message app-lineup-display-message--error" role="alert">
            Não foi possível carregar o Line-Up. Nova tentativa a cada 30 segundos.
          </div>
        ) : isLoading ? (
          <div className="app-lineup-display-message" role="status">Carregando o Line-Up…</div>
        ) : rows.length === 0 ? (
          <div className="app-lineup-display-message">Nenhuma escala em aberto.</div>
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
                    const ce = lineUpCeStatus(row.rowType === 'export' ? row.exportCeStatus ?? 'waiting' : row.ceStatus)
                    const linked = lineUpLinked(row.rowType === 'export' ? row.exportLinked : row.linked)
                    return (
                    <article
                      key={row.id}
                      className={`app-lineup-display-board__row ${isSliding ? 'app-lineup-display-board__row--sliding' : ''} ${row.rowType === 'export' ? 'app-lineup-display-board__row--export' : ''} ${isBerthed ? 'app-lineup-display-board__row--berthed' : ''} ${isCycleStart ? 'app-lineup-display-board__row--cycle-start' : ''}`}
                      style={{ top: `${slotIndex * rowHeight}px` }}
                    >
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--vessel">{row.vesselName}</div>
                      <div className="app-lineup-display-board__cell">{row.voyageNumber}</div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--stack">
                        <span>{row.pod}</span>
                        {row.omitted ? <OmittedChip /> : null}
                      </div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--terminal">{row.rowType === 'export' ? row.exportTerminal : row.importTerminal}</div>
                      <div className={`app-lineup-display-board__cell${arrival.isActual ? ' app-lineup-display-board__cell--actual' : ''}`}>
                        {arrival.isActual ? <span className="sr-only">ATA </span> : null}
                        {formatShortDate(arrival.value)}
                      </div>
                      <div className="app-lineup-display-board__cell">{formatShortDate(row.etb)}</div>
                      {row.rowType === 'export' ? (
                        <div
                          className="app-lineup-display-board__cell app-lineup-display-board__cell--export-label"
                          style={{ gridColumn: 'span 7' }}
                        >
                          {lineUpExportLabel(row)}
                        </div>
                      ) : (
                        <>
                          <div className="app-lineup-display-board__cell">{formatLineUpInteger(row.vin)}</div>
                          <div className="app-lineup-display-board__cell">{formatLineUpInteger(row.car)}</div>
                          <div className="app-lineup-display-board__cell">{formatLineUpInteger(row.cg)}</div>
                          <div className="app-lineup-display-board__cell app-lineup-display-board__cell--total">{formatLineUpInteger(row.total)}</div>
                          <div className="app-lineup-display-board__cell">{formatLineUpInteger(row.mty)}</div>
                          <div className="app-lineup-display-board__cell">{row.rtw === null ? '—' : formatLineUpInteger(row.rtw)}</div>
                          <div className="app-lineup-display-board__cell" title="Máquinas / packages">
                            {formatBreakbulk(row)}
                          </div>
                        </>
                      )}
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                        <DisplayStatus tone={ce.tone}>{ce.label}</DisplayStatus>
                      </div>
                      <div className="app-lineup-display-board__cell app-lineup-display-board__cell--status">
                        <DisplayStatus tone={linked.tone}>{linked.label}</DisplayStatus>
                      </div>
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

function DisplayStatus({ tone, children }: { tone: LineUpStatusTone; children: string }) {
  return <span className={`app-lineup-display-status app-lineup-display-status--${tone}`}>{children}</span>
}

function CardField({ label, value, actual, wide }: { label: string; value: React.ReactNode; actual?: boolean; wide?: boolean }) {
  return (
    <div className={`app-lineup-card__field${wide ? ' app-lineup-card__field--wide' : ''}`}>
      <span className="app-lineup-card__field-label">{label}</span>
      <span className={`app-lineup-card__field-value${actual ? ' app-lineup-card__field-value--actual' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function LineUpMobileCard({ row, cycleStart }: { row: LineUpRow; cycleStart: boolean }) {
  const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
  const isBerthed = deriveEscalaState({ atb: row.atb, atd: row.atd }) === 'atracada'
  const isExport = row.rowType === 'export'
  const ce = lineUpCeStatus(isExport ? row.exportCeStatus ?? 'waiting' : row.ceStatus)
  const linked = lineUpLinked(isExport ? row.exportLinked : row.linked)
  return (
    <article className={`app-lineup-card ${isBerthed ? 'app-lineup-card--berthed' : ''} ${cycleStart ? 'app-lineup-display-board__row--cycle-start' : ''}`}>
      <div className="app-lineup-card__head">
        <span className="app-lineup-card__vessel">{row.vesselName}</span>
        <span className="app-lineup-card__voy">Viagem {row.voyageNumber}</span>
      </div>
      <div className="app-lineup-card__pod">
        <span className="app-lineup-card__pod-label">POD</span>
        <span>{row.pod}</span>
        {row.omitted ? <OmittedChip /> : null}
        {isBerthed ? <span className="app-lineup-card__state">Atracado</span> : null}
      </div>
      <div className="app-lineup-card__grid">
        <CardField label="Terminal" value={isExport ? row.exportTerminal : row.importTerminal} />
        <CardField label={arrival.isActual ? 'ATA' : 'ETA'} value={formatShortDate(arrival.value)} actual={arrival.isActual} />
        <CardField label="ETB" value={formatShortDate(row.etb)} />
        {isExport ? (
          <CardField label="Carga" value={lineUpExportLabel(row)} wide />
        ) : (
          <>
            <CardField label="VIN" value={formatLineUpInteger(row.vin)} />
            <CardField label="VIN CNTR" value={formatLineUpInteger(row.car)} />
            <CardField label="CG" value={formatLineUpInteger(row.cg)} />
            <CardField label="Total" value={formatLineUpInteger(row.total)} />
            <CardField label="MTY" value={formatLineUpInteger(row.mty)} />
            <CardField label="RTW" value={row.rtw === null ? '—' : formatLineUpInteger(row.rtw)} />
            <CardField label="BB máq. / packages" value={formatBreakbulk(row)} wide />
          </>
        )}
        <CardField label="CEs" value={<DisplayStatus tone={ce.tone}>{ce.label}</DisplayStatus>} />
        <CardField label="Vinculada" value={<DisplayStatus tone={linked.tone}>{linked.label}</DisplayStatus>} />
      </div>
    </article>
  )
}

/** BB numa linha: máquinas / packages. O total era a soma das duas e ocupava uma terceira linha. */
function formatBreakbulk(row: Pick<LineUpRow, 'bbMachines' | 'bbPackages'>) {
  if (!row.bbMachines && !row.bbPackages) return '—'
  return `${formatLineUpInteger(row.bbMachines)} / ${formatLineUpInteger(row.bbPackages)}`
}

function OmittedChip() {
  return (
    <span className="app-lineup-display-omit" title="Escala omitida — o navio não atracará neste porto.">
      OMIT
    </span>
  )
}

function buildDisplayLeadLabel(row: LineUpRow) {
  const arrival = arrivalDisplay({ eta: row.eta, ata: row.ata })
  const etaLabel = formatDisplayLeadDate(arrival.isActual ? 'ATA' : 'ETA', arrival.value)
  if (etaLabel) return `${etaLabel} | ${row.vesselName} | ${row.pod}`

  const etbLabel = formatDisplayLeadDate('ETB', row.etb)
  if (etbLabel) return `${etbLabel} | ${row.vesselName} | ${row.pod}`

  return `${row.vesselName} | ${row.pod}`
}

function formatDisplayLeadDate(label: 'ETA' | 'ATA' | 'ETB', value: string | null) {
  if (!value) return null
  const shortDate = formatDateOnlyToBRShort(value)
  if (shortDate) return `${label} ${shortDate}`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${label} ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(parsed)}`
}

function formatShortDate(value: string | null) {
  const formatted = formatShortDateSafe(value)
  return formatted === '-' ? '—' : formatted
}
