import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, ExternalLink, ShieldAlert, Undo2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  useInternalNotifications,
  useInternalNotificationEntityLabels,
  useMarkAllInternalNotificationsRead,
  useMarkInternalNotificationRead,
  useUnreadInternalNotificationCount,
} from '../../hooks/useInternalNotifications'
import { alertEntityLink, formatAlertEntity, ENTITY_TYPE_LABELS, type InternalNotification } from '../../services/alerts'
import type { InternalNotificationCursor } from '../../services/alerts'
import { formatDate } from '../../lib/utils'
import { useToast } from '../ui/Toast'

export function InternalNotificationBell() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [cursorByPage, setCursorByPage] = useState<Array<InternalNotificationCursor | null>>([null])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { showToast } = useToast()

  const { data: countData } = useUnreadInternalNotificationCount()
  const unreadCount = Number(countData ?? 0)

  const cursor = cursorByPage[page] ?? null
  const { data = [], isLoading } = useInternalNotifications(open, cursor)
  const { data: entityLabels } = useInternalNotificationEntityLabels(data, cursor)
  const markRead = useMarkInternalNotificationRead()
  const markAllRead = useMarkAllInternalNotificationsRead()

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className="app-header__icon-button"
        aria-label={`Notificações internas${unreadCount ? ` (${unreadCount} não lidas)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="internal-notifications-panel"
        onClick={() => {
          setOpen((current) => !current)
          setPage(0)
          setCursorByPage([null])
        }}
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[var(--app-red)] px-1 text-center text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-10 z-50 w-[min(92vw,400px)] rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-2 shadow-2xl"
          id="internal-notifications-panel"
          role="region"
          aria-label="Notificações internas"
        >
          <div className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--app-text-strong)]">Notificações internas</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-[var(--app-link)] hover:underline disabled:opacity-50"
                disabled={markAllRead.isPending}
                onClick={() => void markAllRead.mutateAsync().catch(() => showToast('Não foi possível marcar todas como lidas. Tente de novo.', 'error'))}
              >
                <CheckCheck size={14} />
                <span>Marcar todas como lidas</span>
              </button>
            ) : null}
          </div>

          {isLoading ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--app-muted)]">Carregando…</div>
          ) : null}

          {!isLoading && !data.length ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--app-muted)]">Nenhuma pendência nova.</div>
          ) : null}

          <div className="max-h-96 divide-y divide-[var(--app-border)] overflow-auto">
            {data.map((notification: InternalNotification) => {
              const isEcho = Boolean(notification.payload?.is_echo)
              const destination = alertEntityLink({
                type: notification.item_type ?? notification.type ?? '',
                entity_type: notification.entity_type,
                entity_id: notification.entity_id,
                metadata: notification.payload ?? {},
                destination: notification.destination,
              }) ?? '/alertas'

              const entityFormatted = formatAlertEntity(notification.entity_type, notification.entity_id, entityLabels)
                ?? (notification.entity_type ? (ENTITY_TYPE_LABELS[notification.entity_type] ?? notification.entity_type) : null)

              return (
                <button
                  key={notification.id}
                  type="button"
                  className="flex w-full gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/5"
                  onClick={() => {
                    if (!notification.read_at) {
                      // A mutation é idempotente por notificação: repetir o clique
                      // (retry após falha) não duplica nem perde o item — o hook
                      // restaura o estado otimista no erro.
                      void markRead.mutateAsync(notification.id).catch(() =>
                        showToast('Não foi possível marcar como lida. Toque de novo para tentar.', 'error'),
                      )
                    }
                    navigate(destination)
                    setOpen(false)
                  }}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      notification.read_at
                        ? 'bg-slate-600'
                        : notification.severity === 'critical'
                          ? 'bg-red-400'
                          : isEcho
                            ? 'bg-sky-400'
                            : 'bg-amber-300'
                    }`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isEcho ? (
                        <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400 border border-sky-500/20">
                          <Undo2 size={10} />
                          Eco de Tratamento
                        </span>
                      ) : notification.severity === 'critical' ? (
                        <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400 border border-rose-500/20">
                          Crítico
                        </span>
                      ) : null}

                      {notification.is_fallback ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20" title="Entregue por rota alternativa do Administrativo. Responsável pelo tratamento permanece inalterado.">
                          <ShieldAlert size={10} />
                          Entrega alternativa
                        </span>
                      ) : null}

                      <span className="text-xs font-semibold text-[var(--app-text-strong)]">{notification.title}</span>
                    </div>

                    <p className="text-xs text-[var(--app-text)]">{notification.message}</p>

                    <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                      <span>{entityFormatted ?? 'Geral'}</span>
                      <span>{formatDate(notification.created_at)}</span>
                    </div>
                  </div>

                  <ExternalLink size={13} className="mt-1 shrink-0 text-[var(--app-muted)]" />
                </button>
              )
            })}
          </div>

          {data.length >= 20 || page > 0 ? (
            <div className="flex items-center justify-between border-t border-[var(--app-border)] px-3 py-2 text-xs text-[var(--app-muted)]">
              <button
                type="button"
                className="text-[var(--app-link)] hover:underline disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Anterior
              </button>
              <span>Página {page + 1}</span>
              <button
                type="button"
                className="text-[var(--app-link)] hover:underline disabled:opacity-40"
                disabled={data.length < 20}
                onClick={() => {
                  const last = data[data.length - 1]
                  if (!last) return
                  setCursorByPage((current) => {
                    const next = current.slice(0, page + 1)
                    next[page + 1] = { createdAt: last.created_at, id: last.id }
                    return next
                  })
                  setPage((current) => current + 1)
                }}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
