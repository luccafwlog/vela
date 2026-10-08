import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, FileText, MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePortalScope } from '../../hooks/usePortalScope'
import { usePortalMarkAllRead, usePortalMarkRead, usePortalNotifications, usePortalUnreadCount } from '../../hooks/usePortalNotifications'
import { portalListNotifications, portalNotificationUnreadCount } from '../../services/portalBilling'
import { isPortalReadOnly } from '../../services/portalScope'
import { useConfirm } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'

const NOTIFICATION_CONFIRMATION_LIMIT = 10_000

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data: notifications, isLoading, isError, refetch } = usePortalNotifications(open)
  const { data: unreadCount = 0 } = usePortalUnreadCount()
  const markRead = usePortalMarkRead()
  const markAllRead = usePortalMarkAllRead()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirm = useConfirm()
  const { showToast } = useToast()
  const scope = usePortalScope()
  const readOnly = isPortalReadOnly(scope)

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const handleMarkAllRead = useCallback(async () => {
    if (scope.mode !== 'client') return
    try {
      const [snapshot, currentUnreadCount] = await Promise.all([
        portalListNotifications(scope, NOTIFICATION_CONFIRMATION_LIMIT),
        portalNotificationUnreadCount(scope),
      ])
      const unreadNotifications = snapshot.filter((notification) => !notification.read)
      if (snapshot.length === NOTIFICATION_CONFIRMATION_LIMIT || unreadNotifications.length !== currentUnreadCount) {
        showToast('Não foi possível confirmar a lista completa. Atualize as notificações e tente de novo; nenhuma foi marcada.', 'error')
        return
      }
      if (unreadNotifications.length === 0) return

      const confirmed = await confirm({
        title: 'Marcar todas como lidas',
        message: `Marcar ${unreadNotifications.length} notificações do Portal como lidas?`,
        confirmLabel: 'Marcar como lidas',
        affected: {
          summary: `${unreadNotifications.length} notificações não lidas da conta atual`,
          items: unreadNotifications.map((notification) => `${notification.title} — ${notification.message}`),
        },
        consequence: 'Elas deixam de contar como não lidas. Faturas, disputas e pendências continuam com o mesmo estado.',
        reversibility: 'Não há ação no Portal para marcar essas notificações novamente como não lidas.',
      })
      if (!confirmed) return

      await markAllRead.mutateAsync()
    } catch {
      showToast('Não foi possível marcar todas como lidas. Tente de novo.', 'error')
    }
  }, [confirm, markAllRead, scope, showToast])

  if (!scope.overview) return null

  const formatDate = (value: string | undefined) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(date)
  }

  const items = notifications ?? []

  // Painel não modal (região), igual ao sino do Vela: a lista tem botões
  // comuns e "Marcar todas como lidas" no cabeçalho, o que não cabe no papel
  // de menu. Escape fecha e devolve o foco ao sino.
  return (
    <div ref={containerRef} className="portal-notifications">
      <button
        ref={triggerRef}
        type="button"
        className="app-header__icon-button"
        onClick={() => setOpen(!open)}
        aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ''}`}
        aria-expanded={open}
        aria-controls="portal-notifications-panel"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="app-header__count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div id="portal-notifications-panel" role="region" aria-label="Notificações" className="app-notifications portal-notifications__panel">
          <div className="app-notifications__header">
            <h2 className="app-notifications__title">Notificações</h2>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="app-notifications__mark-all"
                onClick={handleMarkAllRead}
                disabled={readOnly || markAllRead.isPending}
                title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
              >
                <CheckCheck size={16} aria-hidden="true" />
                Marcar todas como lidas
              </button>
            ) : null}
          </div>

          <div className="app-notifications__list">
            {isLoading ? (
              <div className="app-notifications__state" role="status">Carregando notificações…</div>
            ) : isError ? (
              <div className="app-notifications__state" role="alert">
                Não foi possível carregar as notificações.{' '}
                <button type="button" className="app-notifications__retry" onClick={() => void refetch()}>Tentar novamente</button>
              </div>
            ) : items.length === 0 ? (
              <div className="app-notifications__state">Nenhuma notificação por enquanto.</div>
            ) : (
              <ul className="app-notifications__items">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-read={String(n.read)}
                      className="app-notifications__item app-notifications__item--icon"
                      onClick={async () => {
                        if (!n.read && scope.mode === 'client') {
                          const confirmed = await confirm({
                            title: 'Marcar notificação como lida',
                            message: `Marcar “${n.title}” como lida e abrir o conteúdo?`,
                            confirmLabel: 'Marcar como lida',
                            affected: { summary: `1 notificação: ${n.title}`, items: [n.message] },
                            consequence: 'A notificação deixa de contar como não lida. O estado da fatura ou disputa não muda.',
                            reversibility: 'Não há ação no Portal para marcar esta notificação novamente como não lida.',
                          })
                          if (!confirmed) return
                          await markRead.mutateAsync(n.id)
                        }
                        if (n.link?.startsWith('/portal')) navigate(readOnly ? n.link.replace(/^\/portal/, scope.basePath) : n.link)
                        setOpen(false)
                      }}
                    >
                      <span className="app-notifications__icon" aria-hidden="true">
                        {n.type === 'invoice_issued' || n.type === 'demurrage_issued' ? <FileText size={18} /> : n.type === 'dispute_responded' ? <MessageSquare size={18} /> : <Bell size={18} />}
                      </span>
                      <div className="app-notifications__body">
                        <span className="app-notifications__item-title">{n.title}</span>
                        <p className="app-notifications__message">{n.message}</p>
                        {formatDate(n.created_at) ? <div className="app-notifications__meta"><span>{formatDate(n.created_at)}</span></div> : null}
                      </div>
                      {!n.read ? (
                        <>
                          <span className="app-notifications__unread" aria-hidden="true" />
                          <span className="sr-only">Não lida</span>
                        </>
                      ) : <span aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
