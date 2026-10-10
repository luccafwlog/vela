import { formatDateTime } from '../../lib/utils'

const CALLOUT_TITLE: Record<string, string> = {
  operacao_granito: 'Escopo da operação',
  faturado: 'Situação da fatura',
  isento: 'Situação da fatura',
  pronto: 'Situação da fatura',
}

// O detalhe do bloco descreve tanto impedimentos quanto estados finais (pronto,
// faturado, isento). Rotular tudo como "Por que não fatura?" em amarelo faz um
// B/L pronto parecer bloqueado — por isso o título e o tom seguem o código.
export function calloutTitle(code: string) {
  return CALLOUT_TITLE[code] ?? 'Por que não fatura?'
}

export function calloutTone(code: string) {
  if (CALLOUT_TITLE[code]) {
    return {
      body: 'border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text-strong)]',
      title: 'text-[var(--app-muted)]',
    }
  }
  return { body: 'border-[var(--app-warning-border)] bg-[var(--app-warning-bg)] text-[var(--app-text)]', title: 'text-[var(--app-warning-fg)]' }
}

const AUDIT_FIELD_LABEL: Record<string, string> = {
  charge_status: 'Status das taxas',
  financial_status: 'Status financeiro',
  review_status: 'Status de revisão',
  customer_id: 'Cliente vinculado',
  ce_mercante: 'CE Mercante',
  ncm_codes: 'Códigos NCM',
  billing_hold_reason: 'Motivo de bloqueio',
  last_billing_run_id: 'Execução de faturamento',
  deleted: 'Exclusão',
  notes: 'Observações',
}

// ponytail: mapa curto + fallback humanizado. O `field_name` da auditoria é
// aberto (qualquer coluna auditada entra), então nomes fora do mapa aparecem
// com underscores trocados por espaço em vez de virarem "-".
export function describeLastEvent(trail: {
  last_event_at: string | null
  last_event_field: string | null
}) {
  if (!trail.last_event_at && !trail.last_event_field) return 'Nenhum evento registrado.'
  const raw = (trail.last_event_field ?? '').trim()
  const label = raw ? (AUDIT_FIELD_LABEL[raw] ?? raw.replace(/_/g, ' ')) : 'Evento sem campo identificado'
  const when = trail.last_event_at ? formatDateTime(trail.last_event_at) : 'data desconhecida'
  return `${label} · ${when}`
}
