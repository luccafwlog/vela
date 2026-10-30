import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../supabase'

export type DemurrageDisputeMessage = {
  id: number
  author_type: 'cliente' | 'equipamentos' | 'administrativo' | 'sistema'
  body: string
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  created_at: string
  attachments?: DisputeAttachment[]
}

export type DisputeAttachment = { id: number; file_name: string; mime_type: string; storage_path: string }

/**
 * Abre o anexo por um link temporário do Storage (60 s). Quem lê é decidido
 * pela regra do bucket: equipe interna ativa ou o Cliente dono da pasta
 * (migration 158). O link só nasce depois da autorização; nenhuma aba abre
 * antes dela.
 */
export async function openDisputeAttachment(client: SupabaseClient, attachment: DisputeAttachment): Promise<void> {
  const { data, error } = await client.storage
    .from('demurrage-disputes')
    .createSignedUrl(attachment.storage_path, 60, attachment.mime_type === 'application/pdf' ? undefined : { download: attachment.file_name })
  if (error || !data?.signedUrl) throw error ?? new Error('Anexo indisponível.')
  const link = document.createElement('a')
  link.href = data.signedUrl
  link.rel = 'noopener'
  link.target = '_blank'
  link.click()
}

export type DemurrageDispute = {
  id: number
  demurrage_invoice_id: number
  doc_number: string
  customer_id: number
  customer_name: string
  state: 'aberta' | 'resolvida' | 'cancelada'
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  subject: string | null
  created_at: string
  updated_at: string
  messages: DemurrageDisputeMessage[]
  /** Desde a migration 520 (ADR 0112, D15 e D18). */
  resolved_at?: string | null
  cancelled_at?: string | null
  invoice_status?: string | null
  invoice_total_usd?: number | null
  invoice_discount_mode?: string | null
  invoice_discount_value?: number | null
  invoice_current_total_brl?: number | null
  /** Desde quando aguarda Equipamentos; nulo quando a vez não é nossa. */
  waiting_since?: string | null
  /** 1 dia útil depois de `waiting_since`, pelo calendário do Vela. */
  due_at?: string | null
  overdue?: boolean
}

/** Rótulos da situação e da vez na aba Disputas e no Exportar dela. */
export const DISPUTE_STATE_LABELS: Record<DemurrageDispute['state'], string> = {
  aberta: 'Aberta',
  resolvida: 'Resolvida',
  cancelada: 'Cancelada',
}

export const DISPUTE_NEXT_LABELS: Record<DemurrageDispute['next_responder'], string> = {
  equipamentos: 'Aguarda a nossa resposta',
  cliente: 'Aguarda o Cliente',
  ninguem: 'Sem pendência de resposta',
}

const disputeRpc = supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

export async function listDemurrageDisputes(state: DemurrageDispute['state'] | null = null): Promise<DemurrageDispute[]> {
  const { data, error } = await disputeRpc.rpc('list_demurrage_disputes_internal', { p_state: state })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as DemurrageDispute[]
}

export async function addDemurrageDisputeMessage(disputeId: number, body: string, nextResponder: DemurrageDispute['next_responder']) {
  const { data, error } = await disputeRpc.rpc('add_demurrage_dispute_message', {
    p_dispute_id: disputeId,
    p_body: body,
    p_next_responder: nextResponder,
  })
  if (error) throw error
  return data
}

export async function reopenDemurrageDispute(disputeId: number, reason: string) {
  const { error } = await disputeRpc.rpc('reopen_demurrage_dispute', { p_dispute_id: disputeId, p_reason: reason })
  if (error) throw error
}

export async function uploadDemurrageDisputeAttachment(
  messageId: number,
  disputeId: number,
  customerId: number,
  file: File,
) {
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
  if (!allowed.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Anexo inválido. Use PDF, JPG, PNG ou TXT de até 10 MB.')
  }
  const path = `${customerId}/disputes/${disputeId}/${messageId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: uploadError } = await supabase.storage.from('demurrage-disputes').upload(path, file, { upsert: false })
  if (uploadError) throw uploadError
  const { data, error } = await disputeRpc.rpc('add_demurrage_dispute_attachment', {
    p_message_id: messageId,
    p_storage_path: path,
    p_file_name: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
  })
  if (error) {
    try {
      await supabase.storage.from('demurrage-disputes').remove([path])
    } catch {
      // Ignora erro ao tentar remover arquivo órfão
    }
    throw error
  }
  return data
}
