import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { maskEmail, recipientKey, type EmailAttemptRecord } from '../_shared/email.ts'
import { canonicalPortalUrl } from '../_shared/portalUrls.ts'
import {
  dunningResumeDispatchId,
  runDemurrageDunning,
  type DunningContact,
  type DunningInvoiceContext,
  type DunningStore,
} from '../_shared/demurrageDunningRunner.ts'

// A rodada (seleção, envio, status do Comunicado e desfecho de cada fatura)
// fica em _shared/demurrageDunningRunner.ts, testada com banco e fetch falsos
// (plano dos e-mails, 1E.5). Aqui ficam a autenticação, o ambiente e o acesso
// ao banco pelo cliente Supabase.

// Cliente sem schema tipado: com `ReturnType<typeof createClient>` o deno check
// resolve as tabelas como `never` (plano dos e-mails, 5.4).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// Respostas à cobrança vão para a equipe de demurrage, o mesmo endereço do
// rodapé (decisão de 2026-10-20); sem DEMURRAGE_REPLY_TO o envio real é
// recusado, em vez de cair na caixa dos Comunicados.
function demurrageReplyTo(): string | undefined {
  return Deno.env.get('DEMURRAGE_REPLY_TO')?.trim() || undefined
}

// Faturas do Portal pela configuração única (src/config/portalUrl.ts): um
// PORTAL_URL do portal antigo (Transhipping Desk) não chega ao e-mail (ponto 4
// de 2026-10-23).
function portalBillingUrl(): string {
  return canonicalPortalUrl('billing')
}

async function recipientAllowed(admin: Admin, customerId: number, contactId: number): Promise<boolean> {
  const { data, error } = await admin.rpc('customer_communication_recipient_allowed', {
    p_customer_id: customerId,
    p_contact_id: contactId,
    p_kind: 'cobranca_demurrage',
    p_audience_mode: 'caixa',
    p_recipient_box_code: null,
  })
  if (error) throw error
  return data === true
}

// 1E.6: o critério de destinatário é o do banco (caixas ativas ligadas a
// cobranca_demurrage, contato ativo, e-mail válido, sem supressão), na seleção
// e antes de cada envio, em vez de caixas fixas no código.
async function loadRecipients(admin: Admin, customerId: number): Promise<DunningContact[]> {
  const { data, error } = await admin
    .from('customer_contacts')
    .select('id, email')
    .eq('customer_id', customerId)
    .is('deactivated_at', null)
    .order('id', { ascending: true })
  if (error) throw error
  const seen = new Set<string>()
  const result: DunningContact[] = []
  for (const contact of (data ?? []) as Array<{ id: number; email: string | null }>) {
    const email = normalizeEmail(contact.email)
    if (!EMAIL_PATTERN.test(email) || seen.has(email)) continue
    if (!await recipientAllowed(admin, customerId, contact.id)) continue
    seen.add(email)
    result.push({ id: contact.id, email })
  }
  return result
}

async function loadInvoice(admin: Admin, invoiceId: number): Promise<DunningInvoiceContext> {
  const { data, error } = await admin
    .from('demurrage_invoices')
    .select('id, customer_id, bl_id, doc_number, total_usd, discount_mode, discount_value, current_total_brl, current_roe, first_billed_at, updated_at, customer:customers(id, name), bl:bls(id, pod, voyage:voyages(id, voyage_number, vessel:vessels(name)))')
    .eq('id', invoiceId)
    .single()
  if (error) throw error
  const row = data as unknown as DunningInvoiceContext
  return { ...row, customer: normalizeNested(row.customer), bl: normalizeNested(row.bl) }
}

async function currentEligibleRecipient(admin: Admin, customerId: number, contactId: number): Promise<string | null> {
  const { data: contact, error: contactError } = await admin
    .from('customer_contacts')
    .select('id, email, customer_id, deactivated_at')
    .eq('id', contactId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (contactError) throw contactError
  if (!contact || contact.deactivated_at != null) return null
  if (!await recipientAllowed(admin, customerId, contactId)) return null
  const recipient = normalizeEmail(String(contact.email ?? ''))
  return EMAIL_PATTERN.test(recipient) ? recipient : null
}

type DunningAttemptRow = {
  id: string | number
  status: string
  provider_message_id: string | null
  dispatch_mode: string
  idempotency_key: string
  recipient_key: string | null
}

async function findExistingDunningAttempt(
  admin: Admin,
  {
    communicationId,
    contactId,
    attemptKey,
    recipientIdentity,
    keyPrefix,
  }: {
    communicationId: number
    contactId: number
    attemptKey: string
    recipientIdentity: string
    keyPrefix: string
  },
): Promise<DunningAttemptRow | null> {
  const select = 'id, status, provider_message_id, dispatch_mode, idempotency_key, recipient_key'
  const { data: exact, error: exactError } = await admin
    .from('customer_communication_attempts')
    .select(select)
    .eq('idempotency_key', attemptKey)
    .maybeSingle()
  if (exactError) throw exactError
  if (exact) return exact as DunningAttemptRow

  // A previous version hashed the raw email. Keep its provider key intact and
  // find it by the stable communication/contact identity instead of creating a
  // second attempt after the canonicalization change.
  const { data: byRecipient, error: recipientError } = await admin
    .from('customer_communication_attempts')
    .select(select)
    .eq('communication_id', communicationId)
    .eq('recipient_key', recipientIdentity)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recipientError) throw recipientError
  if (byRecipient) return byRecipient as DunningAttemptRow

  const { data: byLegacyKey, error: legacyKeyError } = await admin
    .from('customer_communication_attempts')
    .select(select)
    .eq('communication_id', communicationId)
    .like('idempotency_key', `${keyPrefix}${contactId}:%`)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (legacyKeyError) throw legacyKeyError
  return (byLegacyKey as DunningAttemptRow | null) ?? null
}

async function recordDunningAttempt({
  admin,
  communicationId,
  contactId,
  communicationsEnabled,
  attemptKey,
  to,
  keyPrefix,
}: {
  admin: Admin
  communicationId: number
  contactId: number
  communicationsEnabled: boolean
  attemptKey: string
  to: string
  keyPrefix: string
}): Promise<EmailAttemptRecord> {
  const recipientIdentity = await recipientKey(to)
  const { data, error } = await admin.from('customer_communication_attempts').insert({
    communication_id: communicationId,
    recipient_masked: maskEmail(to),
    recipient_key: recipientIdentity,
    status: 'aceito',
    dispatch_mode: communicationsEnabled ? 'real' : 'simulado',
    idempotency_key: attemptKey,
  }).select('id').single()
  if (error?.code === '23505') {
    const existing = await findExistingDunningAttempt(admin, {
      communicationId,
      contactId,
      attemptKey,
      recipientIdentity,
      keyPrefix,
    })
    if (!existing) throw error

    if (existing.recipient_key !== recipientIdentity || (existing.dispatch_mode === 'legado' && existing.status === 'aceito' && existing.provider_message_id == null)) {
      const { error: repairError } = await admin.from('customer_communication_attempts').update({
        recipient_key: recipientIdentity,
        ...(existing.dispatch_mode === 'legado' && existing.status === 'aceito' && existing.provider_message_id == null
          ? { dispatch_mode: communicationsEnabled ? 'real' : 'simulado' }
          : {}),
      }).eq('id', existing.id)
      if (repairError) throw repairError
    }
    return {
      id: existing.id,
      status: existing.status as EmailAttemptRecord['status'],
      providerMessageId: existing.provider_message_id,
      idempotencyKey: existing.idempotency_key,
      existing: true,
    }
  }
  if (error || !data) throw error ?? new Error('Não foi possível registrar a tentativa de Demurrage.')
  return { id: data.id, status: 'aceito', providerMessageId: null, idempotencyKey: attemptKey, existing: false }
}

async function markAutomatic(admin: Admin, communicationId: number): Promise<number> {
  if (!Number.isInteger(communicationId) || communicationId <= 0) throw new Error('RPC não retornou o comunicado de Demurrage.')
  const { error } = await admin.from('customer_communications').update({ origin: 'automatico' }).eq('id', communicationId)
  if (error) throw error
  return communicationId
}

function supabaseDunningStore(admin: Admin): DunningStore {
  return {
    async loadCommunicationsEnabled() {
      const { data, error } = await admin.from('app_settings').select('communications_enabled').eq('id', 1).maybeSingle()
      if (error) throw error
      return Boolean((data as { communications_enabled?: boolean } | null)?.communications_enabled)
    },
    async claimCandidates(asOf, limit) {
      const { data, error } = await admin.rpc('claim_demurrage_dunning_candidates', { p_as_of: asOf, p_limit: limit })
      if (error) throw error
      return data
    },
    loadRecipients: (customerId) => loadRecipients(admin, customerId),
    loadInvoice: (invoiceId) => loadInvoice(admin, invoiceId),
    async isSendable(invoiceId) {
      const { data, error } = await admin.rpc('demurrage_dunning_candidate_sendable', { p_invoice_id: invoiceId })
      if (error) throw error
      return data === true
    },
    currentEligibleRecipient: (customerId, contactId) => currentEligibleRecipient(admin, customerId, contactId),
    async createCommunication({ mode, candidates, anchor, vesselName, voyageNumber, resumeGeneration }) {
      const first = candidates[0]!
      if (mode === 'group') {
        const { data, error } = await admin.rpc('create_customer_dunning_group_atomic', {
          p_customer_id: first.customer_id,
          p_attempt_discriminator: first.attempt_discriminator,
          p_invoice_ids: candidates.map((item) => item.invoice_id),
          p_anchor_voyage_id: anchor.bl?.voyage?.id ?? null,
          p_anchor_port: anchor.bl?.pod ?? null,
          p_vessel_name: vesselName,
          p_voyage_number: voyageNumber,
          p_terminal_name: null,
        })
        if (error) throw error
        return await markAutomatic(admin, Number(data))
      }
      const { data, error } = await admin.rpc('create_customer_communication_atomic', {
        p_customer_id: first.customer_id,
        p_kind: 'cobranca_demurrage',
        p_nature: 'demurrage',
        p_anchor_voyage_id: anchor.bl?.voyage?.id ?? null,
        p_anchor_port: anchor.bl?.pod ?? null,
        p_anchor_atracacao_id: null,
        p_anchor_invoice_id: first.invoice_id,
        p_attempt_discriminator: first.attempt_discriminator,
        // Retomada depois da recusa (migration 317): Comunicado novo, sem a
        // tentativa recusada do endereço antigo deixar o status em parcial.
        p_dispatch_id: await dunningResumeDispatchId(first.invoice_id, first.attempt_discriminator, resumeGeneration),
        p_vessel_name: vesselName,
        p_voyage_number: voyageNumber,
        p_terminal_name: null,
        p_created_by: null,
        p_bl_ids: [first.bl_id],
      })
      if (error) throw error
      return await markAutomatic(admin, Number(data))
    },
    async checkSuppression(to) {
      const [{ data: communicationSuppression, error: communicationError }, { data: portalSuppression, error: portalError }] = await Promise.all([
        admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
        admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
      ])
      // Erro na consulta não libera o envio para um endereço que pode estar suprimido.
      if (communicationError || portalError) throw communicationError ?? portalError
      return { suppressed: Boolean(communicationSuppression || portalSuppression) }
    },
    recordAttempt: (input) => recordDunningAttempt({ admin, ...input }),
    async updateAttempt(attemptId, update) {
      const { error } = await admin.from('customer_communication_attempts').update({
        provider_message_id: update.providerMessageId,
        retry_count: update.retryCount,
        status: update.status,
        last_error: update.lastError,
      }).eq('id', attemptId)
      if (error) throw error
    },
    async refreshStatus(communicationId) {
      const { data, error } = await admin.rpc('refresh_customer_communication_status', { p_communication_id: communicationId })
      if (error) throw error
      return data
    },
    async persistStatus(communicationId, status) {
      const { error } = await admin.from('customer_communications').update({ status }).eq('id', communicationId)
      if (error) throw error
    },
    async settleClaim(candidate, outcome, reason, communicationId) {
      const { error } = await admin.rpc('settle_demurrage_dunning_claim', {
        p_invoice_id: candidate.invoice_id,
        p_attempt_discriminator: candidate.attempt_discriminator,
        p_outcome: outcome,
        p_reason: reason ?? null,
        p_communication_id: communicationId ?? null,
      })
      if (error) throw error
    },
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const expectedSecret = Deno.env.get('DEMURRAGE_DUNNING_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) return json(401, { error: 'Unauthorized' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const result = await runDemurrageDunning({
    store: supabaseDunningStore(createClient(url, serviceKey)),
    config: {
      resendApiKey: Deno.env.get('RESEND_API_KEY'),
      from: Deno.env.get('PORTAL_FROM_EMAIL'),
      replyTo: demurrageReplyTo(),
      portalUrl: portalBillingUrl(),
    },
  })
  return json(result.status, result.body)
}

if (typeof Deno !== 'undefined') {
  const edgeHandler = instrumentEdgeHandler('demurrage-dunning', handler)
  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('DEMURRAGE_DUNNING_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('demurrageDunning', () => edgeHandler(req), { enabled: authorized })
  })
}
