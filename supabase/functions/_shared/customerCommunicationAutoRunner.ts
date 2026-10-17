// Rodada do customer-communication-auto-runner sem dependência remota, para o
// teste com fetch falso rodar no Vitest. O index.ts só autentica e injeta o
// cliente Supabase.
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
  serviceKey: string
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
}

type DispatchResponse = { status?: string; suppressed?: boolean; permanent?: boolean; error?: string }

async function settleClaim(
  rpc: AutoRunnerRpc,
  action: 'release' | 'reject',
  claimKey: string | undefined,
  reason?: string,
): Promise<boolean> {
  if (!claimKey) return true
  try {
    const { error } = action === 'reject'
      ? await rpc('reject_customer_communication_automation_claim', { p_claim_key: claimKey, p_reason: reason ?? null })
      : await rpc('release_customer_communication_automation_claim', { p_claim_key: claimKey })
    if (error) throw error
    return true
  } catch (error) {
    console.error(`[customer-communication-auto-runner] falha ao ${action === 'reject' ? 'rejeitar' : 'liberar'} claim`, claimKey, error)
    return false
  }
}

export async function runAutomaticCommunications(deps: AutoRunnerDeps): Promise<AutoRunnerResult> {
  const { rpc, fetcher, supabaseUrl, serviceKey, secret } = deps
  const { data, error } = await rpc('evaluate_and_dispatch_automatic_communications', { p_as_of: (deps.asOf ?? new Date()).toISOString() })
  if (error) return { status: 500, body: { error: (error as { message?: string }).message ?? String(error) } }
  const candidates = (data ?? []) as AutoRunnerCandidate[]
  const sent: Array<{ kind: string; customerId: number; emails: number }> = []
  let releaseFailures = 0
  let failed = 0
  for (const candidate of candidates) {
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
        if (!await settleClaim(rpc, 'release', candidate.claim_key)) releaseFailures += 1
      } else {
        let resolvedRecipients = 0
        let permanentRejections = 0
        let rejectionReason: string | undefined
        for (const recipient of recipients) {
          try {
            const response = await fetcher(`${supabaseUrl}/functions/v1/send-customer-communication`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', 'X-Communication-Automation-Secret': secret },
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
              if (response.status === 422 && result?.permanent === true) {
                permanentRejections += 1
                rejectionReason ??= result.error
              }
            }
          } catch (dispatchError) {
            failed += 1
            console.error('[customer-communication-auto-runner] falha de requisição', candidate.kind, candidate.customer_id, candidate.claim_key, dispatchError)
          }
        }
        // A claim covers the whole customer/port target, but delivery is per
        // recipient. When every pending recipient was refused for a reason that
        // only changes with new code or payload, reject the claim so the next
        // runs stop retrying it; any transient failure still releases it.
        const pendingRecipients = recipients.length - resolvedRecipients
        if (pendingRecipients > 0 && permanentRejections === pendingRecipients) {
          if (!await settleClaim(rpc, 'reject', candidate.claim_key, rejectionReason)) releaseFailures += 1
        } else if (pendingRecipients > 0) {
          if (!await settleClaim(rpc, 'release', candidate.claim_key)) releaseFailures += 1
        }
      }
    } catch (candidateError) {
      failed += 1
      console.error('[customer-communication-auto-runner] candidato com erro', candidate.kind, candidate.customer_id, candidate.claim_key, candidateError)
      if (!await settleClaim(rpc, 'release', candidate.claim_key)) releaseFailures += 1
    }
    sent.push({ kind: candidate.kind, customerId: candidate.customer_id, emails: count })
  }
  return { status: releaseFailures ? 500 : 200, body: { candidates: candidates.length, sent, failed, releaseFailures } }
}
