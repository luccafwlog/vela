import { supabase } from './supabase'
import type { VoyageFormValues } from './voyageForm'
import { canonicalizeVesselName, normalizeVesselImo } from '../lib/vesselAlias'

export async function createVoyage(form: VoyageFormValues, changedBy: string | null) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)

  const { data: created, error: createError } = await supabase
    .from('voyages')
    .insert({
      vessel_id: vesselId,
      voyage_number: form.voyageNumber.trim(),
      pol_id: null,
      pod_id: null,
      status: form.status,
    })
    .select('id')
    .single()

  if (createError || !created) throw createError

  await insertVoyageAuditRows([
    makeVoyageAuditRow(created.id, 'created', null, form.voyageNumber.trim(), changedBy),
    makeVoyageAuditRow(created.id, 'indicated_first_brazilian_port', null, form.indicatedFirstBrazilianPort ?? null, changedBy),
    makeVoyageAuditRow(created.id, 'indicated_first_brazilian_eta', null, form.indicatedFirstBrazilianEta ?? null, changedBy),
  ])

  return created
}

export async function updateVoyage(voyageId: number, form: VoyageFormValues, changedBy: string | null) {
  const carrierId = await getOrCreateCarrier(form.carrierName, form.carrierScac)
  const vesselId = await getOrCreateVessel(form.vesselName, form.vesselImo, carrierId)
  const [{ data: current, error: currentError }, currentIndicated] = await Promise.all([
    supabase
      .from('voyages')
      .select('vessel_id, voyage_number, status')
      .eq('id', voyageId)
      .single(),
    getVoyageIndicatedFirstBrazilianPort(voyageId),
  ])
  if (currentError) throw currentError

  const { data: updated, error: updateError } = await supabase
    .from('voyages')
    .update({
      vessel_id: vesselId,
      voyage_number: form.voyageNumber.trim(),
      status: form.status,
    })
    .eq('id', voyageId)
    .select('id')
    .single()

  if (updateError || !updated) throw updateError

  await insertVoyageAuditRows([
    makeVoyageAuditRow(voyageId, 'vessel_id', current?.vessel_id == null ? null : String(current.vessel_id), String(vesselId), changedBy),
    makeVoyageAuditRow(voyageId, 'voyage_number', current?.voyage_number ?? null, form.voyageNumber.trim(), changedBy),
    makeVoyageAuditRow(voyageId, 'status', current?.status ?? null, form.status, changedBy),
    makeVoyageAuditRow(voyageId, 'indicated_first_brazilian_port', currentIndicated?.port ?? null, form.indicatedFirstBrazilianPort ?? null, changedBy),
    makeVoyageAuditRow(voyageId, 'indicated_first_brazilian_eta', currentIndicated?.eta ?? null, form.indicatedFirstBrazilianEta ?? null, changedBy),
  ])

  return updated
}

export async function cancelVoyage({
  voyageId,
  reason,
  changedBy,
}: {
  voyageId: number
  reason: string
  changedBy: string
}) {
  const normalizedReason = reason.trim()
  if (!normalizedReason) throw new Error('Informe o motivo do cancelamento.')

  const cancelRpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: Error | null }>
  const { error } = await cancelRpc('cancel_voyage', {
    p_voyage_id: voyageId,
    p_reason: normalizedReason,
    p_changed_by: changedBy,
  })
  if (error) throw error
}

export async function deleteVoyage(voyageId: number) {
  const [bls, batches, graniteManifests, vaziosManifests] = await Promise.all([
    supabase.from('bls').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('import_batches').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('granite_manifests').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
    supabase.from('vazios_manifests').select('id', { count: 'exact', head: true }).eq('voyage_id', voyageId).range(0, 0),
  ])

  const firstError = [bls, batches, graniteManifests, vaziosManifests].find((result) => result.error)?.error
  if (firstError) throw firstError

  const blCount = bls.count ?? 0
  const batchCount = batches.count ?? 0
  const graniteManifestCount = graniteManifests.count ?? 0
  const vaziosManifestCount = vaziosManifests.count ?? 0

  if (blCount > 0 || batchCount > 0 || graniteManifestCount > 0 || vaziosManifestCount > 0) {
    throw new Error(
      `Nao e possivel excluir esta viagem porque ela possui dados vinculados: ${blCount} B/L(s), ${batchCount} importacao(oes) CNTR/BB, ${graniteManifestCount} manifesto(s) de granito e ${vaziosManifestCount} manifesto(s) de vazios. Remova os vinculos antes.`,
    )
  }

  const { error } = await supabase.from('voyages').delete().eq('id', voyageId)
  if (error) throw error
}

async function getOrCreateCarrier(name: string, scac: string) {
  let query = supabase.from('carriers').select('id').limit(1)
  if (scac.trim()) {
    query = query.eq('scac', scac.trim())
  } else {
    query = query.eq('name', name.trim())
  }

  const { data: existing, error: existingError } = await query
  if (existingError) throw existingError
  if (existing?.[0]) return existing[0].id

  const { data: created, error: createError } = await supabase
    .from('carriers')
    .insert({ name: name.trim(), scac: scac.trim() || null })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function getOrCreateVessel(name: string, imo: string, carrierId: number) {
  const normalizedImo = normalizeVesselImo(imo)
  const canonical = canonicalizeVesselName(name.trim())
  // IMO prevalece sobre grafia: mesmo IMO, grafias distintas são o mesmo navio.
  if (normalizedImo) {
    const byImo = await findVesselsByNormalizedImo(normalizedImo)
    if (byImo?.length > 1) {
      throw new Error(`Navio com IMO ${normalizedImo} ambíguo: mais de um cadastro. Corrija antes de importar.`)
    }
    if (byImo?.[0] && normalizeVesselImo(byImo[0].imo) === normalizedImo) {
      const vessel = byImo[0]
      const updates: { name?: string; imo?: string; carrier_id?: number } = {}
      if (vessel.name && vessel.name !== canonical) updates.name = canonical
      if (vessel.carrier_id !== carrierId) updates.carrier_id = carrierId
      if (vessel.imo !== normalizedImo) updates.imo = normalizedImo
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase.from('vessels').update(updates).eq('id', vessel.id)
        if (updateError) throw updateError
      }
      return vessel.id
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from('vessels')
    .select('id, imo, name, carrier_id')
    .eq('name', canonical)
    .limit(2)

  if (existingError) throw existingError
  if (existing && existing.length > 1) {
    throw new Error(`Navio ${canonical} ambíguo: mais de um cadastro sem IMO. Informe o IMO.`)
  }
  if (existing?.[0]) {
    const vessel = existing[0]
    // IMOs distintos nunca se fundem: nome igual com IMO diferente é conflito explícito.
    const existingImo = normalizeVesselImo(vessel.imo)
    if (normalizedImo && existingImo && existingImo !== normalizedImo) {
      throw new Error(`Navio ${canonical} com IMO conflitante (${existingImo} vs ${normalizedImo}). Corrija antes de importar.`)
    }
    const updates: { imo?: string; carrier_id?: number } = {}
    if (normalizedImo && existingImo !== normalizedImo) updates.imo = normalizedImo
    if (vessel.carrier_id !== carrierId) updates.carrier_id = carrierId

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase.from('vessels').update(updates).eq('id', vessel.id)
      if (updateError) throw updateError
    }

    return vessel.id
  }

  const { data: created, error: createError } = await supabase
    .from('vessels')
    .insert({ name: canonical, imo: normalizedImo, carrier_id: carrierId })
    .select('id')
    .single()

  if (createError || !created) throw createError
  return created.id
}

async function findVesselsByNormalizedImo(normalizedImo: string) {
  const exact = await supabase
    .from('vessels')
    .select('id, imo, name, carrier_id')
    .eq('imo', normalizedImo)
    .limit(2)
  if (exact.error) throw exact.error

  const exactMatches = (exact.data ?? []).filter((vessel) => normalizeVesselImo(vessel.imo) === normalizedImo)
  if ((exact.data ?? []).length > 0 || !/^\d{7}$/.test(normalizedImo)) return exactMatches

  // Cadastros anteriores podem guardar "IMO: 1234567". O filtro amplo só é
  // usado para um IMO numérico válido e a igualdade canônica é revalidada em
  // memória, evitando aceitar uma coincidência parcial ou um valor inválido.
  // ponytail: consulta no máximo 20 candidatos legados; upgrade path =
  // canonicalizar o legado e criar índice/expressão ou RPC de igualdade.
  const legacy = await supabase
    .from('vessels')
    .select('id, imo, name, carrier_id')
    .ilike('imo', `%${normalizedImo}%`)
    .limit(20)
  if (legacy.error) throw legacy.error
  return (legacy.data ?? []).filter((vessel) => normalizeVesselImo(vessel.imo) === normalizedImo)
}

function makeVoyageAuditRow(
  voyageId: number,
  fieldName:
    | 'created'
    | 'vessel_id'
    | 'voyage_number'
    | 'status'
    | 'indicated_first_brazilian_port'
    | 'indicated_first_brazilian_eta',
  oldValue: string | null,
  newValue: string | null,
  changedBy: string | null,
) {
  if (!changedBy) return null
  if ((oldValue ?? '') === (newValue ?? '')) return null
  return {
    entity_type: 'voyages',
    entity_id: String(voyageId),
    field_name: fieldName,
    old_value: oldValue,
    new_value: newValue,
    changed_by: changedBy,
    justification: 'Atualizacao de dados da viagem',
  }
}

export async function getVoyageIndicatedFirstBrazilianPort(voyageId: number): Promise<{ port: string | null; eta: string | null }> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('field_name, new_value, changed_at')
    .eq('entity_type', 'voyages')
    .eq('entity_id', String(voyageId))
    .in('field_name', ['indicated_first_brazilian_port', 'indicated_first_brazilian_eta'])
    .order('changed_at', { ascending: false })

  if (error) throw error

  let port: string | null = null
  let eta: string | null = null
  let portSeen = false
  let etaSeen = false
  for (const row of data ?? []) {
    if (row.field_name === 'indicated_first_brazilian_port' && !portSeen) {
      portSeen = true
      port = row.new_value ? row.new_value.trim().toUpperCase() : null
    }
    if (row.field_name === 'indicated_first_brazilian_eta' && !etaSeen) {
      etaSeen = true
      eta = row.new_value ? row.new_value.trim() : null
    }
  }
  return { port, eta }
}

export async function listVoyagesIndicatedFirstBrazilianPort(voyageIds: number[]): Promise<Map<number, { port: string | null; eta: string | null }>> {
  const result = new Map<number, { port: string | null; eta: string | null }>()
  if (!voyageIds.length) return result

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', 'voyages')
    .in('entity_id', voyageIds.map(String))
    .in('field_name', ['indicated_first_brazilian_port', 'indicated_first_brazilian_eta'])
    .order('changed_at', { ascending: false })

  if (error) throw error

  for (const row of data ?? []) {
    const id = Number(row.entity_id)
    if (!id) continue
    const current = result.get(id) ?? { port: null, eta: null }
    const seen = (current as typeof current & { portSeen?: boolean; etaSeen?: boolean })
    if (row.field_name === 'indicated_first_brazilian_port' && !seen.portSeen) {
      seen.portSeen = true
      current.port = row.new_value ? row.new_value.trim().toUpperCase() : null
    }
    if (row.field_name === 'indicated_first_brazilian_eta' && !seen.etaSeen) {
      seen.etaSeen = true
      current.eta = row.new_value ? row.new_value.trim() : null
    }
    result.set(id, current)
  }
  return result
}

async function insertVoyageAuditRows(rows: Array<ReturnType<typeof makeVoyageAuditRow>>) {
  const payload = rows.filter((row): row is NonNullable<typeof row> => row !== null)
  if (!payload.length) return

  const { error } = await supabase.from('audit_logs').insert(payload)
  if (error) throw error
}

export async function fetchVoyagesWithUnpaidBls(voyageIds: number[]): Promise<Set<number>> {
  if (!voyageIds.length) return new Set<number>()

  const { data, error } = await supabase
    .from('bls')
    .select('voyage_id')
    .in('voyage_id', voyageIds)
    .neq('charge_status', 'exempt')
    .limit(5000)

  if (error) throw error
  return new Set((data ?? []).map((row) => Number((row as { voyage_id: number }).voyage_id)).filter(Boolean))
}

export async function setVoyageShowOnPortal(voyageId: number, show: boolean) {
  const { error } = await supabase
    .from('voyages')
    .update({ show_on_portal: show })
    .eq('id', voyageId)
  if (error) throw error
}

/** Busca viagem por VOY + navio (IMO prevalece; conflito explícito, nunca .find arbitrário). */
export async function findVoyageByNumberAndVessel(
  voyageNumber: string,
  vesselImo: string,
  vesselName: string,
): Promise<number | null> {
  const number = voyageNumber.trim().toUpperCase()
  const imo = normalizeVesselImo(vesselImo)
  const canonical = canonicalizeVesselName(vesselName)
  if (!number || !canonical) return null
  const numberPattern = number.replace(/[\\%_]/g, (char) => `\\${char}`)

  const { data, error } = await supabase
    .from('voyages')
    .select('id, voyage_number, vessel:vessels(name, imo)')
    .ilike('voyage_number', numberPattern)
    .overrideTypes<Array<{ id: number; voyage_number: string; vessel: { name: string | null; imo: string | null } | null }>, { merge: false }>()
  if (error) throw error

  const voyageCandidates = (data ?? []).filter((row) => {
    if (row.voyage_number.trim().toUpperCase() !== number) return false
    return true
  })

  if (imo) {
    const exactImoCandidates = voyageCandidates.filter((row) => normalizeVesselImo(row.vessel?.imo) === imo)
    if (exactImoCandidates.length > 1) {
      throw new Error(`Viagem ${number} / IMO ${imo} ambígua: ${exactImoCandidates.length} candidatas.`)
    }
    // O identificador forte vence qualquer grafia, inclusive um cadastro
    // nominal sem IMO. Isso evita que o fallback produza ambiguidade falsa.
    if (exactImoCandidates.length === 1) return exactImoCandidates[0].id

    const conflictingImo = voyageCandidates.some((row) => {
      const rowImo = normalizeVesselImo(row.vessel?.imo)
      return rowImo !== null && rowImo !== imo && canonicalizeVesselName(row.vessel?.name ?? '') === canonical
    })
    if (conflictingImo) return null

    const nameCandidates = voyageCandidates.filter((row) =>
      !normalizeVesselImo(row.vessel?.imo) && canonicalizeVesselName(row.vessel?.name ?? '') === canonical,
    )
    if (nameCandidates.length > 1) {
      throw new Error(`Viagem ${number} / ${canonical} ambígua: ${nameCandidates.length} candidatas. Informe o IMO.`)
    }
    return nameCandidates[0]?.id ?? null
  }

  const nameCandidates = voyageCandidates.filter((row) => canonicalizeVesselName(row.vessel?.name ?? '') === canonical)
  if (nameCandidates.length > 1) {
    throw new Error(`Viagem ${number} / ${canonical} ambígua: ${nameCandidates.length} candidatas. Informe o IMO.`)
  }
  return nameCandidates[0]?.id ?? null
}
