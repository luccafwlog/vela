import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { withCors } from '../_shared/cors.ts'

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_CUSTOMER_QUOTA = 100 * 1024 * 1024 // 100 MB
const MAX_DAILY_UPLOADS = 20

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const jwt = req.headers.get('Authorization') ?? ''

  const portal = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: userData, error: userError } = await portal.auth.getUser()
  const authUserId = userData.user?.id
  if (userError || !authUserId) {
    return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada.' }), { status: 401 })
  }

  const admin = createClient(url, serviceKey)
  const { data: account } = await admin
    .from('customer_portal_accounts')
    .select('id, customer_id, active')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (!account || !account.active) {
    return new Response(JSON.stringify({ error: 'Acesso negado ao Portal.' }), { status: 403 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return new Response(JSON.stringify({ error: 'Requisição inválida (esperado multipart/form-data).' }), { status: 400 })
  }

  const file = formData.get('file') as File | null
  const messageIdRaw = formData.get('message_id')
  const disputeIdRaw = formData.get('dispute_id')

  const messageId = Number(messageIdRaw)
  const disputeId = Number(disputeIdRaw)

  if (!file || !Number.isInteger(messageId) || !Number.isInteger(disputeId)) {
    return new Response(JSON.stringify({ error: 'Arquivo ou IDs de mensagem/disputa inválidos.' }), { status: 422 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return new Response(JSON.stringify({ error: 'Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.' }), { status: 422 })
  }

  // PAF-03: Validação de autoria e integridade
  const { data: message } = await admin
    .from('demurrage_dispute_messages')
    .select('id, dispute_id, author_type, author_id')
    .eq('id', messageId)
    .maybeSingle()

  if (!message || message.dispute_id !== disputeId) {
    return new Response(JSON.stringify({ error: 'Mensagem não encontrada.' }), { status: 404 })
  }

  if (message.author_type !== 'cliente' || message.author_id !== authUserId) {
    return new Response(JSON.stringify({ error: 'Apenas o autor da mensagem pode anexar arquivos.' }), { status: 403 })
  }

  const { data: dispute } = await admin
    .from('demurrage_disputes')
    .select('id, customer_id')
    .eq('id', disputeId)
    .maybeSingle()

  if (!dispute || dispute.customer_id !== account.customer_id) {
    return new Response(JSON.stringify({ error: 'Disputa não encontrada ou não autorizada.' }), { status: 403 })
  }

  // Quota e Rate Limit (G-PAF1)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('demurrage_dispute_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', account.customer_id)
    .gte('created_at', oneDayAgo)

  if (typeof count === 'number' && count >= MAX_DAILY_UPLOADS) {
    return new Response(JSON.stringify({ error: 'Limite diário de 20 anexos excedido.' }), { status: 429 })
  }

  const { data: existingAttachments } = await admin
    .from('demurrage_dispute_attachments')
    .select('size_bytes')
    .eq('customer_id', account.customer_id)

  const currentUsageBytes = (existingAttachments ?? []).reduce((acc, row) => acc + Number(row.size_bytes || 0), 0)
  if (currentUsageBytes + file.size > MAX_CUSTOMER_QUOTA) {
    return new Response(JSON.stringify({ error: 'Quota de armazenamento de anexos de 100 MB excedida.' }), { status: 422 })
  }

  // Caminho gerado no servidor
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${account.customer_id}/disputes/${dispute.id}/${message.id}/${crypto.randomUUID()}-${safeName}`
  const fileBuffer = await file.arrayBuffer()

  const { error: uploadError } = await admin.storage
    .from('demurrage-disputes')
    .upload(storagePath, fileBuffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    return new Response(JSON.stringify({ error: 'Falha ao gravar anexo no storage.' }), { status: 500 })
  }

  // Registro de metadados
  const { data: attachment, error: insertError } = await admin
    .from('demurrage_dispute_attachments')
    .insert({
      message_id: message.id,
      dispute_id: dispute.id,
      customer_id: account.customer_id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: authUserId,
    })
    .select('id, file_name, size_bytes')
    .single()

  if (insertError || !attachment) {
    // Limpeza de órfão imediata
    await admin.storage.from('demurrage-disputes').remove([storagePath]).catch(() => null)
    return new Response(JSON.stringify({ error: 'Falha ao registrar anexo.' }), { status: 500 })
  }

  return new Response(JSON.stringify(attachment), { status: 201, headers: { 'Content-Type': 'application/json' } })
}))
