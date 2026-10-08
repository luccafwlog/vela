import { CheckCircle2, EyeOff } from 'lucide-react'
import { Card } from '../ui/Card'
import type { BlPortalNotification, BlPortalVisibility } from '../../services/blPortalStatus'

export type BlPortalStatus = {
  visibility: BlPortalVisibility
  notifications: BlPortalNotification[]
  openDisputes: Array<{ id: number; doc_number: string | null; dispute_status: string | null }>
}

/**
 * O que o Cliente vê deste B/L no Portal: se aparece, por que não aparece,
 * avisos enviados e disputas abertas. Estado em texto com ícone, não só cor.
 */
export function BlPortalCard({ status, embedded = false }: { status: BlPortalStatus; embedded?: boolean }) {
  const visible = status.visibility.visible
  const body = (
    <div className="app-bl-portal">
      <div className="app-bl-section-head">
        <h2 className="app-bl-section-title">Portal</h2>
      </div>
      <p className={`app-bl-portal__state app-bl-tone--${visible ? 'success' : 'warning'}`}>
        {visible ? <CheckCircle2 size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
        {visible ? 'Visível no Portal' : 'Não visível no Portal'}
      </p>
      {status.visibility.reasons.length ? (
        <ul className="app-bl-portal__reasons" aria-label="Por que não aparece">
          {status.visibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      <dl className="app-bl-facts">
        <div className="app-bl-facts__item">
          <dt>Avisos ao Cliente</dt>
          <dd>
            {status.notifications.length ? (
              <ul className="app-bl-portal__list">
                {status.notifications.map((notification) => (
                  <li key={notification.id}>
                    {notification.title} <span className="app-bl-facts__sub">· {notification.read_at ? 'lida' : 'não lida'}</span>
                  </li>
                ))}
              </ul>
            ) : <span className="app-bl-facts__missing">Nenhum</span>}
          </dd>
        </div>
        <div className="app-bl-facts__item">
          <dt>Disputas abertas</dt>
          <dd>
            {status.openDisputes.length ? (
              <ul className="app-bl-portal__list">
                {status.openDisputes.map((dispute) => (
                  <li key={dispute.id}>{dispute.doc_number ?? `#${dispute.id}`} <span className="app-bl-facts__sub">· {dispute.dispute_status ?? 'aberta'}</span></li>
                ))}
              </ul>
            ) : <span className="app-bl-facts__missing">Nenhuma</span>}
          </dd>
        </div>
      </dl>
    </div>
  )
  return embedded ? body : <Card>{body}</Card>
}
