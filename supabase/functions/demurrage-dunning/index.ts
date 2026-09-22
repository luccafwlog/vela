import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { renderDemurrageTemplate } from '../_shared/customerCommunicationTemplates.ts'
import { maskEmail, recipientKey, sendEmail, type EmailAttemptRecord } from '../_shared/email.ts'

type DunningCandidate = {
  invoice_id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
  roe_source: string | null
  first_billed_at: string
  claimed_at: string
  roe_reference_date: string
  attempt_discriminator: number
}

type DunningContact = { id: number; customer_id: number | null; email: string | null; deactivated_at?: string | null }
type ContactBoxLink = { contact_id: number; box_code: string }
type Suppression = { email: string; reason?: string | null }
type InvoiceContext = {
  id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
  first_billed_at: string | null
  status: string | null
  paid_at: string | null
  dispute_open: boolean | null
  updated_at: string | null
  customer: { id: number; name: string } | null
  bl: {
    id: string
    pod: string | null
    voyage: { id: number; voyage_number: string; vessel: { name: string } | null } | null
  } | null
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const CLAIM_BATCH_SIZE = 50

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asCandidates(value: unknown): DunningCandidate[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is DunningCandidate => {
    if (!isRecord(item)) return false
    return Number.isFinite(Number(item.invoice_id))
      && Number.isFinite(Number(item.customer_id))
      && typeof item.bl_id === 'string'
      && typeof item.doc_number === 'string'
      && Number.isFinite(Number(item.total_usd))
      && typeof item.claimed_at === 'string'
      && Number.isFinite(Number(item.attempt_discriminator))
  }).map((item) => ({
    invoice_id: Number(item.invoice_id),
    customer_id: Number(item.customer_id),
    bl_id: String(item.bl_id),
    doc_number: String(item.doc_number),
    total_usd: Number(item.total_usd),
    current_total_brl: item.current_total_brl == null ? null : Number(item.current_total_brl),
    current_roe: item.current_roe == null ? null : Number(item.current_roe),
    roe_source: item.roe_source == null ? null : String(item.roe_source),
    first_billed_at: String(item.first_billed_at ?? ''),
    claimed_at: String(item.claimed_at),
    roe_reference_date: String(item.roe_reference_date ?? ''),
    attempt_discriminator: Number(item.attempt_discriminator),
  }))
}

function normalizeNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function portalBillingUrl(): string {
  const configured = (Deno.env.get('PORTAL_URL') ?? '').trim().replace(/\/+$/, '')
  if (!configured) return 'https://portalfwlog.com.br/portal/billing'
  if (configured.endsWith('/portal/billing')) return configured
  if (configured.endsWith('/portal')) return `${configured}/billing`
  if (configured.endsWith('/billing')) return `${configured.slice(0, -'/billing'.length)}/portal/billing`
  return `${configured}/portal/billing`
}

function dateOnly(value: string | null | undefined): string {
  return value?.slice(0, 10) || new Date().toISOString().slice(0, 10)
}

async function loadRecipients(
  admin: ReturnType<typeof createClient>,
  customerId: number,
): Promise<DunningContact[]> {
  const { data: contactsData, error: contactsError } = await admin
    .from('customer_contacts')
    .select('id, customer_id, email, deactivated_at')
    .eq('customer_id', customerId)
    .is('deactivated_at', null)
  if (contactsError) throw contactsError
  const contacts = (contactsData ?? []) as DunningContact[]
  const contactIds = contacts.map((contact) => contact.id)
  const contactEmails = [...new Set(contacts.flatMap((contact) => {
    const email = (contact.email ?? '').trim()
    return email ? [email, email.toLowerCase()] : []
  }))]
  const [{ data: boxLinksData, error: boxLinksError }, { data: communicationData, error: communicationError }, { data: portalData, error: portalError }] = await Promise.all([
    contactIds.length
      ? admin.from('customer_contact_box_links').select('contact_id, box_code').in('contact_id', contactIds).in('box_code', ['financeiro', 'demurrage'])
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? admin.from('customer_communication_suppressions').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? admin.from('portal_suppressed_emails').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (boxLinksError) throw boxLinksError
  if (communicationError) throw communicationError
  if (portalError) throw portalError

  const boxLinks = (boxLinksData ?? []) as ContactBoxLink[]
  const eligibleContactIds = new Set(boxLinks.map((link) => link.contact_id))
  const communicationSuppressions = (communicationData ?? []) as Suppression[]
  const portalSuppressions = (portalData ?? []) as Suppression[]
  const isSuppressed = (email: string) => communicationSuppressions.some((row) => normalizeEmail(row.email) === email)
    || portalSuppressions.some((row) => normalizeEmail(row.email) === email && row.reason === 'bounce_permanente')

  const seenEmails = new Set<string>()
  const result: DunningContact[] = []
  for (const contact of contacts) {
    if (contact.deactivated_at != null) continue
    if (!eligibleContactIds.has(contact.id)) continue
    const email = normalizeEmail(contact.email)
    if (!EMAIL_PATTERN.test(email) || isSuppressed(email)) continue
    if (seenEmails.has(email)) continue
    seenEmails.add(email)
    result.push(contact)
  }
  return result
}

async function loadInvoice(
  admin: ReturnType<typeof createClient>,
  invoiceId: number,
): Promise<InvoiceContext> {
  const { data, error } = await admin
    .from('demurrage_invoices')
    .select('id, customer_id, bl_id, doc_number, total_usd, current_total_brl, current_roe, first_billed_at, updated_at, status, paid_at, dispute_open, customer:customers(id, name), bl:bls(id, pod, voyage:voyages(id, voyage_number, vessel:vessels(name)))')
    .eq('id', invoiceId)
    .single()
  if (error) throw error
  const row = data as InvoiceContext
  return {
    ...row,
    customer: normalizeNested(row.customer),
    bl: normalizeNested(row.bl),
  }
}

async function revalidateInvoiceBeforeSend(
  admin: ReturnType<typeof createClient>,
  invoiceId: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('demurrage_dunning_candidate_sendable', { p_invoice_id: invoiceId })
  if (error) throw error
  return data === true
}

async function currentEligibleRecipient(
  admin: ReturnType<typeof createClient>,
  customerId: number,
  contactId: number,
): Promise<string | null> {
  const { data: contact, error: contactError } = await admin
    .from('customer_contacts')
    .select('id, email, customer_id, deactivated_at')
    .eq('id', contactId)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (contactError) throw contactError
  if (!contact || contact.deactivated_at != null) return null

  const { data: allowed, error: allowedError } = await admin.rpc('customer_communication_recipient_allowed', {
    p_customer_id: customerId,
    p_contact_id: contactId,
    p_kind: 'cobranca_demurrage',
    p_audience_mode: 'caixa',
    p_recipient_box_code: null,
  })
  if (allowedError) throw allowedError
  if (allowed !== true) return null
  const recipient = normalizeEmail(String(contact.email ?? ''))
  return EMAIL_PATTERN.test(recipient) ? recipient : null
}

async function recipientVersion(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  const bytes = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
  admin: ReturnType<typeof createClient>,
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
  admin: ReturnType<typeof createClient>
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

async function createCommunication(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
  context: InvoiceContext,
  vesselName: string,
  voyageNumber: string,
  terminalName: string | null,
): Promise<number> {
  const { data, error } = await admin.rpc('create_customer_communication_atomic', {
    p_customer_id: candidate.customer_id,
    p_kind: 'cobranca_demurrage',
    p_nature: 'demurrage',
    p_anchor_voyage_id: context.bl?.voyage?.id ?? null,
    p_anchor_port: context.bl?.pod ?? null,
    p_anchor_atracacao_id: null,
    p_anchor_invoice_id: candidate.invoice_id,
    p_attempt_discriminator: candidate.attempt_discriminator,
    p_dispatch_id: null,
    p_vessel_name: vesselName,
    p_voyage_number: voyageNumber,
    p_terminal_name: terminalName,
    p_created_by: null,
    p_bl_ids: [candidate.bl_id],
  })
  if (error) throw error
  const communicationId = Number(data)
  if (!Number.isInteger(communicationId) || communicationId <= 0) throw new Error('RPC não retornou o comunicado de Demurrage.')
  const { error: originError } = await admin
    .from('customer_communications')
    .update({ origin: 'automatico' })
    .eq('id', communicationId)
  if (originError) throw originError
  return communicationId
}

function groupDunningCandidatesByCustomerCycle(candidates: DunningCandidate[]): DunningCandidate[][] {
  // D11: uma mensagem por cliente/ciclo (customer_id + attempt_discriminator).
  // Preserva cada fatura (sem consolidar valores); o grupo congela a composição
  // da tentativa e deduplica por cliente/ciclo/destinatário no envio.
  const groups = new Map<string, DunningCandidate[]>()
  for (const candidate of candidates) {
    const key = `${candidate.customer_id}:${candidate.attempt_discriminator}`
    const list = groups.get(key) ?? []
    if (!list.some((item) => item.invoice_id === candidate.invoice_id)) list.push(candidate)
    groups.set(key, list)
  }
  return [...groups.values()].map((list) => list.sort((a, b) => a.invoice_id - b.invoice_id))
}

async function createGroupedCommunication(
  admin: ReturnType<typeof createClient>,
  group: DunningCandidate[],
  context: InvoiceContext,
  vesselName: string,
  voyageNumber: string,
): Promise<number> {
  const first = group[0]!
  const { data, error } = await admin.rpc('create_customer_dunning_group_atomic', {
    p_customer_id: first.customer_id,
    p_attempt_discriminator: first.attempt_discriminator,
    p_invoice_ids: group.map((item) => item.invoice_id),
    p_anchor_voyage_id: context.bl?.voyage?.id ?? null,
    p_anchor_port: context.bl?.pod ?? null,
    p_vessel_name: vesselName,
    p_voyage_number: voyageNumber,
    p_terminal_name: null,
  })
  if (error) throw error
  const communicationId = Number(data)
  if (!Number.isInteger(communicationId) || communicationId <= 0) throw new Error('RPC não retornou o comunicado de Demurrage.')
  const { error: originError } = await admin
    .from('customer_communications')
    .update({ origin: 'automatico' })
    .eq('id', communicationId)
  if (originError) throw originError
  return communicationId
}

async function sendCandidateGroup(
  admin: ReturnType<typeof createClient>,
  group: DunningCandidate[],
  communicationsEnabled: boolean,
): Promise<'enviado' | 'simulado' | 'parcial' | 'falha' | 'pausado'> {
  const first = group[0]!
  // Revalida quitação/disputa/supressão/caixa por fatura antes de compor o grupo.
  const sendable: DunningCandidate[] = []
  for (const candidate of group) {
    if (await revalidateInvoiceBeforeSend(admin, candidate.invoice_id)) {
      sendable.push(candidate)
    } else {
      // A claim filtrada não pode ficar consumida só porque outra invoice do
      // mesmo lote permaneceu elegível. O resultado da tentativa é por invoice.
      await releaseClaim(admin, candidate)
    }
  }
  if (!sendable.length) return 'pausado'
  const contacts = await loadRecipients(admin, first.customer_id)
  if (!contacts.length) return 'pausado'

  const contexts = new Map<number, InvoiceContext>()
  for (const candidate of sendable) {
    contexts.set(candidate.invoice_id, await loadInvoice(admin, candidate.invoice_id))
  }
  const anchor = contexts.get(first.invoice_id) ?? contexts.get(sendable[0]!.invoice_id)!
  const vesselName = anchor.bl?.voyage?.vessel?.name ?? ''
  const voyageNumber = anchor.bl?.voyage?.voyage_number ?? ''
  const firstRoe = Number(first.current_roe ?? anchor.current_roe ?? 0)
  if (!anchor.customer?.name || !vesselName || !voyageNumber || firstRoe <= 0) {
    throw new Error('Dados incompletos para o comunicado de Demurrage.')
  }
  // Valida o template canônico na primeira fatura e lista todas sem consolidar.
  const firstTotalBrl = Number(first.current_total_brl ?? anchor.current_total_brl ?? (first.total_usd * firstRoe))
  renderDemurrageTemplate({
    customerId: first.customer_id,
    customerName: anchor.customer.name,
    vesselName,
    voyageNumber,
    port: anchor.bl?.pod ?? '—',
    milestoneAt: first.first_billed_at,
    bls: [{ id: first.bl_id, customerId: first.customer_id }],
    portalUrl: portalBillingUrl(),
    demurrage: {
      docNumber: first.doc_number,
      totalUsd: first.total_usd,
      totalBrl: firstTotalBrl,
      roe: firstRoe,
      roeReferenceDate: first.roe_reference_date || dateOnly(anchor.updated_at || anchor.first_billed_at),
    },
  })
  const lines = sendable.map((candidate) => {
    const context = contexts.get(candidate.invoice_id)!
    const roe = Number(candidate.current_roe ?? context.current_roe ?? firstRoe)
    const totalBrl = Number(candidate.current_total_brl ?? context.current_total_brl ?? (candidate.total_usd * roe))
    return { candidate, totalBrl, roe }
  })
  const totalUsd = lines.reduce((sum, line) => sum + line.candidate.total_usd, 0)
  const subject = sendable.length === 1
    ? `Cobrança de Demurrage — ${sendable[0]!.doc_number} — ${vesselName} / ${voyageNumber}`
    : `Cobrança de Demurrage — ${sendable.length} faturas — ${vesselName} / ${voyageNumber}`
  const textList = lines.map((line) => `• ${line.candidate.doc_number} (B/L ${line.candidate.bl_id}): USD ${line.candidate.total_usd.toFixed(2)} / BRL ${line.totalBrl.toFixed(2)}`).join('\n')
  const htmlList = lines.map((line) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${line.candidate.doc_number} <span style="color:#6b7280">(${line.candidate.bl_id})</span></td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">USD ${line.candidate.total_usd.toFixed(2)} · BRL ${line.totalBrl.toFixed(2)}</td></tr>`).join('')
  const portalUrl = portalBillingUrl()
  const template = {
    subject,
    html: `<p>Olá, ${anchor.customer!.name}.</p><p>${sendable.length} cobrança(s) de Demurrage disponíveis (total USD ${totalUsd.toFixed(2)} — valores por fatura, sem consolidação):</p><table style="width:100%;border-collapse:collapse">${htmlList}</table><p><a href="${portalUrl}">Consultar detalhes no Portal do Cliente</a></p>`,
    text: `Olá, ${anchor.customer!.name}.\n\n${sendable.length} cobrança(s) de Demurrage disponíveis:\n${textList}\n\nConsulte os detalhes no Portal do Cliente: ${portalUrl}`,
  }
  const resendApiKey = communicationsEnabled ? Deno.env.get('RESEND_API_KEY') : null
  if (communicationsEnabled && !resendApiKey) throw new Error('RESEND_API_KEY não está configurada para envio real.')
  const communicationId = await createGroupedCommunication(admin, sendable, anchor, vesselName, voyageNumber)
  let deliveredRecipients = 0
  let simulatedRecipients = 0
  let failedRecipients = 0
  let eligibleRecipients = 0
  for (const contact of contacts) {
    for (const candidate of sendable) {
      if (!await revalidateInvoiceBeforeSend(admin, candidate.invoice_id)) return 'pausado'
    }
    const recipient = await currentEligibleRecipient(admin, first.customer_id, contact.id)
    if (!recipient) continue
    eligibleRecipients += 1
    const idempotencyKey = `demurrage:group:${communicationId}:${contact.id}:${await recipientVersion(recipient)}`
    try {
      const sent = await sendEmail({
        kind: 'cobranca_demurrage',
        to: recipient,
        subject: template.subject,
        html: template.html,
        text: template.text,
        idempotencyKey,
        resendApiKey,
        from: Deno.env.get('PORTAL_FROM_EMAIL'),
        replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO'),
        missingConfigurationMessage: 'PORTAL_FROM_EMAIL e COMMUNICATIONS_REPLY_TO são obrigatórios para envio real',
        checkSuppression: async (to) => {
          const [{ data: communicationSuppression }, { data: portalSuppression }] = await Promise.all([
            admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
            admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
          ])
          return { suppressed: Boolean(communicationSuppression || portalSuppression) }
        },
        recordAttempt: ({ idempotencyKey: attemptKey, to }) => recordDunningAttempt({
          admin,
          communicationId,
          contactId: contact.id,
          communicationsEnabled,
          attemptKey,
          to,
          keyPrefix: `demurrage:group:${communicationId}:`,
        }),
        updateAttempt: async (attemptId, update) => {
          const { error } = await admin.from('customer_communication_attempts').update({
            provider_message_id: update.providerMessageId,
            retry_count: update.retryCount,
            status: update.status,
            last_error: update.lastError,
          }).eq('id', attemptId)
          if (error) throw error
        },
      })
      if (sent.ok) {
        if (communicationsEnabled) deliveredRecipients += 1
        else simulatedRecipients += 1
      } else {
        failedRecipients += 1
      }
    } catch (error) {
      failedRecipients += 1
      console.error('[demurrage-dunning] falha no envio em grupo', first.customer_id, first.attempt_discriminator, recipient, error)
    }
  }

  if (eligibleRecipients === 0) return 'pausado'
  const allDelivered = deliveredRecipients === eligibleRecipients && failedRecipients === 0
  const allSimulated = simulatedRecipients === eligibleRecipients && failedRecipients === 0
  const fallbackStatus = allDelivered ? 'enviado' : allSimulated ? 'simulado' : 'falha'
  const { data: refreshedStatus, error: statusError } = await admin.rpc('refresh_customer_communication_status', {
    p_communication_id: communicationId,
  })
  if (statusError) throw statusError
  return (refreshedStatus ?? fallbackStatus) as 'enviado' | 'simulado' | 'parcial' | 'falha'
}

async function sendCandidate(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
  communicationsEnabled: boolean,
): Promise<'enviado' | 'simulado' | 'parcial' | 'falha' | 'pausado'> {
  const context = await loadInvoice(admin, candidate.invoice_id)
  if (!await revalidateInvoiceBeforeSend(admin, candidate.invoice_id)) return 'pausado'
  const contacts = await loadRecipients(admin, candidate.customer_id)
  if (!contacts.length) return 'pausado'

  const vesselName = context.bl?.voyage?.vessel?.name ?? ''
  const voyageNumber = context.bl?.voyage?.voyage_number ?? ''
  const currentRoe = Number(candidate.current_roe ?? context.current_roe ?? 0)
  if (!context.customer?.name || !vesselName || !voyageNumber || currentRoe <= 0) {
    throw new Error('Dados incompletos para o comunicado de Demurrage.')
  }
  const currentTotalBrl = Number(candidate.current_total_brl ?? context.current_total_brl ?? (candidate.total_usd * currentRoe))
  const template = renderDemurrageTemplate({
    customerId: candidate.customer_id,
    customerName: context.customer.name,
    vesselName,
    voyageNumber,
    port: context.bl?.pod ?? '—',
    milestoneAt: candidate.first_billed_at,
    bls: [{ id: candidate.bl_id, customerId: candidate.customer_id }],
    portalUrl: portalBillingUrl(),
    demurrage: {
      docNumber: candidate.doc_number,
      totalUsd: candidate.total_usd,
      totalBrl: currentTotalBrl,
      roe: currentRoe,
      roeReferenceDate: candidate.roe_reference_date || dateOnly(context.updated_at || context.first_billed_at),
    },
  })
  const resendApiKey = communicationsEnabled ? Deno.env.get('RESEND_API_KEY') : null
  if (communicationsEnabled && !resendApiKey) throw new Error('RESEND_API_KEY não está configurada para envio real.')
  const communicationId = await createCommunication(admin, candidate, context, vesselName, voyageNumber, null)
  let deliveredRecipients = 0
  let simulatedRecipients = 0
  let failedRecipients = 0
  let eligibleRecipients = 0
  for (const contact of contacts) {
    if (!await revalidateInvoiceBeforeSend(admin, candidate.invoice_id)) return 'pausado'
    const recipient = await currentEligibleRecipient(admin, candidate.customer_id, contact.id)
    if (!recipient) continue
    eligibleRecipients += 1
    const idempotencyKey = `demurrage:${communicationId}:${contact.id}:${await recipientVersion(recipient)}`
    try {
      const sent = await sendEmail({
        kind: 'cobranca_demurrage',
        to: recipient,
        subject: template.subject,
        html: template.html,
        text: template.text,
        idempotencyKey,
        resendApiKey,
        from: Deno.env.get('PORTAL_FROM_EMAIL'),
        replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO'),
        missingConfigurationMessage: 'PORTAL_FROM_EMAIL e COMMUNICATIONS_REPLY_TO são obrigatórios para envio real',
        checkSuppression: async (to) => {
          const [{ data: communicationSuppression }, { data: portalSuppression }] = await Promise.all([
            admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
            admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
          ])
          return { suppressed: Boolean(communicationSuppression || portalSuppression) }
        },
        recordAttempt: ({ idempotencyKey: attemptKey, to }) => recordDunningAttempt({
          admin,
          communicationId,
          contactId: contact.id,
          communicationsEnabled,
          attemptKey,
          to,
          keyPrefix: `demurrage:${communicationId}:`,
        }),
        updateAttempt: async (attemptId, update) => {
          const { error } = await admin.from('customer_communication_attempts').update({
            provider_message_id: update.providerMessageId,
            retry_count: update.retryCount,
            status: update.status,
            last_error: update.lastError,
          }).eq('id', attemptId)
          if (error) throw error
        },
      })
      if (sent.ok) {
        if (communicationsEnabled) deliveredRecipients += 1
        else simulatedRecipients += 1
      } else {
        failedRecipients += 1
      }
    } catch (error) {
      failedRecipients += 1
      console.error('[demurrage-dunning] falha no envio', candidate.invoice_id, recipient, error)
    }
  }

  if (eligibleRecipients === 0) return 'pausado'
  const allDelivered = deliveredRecipients === eligibleRecipients && failedRecipients === 0
  const allSimulated = simulatedRecipients === eligibleRecipients && failedRecipients === 0
  const fallbackStatus = allDelivered ? 'enviado' : allSimulated ? 'simulado' : 'falha'
  const { data: refreshedStatus, error: statusError } = await admin.rpc('refresh_customer_communication_status', {
    p_communication_id: communicationId,
  })
  if (statusError) throw statusError
  return (refreshedStatus ?? fallbackStatus) as 'enviado' | 'simulado' | 'parcial' | 'falha'
}

async function releaseClaim(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
): Promise<void> {
  const { error } = await admin.rpc('release_demurrage_dunning_claim', {
    p_demurrage_invoice_id: candidate.invoice_id,
    p_attempt_discriminator: candidate.attempt_discriminator,
  })
  if (error) throw error
}

async function releaseClaimSafely(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
): Promise<boolean> {
  try {
    await releaseClaim(admin, candidate)
    return true
  } catch (error) {
    console.error('[demurrage-dunning] falha ao liberar claim', candidate.invoice_id, error)
    return false
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
  const admin = createClient(url, serviceKey)
  const [{ data: settings, error: settingsError }, { data: claimed, error: claimError }] = await Promise.all([
    admin.from('app_settings').select('communications_enabled').eq('id', 1).maybeSingle(),
    admin.rpc('claim_demurrage_dunning_candidates', {
      p_as_of: new Date().toISOString(),
      p_limit: CLAIM_BATCH_SIZE,
    }),
  ])
  if (settingsError || claimError) {
    console.error('[demurrage-dunning] falha ao preparar o ciclo', settingsError ?? claimError)
    return json(500, { error: 'Falha ao preparar a régua de Demurrage.' })
  }

  const communicationsEnabled = Boolean((settings as { communications_enabled?: boolean } | null)?.communications_enabled)
  const candidates = asCandidates(claimed)
  const groups = groupDunningCandidatesByCustomerCycle(candidates)
  let sent = 0
  let simulated = 0
  let partial = 0
  let failed = 0
  let paused = 0
  let releaseFailures = 0
  for (const group of groups) {
    // Grupo unitário preserva o caminho por fatura (idempotência por invoice);
    // grupo D11 envia uma mensagem por cliente/ciclo a cada destinatário.
    if (group.length === 1) {
      const candidate = group[0]!
      try {
        const result = await sendCandidate(admin, candidate, communicationsEnabled)
        if (result === 'enviado') sent += 1
        else if (result === 'parcial') {
          // Não solta o claim: contatos que já receberam não devem receber reenvio duplicado.
          partial += 1
        } else if (result === 'falha' || result === 'pausado') {
          if (!await releaseClaimSafely(admin, candidate)) releaseFailures += 1
          if (result === 'falha') failed += 1
          else paused += 1
        } else {
          simulated += 1
        }
      } catch (error) {
        failed += 1
        if (!await releaseClaimSafely(admin, candidate)) releaseFailures += 1
        console.error('[demurrage-dunning] candidato inválido', candidate.invoice_id, error)
      }
      continue
    }
    try {
      const result = await sendCandidateGroup(admin, group, communicationsEnabled)
      if (result === 'enviado') sent += 1
      else if (result === 'parcial') {
        // Não solta o claim: contatos que já receberam não devem receber reenvio duplicado.
        partial += 1
      } else if (result === 'falha' || result === 'pausado') {
        for (const candidate of group) {
          if (!await releaseClaimSafely(admin, candidate)) releaseFailures += 1
        }
        if (result === 'falha') failed += 1
        else paused += 1
      } else {
        simulated += 1
      }
    } catch (error) {
      failed += 1
      for (const candidate of group) {
        if (!await releaseClaimSafely(admin, candidate)) releaseFailures += 1
      }
      console.error('[demurrage-dunning] grupo inválido', group[0]?.customer_id, group[0]?.attempt_discriminator, error)
    }
  }
  return json(releaseFailures ? 500 : 200, { claimed: candidates.length, sent, simulated, partial, failed, paused, releaseFailures })
}

if (typeof Deno !== 'undefined') Deno.serve(instrumentEdgeHandler('demurrage-dunning', handler))
