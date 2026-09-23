import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { withCors } from '../_shared/cors.ts'

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// ponytail: validação de magic bytes em memória para os 4 MIME types permitidos.
// Teto conhecido: não inspeciona macros ou embeds profundos em PDF;
// caminho de upgrade é verificação antivírus assíncrona/sandboxed se visualização inline for introduzida.
function matchesMagicBytes(buffer: Uint8Array, mime: string): boolean {
  if (buffer.length < 4) return false
  if (mime === 'application/pdf') {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 // %PDF
  }
  if (mime === 'image/png') {
    return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
  }
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF
  }
  if (mime === 'text/plain') {
    const slice = buffer.subarray(0, Math.min(buffer.length, 512))
    return !slice.includes(0x00)
  }
  return false
}

function json(body: { error?: string; code?: string; [key: string]: unknown }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const jwt = req.headers.get('Authorization') ?? ''

  const portal = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: userData, error: userError } = await portal.auth.getUser()
  const authUserId = userData.user?.id
  if (userError || !authUserId) {
    return json({ error: 'Sessão inválida ou expirada.', code: 'AUTH_REQUIRED' }, 401)
  }

  const admin = createClient(url, serviceKey)
  const { data: account } = await admin
    .from('customer_portal_accounts')
    .select('id, customer_id, active')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (!account || !account.active) {
    return json({ error: 'Acesso negado ao Portal.', code: 'FORBIDDEN' }, 403)
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return json({ error: 'Requisição inválida (esperado multipart/form-data).', code: 'BAD_REQUEST' }, 400)
  }

  const file = formData.get('file') as File | null
  const messageIdRaw = formData.get('message_id')
  const disputeIdRaw = formData.get('dispute_id')

  const messageId = Number(messageIdRaw)
  const disputeId = Number(disputeIdRaw)

  if (!file || !Number.isInteger(messageId) || !Number.isInteger(disputeId)) {
    return json({ error: 'Arquivo ou IDs de mensagem/disputa inválidos.', code: 'INVALID_INPUT' }, 422)
  }

  if (!ALLOWED_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return json({ error: 'Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.', code: 'INVALID_FILE' }, 422)
  }

  const fileBuffer = await file.arrayBuffer()
  const uint8 = new Uint8Array(fileBuffer)
  if (!matchesMagicBytes(uint8, file.type)) {
    return json({ error: 'Conteúdo do arquivo não corresponde ao tipo MIME informado.', code: 'INVALID_MAGIC_BYTES' }, 422)
  }

  // PAF-03: Pré-validação de autoria e integridade
  const { data: message } = await admin
    .from('demurrage_dispute_messages')
    .select('id, dispute_id, author_type, author_id')
    .eq('id', messageId)
    .maybeSingle()

  if (!message || message.dispute_id !== disputeId) {
    return json({ error: 'Mensagem não encontrada.', code: 'NOT_FOUND' }, 404)
  }

  if (message.author_type !== 'cliente' || message.author_id !== authUserId) {
    return json({ error: 'Apenas o autor da mensagem pode anexar arquivos.', code: 'FORBIDDEN' }, 403)
  }

  const { data: dispute } = await admin
    .from('demurrage_disputes')
    .select('id, customer_id')
    .eq('id', disputeId)
    .maybeSingle()

  if (!dispute || dispute.customer_id !== account.customer_id) {
    return json({ error: 'Disputa não encontrada ou não autorizada.', code: 'FORBIDDEN' }, 403)
  }

  // Caminho gerado no servidor
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${account.customer_id}/disputes/${dispute.id}/${message.id}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await admin.storage
    .from('demurrage-disputes')
    .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    return json({ error: 'Falha ao gravar anexo no storage.', code: 'STORAGE_ERROR' }, 500)
  }

  // A1: Registro de metadados e validação de quota/taxa via RPC add_demurrage_dispute_attachment
  const { data: attachmentId, error: rpcError } = await portal.rpc('add_demurrage_dispute_attachment', {
    p_message_id: message.id,
    p_storage_path: storagePath,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
  })

  if (rpcError || !attachmentId) {
    // Limpeza de órfão imediata
    await admin.storage.from('demurrage-disputes').remove([storagePath]).catch(() => null)
    const errorMessage = rpcError?.message || 'Falha ao registrar anexo.'
    const status = (rpcError?.code === '42501' || rpcError?.code === '28000') ? 403 : rpcError?.code === 'P0002' ? 404 : 422
    return json({ error: errorMessage, code: rpcError?.code || 'RPC_ERROR' }, status)
  }

  return json({ id: attachmentId, file_name: file.name, size_bytes: file.size }, 201)
}))
