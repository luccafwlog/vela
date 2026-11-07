// Rodada do customer-communication-auto-runner sem dependência remota, para o
// teste com envio falso rodar no Vitest. O index.ts autentica e injeta o
// cliente Supabase e o envio (_shared/customerCommunicationDispatch.ts).
import { telemetryFailureHeaders } from '../../../src/lib/telemetryContract.ts'
import { renderCustomerCommunicationTemplate } from './customerCommunicationTemplates.ts'

export type AutoRunnerCandidate = {
  claim_key?: string
  kind: 'aviso_chegada_noa' | 'aviso_prontidao_nor' | 'aviso_atracacao_nob' | 'ce_mercante_taxas'
  nature?: 'avisos_operacionais' | 'documentacao'
  customer_id: number
  customer_name: string
  customer_cnpj: string
  voyage_id: number
  vessel_name: string
  voyage_number: string
  port: string
  milestone_at: string
  bl_ids: string[]
  /** Só os destinatários do alvo que ainda não receberam (migration 318). */
  emails: string[]
  /** Só no NOB: identidade da Atracação e do terminal que a hospeda. */
  anchor_atracacao_id?: string | null
  terminal_id?: string | null
  terminal_name?: string | null
}

export type AutoRunnerRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>

/** Corpo devolvido pelo envio de um destinatário (_shared/customerCommunicationDispatch.ts). */
export type AutoRunnerDispatchResult = { status: number; body: Record<string, unknown> | null }

export type AutoRunnerDeps = {
  rpc: AutoRunnerRpc
  /**
   * Envio de um destinatário no mesmo processo. Até 07/11/2026 a rodada fazia
   * um POST à Edge send-customer-communication por destinatário, e a Supabase
   * recusou da 31ª chamada em diante (limite de chamadas entre Edge Functions).
   */
  dispatch: (payload: Record<string, unknown>) => Promise<AutoRunnerDispatchResult>
  portalUrl?: string
  asOf?: Date
  /** Teto da rodada; o que passar dele fica para a rodada seguinte. */
  budget?: AutoRunnerBudget
  /** Relógio em ms, para o teste do teto de tempo. */
  now?: () => number
}

export type AutoRunnerBudget = {
  /** Destinatários que a rodada começa a enviar. */
  maxRecipients: number
  /** Depois deste tempo desde o início, a rodada não começa outro envio. */
  maxMillis: number
}

// ponytail: teto fixo por rodada, sem medir a CPU. A Edge tem 2 s de CPU por
// execução e o pg_net desiste da chamada em 30 s (migration 165); cada envio no
// mesmo processo gasta CPU desta execução (consultas, modelo, hash). 50
// destinatários ou 15 s por rodada deixam folga nos dois; o resto sai na rodada
// seguinte, 2 min depois, então 50 por rodada são até 1.500 por hora. Caminho
// de melhoria: medir a CPU da rodada e subir o teto, ou levar o envio para uma
// fila (Supabase Queues).
export const DEFAULT_AUTO_RUNNER_BUDGET: AutoRunnerBudget = { maxRecipients: 50, maxMillis: 15_000 }

export type AutoRunnerResult = {
  status: number
  body: {
    error?: string
    candidates?: number
    sent?: Array<{ kind: string; customerId: number; emails: number }>
    /** Destinatários recusados ou com falha na rodada; o heartbeat fica vermelho com > 0. */
    failed?: number
    releaseFailures?: number
    /**
     * Destinatários que a rodada não chegou a enviar (teto da rodada ou limite
     * da plataforma) e voltam na rodada seguinte. Não é falha: o heartbeat não
     * fica vermelho por eles.
     */
    nextRound?: number
    /** Por que a rodada parou antes do fim. */
    paused?: RoundPause
  }
  /** Marcação de telemetria do 500 (telemetryFailureHeaders): código e RPC, sem a mensagem. */
  headers?: Record<string, string>
}

// `reason`: motivo técnico da tentativa no 502 do provedor ("HTTP 422 validation_error", "Tempo esgotado…").
type DispatchResponse = { status?: string; suppressed?: boolean; permanent?: boolean; error?: string; reason?: string }

type RoundPause = 'teto_da_rodada' | 'limite_da_plataforma'

/**
 * Recusa da própria Supabase, não do envio (Deno.errors.RateLimitError, que
 * hoje só vem de chamada entre Edge Functions). A rodada para e o resto volta
 * na seguinte, sem contar falha.
 */
export function isPlatformRateLimit(error: unknown): boolean {
  return error instanceof Error && error.name === 'RateLimitError'
}

/**
 * Desfecho da claim depois da rodada (plano dos e-mails, 1D; D18):
 * - complete: todos os destinatários resolvidos; zera a contagem e fecha o
 *   alerta comunicado_recusado do Cliente;
 * - reject: recusa definitiva (código, payload ou provedor com
 *   falha_permanente); a produtora não retoma por 24 h;
 * - defer: recusa que pode mudar. Volta em 15 min, 1 h e depois a cada 6 h; o
 *   alerta abre na 1ª recusa por dado ou na 3ª falha seguida do provedor;
 * - release: sem destinatário (a produtora já não manda este caso), ou envio
 *   que a rodada não chegou a fazer (teto da rodada ou limite da plataforma):
 *   a produtora devolve a claim na rodada seguinte, sem intervalo e sem contar
 *   tentativa.
 */
type ClaimSettlement =
  | { action: 'complete' }
  | { action: 'reject'; reason?: string }
  | { action: 'defer'; reason?: string; providerFailure: boolean }
  | { action: 'release' }

const SETTLE_RPC: Record<ClaimSettlement['action'], string> = {
  complete: 'complete_customer_communication_automation_claim',
  reject: 'reject_customer_communication_automation_claim',
  defer: 'defer_customer_communication_automation_claim',
  release: 'release_customer_communication_automation_claim',
}

async function settleClaim(rpc: AutoRunnerRpc, claimKey: string | undefined, settlement: ClaimSettlement): Promise<boolean> {
  if (!claimKey) return true
  const args: Record<string, unknown> = { p_claim_key: claimKey }
  if (settlement.action === 'reject') args.p_reason = settlement.reason ?? null
  if (settlement.action === 'defer') {
    args.p_reason = settlement.reason ?? null
    args.p_provider_failure = settlement.providerFailure
  }
  try {
    const { error } = await rpc(SETTLE_RPC[settlement.action], args)
    if (error) throw error
    return true
  } catch (error) {
    console.error(`[customer-communication-auto-runner] falha ao encerrar claim (${settlement.action})`, claimKey, error)
    return false
  }
}

// Clientes simultâneos: cada candidato tem claim e Comunicado próprios, e os
// de Clientes diferentes não dividem linha. Os alvos de um mesmo Cliente e os
// destinatários de um mesmo alvo seguem em série: dividem o alerta do Cliente
// e o Comunicado, cujo status o envio grava em dois passos (recálculo e
// gravação). Quatro envios por vez ficam bem abaixo do limite de 10 req/s do
// provedor; o 429 com retry-after já é tratado no envio (_shared/email.ts).
const CANDIDATE_CONCURRENCY = 4

async function forEachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// Se a execução cair no meio de um Cliente, a claim fica presa até envelhecer
// (30 min) e a produtora a devolve na primeira rodada depois disso: o alvo só
// sai da lista quando todo destinatário automático tem tentativa entregue
// (migration 315), e `emails` traz só os que faltam (migration 318) — quem já
// recebeu, inclusive em simulação, não recebe de novo, nem com a chave ligada
// depois. O teto da rodada (DEFAULT_AUTO_RUNNER_BUDGET) existe para a execução
// não cair.
export async function runAutomaticCommunications(deps: AutoRunnerDeps): Promise<AutoRunnerResult> {
  const { rpc, dispatch } = deps
  const budget = deps.budget ?? DEFAULT_AUTO_RUNNER_BUDGET
  const now = deps.now ?? Date.now
  const { data, error } = await rpc('evaluate_and_dispatch_automatic_communications', { p_as_of: (deps.asOf ?? new Date()).toISOString() })
  if (error) {
    return {
      status: 500,
      body: { error: (error as { message?: string }).message ?? String(error) },
      headers: telemetryFailureHeaders('evaluate_and_dispatch_automatic_communications', error),
    }
  }
  const candidates = (data ?? []) as AutoRunnerCandidate[]
  const sent: Array<{ kind: string; customerId: number; emails: number }> = new Array(candidates.length)
  let releaseFailures = 0
  let failed = 0
  let nextRound = 0
  // Teto da rodada, dividido entre os Clientes simultâneos: cada envio reserva
  // a vez antes de começar.
  const startedAt = now()
  const round: { started: number; paused: RoundPause | null } = { started: 0, paused: null }
  const takeTurn = (): boolean => {
    if (round.paused) return false
    if (round.started >= budget.maxRecipients || now() - startedAt >= budget.maxMillis) {
      round.paused = 'teto_da_rodada'
      return false
    }
    round.started += 1
    return true
  }
  const processCandidate = async (candidate: AutoRunnerCandidate, index: number) => {
    let count = 0
    if (round.paused) {
      // A rodada já parou: o candidato volta inteiro na seguinte.
      nextRound += candidate.emails?.length ?? 0
      if (!await settleClaim(rpc, candidate.claim_key, { action: 'release' })) releaseFailures += 1
      sent[index] = { kind: candidate.kind, customerId: candidate.customer_id, emails: 0 }
      return
    }
    try {
      const payload = candidate.kind === 'ce_mercante_taxas'
        ? await rpc('customer_local_charges_communication_payload', {
            p_voyage_id: candidate.voyage_id,
            p_customer_id: candidate.customer_id,
          }).then(({ data, error }) => {
            if (error) throw error
            return data as {
              customer_name?: string
              vessel_name?: string
              voyage_number?: string
              port?: string
              milestone_at?: string
              bls?: Array<{ bl_id: string; ce_mercante: string | null; total_brl: number | null; exempt?: boolean }>
            }
          })
        : null
      const financeRows = payload?.bls?.map((row) => ({
        blId: row.bl_id,
        ceMercante: row.ce_mercante ?? '',
        totalBrl: Number(row.total_brl ?? 0),
        exempt: row.exempt === true,
      })) ?? []
      const rendered = renderCustomerCommunicationTemplate(candidate.kind, {
        customerId: candidate.customer_id,
        customerName: payload?.customer_name ?? candidate.customer_name,
        vesselName: payload?.vessel_name ?? candidate.vessel_name,
        voyageNumber: payload?.voyage_number ?? candidate.voyage_number,
        port: payload?.port ?? candidate.port,
        milestoneAt: payload?.milestone_at ?? candidate.milestone_at,
        bls: candidate.bl_ids.map((id) => ({
          id,
          customerId: candidate.customer_id,
          // assertCommunicationScope exige que todo B/L do NOB carregue a mesma
          // identidade de terminal do comunicado; a produtora já restringiu a
          // lista à carga da Frente de Operação atribuída a esta Atracação.
          terminalId: candidate.terminal_id ?? null,
          terminalStateId: candidate.anchor_atracacao_id ?? null,
        })),
        terminalId: candidate.terminal_id ?? null,
        terminalStateId: candidate.anchor_atracacao_id ?? null,
        terminalName: candidate.terminal_name ?? null,
        portalUrl: deps.portalUrl,
        ceMercanteRows: financeRows,
        totalBrl: financeRows.reduce((sum, row) => sum + (row.exempt ? 0 : row.totalBrl), 0),
      })
      const recipients = candidate.emails ?? []
      if (!recipients.length) {
        if (!await settleClaim(rpc, candidate.claim_key, { action: 'release' })) releaseFailures += 1
      } else {
        let resolvedRecipients = 0
        let attemptedRecipients = 0
        let permanentRejections = 0
        let dataRefusals = 0
        let rejectionReason: string | undefined
        let deferReason: string | undefined
        for (const recipient of recipients) {
          if (!takeTurn()) break
          try {
            const { status, body } = await dispatch({
              customer_id: candidate.customer_id, kind: candidate.kind, nature: candidate.nature ?? 'avisos_operacionais', recipient,
              subject: rendered.subject, html: rendered.html, text: rendered.text, bl_ids: candidate.bl_ids,
              anchor_voyage_id: candidate.voyage_id, anchor_port: candidate.port, attempt_discriminator: 0,
              anchor_atracacao_id: candidate.anchor_atracacao_id ?? null,
              terminal_name: candidate.terminal_name ?? null,
              vessel_name: candidate.vessel_name, voyage_number: candidate.voyage_number, origin: 'automatico',
            })
            attemptedRecipients += 1
            const result = body as DispatchResponse | null
            const ok = status >= 200 && status < 300
            const isDeliveredOrSimulated = ok && (result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial')
            const isPermanentSuppression = status === 422 && Boolean(result?.suppressed)
            if (isDeliveredOrSimulated) count += 1
            if (isDeliveredOrSimulated || isPermanentSuppression) {
              resolvedRecipients += 1
            } else {
              failed += 1
              console.warn('[customer-communication-auto-runner] envio recusado', {
                status,
                error: result?.error,
                kind: candidate.kind,
                customerId: candidate.customer_id,
                claimKey: candidate.claim_key,
              })
              if (result?.permanent === true) {
                // 422 de código/payload ou 502 com falha_permanente do provedor.
                permanentRejections += 1
                rejectionReason ??= result.error ?? result.reason ?? `HTTP ${status}`
              } else if (status === 422) {
                // Recusa por dado: prontidão, contato, Cliente, escala, Atracação.
                dataRefusals += 1
                deferReason ??= result?.error ?? 'Recusa sem motivo informado.'
              } else {
                deferReason ??= result?.error ?? result?.reason ?? `HTTP ${status}`
              }
            }
          } catch (dispatchError) {
            if (isPlatformRateLimit(dispatchError)) {
              // A Supabase recusou antes do envio: este destinatário e o resto
              // da rodada voltam na seguinte.
              round.paused = 'limite_da_plataforma'
              break
            }
            attemptedRecipients += 1
            failed += 1
            deferReason ??= 'Erro inesperado no envio do Comunicado.'
            console.error('[customer-communication-auto-runner] erro no envio', candidate.kind, candidate.customer_id, candidate.claim_key, dispatchError)
          }
        }
        // A claim covers the whole customer/port target, but delivery is per
        // recipient. When every pending recipient was refused for a reason that
        // only changes with new code or payload, reject the claim so the next
        // runs stop retrying it; any transient failure still releases it.
        const pendingRecipients = recipients.length - resolvedRecipients
        const notAttempted = recipients.length - attemptedRecipients
        const refusedRecipients = pendingRecipients - notAttempted
        if (notAttempted > 0) nextRound += notAttempted
        const settlement: ClaimSettlement = pendingRecipients === 0
          ? { action: 'complete' }
          // Sobrou envio que a rodada não fez, sem falha que peça intervalo: a
          // claim volta na rodada seguinte; uma recusa definitiva junto decide
          // quando não sobrar mais nada.
          : notAttempted > 0 && refusedRecipients === permanentRejections
            ? { action: 'release' }
            : permanentRejections === pendingRecipients
              ? { action: 'reject', reason: rejectionReason }
              // Uma recusa por dado já pede uma pessoa; sem ela, é falha do
              // provedor ou da infraestrutura.
              : { action: 'defer', reason: deferReason ?? rejectionReason, providerFailure: dataRefusals === 0 }
        if (!await settleClaim(rpc, candidate.claim_key, settlement)) releaseFailures += 1
      }
    } catch (candidateError) {
      failed += 1
      console.error('[customer-communication-auto-runner] candidato com erro', candidate.kind, candidate.customer_id, candidate.claim_key, candidateError)
      const reason = candidateError instanceof Error ? candidateError.message : 'Erro ao preparar o Comunicado.'
      if (!await settleClaim(rpc, candidate.claim_key, { action: 'defer', reason, providerFailure: true })) releaseFailures += 1
    }
    sent[index] = { kind: candidate.kind, customerId: candidate.customer_id, emails: count }
  }
  // Os alvos de um mesmo Cliente seguem em série (contatos e alerta do Cliente).
  const byCustomer = new Map<number, number[]>()
  candidates.forEach((candidate, index) => byCustomer.set(candidate.customer_id, [...(byCustomer.get(candidate.customer_id) ?? []), index]))
  await forEachWithConcurrency([...byCustomer.values()], CANDIDATE_CONCURRENCY, async (indexes) => {
    for (const index of indexes) await processCandidate(candidates[index]!, index)
  })
  const { paused } = round
  if (paused) {
    console.warn('[customer-communication-auto-runner] rodada parou antes do fim', {
      motivo: paused, enviosIniciados: round.started, ms: now() - startedAt, proximaRodada: nextRound,
    })
  }
  return {
    status: releaseFailures ? 500 : 200,
    body: { candidates: candidates.length, sent, failed, releaseFailures, nextRound, ...(paused ? { paused } : {}) },
  }
}
