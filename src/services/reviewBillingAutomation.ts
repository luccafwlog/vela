import { markBlReadyAndCreateInvoice } from './billing'
import {
  calculateBlLocalCharges,
  type LocalChargeCalculationResult,
} from './charges/chargeOperationsService'
import { logOperationalEvent } from './operationalEvents'
import { createAlert, resolveAlertItem } from './alerts'
import { supabase } from './supabase'
import { isCustomerReconciliationResolved } from './customerReconciliation'

export type ReviewBillingAutomationResult =
  | { status: 'invoiced'; invoiceResult: unknown }
  | {
      status: 'blocked'
      message: string
      reason: 'calculation_blocked' | 'rpc_error' | 'awaiting_flow'
      calculation?: LocalChargeCalculationResult
      unexpected?: boolean
      stage?: 'lookup' | 'calculation' | 'emission'
    }

type BillingAttemptBl = {
  ce_mercante: string | null
  cargo_mode: string | null
  customer_id: number | null
  customer_reconciliation_status: string | null
  review_status: string | null
  billing_hold_reason: string | null
  charge_status: string | null
  financial_status: string | null
}

type CalculationBlockReason = 'review:no_table' | 'pending_review' | 'invalid_lines' | 'billing_hold_reason' | 'no_billable_value'

type CalculationBlock = {
  reason: CalculationBlockReason
  message: string
}

function hasInvalidCalculationLines(calculation: LocalChargeCalculationResult) {
  const totals = [calculation.total_brl, calculation.total_usd]
  return calculation.line_count < 0
    || totals.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)
    || /(linha|line).*(inválid|invalid)|review:(?:weight_missing|unsupported_basis|thd_any_profile|no_containers|imo_oog_thd)/i.test(calculation.reason)
}

function isKnownCalculationStatus(status: LocalChargeCalculationResult['status']) {
  return ['calculated', 'review_required', 'reviewed', 'ready_for_billing', 'exempt'].includes(status)
}

function hasAuthoritativeCalculationState(bl: BillingAttemptBl, calculation: LocalChargeCalculationResult) {
  return isKnownCalculationStatus(calculation.status)
    || calculation.exempt
    || /review:no_table/i.test(calculation.reason)
    || calculation.review_required
    || bl.charge_status === 'review_required'
    || Boolean(bl.billing_hold_reason?.trim())
}

function isCustomerReviewFlow(bl: BillingAttemptBl, calculation: LocalChargeCalculationResult) {
  const text = `${calculation.reason} ${bl.billing_hold_reason ?? ''}`.toLowerCase()
  if (/peso\s+bb|bb_weight|pend[eê]ncia de revis[aã]o operacional/.test(text)) return true
  return bl.review_status === 'pending_review'
    && /cliente|reconcil|portal|e-?mail|consignat/.test(text)
}

function isCustomerReconciliationReview(bl: BillingAttemptBl) {
  return bl.review_status === 'pending_review'
    && /cliente|reconcil|portal|e-?mail|consignat/.test((bl.billing_hold_reason ?? '').toLowerCase())
}

function calculationBlockReason(
  bl: BillingAttemptBl,
  calculation: LocalChargeCalculationResult,
): CalculationBlockReason {
  if (/review:no_table/i.test(calculation.reason)) return 'review:no_table'
  if (hasInvalidCalculationLines(calculation)) return 'invalid_lines'
  if (bl.billing_hold_reason?.trim()) return 'billing_hold_reason'
  return 'pending_review'
}

function getCalculationBlock(
  bl: BillingAttemptBl,
  customerId: number | null,
  calculation: LocalChargeCalculationResult,
): CalculationBlock | null {
  // Cliente ausente/reconciliação pendente é propriedade do fluxo #520.
  // Não duplicar a pendência de revisão como bloqueio financeiro.
  if (!customerId || !bl.customer_id || !isCustomerReconciliationResolved(bl.customer_reconciliation_status)) return null
  if (calculation.exempt || calculation.status === 'exempt') return null

  const calculationReason = calculation.reason.trim()
  if (isCustomerReviewFlow(bl, calculation)) return null
  if (/review:no_table/i.test(calculationReason)) {
    return { reason: 'review:no_table', message: calculationReason || 'Tabela de taxas locais ausente ou inválida.' }
  }
  if (hasInvalidCalculationLines(calculation)) {
    return { reason: 'invalid_lines', message: calculationReason || 'Há linhas de taxa inválidas.' }
  }
  if (bl.billing_hold_reason?.trim()) {
    return { reason: 'billing_hold_reason', message: bl.billing_hold_reason }
  }
  if (calculation.review_required || calculation.status === 'review_required') {
    return { reason: calculationBlockReason(bl, calculation), message: calculationReason || 'Há uma pendência persistida no cálculo das taxas locais.' }
  }
  if (['calculated', 'reviewed', 'ready_for_billing'].includes(calculation.status)
    && Number(calculation.total_brl ?? 0) <= 0
    && Number(calculation.total_usd ?? 0) <= 0) {
    return { reason: 'no_billable_value', message: 'B/L sem valor faturavel apos recalculo.' }
  }

  // Peso BB e outras pendências previstas da revisão retornam para o fluxo
  // operacional sem produzir A2.
  return null
}

function calculationAlertMetadata(
  bl: BillingAttemptBl,
  calculation: LocalChargeCalculationResult,
  reason: CalculationBlockReason,
) {
  const correctionRoute = reason === 'review:no_table' || /review:no_table/i.test(calculation.reason)
    ? '/taxas-locais/tabelas'
    : '/taxas-locais'
  return {
    source: 'authoritative_local_calculation',
    correction_route: correctionRoute,
    reason,
    calculation_status: calculation.status,
    table_id: calculation.table_id,
    line_count: calculation.line_count,
    total_brl: calculation.total_brl,
    total_usd: calculation.total_usd,
    review_status: bl.review_status,
    billing_hold_reason: bl.billing_hold_reason,
    persisted_charge_status: bl.charge_status,
    persisted_billing_hold_reason: bl.billing_hold_reason,
  }
}

async function loadBillingAttemptBl(blId: string) {
  return supabase
    .from('bls')
    .select('ce_mercante, cargo_mode, customer_id, customer_reconciliation_status, review_status, billing_hold_reason, charge_status, financial_status')
    .eq('id', blId)
    .single()
}

export async function tryAutoIssueInvoice({
  blId,
  customerId,
  actorId,
}: {
  blId: string
  customerId: number
  actorId: string | null
}): Promise<ReviewBillingAutomationResult> {
  const { data: blData, error: blError } = await loadBillingAttemptBl(blId)
  if (blError) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: blError instanceof Error ? blError.message : 'Falha ao consultar o B/L para calcular taxas locais.',
      unexpected: true,
      stage: 'lookup',
    }
  }

  const bl = (blData ?? {}) as Partial<BillingAttemptBl>
  const attemptBl: BillingAttemptBl = {
    ce_mercante: bl.ce_mercante ?? null,
    cargo_mode: bl.cargo_mode ?? null,
    customer_id: bl.customer_id ?? null,
    customer_reconciliation_status: bl.customer_reconciliation_status ?? null,
    review_status: bl.review_status ?? null,
    billing_hold_reason: bl.billing_hold_reason ?? null,
    charge_status: bl.charge_status ?? null,
    financial_status: bl.financial_status ?? null,
  }

  // O banco agora é a autoridade do gatilho CE -> cálculo -> invoice. O
  // callback da tela de Revisão pode chegar depois da transação e deve apenas
  // reconhecer a emissão já concluída, sem recalcular nem criar alerta falso.
  if (['invoiced', 'partially_paid', 'paid'].includes(attemptBl.financial_status ?? '')) {
    return {
      status: 'invoiced',
      invoiceResult: { idempotent: true, financial_status: attemptBl.financial_status },
    }
  }
  if (!customerId || !attemptBl.customer_id || !isCustomerReconciliationResolved(attemptBl.customer_reconciliation_status)) {
    return { status: 'blocked', reason: 'awaiting_flow', message: 'Aguardando vínculo e reconciliação do cliente.' }
  }
  if (isCustomerReconciliationReview(attemptBl)) {
    return { status: 'blocked', reason: 'awaiting_flow', message: 'Aguardando conclusão da revisão de cliente.' }
  }

  let calculation: LocalChargeCalculationResult
  try {
    calculation = await calculateBlLocalCharges(blId, { actorId, recalculate: true })
  } catch (error) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: error instanceof Error ? error.message : 'Falha ao calcular taxas locais.',
      unexpected: true,
      stage: 'calculation',
    }
  }

  // O RPC grava charge_status/billing_hold_reason durante a tentativa. O
  // snapshot anterior ao RPC não é suficiente para decidir se houve uma
  // pendência financeira real.
  const { data: persistedBlData, error: persistedBlError } = await loadBillingAttemptBl(blId)
  if (persistedBlError) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: persistedBlError instanceof Error ? persistedBlError.message : 'Falha ao confirmar o estado do cálculo local.',
      calculation,
      unexpected: true,
      stage: 'calculation',
    }
  }
  const persistedBl = (persistedBlData ?? {}) as Partial<BillingAttemptBl>
  const authoritativeBl: BillingAttemptBl = {
    ...attemptBl,
    ce_mercante: persistedBl.ce_mercante ?? attemptBl.ce_mercante,
    cargo_mode: persistedBl.cargo_mode ?? attemptBl.cargo_mode,
    customer_id: persistedBl.customer_id ?? attemptBl.customer_id,
    customer_reconciliation_status: persistedBl.customer_reconciliation_status ?? attemptBl.customer_reconciliation_status,
    review_status: persistedBl.review_status ?? attemptBl.review_status,
    billing_hold_reason: persistedBl.billing_hold_reason ?? attemptBl.billing_hold_reason,
    charge_status: persistedBl.charge_status ?? attemptBl.charge_status,
    financial_status: persistedBl.financial_status ?? attemptBl.financial_status,
  }

  // O cálculo pode ter corrido em paralelo com o trigger server-side do CE.
  // Reconheça a emissão observada na releitura antes de tentar qualquer RPC
  // manual, evitando segunda invoice e alerta falso de falha.
  if (['invoiced', 'partially_paid', 'paid'].includes(authoritativeBl.financial_status ?? '')) {
    return {
      status: 'invoiced',
      invoiceResult: { idempotent: true, financial_status: authoritativeBl.financial_status },
    }
  }

  if (!hasAuthoritativeCalculationState(authoritativeBl, calculation)) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: 'Resultado de cálculo local desconhecido; emissão não tentada.',
      calculation,
      unexpected: true,
      stage: 'calculation',
    }
  }

  const calculationBlock = getCalculationBlock(authoritativeBl, customerId, calculation)
  if (calculationBlock) {
    await createAlert({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: blId,
      message: calculationBlock.message,
      metadata: calculationAlertMetadata(authoritativeBl, calculation, calculationBlock.reason),
    })
    return { status: 'blocked', reason: 'calculation_blocked', message: calculationBlock.message, calculation }
  }

  if (calculation.review_required || calculation.status === 'review_required') {
    return { status: 'blocked', reason: 'awaiting_flow', message: calculation.reason || 'Taxas locais ainda possuem pendencia de revisao.', calculation }
  }

  if (calculation.exempt || calculation.status === 'exempt') {
    await resolveAlertItem({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: blId,
      source: 'billing_calculation',
      metadata: { resolution: 'exemption_valid', correction_route: '/taxas-locais' },
    })
    return { status: 'blocked', reason: 'awaiting_flow', message: 'B/L isento de taxas locais.', calculation }
  }

  await resolveAlertItem({
    type: 'billing_calculation_blocked',
    entityType: 'bl',
    entityId: blId,
    source: 'billing_calculation',
    metadata: { resolution: 'calculation_valid', correction_route: '/taxas-locais' },
  })

  // O CE Mercante não é necessário para calcular, mas continua exigido para
  // emitir — a invoice precisa do documento em qualquer modalidade de carga.
  if (!authoritativeBl.ce_mercante?.trim()) {
    return { status: 'blocked', reason: 'awaiting_flow', message: 'Aguardando cadastro do CE Mercante para emitir a fatura (ADR 0020).', calculation }
  }

  let invoiceResult: unknown
  try {
    invoiceResult = await markBlReadyAndCreateInvoice({
      blId,
      customerId,
      actorId,
    })
  } catch (error) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: error instanceof Error ? error.message : 'Falha ao gerar invoice automatica.',
      unexpected: true,
      stage: 'emission',
    }
  }

  await resolveAlertItem({
    type: 'billing_auto_issue_failed',
    entityType: 'bl',
    entityId: blId,
    source: 'ce_auto_billing',
  })

  return { status: 'invoiced', invoiceResult }
}

export async function maybeAutoBillAfterCeMercante(blId: string, actorId: string | null) {
  const { data, error } = await supabase
    .from('bls')
    .select('id, voyage_id, customer_id, customer_reconciliation_status, cargo_mode, financial_status')
    .eq('id', blId)
    .single()
  if (error) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: error instanceof Error ? error.message : 'Falha ao consultar o B/L para o auto faturamento.',
      unexpected: true,
      stage: 'lookup',
    }
  }

  const bl = data as {
    id: string
    voyage_id?: number | null
    customer_id: number | null
    customer_reconciliation_status: string | null
    cargo_mode: string | null
    financial_status: string | null
  } | null

  if (!bl?.customer_id || !isCustomerReconciliationResolved(bl.customer_reconciliation_status)) return null
  const cargoMode = bl.cargo_mode ?? 'container'
  if (cargoMode !== 'container' && cargoMode !== 'carga_solta' && cargoMode !== '') return null

  // Reimport de CE em B/L ja faturado e no-op benigno: create_invoice_from_bls_core
  // recusaria a segunda fatura. Registramos como info e nao tentamos refaturar.
  if ((bl.financial_status ?? 'pending') !== 'pending') {
    await logOperationalEvent({
      code: 'ce_reimport_already_invoiced',
      message: `Reimport de CE Mercante em B/L ja faturado (${bl.financial_status}); refaturamento ignorado.`,
      changedBy: actorId,
      entityId: bl.id,
      context: { source: 'ce_auto_billing', financial_status: bl.financial_status },
    })
    return null
  }

  const result = await tryAutoIssueInvoice({ blId: bl.id, customerId: bl.customer_id, actorId })
  if (result.status === 'blocked' && result.reason === 'rpc_error' && result.stage === 'emission') {
    await createAlert({
      type: 'billing_auto_issue_failed',
      entityType: 'bl',
      entityId: bl.id,
      message: result.message,
      metadata: { source: 'local_invoice_emission', correction_route: '/taxas-locais', failure_stage: 'emission' },
    })
    await logOperationalEvent({
      code: 'bl_auto_billing_failed',
      message: result.message,
      changedBy: actorId,
      entityId: bl.id,
      context: { source: 'ce_auto_billing' },
    })
  }
  return result
}
