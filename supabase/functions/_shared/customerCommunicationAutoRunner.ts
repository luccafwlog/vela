// Rodada do customer-communication-auto-runner sem dependência remota, para o
// teste com fetch falso rodar no Vitest. O index.ts só autentica e injeta o
// cliente Supabase.
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

export type AutoRunnerDeps = {
  rpc: AutoRunnerRpc
  fetcher: typeof fetch
  supabaseUrl: string
  /**
   * Chave pública (anon) que vai no Authorization da chamada à
   * send-customer-communication. O ramo da automação autentica só pelo
   * X-Communication-Automation-Secret e não usa o portador; a chave de serviço
   * não precisa sair da Edge (auditoria run-3).
   */
  anonKey: string
  secret: string
  portalUrl?: string
  asOf?: Date
}

export type AutoRunnerResult = {
  status: number
  body: {
    error?: string
    candidates?: number
    sent?: Array<{ kind: string; customerId: number; emails: number }>
    /** Destinatários recusados ou com falha na rodada; o heartbeat fica vermelho com > 0. */
    failed?: number
    releaseFailures?: number
  }
  /** Marcação de telemetria do 500 (telemetryFailureHeaders): código e RPC, sem a mensagem. */
  headers?: Record<string, string>
}

// `reason`: motivo técnico da tentativa no 502 do provedor ("HTTP 422 validation_error", "Tempo esgotado…").
type DispatchResponse = { status?: string; suppressed?: boolean; permanent?: boolean; error?: string; reason?: string }

/**
 * Desfecho da claim depois da rodada (plano dos e-mails, 1D; D18):
 * - complete: todos os destinatários resolvidos; zera a contagem e fecha o
 *   alerta comunicado_recusado do Cliente;
 * - reject: recusa definitiva (código, payload ou provedor com
 *   falha_permanente); a produtora não retoma por 24 h;
 * - defer: recusa que pode mudar. Volta em 15 min, 1 h e depois a cada 6 h; o
 *   alerta abre na 1ª recusa por dado ou na 3ª falha seguida do provedor;
 * - release: sem destinatário (a produtora já não manda este caso).
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
// e o Comunicado, cujo status a send-customer-communication grava em dois
// passos (recálculo e gravação). Quatro POSTs por vez ficam bem abaixo do
// limite de 10 req/s do provedor; o 429 com retry-after já é tratado no envio
// (_shared/email.ts).
const CANDIDATE_CONCURRENCY = 4

async function forEachWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// ponytail: até quatro Clientes por vez, um POST à Edge por destinatário, dentro
// do tempo de uma invocação da Edge (~150 s). Com o provedor a ~1-2 s por
// chamada, o teto prático fica em torno de 250-400 destinatários por rodada. Se
// a invocação cair no meio de um Cliente, a claim fica presa até envelhecer
// (30 min) e a produtora a devolve na primeira rodada depois disso: o alvo só
// sai da lista quando todo destinatário automático tem tentativa entregue
// (migration 315), e `emails` traz só os que faltam (migration 318) — quem já
// recebeu, inclusive em simulação, não recebe de novo, nem com a chave ligada
// depois. Caminho de melhoria: limitar o lote na produtora (LIMIT por rodada).
export async function runAutomaticCommunications(deps: AutoRunnerDeps): Promise<AutoRunnerResult> {
  const { rpc, fetcher, supabaseUrl, anonKey, secret } = deps
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
  const processCandidate = async (candidate: AutoRunnerCandidate, index: number) => {
    let count = 0
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
              bls?: Array<{ bl_id: string; ce_mercante: string | null; total_brl: number | null }>
            }
          })
        : null
      const financeRows = payload?.bls?.map((row) => ({
        blId: row.bl_id,
        ceMercante: row.ce_mercante ?? '',
        totalBrl: Number(row.total_brl ?? 0),
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
        totalBrl: financeRows.reduce((sum, row) => sum + row.totalBrl, 0),
      })
      const recipients = candidate.emails ?? []
      if (!recipients.length) {
        if (!await settleClaim(rpc, candidate.claim_key, { action: 'release' })) releaseFailures += 1
      } else {
        let resolvedRecipients = 0
        let permanentRejections = 0
        let dataRefusals = 0
        let rejectionReason: string | undefined
        let deferReason: string | undefined
        for (const recipient of recipients) {
          try {
            const response = await fetcher(`${supabaseUrl}/functions/v1/send-customer-communication`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', 'X-Communication-Automation-Secret': secret },
              body: JSON.stringify({
                customer_id: candidate.customer_id, kind: candidate.kind, nature: candidate.nature ?? 'avisos_operacionais', recipient,
                subject: rendered.subject, html: rendered.html, text: rendered.text, bl_ids: candidate.bl_ids,
                anchor_voyage_id: candidate.voyage_id, anchor_port: candidate.port, attempt_discriminator: 0,
                anchor_atracacao_id: candidate.anchor_atracacao_id ?? null,
                terminal_name: candidate.terminal_name ?? null,
                vessel_name: candidate.vessel_name, voyage_number: candidate.voyage_number, origin: 'automatico',
              }),
            })
            let result: DispatchResponse | null = null
            try {
              result = await response.json() as DispatchResponse
            } catch {
              // A successful HTTP response without the contract status is not a sent e-mail.
            }
            const isDeliveredOrSimulated = response.ok && (result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial')
            const isPermanentSuppression = response.status === 422 && Boolean(result?.suppressed)
            if (isDeliveredOrSimulated) count += 1
            if (isDeliveredOrSimulated || isPermanentSuppression) {
              resolvedRecipients += 1
            } else {
              failed += 1
              console.warn('[customer-communication-auto-runner] envio recusado', {
                status: response.status,
                error: result?.error,
                kind: candidate.kind,
                customerId: candidate.customer_id,
                claimKey: candidate.claim_key,
              })
              if (result?.permanent === true) {
                // 422 de código/payload ou 502 com falha_permanente do provedor.
                permanentRejections += 1
                rejectionReason ??= result.error ?? result.reason ?? `HTTP ${response.status}`
              } else if (response.status === 422) {
                // Recusa por dado: prontidão, contato, Cliente, escala, Atracação.
                dataRefusals += 1
                deferReason ??= result?.error ?? 'Recusa sem motivo informado.'
              } else {
                deferReason ??= result?.error ?? result?.reason ?? `HTTP ${response.status}`
              }
            }
          } catch (dispatchError) {
            failed += 1
            deferReason ??= 'Falha de requisição ao envio do Comunicado.'
            console.error('[customer-communication-auto-runner] falha de requisição', candidate.kind, candidate.customer_id, candidate.claim_key, dispatchError)
          }
        }
        // A claim covers the whole customer/port target, but delivery is per
        // recipient. When every pending recipient was refused for a reason that
        // only changes with new code or payload, reject the claim so the next
        // runs stop retrying it; any transient failure still releases it.
        const pendingRecipients = recipients.length - resolvedRecipients
        const settlement: ClaimSettlement = pendingRecipients === 0
          ? { action: 'complete' }
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
  return { status: releaseFailures ? 500 : 200, body: { candidates: candidates.length, sent, failed, releaseFailures } }
}
