import { supabase } from './supabase'

export type VoyageScheduleEvent = {
  entity_type?: string | null
  entity_id: string
  field_name: string
  old_value?: string | null
  new_value: string | null
  changed_by?: string | null
  actor_role?: string | null
  actor_department?: string | null
  justification?: string | null
  changed_at: string | null
}

export type VoyageAuditEvent = VoyageScheduleEvent

export type VoyageResolutionEvent = {
  field_name: string | null
  resolved_at: string | null
}

export type VoyageBaplieImportEvent = {
  imported_at: string | null
  container_count: number | null
}
export type VoyageImportBatchEvent = { id: number; filename: string; cargo_mode: 'container' | 'carga_solta' | null; uploaded_at: string | null; uploaded_by?: string | null; route_summary?: string | null; total_bls?: number | null; ce_master?: string | null }

/**
 * Fontes da linha do tempo de uma viagem: eventos de escala (audit_logs,
 * insert-only) e resoluções de conciliação Baplie↔Manifesto. Sem eventos
 * financeiros, por decisão de produto.
 */
export async function fetchVoyageTimelineSources(
  voyageId: number,
): Promise<{
  scheduleEvents: VoyageScheduleEvent[]
  auditEvents: VoyageAuditEvent[]
  resolutions: VoyageResolutionEvent[]
  baplieImports: VoyageBaplieImportEvent[]
  importBatches: VoyageImportBatchEvent[]
  actorNames: Record<string, string>
  actorDepartments: Record<string, string>
}> {
  const [scheduleRes, auditRes, resolutionRes, baplieRes, importsRes] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('entity_type, entity_id, field_name, old_value, new_value, changed_by, actor_role, actor_department, justification, changed_at')
      .in('entity_type', ['voyage_pod_schedule', 'voyage_pol_schedule'])
      .like('entity_id', `${voyageId}::%`)
      .order('changed_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('audit_logs')
      .select('entity_type, entity_id, field_name, old_value, new_value, changed_by, actor_role, actor_department, justification, changed_at')
      // `import_batches` é o gatilho do lote (id do lote): lido abaixo pelo id
      // do lote, nunca pelo id da Viagem (migration 404, F-24).
      .in('entity_type', ['voyages', 'voyage', 'import_batch', 'baplie_import'])
      .eq('entity_id', String(voyageId))
      .order('changed_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('baplie_reconciliation_resolutions')
      .select('field_name, resolved_at')
      .eq('voyage_id', voyageId)
      .order('resolved_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('baplie_containers')
      .select('imported_at', { count: 'exact' })
      .eq('voyage_id', voyageId)
      .order('imported_at', { ascending: true })
      .limit(1),
    supabase.from('import_batches').select('id, filename, cargo_mode, uploaded_at, uploaded_by, route_summary, total_bls, ce_master').eq('voyage_id', voyageId).order('uploaded_at', { ascending: false }),
  ])

  if (scheduleRes.error) throw scheduleRes.error
  if (auditRes.error) throw auditRes.error
  if (resolutionRes.error) throw resolutionRes.error
  if (baplieRes.error) throw baplieRes.error
  if (importsRes.error) throw importsRes.error

  const importBatchIds = (importsRes.data ?? []).map((row) => String(row.id))
  const importBatchAuditRes = importBatchIds.length
    ? await supabase
        .from('audit_logs')
      .select('entity_id, field_name, changed_by, actor_role, actor_department')
        .eq('entity_type', 'import_batches')
        .eq('field_name', 'criado')
        .in('entity_id', importBatchIds)
    : { data: [], error: null }
  if (importBatchAuditRes.error) throw importBatchAuditRes.error

  const actorIds = Array.from(
    new Set([
      ...(scheduleRes.data ?? []).map((row) => row.changed_by),
      ...(auditRes.data ?? []).map((row) => row.changed_by),
      ...(importBatchAuditRes.data ?? []).map((row) => row.changed_by),
      ...(importsRes.data ?? []).map((row) => row.uploaded_by),
    ].filter(Boolean)),
  ) as string[]
  const actorNames: Record<string, string> = {}
  const actorDepartments: Record<string, string> = {}

  if (actorIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .in('id', actorIds)
    if (profilesError) throw profilesError

    for (const profile of profiles ?? []) {
      const row = profile as { id: string; full_name: string | null }
      const name = String(row.full_name ?? '').trim()
      if (name) actorNames[row.id] = name
    }
  }

  for (const row of importsRes.data ?? []) {
    if (row.uploaded_by) {
      const audit = (importBatchAuditRes.data ?? []).find(
        (event) => event.entity_id === String(row.id) && event.changed_by === row.uploaded_by,
      )
      const department = audit?.actor_department
        ? TIMELINE_ROLE_LABELS[audit.actor_department] ?? audit.actor_department
        : audit?.actor_role
          ? TIMELINE_ROLE_LABELS[audit.actor_role] ?? audit.actor_role
          : null
      if (department) actorDepartments[row.uploaded_by] = department
    }
  }

  return {
    scheduleEvents: (scheduleRes.data ?? []) as VoyageScheduleEvent[],
    auditEvents: (auditRes.data ?? []) as VoyageAuditEvent[],
    resolutions: (resolutionRes.data ?? []) as VoyageResolutionEvent[],
    baplieImports: (baplieRes.data ?? []).map((row) => ({
      imported_at: String((row as { imported_at?: string | null }).imported_at ?? ''),
      container_count: baplieRes.count ?? null,
    })),
    importBatches: (importsRes.data ?? []).map((row) => ({ ...row, cargo_mode: row.cargo_mode === 'carga_solta' ? 'carga_solta' : 'container' })) as VoyageImportBatchEvent[],
    actorNames,
    actorDepartments,
  }
}

export const TIMELINE_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrativo',
  operator: 'Documentação',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
  operacoes: 'Operações',
  documentacao: 'Documentação',
  equipamentos: 'Equipamentos',
}
