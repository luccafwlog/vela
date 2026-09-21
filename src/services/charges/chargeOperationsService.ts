import { supabase } from '../supabase'
import { escapeFilterTerm, sanitizeLikeTerm } from '../../lib/utils'
import { classifyDbError } from '../../lib/errors'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'

const OPERATIONAL_PAGE_SIZE = 1000

export type LocalChargeLine = {
  id: number
  bl_id: string
  charge_table_id: number | null
  charge_item_id: number | null
  charge_name: string
  // Migration 369: a linha diz de qual tabela de cobranca veio e sob qual base
  // foi aplicada. `charge_tables` e admin-only sob RLS, entao sem estas colunas
  // a tela nao tem como nomear a tabela usada no calculo.
  charge_table_name: string | null
  charge_table_pod: string | null
  application_basis: string | null
  source: 'auto' | 'manual' | null
  status: 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt' | null
  quantity: number | null
  currency: string | null
  unit_value_brl: number | null
  unit_value_usd: number | null
  total_value_brl: number | null
  total_value_usd: number | null
  override_applied: boolean | null
  calculation_key: string | null
  notes: string | null
  review_reason: string | null
  calculated_at: string | null
}

export type ManualChargeItemForBl = {
  charge_item_id: number
  charge_item_name: string
  charge_table_id: number
  charge_table_name: string
  cargo_mode: string
  pod: string
  currency: string
  default_unit_value_brl: number | null
  default_unit_value_usd: number | null
  effective_unit_value_brl: number | null
  effective_unit_value_usd: number | null
}

export type LocalChargeCalculationResult = {
  bl_id: string
  status: 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  table_id: number | null
  line_count: number
  total_brl: number
  total_usd: number
  review_required: boolean
  exempt: boolean
  reason: string
}

export type LocalChargePendencyItem = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | 'misto' | 'granito' | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  charge_exemption_reason: string | null
  charges_calculated_at: string | null
  created_at: string | null
  voyage?: {
    voyage_number: string
    vessel?: { name: string | null } | null
  } | null
  customer?: {
    name: string | null
  } | null
}

export type LocalChargeOperationalFilters = {
  search?: string
  cargoMode?: '' | 'container' | 'carga_solta' | 'granito' | 'misto'
  pod?: string
  voyageId?: number | null
  chargeStatus?: '' | 'not_calculated' | 'calculated' | 'review_required' | 'reviewed' | 'ready_for_billing' | 'exempt'
  includeResolved?: boolean
  limit?: number
}

export type LocalChargeOperationalRow = {
  id: string
  cargo_mode: 'container' | 'carga_solta' | 'granito' | 'misto' | null
  pol: string | null
  pod: string | null
  charge_status: string | null
  financial_status: string | null
  ce_mercante: string | null
  review_status: string | null
  notes: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  billing_hold_reason: string | null
  last_billing_run_id: number | null
  charge_exemption_reason: string | null
  charges_calculated_at: string | null
  charges_reviewed_at: string | null
  created_at: string | null
  voyage?: {
    id: number
    voyage_number: string
    vessel?: {
      name: string | null
    } | null
  } | null
  customer?: {
    id: number
    name: string | null
    cnpj_cpf: string | null
  } | null
  totals: {
    total_brl: number
    total_usd: number
    line_count: number
    review_required_count: number
  }
  trail: {
    last_event_at: string | null
    last_event_by: string | null
    last_event_field: string | null
    last_event_message: string | null
  }
}

export type LocalChargeOperationalRowsResult = { rows: LocalChargeOperationalRow[]; truncated: boolean }
export async function calculateBlLocalCharges(
  blId: string,
  options?: {
    actorId?: string | null
    recalculate?: boolean
    // Etapa 2 do plano de faturamento (ADR 0038, achado 6, revisão de performance):
    // permite ao chamador que já tem o financial_status em mãos (ex.: lote da
    // Validação, que já carregou operationsRows) pular a consulta de pre-flight
    // abaixo. Chamadores sem esse dado (recalculo individual da Revisao) continuam
    // protegidos pela consulta.
    knownFinancialStatus?: string | null
  },
) {
  // Etapa 2 do plano de faturamento (ADR 0038, achado 6): trava aqui, no unico
  // ponto de entrada do app para esta RPC, para cobrir todo chamador atual
  // (lote da Validacao e recalculo individual da Revisao) mesmo antes de a
  // trava equivalente existir tambem no banco (migration pendente de aplicar).
  let financialStatus = options?.knownFinancialStatus
  if (financialStatus === undefined) {
    const { data: bl, error: blError } = await supabase.from('bls').select('financial_status').eq('id', blId).maybeSingle()
    if (blError) throw blError
    financialStatus = bl?.financial_status
  }
  if (isBlFinanciallyLocked(financialStatus)) {
    throw new Error(`B/L ${blId} ja foi faturado (status financeiro=${financialStatus}); recalculo bloqueado.`)
  }

  const { data, error } = await supabase.rpc('calculate_bl_local_charges', {
    p_bl_id: blId,
    ...((options?.actorId && options.actorId.trim()) ? { p_actor: options.actorId.trim() } : {}),
    p_recalculate: options?.recalculate ?? true,
  })

  if (error) throw error
  return normalizeCalculationResult(data)
}

export async function listBlLocalChargeLines(blId: string) {
  const { data, error } = await supabase.rpc('list_bl_local_charge_lines', {
    p_bl_id: blId,
  })

  if (error) throw error
  return (data ?? []) as LocalChargeLine[]
}

export async function listManualChargeItemsForBl(blId: string) {
  const { data, error } = await supabase.rpc('list_manual_charge_items_for_bl', {
    p_bl_id: blId,
  })

  if (error) throw error
  return (data ?? []) as ManualChargeItemForBl[]
}

export async function listLocalChargePendencies(limit = 100) {
  const { data, error } = await supabase
    .from('bls')
    .select(
      `
      id,
      cargo_mode,
      pol,
      pod,
      charge_status,
      financial_status,
      charge_exemption_reason,
      charges_calculated_at,
      created_at,
      voyage:voyages(voyage_number,vessel:vessels(name)),
      customer:customers!bls_customer_id_fkey(name)
    `,
    )
    .in('charge_status', ['review_required', 'not_calculated'])
    .order('created_at', { ascending: false })
    .limit(limit)
    .overrideTypes<LocalChargePendencyItem[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

export async function listLocalChargeOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRow[]> {
  return (await listLocalChargeOperationalRowsWithMeta(filters)).rows
}

export async function listLocalChargeOperationalRowsWithMeta(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRowsResult> {
  const cargoMode = filters?.cargoMode ?? ''
  const wantBls = cargoMode === '' || cargoMode === 'container' || cargoMode === 'carga_solta' || cargoMode === 'misto'
  const wantGranite = cargoMode === '' || cargoMode === 'granito'

  const [blRows, graniteRows] = await Promise.all([
    wantBls ? loadBlOperationalRows(filters) : Promise.resolve({ rows: [], truncated: false } as LocalChargeOperationalRowsResult),
    wantGranite ? loadGraniteOperationalRows(filters) : Promise.resolve({ rows: [], truncated: false } as LocalChargeOperationalRowsResult),
  ])

  return { rows: [...blRows.rows, ...graniteRows.rows], truncated: blRows.truncated || graniteRows.truncated }
}

async function loadBlOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRowsResult> {
  const limit = Math.max(50, Math.min(5000, Number(filters?.limit ?? 400)))
  const rows: LocalChargeOperationalRow[] = []
  let truncated = false

  // Pagina internamente a fila operacional para nao ocultar B/Ls em volumes maiores.
  for (let offset = 0; offset < limit; offset += OPERATIONAL_PAGE_SIZE) {
    const pageSize = Math.min(OPERATIONAL_PAGE_SIZE, limit - offset)
    let query = supabase
      .from('bls')
      .select(
        `
        id,
        cargo_mode,
        pol,
        pod,
        charge_status,
        financial_status,
        ce_mercante,
        review_status,
        notes,
        customer_reconciliation_status,
        customer_reconciliation_notes,
        billing_hold_reason,
        last_billing_run_id,
        charge_exemption_reason,
        charges_calculated_at,
        charges_reviewed_at,
        created_at,
        voyage:voyages(id,voyage_number,vessel:vessels(name)),
        customer:customers!bls_customer_id_fkey(id,name,cnpj_cpf)
      `,
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (filters?.cargoMode === 'container') query = query.in('cargo_mode', ['container', 'misto'])
    else if (filters?.cargoMode === 'carga_solta') query = query.in('cargo_mode', ['carga_solta', 'misto'])
    else if (filters?.cargoMode === 'misto') query = query.eq('cargo_mode', 'misto')
    if (!filters?.includeResolved) query = query.or('financial_status.is.null,financial_status.neq.invoiced')
    if (filters?.pod) {
      const pod = sanitizeLikeTerm(filters.pod)
      if (pod) query = query.ilike('pod', `%${pod}%`)
    }
    if (filters?.voyageId) {
      query = query.eq('voyage_id', filters.voyageId)
    }
    if (filters?.chargeStatus) {
      query = query.eq('charge_status', filters.chargeStatus)
    }
    if (filters?.search) {
      const search = escapeFilterTerm(filters.search)
      if (search) {
        query = query.or(`id.ilike.%${search}%,consignee.ilike.%${search}%`)
      }
    }

    const { data: blRows, error: blError } = await query.overrideTypes<LocalChargeOperationalRow[], { merge: false }>()
    if (blError) throw blError

    const pageRows = blRows ?? []
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
    if (offset + pageSize >= limit) truncated = true
  }

  if (rows.length === 0) return { rows: [], truncated }

  const blIds = rows.map((row) => row.id)

  const { data: calcRows, error: calcError } = await supabase
    .from('charge_calculations')
    .select('bl_id,total_value_brl,total_value_usd,status')
    .in('bl_id', blIds)

  if (calcError) throw calcError

  const totalsMap = new Map<
    string,
    { total_brl: number; total_usd: number; line_count: number; review_required_count: number }
  >()

  for (const row of calcRows ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue
    const current = totalsMap.get(blId) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 }
    current.total_brl += Number(row.total_value_brl ?? 0)
    current.total_usd += Number(row.total_value_usd ?? 0)
    current.line_count += 1
    if (row.status === 'review_required') {
      current.review_required_count += 1
    }
    totalsMap.set(blId, current)
  }

  const { data: auditRows, error: auditError } = await supabase
    .from('audit_logs')
    .select('id,entity_type,entity_id,field_name,new_value,changed_by,changed_at')
    .in('entity_id', blIds)
    .in('entity_type', ['bl', 'charge_calculation'])
    .order('changed_at', { ascending: false })
    .limit(Math.min(blIds.length * 8, 4000))

  if (auditError && classifyDbError(auditError).kind !== 'permissao') {
    throw auditError
  }

  const trailMap = new Map<
    string,
    { last_event_at: string | null; last_event_by: string | null; last_event_field: string | null; last_event_message: string | null }
  >()

  for (const row of auditRows ?? []) {
    const entityType = String(row.entity_type ?? '')
    const entityId = String(row.entity_id ?? '')
    if (!entityId) continue

    const targetBlId = entityType === 'bl' ? entityId : extractBlIdFromChargeAuditMessage(String(row.new_value ?? ''), blIds)
    if (!targetBlId || trailMap.has(targetBlId)) continue

    trailMap.set(targetBlId, {
      last_event_at: row.changed_at ?? null,
      last_event_by: row.changed_by ?? null,
      last_event_field: row.field_name ?? null,
      last_event_message: row.new_value ?? null,
    })
  }

  return { rows: rows.map((row) => ({
    ...row,
    totals: totalsMap.get(row.id) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 },
    trail:
      trailMap.get(row.id) ?? {
        last_event_at: null,
        last_event_by: null,
        last_event_field: null,
        last_event_message: null,
      },
  })), truncated }
}

type GraniteOperationalRaw = {
  id: string
  bl_number: string | null
  charge_status: string | null
  ce_mercante: string | null
  loading_port: string | null
  discharge_port: string | null
  client_id: number | null
  created_at: string | null
  manifest: {
    voyage: {
      id: number
      voyage_number: string | null
      vessel: { name: string | null } | null
    } | null
  } | null
  customer: { id: number; name: string | null; cnpj_cpf: string | null } | null
}

async function loadGraniteOperationalRows(
  filters?: LocalChargeOperationalFilters,
): Promise<LocalChargeOperationalRowsResult> {
  const limit = Math.max(50, Math.min(5000, Number(filters?.limit ?? 400)))

  // Mapeia o filtro de chargeStatus do mundo bls para o domínio enxuto de granite_bls.
  // Estados legados do Granite são somente leitura nesta fila; o workflow atual
  // só recalcula o snapshot quantitativo.
  const requested = filters?.chargeStatus ?? ''
  if (requested === 'review_required' || requested === 'reviewed' || requested === 'exempt') {
    return { rows: [], truncated: false }
  }

  let granRows: GraniteOperationalRaw[] = []
  let truncated = false

  // Pagina internamente a fila de Granito para manter cobertura em listas grandes.
  for (let offset = 0; offset < limit; offset += OPERATIONAL_PAGE_SIZE) {
    const pageSize = Math.min(OPERATIONAL_PAGE_SIZE, limit - offset)
    let query = supabase
      .from('granite_bls')
      .select(
        `
        id,
        bl_number,
        charge_status,
        ce_mercante,
        loading_port,
        discharge_port,
        client_id,
        created_at,
        manifest:granite_manifests(voyage:voyages(id,voyage_number,vessel:vessels(name))),
        customer:customers!granite_bls_client_id_fkey(id,name,cnpj_cpf)
      `,
      )
      .neq('charge_status', filters?.includeResolved ? '__never__' : 'invoiced')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (requested === 'not_calculated' || requested === 'calculated' || requested === 'ready_for_billing') {
      query = query.eq('charge_status', requested)
    }
    if (filters?.pod) {
      const pod = sanitizeLikeTerm(filters.pod)
      if (pod) query = query.ilike('discharge_port', `%${pod}%`)
    }
    if (filters?.search) {
      const search = escapeFilterTerm(filters.search)
      if (search) {
        query = query.or(`bl_number.ilike.%${search}%,shipper_name.ilike.%${search}%`)
      }
    }

    const { data, error } = await query.overrideTypes<GraniteOperationalRaw[], { merge: false }>()
    if (error) throw error

    const pageRows = data ?? []
    granRows = [...granRows, ...pageRows]
    if (pageRows.length < pageSize) break
    if (offset + pageSize >= limit) truncated = true
  }

  // Filtro por viagem em granite_bls passa pelo manifest.voyage (lookup client-side).
  if (filters?.voyageId) {
    granRows = granRows.filter((row) => row.manifest?.voyage?.id === filters.voyageId)
  }

  if (granRows.length === 0) return { rows: [], truncated }

  const graniteIds = granRows.map((row) => row.id)
  const { data: chargeRows, error: chargeErr } = await supabase
    .from('granite_bl_charges')
    .select('bl_id,subtotal,currency')
    .in('bl_id', graniteIds)
  if (chargeErr) throw chargeErr

  const totalsMap = new Map<
    string,
    { total_brl: number; total_usd: number; line_count: number; review_required_count: number }
  >()
  for (const row of chargeRows ?? []) {
    const blId = String(row.bl_id ?? '')
    if (!blId) continue
    const subtotal = Number(row.subtotal ?? 0)
    const current = totalsMap.get(blId) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 }
    if (row.currency === 'USD') current.total_usd += subtotal
    else if (row.currency === 'BRL') current.total_brl += subtotal
    current.line_count += 1
    totalsMap.set(blId, current)
  }

  return { rows: granRows.map((row) => ({
    id: row.id,
    cargo_mode: 'granito' as const,
    pol: row.loading_port,
    pod: row.discharge_port,
    charge_status: row.charge_status,
    financial_status: row.charge_status === 'invoiced' ? 'invoiced' : null,
    ce_mercante: row.ce_mercante,
    // granito não passa pelo gate de revisão de BL comum (workflow próprio).
    review_status: null,
    notes: null,
    // granite_bls não tem workflow de conciliação de cliente — se há client_id,
    // tratamos como conciliado pra não bloquear o pipeline; caso contrário, sinaliza pendência.
    customer_reconciliation_status: row.client_id ? 'reconciled' : 'pending',
    customer_reconciliation_notes: row.client_id ? null : 'Granito: cliente nao vinculado',
    billing_hold_reason: null,
    last_billing_run_id: null,
    charge_exemption_reason: null,
    charges_calculated_at: null,
    charges_reviewed_at: null,
    created_at: row.created_at,
    voyage: row.manifest?.voyage
      ? {
          id: row.manifest.voyage.id,
          voyage_number: row.manifest.voyage.voyage_number ?? '',
          vessel: { name: row.manifest.voyage.vessel?.name ?? null },
        }
      : null,
    customer: row.customer
      ? { id: row.customer.id, name: row.customer.name, cnpj_cpf: row.customer.cnpj_cpf }
      : null,
    totals: totalsMap.get(row.id) ?? { total_brl: 0, total_usd: 0, line_count: 0, review_required_count: 0 },
    trail: { last_event_at: null, last_event_by: null, last_event_field: null, last_event_message: null },
  })), truncated }
}

export async function addManualBlCharge(
  blId: string,
  input: {
    chargeItemId: number
    quantity: number
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('add_manual_bl_charge', {
    p_bl_id: blId,
    p_charge_item_id: input.chargeItemId,
    p_quantity: input.quantity,
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return data
}

export async function updateManualBlCharge(
  chargeCalculationId: number,
  input: {
    quantity: number
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('update_manual_bl_charge', {
    p_charge_calculation_id: chargeCalculationId,
    p_quantity: input.quantity,
    ...(input.notes == null ? {} : { p_notes: input.notes }),
    ...(input.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return data
}

export async function deleteManualBlCharge(chargeCalculationId: number, actorId?: string | null) {
  const { data, error } = await supabase.rpc('delete_manual_bl_charge', {
    p_charge_calculation_id: chargeCalculationId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

export async function markBlChargesReviewed(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_charges_reviewed', {
    p_bl_id: blId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

export async function markBlReadyForBilling(blId: string, actorId?: string | null) {
  const { data, error } = await supabase.rpc('mark_bl_ready_for_billing', {
    p_bl_id: blId,
    ...(actorId == null ? {} : { p_actor: actorId }),
  })

  if (error) throw error
  return data
}

export async function calculateLocalChargesBatch(
  blIds: string[],
  options?: {
    actorId?: string | null
    recalculate?: boolean
  },
) {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  if (normalizedIds.length === 0) {
    return { total: 0, successCount: 0, errorCount: 0, errors: [] }
  }

  const { data: bls, error } = await supabase.from('bls').select('id, financial_status').in('id', normalizedIds)
  if (error) throw error
  const financialStatusById = new Map((bls ?? []).map((bl) => [bl.id, bl.financial_status] as const))

  const unlockedIds = normalizedIds.filter((id) => !isBlFinanciallyLocked(financialStatusById.get(id)))
  const actor = options?.actorId && options.actorId.trim() ? options.actorId.trim() : null

  if (unlockedIds.length > 0) {
    try {
      const { data: batchData, error: batchError } = await (supabase.rpc as unknown as (
        name: string,
        args: unknown,
      ) => Promise<{ data: unknown; error: unknown }>)('calculate_bl_local_charges_batch', {
        p_bl_ids: unlockedIds,
        ...(actor ? { p_actor: actor } : {}),
        p_recalculate: options?.recalculate ?? true,
      })

      if (!batchError && batchData && typeof batchData === 'object') {
        const parsed = batchData as {
          total?: number
          success_count?: number
          error_count?: number
          errors?: Array<{ bl_id?: string; blId?: string; message?: string }>
        }
        return {
          total: normalizedIds.length,
          successCount: parsed.success_count ?? 0,
          errorCount: (parsed.error_count ?? 0) + (normalizedIds.length - unlockedIds.length),
          errors: [
            ...(parsed.errors ?? []).map((err) => ({
              blId: err.bl_id || err.blId || '',
              message: err.message || 'Erro no calculo.',
            })),
            ...normalizedIds
              .filter((id) => isBlFinanciallyLocked(financialStatusById.get(id)))
              .map((id) => ({
                blId: id,
                message: `B/L ${id} ja foi faturado; recalculo bloqueado.`,
              })),
          ],
        }
      }
    } catch {
      // Fallback para loop sequencial runBatch
    }
  }

  return runBatch(blIds, (blId) => {
    const normalizedBlId = blId.trim().toUpperCase()
    const knownFinancialStatus = financialStatusById.get(normalizedBlId)
    return calculateBlLocalCharges(blId, { ...options, knownFinancialStatus })
  })
}

export type LocalChargeConferenceRow = {
  bl_id: string
  customer_name: string
  pod: string
  charge_name: string
  application_basis: string | null
  quantity: number
  unit_value_brl: number | null
  total_value_brl: number
  price_origin: 'Tabela padrão' | 'Condição de Cliente'
  shared_containers: string
}

// Etapa 5 do plano de faturamento: planilha de conferência do cálculo
// provisório, por B/L e por item — a decisão 8 do ADR 0038 só faz sentido com
// isso, senão o operador não tem como validar o número antes do CE. Marca
// container compartilhado (application_basis='container_distinct_voyage')
// com quantos B/Ls da viagem dividem cada container, para o rateio ser
// conferível mesmo quando o B/L que completa o container ainda não chegou.
export async function buildLocalChargeConferenceRows(blIds: string[]): Promise<LocalChargeConferenceRow[]> {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  if (normalizedIds.length === 0) return []

  const { data: bls, error: blsError } = await supabase
    .from('bls')
    .select('id, pod, voyage_id, customer:customers!bls_customer_id_fkey(name)')
    .in('id', normalizedIds)
  if (blsError) throw blsError
  const blMap = new Map(
    (bls ?? []).map((bl) => [
      bl.id as string,
      { pod: bl.pod as string | null, voyageId: bl.voyage_id as number | null, customerName: (bl.customer as { name: string | null } | null)?.name ?? null },
    ]),
  )

  const { data: calcs, error: calcsError } = await supabase
    .from('charge_calculations')
    .select('bl_id, quantity, unit_value_brl, total_value_brl, override_applied, calculation_key, charge_item:charge_table_items(name, application_basis)')
    .in('bl_id', normalizedIds)
    .in('status', ['calculated', 'reviewed', 'ready_for_billing'])
    .gt('total_value_brl', 0)
  if (calcsError) throw calcsError

  const { data: blContainers, error: blContainersError } = await supabase
    .from('bl_containers')
    .select('bl_id, container_number')
    .in('bl_id', normalizedIds)
  if (blContainersError) throw blContainersError

  const containersByBl = new Map<string, string[]>()
  for (const row of blContainers ?? []) {
    const containerNumber = (row.container_number ?? '').trim().toUpperCase()
    if (!containerNumber) continue
    const list = containersByBl.get(row.bl_id as string) ?? []
    list.push(containerNumber)
    containersByBl.set(row.bl_id as string, list)
  }

  const voyageIds = Array.from(new Set(Array.from(blMap.values()).map((bl) => bl.voyageId).filter((v): v is number => v != null)))
  const shareByVoyageContainer = new Map<string, number>()
  if (voyageIds.length > 0) {
    // Achado 7 da review da PR 501: busca os B/Ls da viagem primeiro (com
    // cargo_mode e voyage_id vindos direto da tabela `bls`, sem depender do
    // formato de uma relacao aninhada bl_containers->bls que pode virar
    // objeto ou array conforme o cliente) e so entao os containers desses
    // B/Ls. Isso permite: (1) filtrar cargo_mode='container' -- o share_count
    // do motor so considera B/Ls de container --, e (2) contar bl_id DISTINCT
    // por voyage+container, em vez de linhas cruas de bl_containers (que
    // duplicariam a contagem se um B/L tivesse a mesma linha de container
    // repetida). A chave usa sempre o voyage_id numerico vindo de `bls`,
    // nunca um valor de relacao que pudesse vir undefined.
    const { data: voyageBls, error: voyageBlsError } = await supabase
      .from('bls')
      .select('id, voyage_id')
      .in('voyage_id', voyageIds)
      .in('cargo_mode', ['container', 'misto'])
    if (voyageBlsError) throw voyageBlsError

    const voyageIdByBlId = new Map((voyageBls ?? []).map((bl) => [bl.id as string, bl.voyage_id as number]))
    const containerBlIds = Array.from(voyageIdByBlId.keys())

    if (containerBlIds.length > 0) {
      const { data: voyageContainers, error: voyageContainersError } = await supabase
        .from('bl_containers')
        .select('bl_id, container_number')
        .in('bl_id', containerBlIds)
      if (voyageContainersError) throw voyageContainersError

      const blIdsByVoyageContainer = new Map<string, Set<string>>()
      for (const row of voyageContainers ?? []) {
        const blId = row.bl_id as string
        const voyageId = voyageIdByBlId.get(blId)
        const containerNumber = (row.container_number ?? '').trim().toUpperCase()
        if (voyageId == null || !containerNumber) continue
        const key = `${voyageId}:${containerNumber}`
        const blIdSet = blIdsByVoyageContainer.get(key) ?? new Set<string>()
        blIdSet.add(blId)
        blIdsByVoyageContainer.set(key, blIdSet)
      }
      for (const [key, blIdSet] of blIdsByVoyageContainer) {
        shareByVoyageContainer.set(key, blIdSet.size)
      }
    }
  }

  return (calcs ?? []).map((row) => {
    const bl = blMap.get(row.bl_id as string)
    const chargeItem = row.charge_item as { name: string | null; application_basis: string | null } | null
    const containers = containersByBl.get(row.bl_id as string) ?? []
    const sharedLabel =
      chargeItem?.application_basis === 'container_distinct_voyage'
        ? containers
            .map((containerNumber) => ({
              containerNumber,
              count: shareByVoyageContainer.get(`${bl?.voyageId}:${containerNumber}`) ?? 1,
            }))
            .filter((c) => c.count > 1)
            .map((c) => `${c.containerNumber} (${c.count} B/Ls)`)
            .join('; ')
        : ''

    return {
      bl_id: row.bl_id as string,
      customer_name: bl?.customerName ?? '',
      pod: bl?.pod ?? '',
      charge_name: chargeItem?.name ?? (row.calculation_key as string | null) ?? 'Linha de taxa',
      application_basis: chargeItem?.application_basis ?? null,
      quantity: Number(row.quantity ?? 0),
      unit_value_brl: row.unit_value_brl == null ? null : Number(row.unit_value_brl),
      total_value_brl: Number(row.total_value_brl ?? 0),
      price_origin: row.override_applied ? 'Condição de Cliente' : 'Tabela padrão',
      shared_containers: sharedLabel,
    }
  })
}

// Etapa 4 do plano de faturamento (ADR 0038, achado 11): cálculo provisório
// logo após o import de B/L, antes do CE Mercante. Calcula os B/Ls importados
// e os "irmãos" — B/Ls da mesma viagem que compartilham container com eles —
// porque a quantidade de THD de um container compartilhado depende de quantos
// B/Ls o dividem; importar um novo B/L nesse container muda a quantidade dos
// que já estavam calculados. B/L com fatura emitida nunca é recalculado (cai
// no aviso de container compartilhado que já existe). Container e B/L misto
// participam da fronteira da ADR 0020; carga solta e granito seguem seus fluxos próprios. Best-effort
// e idempotente, no mesmo padrão de applyBapliePhysicalFlags — chame depois
// dele, pois as flags IMO/OOG definem o perfil de carga usado no cálculo.
export async function calculateProvisionalLocalCharges(
  voyageId: number,
  blIds: string[],
  actorId: string | null,
): Promise<{ calculated: number }> {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  if (normalizedIds.length === 0) return { calculated: 0 }

  const { data: targetBls, error: targetError } = await supabase
    .from('bls')
    .select('id, cargo_mode, financial_status')
    .in('id', normalizedIds)
  if (targetError) throw targetError

  const containerBlIds = (targetBls ?? [])
    .filter((bl) => ['container', 'misto'].includes(bl.cargo_mode ?? 'container') && !isBlFinanciallyLocked(bl.financial_status))
    .map((bl) => bl.id)
  if (containerBlIds.length === 0) return { calculated: 0 }

  const { data: containers, error: containersError } = await supabase
    .from('bl_containers')
    .select('container_number')
    .in('bl_id', containerBlIds)
  if (containersError) throw containersError

  const containerNumbers = Array.from(
    new Set((containers ?? []).map((c) => (c.container_number ?? '').trim().toUpperCase()).filter(Boolean)),
  )

  let siblingIds: string[] = []
  if (containerNumbers.length > 0) {
    const containerNumberSet = new Set(containerNumbers)
    // Achado 2 da review da PR 501: compara container_number normalizado
    // (UPPER(TRIM(...))) em memoria, em vez de `.in('container_number', ...)`
    // com os valores ja normalizados contra a coluna crua do banco -- isso
    // deixava de casar irmaos com espaco/caixa diferentes do que o motor usa
    // em outros pontos (ex.: calculate_bl_local_charges). Busca todos os
    // containers da viagem e filtra pelo Set normalizado no cliente.
    const { data: voyageContainers, error: siblingError } = await supabase
      .from('bl_containers')
      .select('bl_id, container_number, bl:bls!inner(voyage_id, cargo_mode, financial_status, charge_status)')
      .eq('bl.voyage_id', voyageId)
    if (siblingError) throw siblingError
    siblingIds = (voyageContainers ?? [])
      .filter((row) => {
        const containerNumber = (row.container_number ?? '').trim().toUpperCase()
        if (!containerNumberSet.has(containerNumber)) return false
        const bl = row.bl as { cargo_mode: string | null; financial_status: string | null; charge_status: string | null } | null
        // Achado 2 da review da PR 501: exclui tambem irmaos ja
        // ready_for_billing, nao so os financeiramente travados -- senao um
        // novo B/L no mesmo container reverte silenciosamente um irmao ja
        // pronto para faturar de volta para calculated/review_required.
        return (
          ['container', 'misto'].includes(bl?.cargo_mode ?? 'container') &&
          !isBlFinanciallyLocked(bl?.financial_status) &&
          bl?.charge_status !== 'ready_for_billing'
        )
      })
      .map((row) => row.bl_id as string)
  }

  const allIds = Array.from(new Set([...containerBlIds, ...siblingIds]))
  const results = await Promise.allSettled(allIds.map((id) => calculateBlLocalCharges(id, { actorId, recalculate: true })))
  return { calculated: results.filter((r) => r.status === 'fulfilled').length }
}

function normalizeCalculationResult(data: unknown): LocalChargeCalculationResult {
  const payload = (data ?? {}) as Record<string, unknown>
  return {
    bl_id: String(payload.bl_id ?? ''),
    status: String(payload.status ?? 'not_calculated') as LocalChargeCalculationResult['status'],
    table_id: payload.table_id === null || payload.table_id === undefined ? null : Number(payload.table_id),
    line_count: Number(payload.line_count ?? 0),
    total_brl: Number(payload.total_brl ?? 0),
    total_usd: Number(payload.total_usd ?? 0),
    review_required: Boolean(payload.review_required),
    exempt: Boolean(payload.exempt),
    reason: String(payload.reason ?? ''),
  }
}

function extractBlIdFromChargeAuditMessage(message: string, candidates: string[]) {
  const normalized = String(message ?? '').toUpperCase()
  for (const candidate of candidates) {
    if (normalized.includes(candidate.toUpperCase())) return candidate
  }
  return null
}


async function runBatch<T>(blIds: string[], worker: (blId: string) => Promise<T>) {
  const normalizedIds = Array.from(new Set(blIds.map((value) => value.trim().toUpperCase()).filter(Boolean)))
  const errors: Array<{ blId: string; message: string }> = []
  let successCount = 0

  for (const blId of normalizedIds) {
    try {
      await worker(blId)
      successCount += 1
    } catch (error) {
      errors.push({
        blId,
        message: error instanceof Error ? error.message : 'Erro inesperado no processamento em lote.',
      })
    }
  }

  return {
    total: normalizedIds.length,
    successCount,
    errorCount: errors.length,
    errors,
  }
}

export type InvoicedBlSubtotal = { totalBrl: number; totalUsd: number | null }

// O que a fatura congelou para ESTE B/L. A migration 261 passou a gravar o
// detalhamento na emissão justamente para que recálculo posterior não mude o
// que o cliente já viu — e a regra de lá tem um caso que diverge do cálculo:
// na consolidação, quando a soma dos itens não bate com o saldo do B/L, a
// fatura guarda UMA linha agregada em vez do detalhamento. A conferência
// compara com este número para não exibir um total diferente do cobrado sem
// dizer nada.
//
// Duas formas, porque faturas individuais/Granito vinculam por `invoice_bls` e
// consolidadas por `invoice_receivable_links` (esta sem coluna em USD).
export async function getInvoicedSubtotalForBl(blId: string): Promise<InvoicedBlSubtotal | null> {
  const id = blId.trim().toUpperCase()
  if (!id) return null

  const ativa = (status: string | null | undefined) =>
    Boolean(status) && !['cancelled', 'obsolete'].includes(String(status))

  try {
    const { data: diretos, error: erroDiretos } = await supabase
      .from('invoice_bls')
      .select('subtotal_brl, subtotal_usd, invoice:invoices(status)')
      .eq('bl_id', id)

    if (erroDiretos) throw erroDiretos

    const direto = (diretos ?? []).find((row) => ativa((row.invoice as { status?: string | null } | null)?.status))
    if (direto) {
      return { totalBrl: Number(direto.subtotal_brl ?? 0), totalUsd: Number(direto.subtotal_usd ?? 0) }
    }

    const { data: consolidados, error: erroConsolidados } = await supabase
      .from('invoice_receivable_links')
      .select('subtotal_brl, status, invoice:invoices(status)')
      .eq('bl_id', id)

    if (erroConsolidados) throw erroConsolidados

    const consolidado = (consolidados ?? []).find(
      (row) => row.status !== 'obsolete' && ativa((row.invoice as { status?: string | null } | null)?.status),
    )
    if (consolidado) {
      // Sem coluna em USD nesta forma: o `null` diz "não sei", que é diferente
      // de "zero" e impede um alarme falso na comparação.
      return { totalBrl: Number(consolidado.subtotal_brl ?? 0), totalUsd: null }
    }

    return null
  } catch (error) {
    // Sem permissão de leitura da fatura, a conferência segue mostrando o
    // cálculo: perder o aviso é aceitável, quebrar a tela não é.
    if (classifyDbError(error).kind === 'permissao') return null
    throw error
  }
}
