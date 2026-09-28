import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, FileText, MessageSquare } from 'lucide-react'
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
  const { data: notifications, isLoading } = usePortalNotifications(open)
  const { data: unreadCount = 0 } = usePortalUnreadCount()
  const markRead = usePortalMarkRead()
  const markAllRead = usePortalMarkAllRead()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
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
      if (e.key === 'Escape') setOpen(false)
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

  return (
    <div ref={containerRef} className="portal-notifications">
      <button
        type="button"
        className="portal-notifications__trigger"
        onClick={() => setOpen(!open)}
        aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--app-red)] px-1 text-[10px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div role="menu" aria-label="Notificações" className="portal-notifications__panel">
          <div className="portal-notifications__header">
            <span className="portal-notifications__title">Notificações</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="portal-notifications__mark-all"
                onClick={handleMarkAllRead}
                disabled={readOnly}
                title={readOnly ? 'Ação do cliente — indisponível em Modo Inspeção' : undefined}
              >
                Marcar todas como lidas
              </button>
            ) : null}
          </div>

          <div className="portal-notifications__list">
            {isLoading ? (
              <div className="portal-notifications__state">Carregando notificações…</div>
            ) : (notifications ?? []).length === 0 ? (
              <div className="portal-notifications__state">Você não tem novas notificações.</div>
            ) : (
              (notifications ?? []).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  data-read={String(n.read)}
                  className="portal-notifications__item"
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
                  <span className="portal-notifications__icon" aria-hidden="true">
                    {n.type === 'invoice_issued' || n.type === 'demurrage_issued' ? <FileText size={18} /> : n.type === 'dispute_responded' ? <MessageSquare size={18} /> : <Bell size={18} />}
                  </span>
                  <div>
                    <div className="portal-notifications__item-title">{n.title}</div>
                    <div className="portal-notifications__message">{n.message}</div>
                    {formatDate(n.created_at) ? <div className="portal-notifications__date">{formatDate(n.created_at)}</div> : null}
                  </div>
                  {!n.read ? <span className="portal-notifications__unread" aria-label="Não lida" /> : <span />}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
