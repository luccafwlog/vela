// Mapa central de códigos de status -> labels pt-BR exibidos na UI.
// Nunca exiba o código cru (ex: PENDING_REVIEW) para o usuário; use estes
// helpers e caia no próprio código apenas como último recurso.
import type { EstadoConciliacao } from '../services/voyageSummaries'
import type { BadgeTone } from '../components/ui/Badge'

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  pending_review: 'Pendente',
  reviewed: 'Revisado',
}

export const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  cancelled: 'Cancelado',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  issued: 'Emitida',
  partially_paid: 'Parcialmente paga',
  paid: 'Paga',
  covered: 'Coberta',
  obsolete: 'Obsoleta',
  cancelled: 'Cancelada',
}

// Demurrage fala "Faturado" onde o faturamento local fala "Emitida"; sao dominios
// distintos e a UI de cada um mantem o proprio vocabulario. Mapa unico para badge,
// filtro e exportacao nao divergirem entre si.
export const DEMURRAGE_INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  issued: 'Faturado',
  paid: 'Pago',
  cancelled: 'Cancelado',
}

export const VOYAGE_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

export function statusLabel(map: Record<string, string>, status: string | null | undefined, fallback = '-') {
  if (!status) return fallback
  return map[status] ?? status
}

export function simNao(value: boolean) {
  return value ? 'SIM' : 'NÃO'
}

// Fonte única de metadados do estado de conciliação. As cores referenciam
// variáveis CSS (--app-*) para respeitar o tema dark. O campo `badgeTone`
// permite usar o componente <Badge> diretamente; `color`/`bg` atendem os
// estilos inline do banner de conciliação do VoyageCard.
export const ESTADO_CONCILIACAO_META: Record<
  EstadoConciliacao,
  { label: string; color: string; bg: string; badgeTone: BadgeTone }
> = {
  divergente: {
    label: 'Divergente',
    color: 'var(--app-red)',
    bg: 'var(--app-red-soft)',
    badgeTone: 'red',
  },
  incompleto: {
    label: 'Pendente',
    color: 'var(--app-gold)',
    bg: 'var(--app-gold-soft)',
    badgeTone: 'yellow',
  },
  conciliado: {
    label: 'Conciliado',
    color: 'var(--app-green)',
    bg: 'var(--app-green-soft)',
    badgeTone: 'green',
  },
}

export const VOYAGE_STATUS_BADGE_TONE: Record<string, BadgeTone> = {
  active: 'blue',
  completed: 'green',
  cancelled: 'red',
}
