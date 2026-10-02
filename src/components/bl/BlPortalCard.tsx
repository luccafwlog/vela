import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import type { BlPortalNotification, BlPortalVisibility } from '../../services/blPortalStatus'

export type BlPortalStatus = {
  visibility: BlPortalVisibility
  notifications: BlPortalNotification[]
  openDisputes: Array<{ id: number; doc_number: string | null; dispute_status: string | null }>
}

export function BlPortalCard({ status }: { status: BlPortalStatus }) {
  return (
    <Card className="h-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Portal</h3>
        <Badge tone={status.visibility.visible ? 'green' : 'yellow'}>
          {status.visibility.visible ? 'Visível no Portal' : 'Não visível no Portal'}
        </Badge>
      </div>
      {status.visibility.reasons.length ? (
        <ul className="mb-3 list-disc pl-5 text-sm text-[var(--app-muted)]">
          {status.visibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--app-muted)]">Notificações</dt>
          <dd className="mt-0.5 grid gap-1">
            {status.notifications.length ? status.notifications.map((notification) => (
              <span key={notification.id}>
                {notification.title} <span className="text-[var(--app-muted)]">({notification.read_at ? 'lida' : 'não lida'})</span>
              </span>
            )) : <span className="text-[var(--app-muted)]">Nenhuma</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--app-muted)]">Disputas abertas</dt>
          <dd className="mt-0.5 grid gap-1">
            {status.openDisputes.length ? status.openDisputes.map((dispute) => (
              <span key={dispute.id}>{dispute.doc_number ?? `#${dispute.id}`} — {dispute.dispute_status ?? 'aberta'}</span>
            )) : <span className="text-[var(--app-muted)]">Nenhuma</span>}
          </dd>
        </div>
      </dl>
    </Card>
  )
}
