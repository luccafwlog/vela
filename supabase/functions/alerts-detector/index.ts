import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'
import { runWithBetterStackHeartbeat } from '../_shared/betterStackHeartbeat.ts'
import { instrumentEdgeHandler } from '../_shared/telemetry.ts'

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index]
  return diff === 0
}

// Upload do Portal que não virou anexo registrado fica no Storage sem dono
// (auditoria run-2, reforço). Roda junto do detector, que já tem job; falha
// aqui não derruba os alertas.
// ponytail: até 100 objetos por execução; a fila esvazia em poucas rodadas.
type StorageAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
  storage: { from: (bucket: string) => { remove: (paths: string[]) => PromiseLike<{ error: unknown }> } }
}

async function removeOrphanedDisputeAttachments(admin: StorageAdmin): Promise<number> {
  const { data, error } = await admin.rpc('list_orphaned_dispute_attachments', { p_older_than: '1 day' })
  if (error) {
    console.error('orphaned dispute attachments listing failed', error)
    return 0
  }
  const paths = ((data ?? []) as Array<{ storage_path: string }>).slice(0, 100).map((row) => row.storage_path)
  if (paths.length === 0) return 0
  const { error: removeError } = await admin.storage.from('demurrage-disputes').remove(paths)
  if (removeError) {
    console.error('orphaned dispute attachments removal failed', removeError)
    return 0
  }
  return paths.length
}

if (typeof Deno !== 'undefined') {
  const edgeHandler = instrumentEdgeHandler('alerts-detector', async (req) => {
    if (req.method !== 'POST') return new Response(null, { status: 405 })

    const expectedSecret = Deno.env.get('ALERTS_DETECTOR_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data, error } = await admin.rpc('run_alert_detectors')
    if (error) {
      console.error('alerts detector failed', error)
      return new Response(JSON.stringify({ error: 'Detector execution failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const orphanedDisputeAttachments = await removeOrphanedDisputeAttachments(admin as unknown as StorageAdmin)
    return new Response(JSON.stringify({ ...(data ?? {}), orphaned_dispute_attachments_removed: orphanedDisputeAttachments }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  Deno.serve((req) => {
    const expectedSecret = Deno.env.get('ALERTS_DETECTOR_SECRET') ?? ''
    const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const authorized = req.method === 'POST' && Boolean(expectedSecret) && timingSafeEqual(providedSecret, expectedSecret)
    return runWithBetterStackHeartbeat('alertsDetector', () => edgeHandler(req), { enabled: authorized })
  })
}
