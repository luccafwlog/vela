import type { ReactNode } from 'react'
import { Block, Fact, FactList, LeadValue } from '../ui/Block'
import type { BlPortalNotification, BlPortalVisibility } from '../../services/blPortalStatus'

export type BlPortalStatus = {
  visibility: BlPortalVisibility
  notifications: BlPortalNotification[]
  openDisputes: Array<{ id: number; doc_number: string | null; dispute_status: string | null }>
}

/**
 * Bloco Portal da ficha do B/L (ADR 0081): o dado principal diz se o Cliente
 * vê o B/L; o motivo, os avisos e as disputas são apoio. "Nenhum" e "Nenhuma"
 * são zero conhecido e ficam escritos. `children` recebe as ações (convite).
 */
export function BlPortalCard({ status, children }: { status: BlPortalStatus; children?: ReactNode }) {
  const visible = status.visibility.visible
  const reasons = status.visibility.reasons
  return (
    <Block title="Portal">
      <LeadValue tone={visible ? 'default' : 'danger'} detail={reasons.length === 1 ? reasons[0] : null}>
        {visible ? 'Visível no Portal' : 'Não visível no Portal'}
      </LeadValue>
      {reasons.length > 1 ? (
        <ul className="app-bl-portal__reasons" aria-label="Por que não aparece">
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      <FactList>
        <Fact label="Avisos ao Cliente">
          {status.notifications.length ? (
            <ul className="app-bl-portal__list">
              {status.notifications.map((notification) => (
                <li key={notification.id}>
                  {notification.title} <span className="app-facts__detail">{notification.read_at ? 'lida' : 'não lida'}</span>
                </li>
              ))}
            </ul>
          ) : 'Nenhum'}
        </Fact>
        <Fact label="Disputas abertas">
          {status.openDisputes.length ? (
            <ul className="app-bl-portal__list">
              {status.openDisputes.map((dispute) => (
                <li key={dispute.id}>{dispute.doc_number ?? `#${dispute.id}`} <span className="app-facts__detail">{dispute.dispute_status ?? 'aberta'}</span></li>
              ))}
            </ul>
          ) : 'Nenhuma'}
        </Fact>
      </FactList>
      {children}
    </Block>
  )
}
