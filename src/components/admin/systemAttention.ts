import { formatBrasiliaDateTime } from './auditLogPresentation'
import { departmentLabel } from '../../lib/departmentLabel'
import { routineLabel } from '../../lib/systemRoutines'
import type { SystemHealth } from '../../services/adminObservability'

/** Leitura do Pix Itaú parada há mais que isto vira ponto de atenção (a rotina roda a cada minuto). */
const PIX_STALE_MINUTES = 30

export type Attention = { key: string; text: string; action?: { label: string; to: string } }

/**
 * O que pede ação agora. Cada item aparece só quando acontece; vazio, o bloco
 * diz "Nada pede atenção" e lista o que foi conferido.
 */
export function systemAttentionItems(health: SystemHealth, now: Date = new Date()): Attention[] {
  const items: Attention[] = []
  for (const role of health.teams_without_active) {
    items.push({ key: `team:${role}`, text: `${departmentLabel(role)} sem nenhuma pessoa ativa: os alertas dessa equipe não têm a quem avisar.`, action: { label: 'Abrir Usuários', to: '/admin/usuarios' } })
  }
  if (health.alert_failures_30d > 0) {
    items.push({ key: 'alerts', text: `${health.alert_failures_30d} ${health.alert_failures_30d === 1 ? 'alerta não chegou' : 'alertas não chegaram'} a ninguém nos últimos 30 dias (lista abaixo, em Falhas de entrega de alertas).` })
  }
  if (health.routines_failing.length) {
    items.push({ key: 'routines', text: `A última execução falhou: ${health.routines_failing.map(routineLabel).join(', ')}.` })
  }
  if (health.pix_provider === 'itau') {
    const polled = health.pix_polled_until ? new Date(health.pix_polled_until) : null
    if (!polled || now.getTime() - polled.getTime() > PIX_STALE_MINUTES * 60_000) {
      items.push({ key: 'pix', text: polled ? `A leitura do Pix Itaú está parada desde ${formatBrasiliaDateTime(health.pix_polled_until!)}.` : 'A leitura do Pix Itaú ainda não rodou.' })
    }
  }
  if (health.suppressed_emails > 0) {
    items.push({ key: 'emails', text: `${health.suppressed_emails} ${health.suppressed_emails === 1 ? 'e-mail bloqueado' : 'e-mails bloqueados'} por devolução ou spam: o Vela não envia para ${health.suppressed_emails === 1 ? 'ele' : 'eles'}.` })
  }
  if (health.holidays_next_year === 0) {
    items.push({ key: 'holidays', text: `Faltam os feriados de ${health.next_year} de Vitória/ES, que contam no prazo da Demurrage. Peça ao suporte técnico.` })
  }
  return items
}

