import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { renderCustomerCommunicationTemplate } from '../_shared/customerCommunicationTemplates.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

type Candidate = {
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

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

async function releaseClaimSafely(admin: ReturnType<typeof createClient>, claimKey?: string): Promise<boolean> {
  if (!claimKey) return true
  try {
    const { error } = await admin.rpc('release_customer_communication_automation_claim', { p_claim_key: claimKey })
    if (error) throw error
    return true
  } catch (error) {
    console.error('[customer-communication-auto-runner] falha ao liberar claim', claimKey, error)
    return false
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const secret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  if (!secret || !timingSafeEqual(providedSecret, secret)) return json(401, { error: 'Não autorizado.' })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const admin = createClient(url, serviceKey)
  const { data, error } = await admin.rpc('evaluate_and_dispatch_automatic_communications', { p_as_of: new Date().toISOString() })
  if (error) return json(500, { error: error.message })
  const candidates = (data ?? []) as Candidate[]
  const sent: Array<{ kind: string; customerId: number; emails: number }> = []
  let releaseFailures = 0
  let failed = 0
  for (const candidate of candidates) {
    let count = 0
    try {
      const payload = candidate.kind === 'ce_mercante_taxas'
        ? await admin.rpc('customer_local_charges_communication_payload', {
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
        portalUrl: Deno.env.get('PORTAL_URL'),
        ceMercanteRows: financeRows,
        totalBrl: financeRows.reduce((sum, row) => sum + row.totalBrl, 0),
      })
      const recipients = candidate.emails ?? []
      if (!recipients.length) {
        if (!await releaseClaimSafely(admin, candidate.claim_key)) releaseFailures += 1
      } else {
        let resolvedRecipients = 0
        for (const recipient of recipients) {
          try {
            const response = await fetch(`${url}/functions/v1/send-customer-communication`, {
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
            let result: { status?: string; suppressed?: boolean } | null = null
            try {
              result = await response.json() as { status?: string; suppressed?: boolean }
            } catch {
              // A successful HTTP response without the contract status is not a sent e-mail.
            }
            const isDeliveredOrSimulated = response.ok && (result?.status === 'enviado' || result?.status === 'simulado' || result?.status === 'parcial')
            const isPermanentSuppression = response.status === 422 && Boolean(result?.suppressed)
            if (isDeliveredOrSimulated) count += 1
            if (isDeliveredOrSimulated || isPermanentSuppression) resolvedRecipients += 1
          } catch (dispatchError) {
            console.error('[customer-communication-auto-runner] falha de requisição', candidate.customer_id, recipient, dispatchError)
          }
        }
        // A claim covers the whole customer/port target, but delivery is per
        // recipient. Release it only when any recipient suffered a transient failure that needs a retry.
        const shouldRelease = resolvedRecipients < recipients.length
        if (shouldRelease) {
          failed += recipients.length - resolvedRecipients
          if (!await releaseClaimSafely(admin, candidate.claim_key)) releaseFailures += 1
        }
      }
    } catch (candidateError) {
      failed += 1
      console.error('[customer-communication-auto-runner] candidato com erro', candidate.customer_id, candidateError)
      if (!await releaseClaimSafely(admin, candidate.claim_key)) releaseFailures += 1
    }
    sent.push({ kind: candidate.kind, customerId: candidate.customer_id, emails: count })
  }
  return json(releaseFailures ? 500 : 200, { candidates: candidates.length, sent, failed, releaseFailures })
}

if (import.meta.main) {
  const edgeHandler = instrumentEdgeHandler('customer-communication-auto-runner', handler)
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
    const providedSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('customerCommunicationAutoRunner', () => edgeHandler(req), { enabled: authorized })
  })
}
