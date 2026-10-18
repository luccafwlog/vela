import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { corsHeaders, withCors } from '../_shared/cors.ts'
import { base64Head, matchesExtension, matchesMagicBytes } from '../_shared/fileSignature.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'
import { sendEmail, type EmailAttachment } from '../_shared/email.ts'
import {
  communicationAttemptRecorder,
  isPermanentProviderFailure,
  missingProviderConfiguration,
  recordUnsentCommunicationAttempt,
  settleCommunicationStatus,
  type CommunicationAttemptStore,
} from '../_shared/customerCommunicationAttempts.ts'
import { resolveCommunicationAttemptKey } from '../_shared/customerCommunicationAttemptKey.ts'
import {
  assertValidCommunicationAttachments,
  renderCustomerCommunicationTemplate,
  renderCeMercanteTaxasTemplate,
  type CustomerCommunicationKind,
  type CommunicationAttachment,
} from '../_shared/customerCommunicationTemplates.ts'

// Cliente sem schema tipado: com `ReturnType<typeof createClient>` o deno check
// resolve as tabelas como `never` (plano dos e-mails, 5.4).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>

const ALLOWED_KINDS = new Set<CustomerCommunicationKind>([
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
  'ce_mercante_taxas',
  'cobranca_demurrage',
  'institucional',
  'livre',
])
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type DispatchPayload = {
  customer_id?: number
  kind?: string
  nature?: string
  recipient?: string
  subject?: string
  html?: string
  text?: string
  // Texto escrito pela equipe em `livre`/`institucional`; o servidor renderiza
  // o e-mail a partir dele e ignora html/text do navegador (auditoria run-2, #10).
  message_body?: string
  bl_ids?: string[]
  anchor_voyage_id?: number | null
  anchor_port?: string | null
  anchor_atracacao_id?: string | null
  anchor_invoice_id?: number | null
  attempt_discriminator?: number
  dispatch_id?: string | null
  vessel_name?: string | null
  voyage_number?: string | null
  terminal_name?: string | null
  idempotency_key?: string
  attachments?: Array<{
    filename?: string
    content_type?: string
    size?: number
    content_base64?: string
  }>
  origin?: 'manual' | 'automatico'
  audience_mode?: string
  recipient_box_code?: string | null
}

type ContactRow = { id: number; customer_id: number | null; email: string | null }

type AnchorValidation = {
  ok: boolean
  error?: string
  voyage_id?: number | null
  port?: string | null
  milestone_at?: string | null
  terminal_id?: string | null
  terminal_code?: string | null
}

function json(status: number, body: unknown, origin: string | null): Response {
  // Toda recusa deixa o motivo no log: sem isto o loop de 422 do CE Mercante
  // passou um dia sem rastro. As mensagens não carregam e-mail do destinatário.
  if (status >= 400 && status < 500) {
    const error = isRecord(body) ? body.error : undefined
    console.warn('[send-customer-communication] recusa', { status, error, permanent: isRecord(body) && body.permanent === true })
  }
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

/**
 * 422 que só muda com outro código ou outro payload. O runner automático
 * rejeita a claim em vez de liberá-la. Recusas que dependem de dados mutáveis
 * (prontidão financeira, contato, cliente, escala ou Atracação) ficam sem a
 * marca e continuam sendo tentadas de novo.
 */
function permanentRejection(error: string, origin: string | null): Response {
  return json(422, { error, permanent: true }, origin)
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Renderiza `livre`/`institucional` com o nome do Cliente e o escopo lidos do
// banco; o HTML enviado pelo navegador nunca chega ao destinatário.
async function renderUserWrittenCommunication(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente sem tipos do banco, como os demais helpers daqui
  admin: any,
  input: { kind: 'livre' | 'institucional'; customerId: number; subject: string; messageBody: string; blIds: string[]; port: string | null },
): Promise<{ subject: string; html: string; text: string; blIds: string[] }> {
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('name')
    .eq('id', input.customerId)
    .single()
  if (customerError || !customer?.name) throw new Error('Cliente não encontrado para o comunicado.')
  let vesselName = ''
  let voyageNumber = ''
  let port = input.port?.trim() ?? ''
  if (input.blIds.length > 0) {
    const { data: bl, error: blError } = await admin
      .from('bls')
      .select('pod, voyage:voyages(voyage_number, vessel:vessels(name))')
      .eq('id', input.blIds[0])
      .single()
    if (blError || !bl) throw new Error('Não foi possível conferir os B/Ls do comunicado.')
    const row = bl as unknown as { pod: string | null; voyage: { voyage_number: string | null; vessel: { name: string | null } | null } | null }
    vesselName = row.voyage?.vessel?.name ?? ''
    voyageNumber = row.voyage?.voyage_number ?? ''
    port = port || (row.pod ?? '')
  }
  const rendered = renderCustomerCommunicationTemplate(input.kind, {
    customerId: input.customerId,
    customerName: customer.name,
    vesselName,
    voyageNumber,
    port,
    milestoneAt: '',
    subject: input.subject,
    body: input.messageBody,
    bls: input.blIds.map((id) => ({ id, customerId: input.customerId })),
  })
  return { subject: rendered.subject, html: rendered.html, text: rendered.text, blIds: rendered.blIds }
}

function parsePayload(value: unknown): DispatchPayload {
  if (!isRecord(value)) throw new Error('Payload inválido.')
  return value as DispatchPayload
}

function natureForKind(kind: string, nature: string): boolean {
  if (kind === 'aviso_chegada_noa' || kind === 'aviso_prontidao_nor' || kind === 'aviso_atracacao_nob') return nature === 'avisos_operacionais'
  if (kind === 'ce_mercante_taxas') return nature === 'documentacao'
  if (kind === 'cobranca_demurrage') return nature === 'demurrage'
  if (kind === 'institucional') return nature === 'avisos_gerais'
  return ['avisos_gerais', 'avisos_operacionais', 'documentacao', 'demurrage'].includes(nature)
}

function assertBase64Content(value: string): void {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

function decodeBase64ByteLength(value: string): number {
  assertBase64Content(value)
  try {
    return atob(value).length
  } catch {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

function decodeBase64Bytes(value: string): Uint8Array {
  assertBase64Content(value)
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeStorageFileName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return safe || 'anexo'
}

function portalBillingUrl(): string {
  const configured = (Deno.env.get('PORTAL_URL') ?? '').trim().replace(/\/+$/, '')
  if (!configured) return 'https://portalfwlog.com.br/portal/billing'
  if (configured.endsWith('/portal/billing')) return configured
  if (configured.endsWith('/portal')) return `${configured}/billing`
  if (configured.endsWith('/billing')) return `${configured.slice(0, -'/billing'.length)}/portal/billing`
  return `${configured}/portal/billing`
}

function isAlreadyExists(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.statusCode === 409
    || error.code === '23505'
    || /already exists|duplicate/i.test(String(error.message ?? ''))
}

async function persistCommunicationAttachments(
  admin: Admin,
  communicationId: number,
  attachments: readonly CommunicationAttachment[],
  uploadedBy: string | null,
): Promise<void> {
  if (!attachments.length) return

  type PersistedAttachment = { storage_path: string; size_bytes: number }
  const prepared = await Promise.all(attachments.map(async (attachment, index) => ({
    attachment,
    storagePath: `${communicationId}/${await sha256Hex(`${index}:${attachment.contentBase64 ?? ''}`)}-${index + 1}-${safeStorageFileName(attachment.filename)}`,
    bytes: decodeBase64Bytes(attachment.contentBase64 ?? ''),
  })))
  const { data: existingData, error: existingError } = await admin
    .from('customer_communication_attachments')
    .select('storage_path, size_bytes')
    .eq('communication_id', communicationId)
  if (existingError) throw existingError
  const existing = (existingData ?? []) as PersistedAttachment[]
  const existingPaths = new Set(existing.map((row) => row.storage_path))
  const newAttachments = prepared.filter((item) => !existingPaths.has(item.storagePath))
  const existingBytes = existing.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0)
  const newBytes = newAttachments.reduce((sum, item) => sum + item.bytes.length, 0)
  if (existing.length + newAttachments.length > 3) {
    throw new Error('O comunicado não pode ter mais de 3 anexos.')
  }
  if (existingBytes + newBytes > 10 * 1024 * 1024) {
    throw new Error('O tamanho total dos anexos do comunicado não pode ultrapassar 10 MB.')
  }
  if (!newAttachments.length) return

  const uploadedNow: string[] = []
  try {
    for (const item of newAttachments) {
      const { attachment, storagePath, bytes } = item
      const { error: uploadError } = await admin.storage
        .from('customer-communications')
        .upload(storagePath, bytes, { contentType: attachment.contentType, upsert: false })
      if (uploadError && !isAlreadyExists(uploadError)) throw uploadError
      if (!uploadError) uploadedNow.push(storagePath)

      const { error: metadataError } = await admin.from('customer_communication_attachments').insert({
        communication_id: communicationId,
        storage_path: storagePath,
        file_name: attachment.filename,
        mime_type: attachment.contentType,
        size_bytes: attachment.size,
        uploaded_by: uploadedBy,
      })
      if (metadataError && !isAlreadyExists(metadataError)) throw metadataError
    }
  } catch (error) {
    if (uploadedNow.length) {
      await admin.storage.from('customer-communications').remove(uploadedNow).catch(() => undefined)
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505'
}

type CommunicationIdentityRow = {
  id: number
  anchor_voyage_id: number | null
  anchor_port: string | null
  anchor_atracacao_id: string | null
  anchor_invoice_id: number | null
  dispatch_id: string | null
}

function normalizedAnchorPort(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

async function findExistingCommunicationId(
  admin: Admin,
  input: {
    customerId: number
    kind: string
    nature: string
    anchorVoyageId?: number | null
    anchorPort?: string | null
    anchorAtracacaoId?: string | null
    anchorInvoiceId?: number | null
    attemptDiscriminator: number
    dispatchId?: string | null
  },
): Promise<number | null> {
  let query = admin
    .from('customer_communications')
    .select('id, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, dispatch_id')
    .eq('customer_id', input.customerId)
    .eq('kind', input.kind)
    .eq('nature', input.nature)
    .eq('attempt_discriminator', input.attemptDiscriminator)
  query = input.anchorVoyageId == null
    ? query.is('anchor_voyage_id', null)
    : query.eq('anchor_voyage_id', input.anchorVoyageId)
  const { data, error } = await query
    .order('id', { ascending: false })
    .limit(20)
  if (error) throw error

  const anchorPort = normalizedAnchorPort(input.anchorPort)
  const row = ((data ?? []) as CommunicationIdentityRow[]).find((candidate) =>
    candidate.anchor_voyage_id === (input.anchorVoyageId ?? null)
    && candidate.anchor_port === anchorPort
    && (candidate.anchor_atracacao_id ?? null) === (input.anchorAtracacaoId ?? null)
    && (candidate.anchor_invoice_id ?? null) === (input.anchorInvoiceId ?? null)
    && (candidate.dispatch_id ?? null) === (input.dispatchId ?? null),
  )
  return row?.id ?? null
}

// Acesso ao banco do registro da tentativa e do status final
// (_shared/customerCommunicationAttempts.ts).
function communicationAttemptStore(admin: Admin): CommunicationAttemptStore {
  return {
    insertAttempt: (row) => admin.from('customer_communication_attempts').insert(row).select('id').single(),
    findAttemptByKey: (idempotencyKey) => admin
      .from('customer_communication_attempts')
      .select('id, status, provider_message_id, dispatch_mode')
      .eq('idempotency_key', idempotencyKey)
      .single(),
    patchAttempt: (id, patch) => admin.from('customer_communication_attempts').update(patch).eq('id', id),
    refreshStatus: (communicationId) => admin.rpc('refresh_customer_communication_status', { p_communication_id: communicationId }),
    persistStatus: (communicationId, status) => admin.from('customer_communications').update({ status }).eq('id', communicationId),
  }
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

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin')
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' }, origin)

  const jwt = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(jwt)) return json(401, { error: 'Autenticação obrigatória.' }, origin)

  const automationSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedAutomationSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  const isAutomation = Boolean(automationSecret && timingSafeEqual(providedAutomationSecret, automationSecret))

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: role, error: roleError } = isAutomation ? { data: 'automatico', error: null } : await caller.rpc('portal_current_role')
  if (!isAutomation && (roleError || !['administrativo', 'documentacao', 'equipamentos'].includes(String(role)))) {
    return json(403, { error: 'Sem permissão para Comunicados.' }, origin)
  }
  const { data: callerUser } = isAutomation ? { data: { user: null } } : await caller.auth.getUser()
  if (!isAutomation && !callerUser.user) return json(401, { error: 'Sessão inválida.' }, origin)

  let body: DispatchPayload
  try {
    body = parsePayload(await req.json())
  } catch (error) {
    return permanentRejection(error instanceof Error ? error.message : 'Payload inválido.', origin)
  }

  const customerId = Number(body.customer_id)
  const kind = String(body.kind ?? '')
  const nature = String(body.nature ?? '').trim()
  const recipient = normalizeEmail(String(body.recipient ?? ''))
  const subject = String(body.subject ?? '').trim()
  const html = String(body.html ?? '')
  const text = String(body.text ?? '')
  const attemptDiscriminator = Number(body.attempt_discriminator ?? 0)
  if (!Number.isInteger(customerId) || customerId <= 0) return permanentRejection('Cliente inválido.', origin)
  if (!ALLOWED_KINDS.has(kind as CustomerCommunicationKind)) return permanentRejection('Tipo de comunicado não disponível neste bloco.', origin)
  // A natureza é validada antes de qualquer renderização/mensagem para não
  // permitir que um payload incompleto contorne o isolamento da fundação.
  if (!nature || !natureForKind(kind, nature)) return permanentRejection('Natureza inválida ou ausente.', origin)
  if (!EMAIL_PATTERN.test(recipient)) return permanentRejection('Destinatário inválido.', origin)
  if (kind !== 'ce_mercante_taxas' && (!subject || !html || !text)) return permanentRejection('Assunto e conteúdo do comunicado são obrigatórios.', origin)
  if (kind === 'cobranca_demurrage') return permanentRejection('Cobrança de Demurrage é enviada exclusivamente pela régua automática.', origin)
  if (!Number.isInteger(attemptDiscriminator) || attemptDiscriminator < 0) return permanentRejection('Discriminador de tentativa inválido.', origin)

  const blIds = body.bl_ids ?? []
  if (!Array.isArray(blIds) || !blIds.every((blId) => typeof blId === 'string' && blId.trim().length > 0)) {
    return permanentRejection('B/Ls inválidos.', origin)
  }
  if (kind === 'institucional' && blIds.length > 0) {
    return permanentRejection('Comunicado institucional não pode conter B/Ls.', origin)
  }
  if (kind !== 'institucional' && blIds.length === 0) {
    return permanentRejection('Selecione ao menos um B/L para o comunicado.', origin)
  }
  const fixedOperationalKind = ['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob'].includes(kind)
  if (fixedOperationalKind && (!Number.isInteger(body.anchor_voyage_id) || Number(body.anchor_voyage_id) <= 0 || !body.anchor_port?.trim())) {
    return permanentRejection('Viagem e porto são obrigatórios para o comunicado operacional.', origin)
  }
  if (kind === 'aviso_atracacao_nob' && !body.anchor_atracacao_id?.trim()) {
    return permanentRejection('Atracação obrigatória para o NOB.', origin)
  }

  const attachments: CommunicationAttachment[] = []
  const emailAttachments: EmailAttachment[] = []
  try {
    for (const [index, attachment] of (body.attachments ?? []).entries()) {
      if (!attachment || typeof attachment !== 'object') return permanentRejection(`Anexo inválido na posição ${index + 1}.`, origin)
      const filename = String(attachment.filename ?? '').trim()
      const contentType = String(attachment.content_type ?? '').trim().toLowerCase()
      const contentBase64 = String(attachment.content_base64 ?? '')
      const actualSize = decodeBase64ByteLength(contentBase64)
      const declaredSize = Number(attachment.size ?? actualSize)
      if (declaredSize !== actualSize) return permanentRejection(`Tamanho inconsistente no anexo ${index + 1}.`, origin)
      // Tipo declarado precisa bater com conteúdo e extensão (auditoria run-2, reforço).
      if (!matchesExtension(filename, contentType) || !matchesMagicBytes(base64Head(contentBase64), contentType)) {
        return permanentRejection(`O conteúdo do anexo ${index + 1} não corresponde ao tipo informado.`, origin)
      }
      attachments.push({ filename, contentType, size: actualSize, contentBase64 })
      emailAttachments.push({ filename, content: contentBase64, contentType })
    }
  } catch (error) {
    return permanentRejection(error instanceof Error ? error.message : 'Conteúdo de anexo inválido.', origin)
  }
  try {
    assertValidCommunicationAttachments(kind, attachments)
  } catch (error) {
    return permanentRejection(error instanceof Error ? error.message : 'Anexos inválidos.', origin)
  }

  const admin = createClient(url, serviceKey)
  // Cliente desativado não recebe Comunicado (auditoria run-2, reforço).
  const { data: targetCustomer, error: targetCustomerError } = await admin.from('customers').select('deactivated_at').eq('id', customerId).maybeSingle()
  if (targetCustomerError) return json(500, { error: 'Não foi possível conferir o cliente.' }, origin)
  if (!targetCustomer) return json(422, { error: 'Cliente inválido.' }, origin)
  if (targetCustomer.deactivated_at) return json(422, { error: 'Cliente desativado não recebe Comunicados.' }, origin)

  let canonicalPayload: { subject: string; html: string; text: string; blIds: string[] } | null = null
  // Porto gravado no Comunicado. No CE e Taxas fica nulo: a identidade é
  // Cliente × Viagem (D3) e o porto informativo vai só no corpo.
  let anchorPort: string | null = body.anchor_port ?? null
  // No NOB o histórico grava o terminal que o servidor pôs no e-mail, não o
  // que o navegador mandou.
  let canonicalTerminalName: string | null = null
  if (kind === 'ce_mercante_taxas') {
    if (!Number.isInteger(body.anchor_voyage_id) || Number(body.anchor_voyage_id) <= 0) {
      return permanentRejection('Viagem obrigatória para o comunicado financeiro.', origin)
    }
    const [{ data: readiness, error: readinessError }, { data: payload, error: payloadError }] = await Promise.all([
      admin.rpc('customer_local_charges_communication_readiness', {
        p_voyage_id: Number(body.anchor_voyage_id),
        p_customer_id: customerId,
      }),
      admin.rpc('customer_local_charges_communication_payload', {
        p_voyage_id: Number(body.anchor_voyage_id),
        p_customer_id: customerId,
      }),
    ])
    if (readinessError || payloadError) return json(500, { error: 'Não foi possível conferir os dados financeiros do comunicado.' }, origin)
    if (!(readiness as { ready?: boolean } | null)?.ready) return json(422, { error: 'Prontidão financeira bloqueada para este cliente e viagem.' }, origin)
    const row = payload as {
      customer_name?: string
      vessel_name?: string
      voyage_number?: string
      port?: string
      milestone_at?: string
      bls?: Array<{ bl_id?: string; ce_mercante?: string | null; total_brl?: number }>
    } | null
    if (!row?.customer_name || !row.vessel_name || !row.voyage_number || !Array.isArray(row.bls) || !row.bls.length) {
      return json(422, { error: 'Dados financeiros incompletos para o comunicado.' }, origin)
    }
    // A identidade do CE e Taxas é Cliente × Viagem (D3): o porto fica só no
    // corpo do e-mail e o registro grava anchor_port nulo (migration 315), para
    // a troca de POD de um B/L não criar outro Comunicado nem reenviar o CE.
    anchorPort = null
    const rendered = renderCeMercanteTaxasTemplate({
      customerId,
      customerName: row.customer_name,
      vesselName: row.vessel_name,
      voyageNumber: row.voyage_number,
      port: row.port ?? '—',
      milestoneAt: row.milestone_at ?? '',
      bls: row.bls.map((bl) => ({ id: String(bl.bl_id ?? ''), customerId })),
      portalUrl: portalBillingUrl(),
      ceMercanteRows: row.bls.map((bl) => ({
        blId: String(bl.bl_id ?? ''),
        ceMercante: String(bl.ce_mercante ?? ''),
        totalBrl: Number(bl.total_brl ?? 0),
      })),
    })
    canonicalPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text, blIds: rendered.blIds }
  }
  let effectiveBlIds = canonicalPayload?.blIds ?? blIds
  const userWrittenKind = kind === 'livre' || kind === 'institucional'
  const messageBody = String(body.message_body ?? '').trim()
  if (userWrittenKind && !messageBody) return permanentRejection('Assunto e conteúdo do comunicado são obrigatórios.', origin)
  const isFixedOperationalAudience = ['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas'].includes(kind)
  const effectiveAudienceMode = kind === 'institucional'
    ? 'todos'
    : isFixedOperationalAudience
      ? 'caixa'
      : body.audience_mode ?? 'todos'
  // Modelos de público fixo vão pela tabela customer_communication_box_kinds
  // (caixa nula): o CE e Taxas alcança Documentação/Operação e Financeiro (A22).
  const effectiveBoxCode = isFixedOperationalAudience
    ? null
    : effectiveAudienceMode === 'caixa'
      ? body.recipient_box_code ?? null
      : null
  // Navio e viagem gravados no histórico vêm dos B/Ls, não do navegador
  // (auditoria run-2, reforço); institucional não tem B/L e grava nulo.
  let derivedVesselName: string | null = null
  let derivedVoyageNumber: string | null = null
  if (effectiveBlIds.length > 0) {
    const uniqueBlIds = Array.from(new Set(effectiveBlIds))
    const { data: ownedBls, error: ownedBlsError } = await admin
      .from('bls')
      .select('id, customer_id, voyage_id, pod, cargo_mode, customer:customers!bls_customer_id_fkey(name), voyage:voyages(voyage_number, vessel:vessels(name))')
      .in('id', uniqueBlIds)
    if (ownedBlsError) return json(500, { error: 'Não foi possível conferir os B/Ls do comunicado.' }, origin)
    const validBls = (ownedBls ?? []) as unknown as Array<{ id: string; customer_id: number | null; voyage_id: number | null; pod: string | null; cargo_mode: string | null; customer: { name: string } | null; voyage: { voyage_number: string; vessel: { name: string } | null } | null }>
    if (validBls.length !== uniqueBlIds.length || validBls.some((bl) => bl.customer_id !== customerId)) {
      return json(422, { error: 'Um ou mais B/Ls não pertencem ao cliente selecionado.' }, origin)
    }
    derivedVesselName = validBls[0]?.voyage?.vessel?.name ?? null
    derivedVoyageNumber = validBls[0]?.voyage?.voyage_number ?? null
    const anchoredKind = fixedOperationalKind || kind === 'ce_mercante_taxas'
    if (!anchoredKind && body.anchor_voyage_id != null && validBls.some((bl) => bl.voyage_id !== Number(body.anchor_voyage_id))) {
      return json(422, { error: 'A viagem-âncora não corresponde aos B/Ls selecionados.' }, origin)
    }
    if (!anchoredKind && body.anchor_port && validBls.some((bl) => (bl.pod ?? '').trim().toUpperCase() !== body.anchor_port!.trim().toUpperCase())) {
      return json(422, { error: 'O porto-âncora não corresponde aos B/Ls selecionados.' }, origin)
    }
    // Escala, porto (normalizado), B/L cancelado, Atracação e regra única do
    // NOB: a mesma validação da RPC create_customer_communication_atomic, com
    // a escala lida do Histórico da Viagem (plano dos e-mails, 1C). O snapshot
    // de escalas da viagem não é lido pelos Comunicados.
    let anchor: AnchorValidation | null = null
    if (anchoredKind) {
      const { data: validation, error: validationError } = await admin.rpc('customer_communication_anchor_validation', {
        p_customer_id: customerId,
        p_kind: kind,
        p_anchor_voyage_id: body.anchor_voyage_id ?? null,
        p_anchor_port: anchorPort,
        p_anchor_atracacao_id: body.anchor_atracacao_id ?? null,
        p_bl_ids: uniqueBlIds,
      })
      if (validationError) {
        console.error('customer communication anchor validation failed', validationError)
        return json(500, { error: 'Não foi possível conferir a âncora do comunicado.' }, origin)
      }
      anchor = validation as AnchorValidation | null
      if (!anchor?.ok) return json(422, { error: anchor?.error ?? 'Âncora do comunicado inválida.' }, origin)
      anchorPort = anchor.port ?? anchorPort
    }
    if (fixedOperationalKind) {
      const first = validBls[0]
      const terminalId = kind === 'aviso_atracacao_nob' ? anchor?.terminal_id ?? null : null
      // O cliente lê a sigla do terminal; o UUID nunca vai para o e-mail.
      const terminalName = kind === 'aviso_atracacao_nob' ? anchor?.terminal_code ?? null : null
      if (kind === 'aviso_atracacao_nob') canonicalTerminalName = terminalName
      const milestoneAt = anchor?.milestone_at ?? null
      if (!first?.customer?.name || !first.voyage?.voyage_number || !first.voyage.vessel?.name || !milestoneAt) {
        return json(422, { error: 'Dados operacionais incompletos para renderizar o comunicado.' }, origin)
      }
      const rendered = renderCustomerCommunicationTemplate(kind as CustomerCommunicationKind, {
        customerId,
        customerName: first.customer.name,
        vesselName: first.voyage.vessel.name,
        voyageNumber: first.voyage.voyage_number,
        port: anchorPort ?? '',
        terminalId,
        terminalName,
        terminalStateId: body.anchor_atracacao_id ?? null,
        milestoneAt,
        bls: validBls.map((bl) => ({ id: bl.id, customerId, terminalId, terminalStateId: body.anchor_atracacao_id ?? null })),
      })
      canonicalPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text, blIds: rendered.blIds }
      effectiveBlIds = rendered.blIds
    }
  }
  if (userWrittenKind) {
    try {
      canonicalPayload = await renderUserWrittenCommunication(admin, {
        kind: kind as 'livre' | 'institucional',
        customerId,
        subject,
        messageBody,
        blIds: effectiveBlIds,
        port: body.anchor_port ?? null,
      })
    } catch (error) {
      return json(422, { error: error instanceof Error ? error.message : 'Não foi possível renderizar o comunicado.' }, origin)
    }
  }
  const effectiveSubject = canonicalPayload?.subject ?? subject
  const effectiveHtml = canonicalPayload?.html ?? html
  const effectiveText = canonicalPayload?.text ?? text
  const { data: contacts, error: contactsError } = await admin
    .from('customer_contacts')
    .select('id, customer_id, email')
    .eq('customer_id', customerId)
  if (contactsError) return json(500, { error: 'Não foi possível conferir o contato.' }, origin)
  const contact = ((contacts ?? []) as ContactRow[]).find((row) => normalizeEmail(row.email ?? '') === recipient)
  if (!contact) return json(422, { error: 'Destinatário não pertence ao cliente selecionado.' }, origin)

  const [
    { data: recipientAllowed, error: recipientAllowedError },
    { data: communicationSuppression, error: communicationSuppressionError },
    { data: portalSuppression, error: portalSuppressionError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    admin.rpc('customer_communication_recipient_allowed', {
      p_customer_id: customerId,
      p_contact_id: contact.id,
      p_kind: kind,
      p_audience_mode: effectiveAudienceMode,
      p_recipient_box_code: effectiveBoxCode,
    }),
    admin.from('customer_communication_suppressions').select('id').eq('email', recipient).maybeSingle(),
    admin.from('portal_suppressed_emails').select('id').eq('email', recipient).eq('reason', 'bounce_permanente').maybeSingle(),
    admin.from('app_settings').select('communications_enabled').eq('id', 1).single(),
  ])
  if (recipientAllowedError || communicationSuppressionError || portalSuppressionError || settingsError) return json(500, { error: 'Não foi possível conferir as regras de envio.' }, origin)
  if (communicationSuppression || portalSuppression) return json(422, { error: 'Endereço suprimido para Comunicados.', suppressed: true }, origin)
  if (!recipientAllowed) return json(422, { error: 'Contato desativado para esta caixa ou modelo.' }, origin)

  // Envio real sem configuração não chega a registrar o Comunicado: antes,
  // ele nascia e ficava sem tentativa (plano dos e-mails, 1B).
  const enabled = Boolean((settings as { communications_enabled?: boolean } | null)?.communications_enabled)
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (missingProviderConfiguration(enabled, { resendApiKey, from: Deno.env.get('PORTAL_FROM_EMAIL'), replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO') })) {
    console.error('[send-customer-communication] envio real sem RESEND_API_KEY, PORTAL_FROM_EMAIL ou COMMUNICATIONS_REPLY_TO')
    return json(500, { error: 'Envio real sem configuração do provedor de e-mail.' }, origin)
  }

  let existingCommunicationId: number | null = null
  if (isAutomation) {
    try {
      existingCommunicationId = await findExistingCommunicationId(admin, {
        customerId,
        kind,
        nature,
        anchorVoyageId: body.anchor_voyage_id,
        anchorPort,
        anchorAtracacaoId: body.anchor_atracacao_id,
        anchorInvoiceId: body.anchor_invoice_id,
        attemptDiscriminator,
        dispatchId: body.dispatch_id,
      })
    } catch (error) {
      console.error('customer communication identity lookup failed', error)
      return json(500, { error: 'Não foi possível conferir o comunicado existente.' }, origin)
    }
  }

  const { data: createdCommunicationId, error: createError } = await admin.rpc('create_customer_communication_atomic', {
    p_customer_id: customerId,
    p_kind: kind,
    p_nature: nature,
    p_anchor_voyage_id: body.anchor_voyage_id ?? null,
    p_anchor_port: anchorPort,
    p_anchor_atracacao_id: body.anchor_atracacao_id ?? null,
    p_anchor_invoice_id: body.anchor_invoice_id ?? null,
    p_attempt_discriminator: attemptDiscriminator,
    p_dispatch_id: body.dispatch_id ?? null,
    p_vessel_name: derivedVesselName,
    p_voyage_number: derivedVoyageNumber,
    p_terminal_name: canonicalTerminalName,
    p_created_by: callerUser.user?.id ?? null,
    p_bl_ids: effectiveBlIds,
  })
  let communicationId = createdCommunicationId as number | null
  if (createError || communicationId == null) {
    // Duas chamadas criando o mesmo Comunicado ao mesmo tempo: a perdedora
    // segue o envio no Comunicado da vencedora, em vez de responder
    // "simulado" sem enviar (plano dos e-mails, 1B).
    if (isUniqueViolation(createError)) {
      try {
        communicationId = await findExistingCommunicationId(admin, {
          customerId, kind, nature,
          anchorVoyageId: body.anchor_voyage_id,
          anchorPort,
          anchorAtracacaoId: body.anchor_atracacao_id,
          anchorInvoiceId: body.anchor_invoice_id,
          attemptDiscriminator,
          dispatchId: body.dispatch_id,
        })
      } catch (error) {
        console.error('customer communication identity lookup after conflict failed', error)
      }
    }
    if (communicationId == null) {
      console.error('customer communication atomic record failed', createError)
      return json(500, { error: 'Não foi possível registrar o comunicado.' }, origin)
    }
  }

  // Cópia do que saiu: o registro do comunicado guarda assunto, texto e o
  // hash do HTML efetivamente enviados (auditoria run-2, #10).
  const { error: renderedError } = await admin
    .from('customer_communications')
    .update({
      rendered_subject: effectiveSubject,
      rendered_text: effectiveText,
      rendered_html_sha256: await sha256Hex(effectiveHtml),
    })
    .eq('id', communicationId)
    .is('rendered_subject', null)
  if (renderedError) {
    console.error('customer communication rendered copy persistence failed', renderedError)
    return json(500, { error: 'Não foi possível registrar o conteúdo do comunicado.' }, origin)
  }

  if (isAutomation && existingCommunicationId == null) {
    const { error: originError } = await admin.from('customer_communications').update({ origin: 'automatico' }).eq('id', communicationId)
    if (originError) {
      console.error('customer communication origin persistence failed', originError)
      return json(500, { error: 'Não foi possível registrar a origem do comunicado.' }, origin)
    }
  }

  try {
    await persistCommunicationAttachments(admin, Number(communicationId), attachments, callerUser.user?.id ?? null)
  } catch (error) {
    await admin.from('customer_communications').update({ status: 'falha' }).eq('id', communicationId)
    console.error('customer communication attachment persistence failed', error)
    return json(500, { error: 'Não foi possível persistir os anexos do comunicado.' }, origin)
  }

  if (kind === 'ce_mercante_taxas') {
    const { error: dispatchReadinessError } = await admin.rpc('customer_local_charges_communication_dispatch_ready', {
      p_voyage_id: Number(body.anchor_voyage_id),
      p_customer_id: customerId,
    })
    if (dispatchReadinessError) {
      const { error: blockedStatusError } = await admin.rpc('mark_customer_communication_dispatch_blocked', {
        p_communication_id: Number(communicationId),
      })
      if (blockedStatusError) console.error('customer communication blocked status persistence failed', blockedStatusError)
      console.error('customer communication dispatch readiness failed', dispatchReadinessError)
      return json(422, { error: 'Prontidão financeira bloqueada para este cliente e viagem.' }, origin)
    }
  }

  let attemptKey: string
  try {
    attemptKey = await resolveCommunicationAttemptKey(
      { communicationId: Number(communicationId), attemptDiscriminator, recipient },
      async (idempotencyKey) => {
        const { data, error } = await admin.from('customer_communication_attempts').select('id').eq('idempotency_key', idempotencyKey).maybeSingle()
        if (error) throw error
        return Boolean(data)
      },
    )
  } catch (error) {
    console.error('customer communication attempt lookup failed', error)
    return json(500, { error: 'Não foi possível conferir a tentativa do comunicado.' }, origin)
  }

  const attemptStore = communicationAttemptStore(admin)
  const attemptRecorder = communicationAttemptRecorder(attemptStore, { communicationId: Number(communicationId), enabled })
  let sent: { ok: boolean }
  try {
    sent = await sendEmail({
      kind,
      to: recipient,
      subject: effectiveSubject,
      html: effectiveHtml,
      text: effectiveText,
      attachments: emailAttachments,
      idempotencyKey: attemptKey,
      resendApiKey: enabled ? resendApiKey : null,
      simulate: !enabled,
      from: Deno.env.get('PORTAL_FROM_EMAIL'),
      replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO'),
      missingConfigurationMessage: 'PORTAL_FROM_EMAIL e COMMUNICATIONS_REPLY_TO são obrigatórios para envio real',
      checkSuppression: async (to) => {
        const [{ data: complaint, error: complaintError }, { data: bounce, error: bounceError }] = await Promise.all([
          admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
          admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
        ])
        // Erro na consulta não libera o envio para um endereço que pode estar suprimido.
        if (complaintError || bounceError) throw complaintError ?? bounceError
        return { suppressed: Boolean(complaint || bounce) }
      },
      ...attemptRecorder,
    })
  } catch (error) {
    // Exceção neste destinatário não apaga o que os outros já receberam: o
    // status vem das tentativas, e este destinatário conta como falha.
    console.error('customer communication send failed', error)
    // Grava o destinatário como falha_transitoria: o Histórico o mostra e a
    // produtora o tenta de novo (o alvo só é feito com a entrega, migration 315).
    const recorded = await recordUnsentCommunicationAttempt(attemptStore, {
      communicationId: Number(communicationId), enabled, recipient, idempotencyKey: attemptKey,
      reason: `Falha antes do envio: ${error instanceof Error ? error.message : String(error)}`,
    })
    const { status: statusAfterError } = await settleCommunicationStatus(attemptStore, {
      communicationId: Number(communicationId), enabled, succeeded: 0, failed: recorded ? 1 : 0, unrecordedFailures: recorded ? 0 : 1,
    })
    return json(500, { error: 'Falha no envio do comunicado.', status: statusAfterError, communicationId }, origin)
  }

  const { status, refreshError: statusError } = await settleCommunicationStatus(attemptStore, {
    communicationId: Number(communicationId), enabled, succeeded: sent.ok ? 1 : 0, failed: sent.ok ? 0 : 1,
  })
  if (statusError) {
    console.error('customer communication status persistence failed', statusError)
    return json(500, { error: 'Não foi possível persistir o status do comunicado.' }, origin)
  }
  const { data: attempt } = await admin
    .from('customer_communication_attempts')
    .select('id, status, last_error')
    .eq('communication_id', communicationId)
    .eq('idempotency_key', attemptKey)
    .maybeSingle()
  return json(sent.ok ? 200 : 502, {
    communicationId,
    attemptId: attempt?.id ?? undefined,
    status,
    suppressed: false,
    // Recusa definitiva do provedor (ex.: 422 do endereço): a mesma chave nunca
    // mais chama o provedor, então a régua rejeita a claim (plano, 1D.4).
    ...(isPermanentProviderFailure(sent.ok, attempt?.status) ? { permanent: true } : {}),
    // Motivo técnico da tentativa (`HTTP 422 validation_error`, "Tempo
    // esgotado…"): a tela o traduz no resumo do lote. Fica fora de `error`,
    // que a régua automática usa como motivo da claim.
    ...(!sent.ok && attempt?.last_error ? { reason: attempt.last_error } : {}),
    message: !sent.ok ? 'Falha no envio do comunicado.' : enabled ? 'Comunicado enviado.' : 'Comunicado registrado em simulação; nenhum e-mail foi enviado.',
  }, origin)
}

if (typeof Deno !== 'undefined') {
  Deno.serve(instrumentEdgeHandler('send-customer-communication', withCors(handler)))
}
