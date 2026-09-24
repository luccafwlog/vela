import { isCustomerReconciliationResolved } from '../../services/customerReconciliation'
import { extractReviewReasons } from '../../hooks/useReview'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'
import type { BillingBlockCode } from './validacaoTypes'

// B/L reconciliado que ainda não é faturável: preso entre a conciliação de cliente
// e o "pronto faturar" (gate de revisão pendente, taxa em revisão ou apenas
// calculado aguardando marcação). Existe para o funil não "sumir" com esses B/Ls.
export function isPendingBillingReview(row: {
  customer_reconciliation_status: string | null
  financial_status: string | null
  charge_status: string | null
}) {
  return (
    isCustomerReconciliationResolved(row.customer_reconciliation_status) &&
    row.financial_status !== 'invoiced' &&
    row.charge_status !== 'ready_for_billing' &&
    row.charge_status !== 'exempt'
  )
}

// O gate de faturamento (ADR 0054, migrations 337/367/368) recusa a promoção a
// `ready_for_billing`, mas a recusa é uma exceção: o `UPDATE` de
// `billing_hold_reason` que a antecedia morria no rollback da mesma transação
// (por isso a 368 o removeu). O estado vivo das pendências canônicas é o que a
// `save_bl_review` grava em `notes`, e é dele que esta tela lê.
const PORTAL_PENDENCY = /acesso ao portal nao provisionado/i

// Portal é o único bloqueio que não se resolve no B/L — mora no cadastro do
// cliente e vale para todos os B/Ls dele. Por isso é o último da precedência:
// só responde pelo B/L quando é a única pendência aberta.
function isPortalOnlyPendency(row: { billing_hold_reason: string | null; notes: string | null }) {
  // `billing_hold_reason` gravado é hold próprio do B/L (reconciliação de
  // cliente, sem linhas faturáveis): nunca é "só o portal".
  if ((row.billing_hold_reason ?? '').trim()) return false
  const reasons = extractReviewReasons(row.notes)
  return reasons.length > 0 && reasons.every((reason) => PORTAL_PENDENCY.test(reason))
}

export function getBillingBlockReason(row: {
  charge_status: string | null
  financial_status: string | null
  review_status: string | null
  notes: string | null
  billing_hold_reason: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  charge_exemption_reason: string | null
  ce_mercante?: string | null
  cargo_mode?: string | null
  customer?: { id: number | null } | null
  totals: { total_brl: number; line_count: number; review_required_count: number }
}) {
  return getBillingBlock(row).detail
}

export function getBillingBlock(row: {
  charge_status: string | null
  financial_status: string | null
  review_status: string | null
  notes: string | null
  billing_hold_reason: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  charge_exemption_reason: string | null
  ce_mercante?: string | null
  cargo_mode?: string | null
  customer?: { id: number | null } | null
  totals: { total_brl: number; line_count: number; review_required_count: number }
}): { code: BillingBlockCode; label: string; detail: string } {
  if (row.cargo_mode === 'granito') {
    return {
      code: 'operacao_granito',
      label: 'Apoio operacional',
      detail: 'Granito fornece conferência de quantidades e não participa da emissão de invoices.',
    }
  }
  if (row.financial_status === 'invoiced') return { code: 'faturado', label: 'Faturado', detail: 'Fatura já emitida.' }
  if (row.charge_status === 'exempt') return { code: 'isento', label: 'Isento', detail: row.charge_exemption_reason ?? 'B/L isento de taxas locais.' }
  if (!row.customer?.id || !isCustomerReconciliationResolved(row.customer_reconciliation_status)) {
    return {
      code: 'sem_cliente',
      label: 'Sem cliente vinculado',
      detail: row.billing_hold_reason ?? row.customer_reconciliation_notes ?? 'Cliente não vinculado.',
    }
  }
  const portalOnly = isPortalOnlyPendency(row)
  // `pending_review` causado só pelo Portal não é problema de cálculo: as taxas
  // estão calculadas e conferíveis, e o que falta é o cliente poder ver a fatura.
  const hasCalculationIssue =
    (row.review_status === 'pending_review' && !portalOnly) ||
    row.totals.review_required_count > 0 ||
    row.totals.line_count === 0 ||
    Number(row.totals.total_brl ?? 0) <= 0
  if (hasCalculationIssue) {
    const reasons = extractReviewReasons(row.notes)
    return {
      code: 'calculo_incompleto',
      label: 'Cálculo incompleto',
      detail: row.billing_hold_reason ?? (reasons.length ? `Revisão pendente: ${reasons.join(', ')}` : row.totals.review_required_count > 0 ? 'Há linhas de taxa com revisão pendente.' : 'Sem linhas de taxa calculadas.'),
    }
  }
  if (row.billing_hold_reason) {
    return { code: 'calculo_incompleto', label: 'Cálculo incompleto', detail: row.billing_hold_reason }
  }
  // CE Mercante é exigido em todo modo faturável (ADR 0042; `assert_bl_ce_mercante`
  // no banco). Granito já saiu acima como apoio operacional.
  if (!row.ce_mercante?.trim()) {
    return { code: 'aguardando_ce', label: 'Aguardando CE Mercante', detail: 'Aguardando cadastro do CE Mercante para emitir a fatura.' }
  }
  if (portalOnly) {
    return {
      code: 'portal_nao_provisionado',
      label: 'Portal não provisionado',
      detail: 'Cliente sem acesso provisionado ao portal: a fatura não pode ser disponibilizada a quem deve pagá-la.',
    }
  }
  return { code: 'pronto', label: 'Pronto para emitir', detail: 'Pronto para emissão individual.' }
}

/* legacy callers use the detail-only API */
export function getLegacyBillingBlockReason(row: {
  charge_status: string | null
  financial_status: string | null
  review_status: string | null
  notes: string | null
  billing_hold_reason: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  charge_exemption_reason: string | null
  ce_mercante?: string | null
  cargo_mode?: string | null
  customer?: { id: number | null } | null
  totals: { total_brl: number; line_count: number; review_required_count: number }
}) {
  if (row.cargo_mode === 'granito') return 'Granito e apoio operacional; nao participa da emissao de invoices.'
  if (row.financial_status === 'invoiced') return 'Fatura ja emitida.'
  if (row.billing_hold_reason) return row.billing_hold_reason
  if (!row.customer?.id) return 'Cliente nao vinculado.'
  if (!isCustomerReconciliationResolved(row.customer_reconciliation_status)) {
    return row.customer_reconciliation_notes ?? 'Conciliação de cliente pendente.'
  }
  if (row.review_status === 'pending_review') {
    const reasons = extractReviewReasons(row.notes)
    return reasons.length ? `Revisão pendente: ${reasons.join(', ')}` : 'Revisão pendente antes do faturamento.'
  }
  if (row.charge_status === 'exempt') return row.charge_exemption_reason ?? 'B/L isento de taxas locais.'
  if (row.totals.review_required_count > 0) return 'Ha linhas de taxa com revisao pendente.'
  if (row.totals.line_count === 0 || Number(row.totals.total_brl ?? 0) <= 0) return 'Sem linhas de taxa calculadas.'
  if (row.charge_status !== 'ready_for_billing') return 'Ainda nao marcado como pronto para faturar.'
  return 'Pronto para emissao individual.'
}

// Etapa 2 do plano de faturamento (ADR 0038, achado 6): recalculo em lote nunca
// toca B/L ja faturado — o RPC recusaria, e contar isso como erro genérico
// esconde que a causa é a fatura já emitida, não uma falha.
export const isBlLockedForRecalc = isBlFinanciallyLocked

// Etapa 6 do plano de faturamento (ADR 0038, decisão 8): motivo mais comum de
// um B/L faturável ficar provisório depois que a promoção automática saiu
// (migration 263) — já calculado e reconciliado, mas sem CE Mercante, então
// reviewBillingAutomation.ts bloqueia só a emissão (não mais o cálculo).
export function isAwaitingCeMercante(row: {
  cargo_mode: string | null
  financial_status: string | null
  ce_mercante: string | null
  charge_status: string | null
  customer_reconciliation_status: string | null
}) {
  return (
    (row.cargo_mode ?? 'container') !== 'granito' &&
    (row.financial_status ?? 'pending') === 'pending' &&
    !row.ce_mercante?.trim() &&
    // Achado 9 da review da PR 501: sem isto o card "Aguardando CE" contava
    // TODO o backlog aberto de container (ate B/Ls ainda sem taxa calculada
    // ou sem cliente reconciliado), nao especificamente quem esta parado
    // esperando CE Mercante. Exige que o B/L ja tenha passado da conciliação
    // e do cálculo (isto é, o CE Mercante seja de fato o único bloqueio
    // restante para a emissão), igual à premissa de reviewBillingAutomation.ts.
    isCustomerReconciliationResolved(row.customer_reconciliation_status) &&
    row.charge_status !== 'exempt' &&
    row.charge_status !== 'not_calculated'
  )
}
