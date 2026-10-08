import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bell, CheckCheck, ShieldAlert, Undo2 } from 'lucide-react'
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
import { listAllUnreadInternalNotifications } from '../../services/alerts'
import { formatDate } from '../../lib/utils'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'
import { Badge } from '../ui/Badge'

export function InternalNotificationBell() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [cursorByPage, setCursorByPage] = useState<Array<InternalNotificationCursor | null>>([null])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const { data: countData, refetch: refetchCount } = useUnreadInternalNotificationCount()
  // Falha ou divergência de "Marcar todas" fica explicada no próprio painel.
  const [markAllNotice, setMarkAllNotice] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const unreadCount = Number(countData ?? 0)

  const cursor = cursorByPage[page] ?? null
  const { data = [], isLoading, isError, refetch } = useInternalNotifications(open, cursor)
  const { data: entityLabels } = useInternalNotificationEntityLabels(data, cursor)
  const markRead = useMarkInternalNotificationRead()
  const markAllRead = useMarkAllInternalNotificationsRead()

  async function markEveryUnreadNotificationRead() {
    setMarkAllNotice(null)
    setMarkingAll(true)
    try {
      const unreadNotifications = await listAllUnreadInternalNotifications()
      if (unreadNotifications.length !== unreadCount) {
        setMarkAllNotice('A lista de notificações mudou desde que o painel abriu; nenhuma foi marcada. Atualize a lista e tente de novo.')
        return
      }
      if (unreadNotifications.length === 0) return

      const confirmed = await confirm({
        title: 'Marcar todas como lidas',
        message: `Marcar ${unreadNotifications.length} notificações internas como lidas?`,
        confirmLabel: 'Marcar como lidas',
        affected: {
          summary: `${unreadNotifications.length} notificações internas não lidas`,
          items: unreadNotifications.map((notification) =>
            `${notification.title ?? 'Notificação'} — ${notification.message}`,
          ),
        },
        consequence: 'Elas saem do contador de não lidas. As pendências operacionais continuam abertas na fila de Alertas; esta ação só altera o estado das notificações.',
        reversibility: 'Não há ação para marcar essas notificações novamente como não lidas. As pendências continuam acessíveis em Alertas.',
      })
      if (!confirmed) return

      await markAllRead.mutateAsync()
    } catch {
      setMarkAllNotice('Não foi possível marcar todas como lidas. Tente de novo.')
    } finally {
      setMarkingAll(false)
    }
  }

  function refreshAfterNotice() {
    setMarkAllNotice(null)
    void refetch()
    void refetchCount()
  }

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
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function openNotification(notification: InternalNotification, destination: string) {
    if (!notification.read_at) {
      void (async () => {
        const confirmed = await confirm({
          title: 'Marcar notificação como lida',
          message: `Marcar “${notification.title ?? 'Notificação'}” como lida e abrir o registro?`,
          confirmLabel: 'Marcar como lida',
          affected: {
            summary: `1 notificação: ${notification.title ?? 'Notificação'}`,
            items: [notification.message],
          },
          consequence: 'A notificação sai do contador de não lidas. A pendência operacional continua aberta na fila de Alertas.',
          reversibility: 'Não há ação para marcar esta notificação novamente como não lida. A pendência continua acessível em Alertas.',
        })
        if (!confirmed) return

        // A mutation é idempotente por notificação: o hook restaura
        // o estado otimista no erro para permitir uma nova tentativa.
        void markRead.mutateAsync(notification.id).catch(() =>
          showToast('Não foi possível marcar como lida. Toque de novo para tentar.', 'error'),
        )
        navigate(destination)
        setOpen(false)
      })()
      return
    }
    navigate(destination)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="app-header__icon-button"
        aria-label={`Notificações internas${unreadCount ? ` (${unreadCount} não lidas)` : ''}`}
        aria-expanded={open}
        aria-controls="internal-notifications-panel"
        onClick={() => {
          setOpen((current) => !current)
          setPage(0)
          setCursorByPage([null])
        }}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="app-header__count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="app-notifications internal-notifications__panel"
          id="internal-notifications-panel"
          role="region"
          aria-label="Notificações internas"
        >
          <div className="app-notifications__header">
            <h2 className="app-notifications__title">Notificações internas</h2>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="app-notifications__mark-all"
                disabled={markingAll || markAllRead.isPending}
                aria-busy={markingAll || undefined}
                onClick={() => void markEveryUnreadNotificationRead()}
              >
                <CheckCheck size={16} aria-hidden="true" />
                <span>{markingAll ? 'Marcando…' : 'Marcar todas como lidas'}</span>
              </button>
            ) : null}
          </div>

          {markAllNotice ? (
            <div className="app-notifications__notice" role="alert">
              <span>{markAllNotice}</span>
              <button type="button" className="app-notifications__notice-action" onClick={refreshAfterNotice}>Atualizar lista</button>
            </div>
          ) : null}

          <div className="app-notifications__list">
            {isLoading ? <div className="app-notifications__state" role="status">Carregando notificações…</div> : null}

            {/* Falha de consulta não pode parecer "nenhuma notificação". */}
            {!isLoading && isError ? (
              <div className="app-notifications__state" role="alert">
                Não foi possível carregar as notificações.{' '}
                <button type="button" className="app-notifications__retry" onClick={() => void refetch()}>Tentar novamente</button>
              </div>
            ) : null}

            {!isLoading && !isError && !data.length ? (
              <div className="app-notifications__state">Nenhuma notificação não lida.</div>
            ) : null}

            {data.length ? (
              <ul className="app-notifications__items">
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
                    <li key={notification.id}>
                      <button
                        type="button"
                        className="app-notifications__item"
                        data-read={String(Boolean(notification.read_at))}
                        onClick={() => openNotification(notification, destination)}
                      >
                        <div className="app-notifications__body">
                          <div className="app-notifications__item-head">
                            <span className="app-notifications__item-title">{notification.title}</span>
                            {isEcho ? (
                              <Badge tone="info"><Undo2 size={12} aria-hidden="true" />Eco de Tratamento</Badge>
                            ) : notification.severity === 'critical' ? (
                              <Badge tone="danger">Crítico</Badge>
                            ) : null}
                            {notification.is_fallback ? (
                              <Badge tone="warning" title="Entregue por rota alternativa do Administrativo. Responsável pelo tratamento permanece inalterado.">
                                <ShieldAlert size={12} aria-hidden="true" />
                                Entrega alternativa
                              </Badge>
                            ) : null}
                          </div>
                          <p className="app-notifications__message">{notification.message}</p>
                          <div className="app-notifications__meta">
                            <span>{entityFormatted ?? 'Geral'}</span>
                            <span>{formatDate(notification.created_at)}</span>
                          </div>
                        </div>
                        {!notification.read_at ? (
                          <>
                            <span className="app-notifications__unread" aria-hidden="true" />
                            <span className="sr-only">Não lida</span>
                          </>
                        ) : <span aria-hidden="true" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>

          <div className="app-notifications__footer">
            {data.length >= 20 || page > 0 ? (
              <div className="app-notifications__pager">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  Anterior
                </button>
                <span>Página {page + 1}</span>
                <button
                  type="button"
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
            <button
              type="button"
              className="app-notifications__footer-link"
              onClick={() => { navigate('/alertas'); setOpen(false) }}
            >
              Abrir fila de Alertas
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
