import { supabase } from './supabase'
import type { Tables } from '../types/database'
import { extractErrorText } from '../lib/errors'

const normPod = (value: string) => value.trim().toUpperCase()

export type BlDisposition = 'transshipment' | 'cod'

type BlTransshipmentRow = Pick<
  Tables<'bl_transshipments'>,
  | 'id'
  | 'bl_id'
  | 'omission_id'
  | 'disposition'
>

export interface BlTransshipment {
  id: number
  blId: string
  omissionId: number
  disposition: BlDisposition
}

export interface VoyageOmission {
  id: number
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
}

export async function omitVoyageEscala(input: {
  voyageId: number
  omittedPod: string
  dischargePod: string
  reason: string | null
  onwardVesselName?: string | null
  onwardCarrier?: string | null
  onwardVoyageNumber?: string | null
  onwardEtd?: string | null
  onwardEta?: string | null
  changedBy: string
}): Promise<number> {
  const { data, error } = await supabase.rpc('omit_voyage_escala', {
    p_voyage_id: input.voyageId,
    p_omitted_pod: normPod(input.omittedPod),
    p_discharge_pod: normPod(input.dischargePod),
    p_reason: input.reason,
    p_onward_vessel_name: input.onwardVesselName ?? null,
    p_onward_carrier: input.onwardCarrier ?? null,
    p_onward_voyage_number: input.onwardVoyageNumber ?? null,
    p_onward_etd: input.onwardEtd ?? null,
    p_onward_eta: input.onwardEta ?? null,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
  if (data == null) throw new Error('RPC de omissão não retornou identificador.')
  return data
}

export async function setBlTransshipment(input: {
  blId: string
  omissionId: number
  justification: string
  changedBy: string
}): Promise<void> {
  const { error } = await supabase.rpc('set_bl_transshipment', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_justification: input.justification,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function updateVoyageOmission(input: {
  omissionId: number
  onwardVesselName: string | null
  onwardCarrier: string | null
  onwardVoyageNumber: string | null
  onwardEtd: string | null
  onwardEta: string | null
  reason: string | null
  changedBy: string
}): Promise<void> {
  const { error } = await supabase.rpc('update_voyage_omission', {
    p_omission_id: input.omissionId,
    p_onward_vessel_name: input.onwardVesselName,
    p_onward_carrier: input.onwardCarrier,
    p_onward_voyage_number: input.onwardVoyageNumber,
    p_onward_etd: input.onwardEtd,
    p_onward_eta: input.onwardEta,
    p_reason: input.reason,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function revertVoyageOmission(input: {
  omissionId: number
  justification: string
  changedBy: string
}): Promise<void> {
  const { error } = await supabase.rpc('revert_voyage_omission', {
    p_omission_id: input.omissionId,
    p_justification: input.justification,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

// `revert_voyage_omission` (migration 251) recusa com "Nao e possivel reverter
// a omissao: N B/L(s) afetado(s) estao em COD." (22023); só essa recusa ganha a
// orientação de conferir os B/Ls em COD.
export function isOmissionRevertBlockedByCod(error: unknown): boolean {
  return /\best[aã]o em COD\b/i.test(extractErrorText(error))
}

export async function setBlCod(input: {
  blId: string
  omissionId: number
  justification: string
  changedBy: string
}): Promise<void> {
  const { error } = await supabase.rpc('set_bl_cod', {
    p_bl_id: input.blId,
    p_omission_id: input.omissionId,
    p_justification: input.justification,
    p_changed_by: input.changedBy,
  })
  if (error) throw error
}

export async function listVoyageOmissions(voyageId: number): Promise<VoyageOmission[]> {
  const { data, error } = await supabase
    .from('voyage_omissions')
    .select('id, voyage_id, omitted_pod, discharge_pod, reason, onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta')
    .eq('voyage_id', voyageId)
    .is('reverted_at', null)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    voyageId: row.voyage_id,
    omittedPod: row.omitted_pod,
    dischargePod: row.discharge_pod,
    reason: row.reason,
    onwardVesselName: row.onward_vessel_name,
    onwardCarrier: row.onward_carrier,
    onwardVoyageNumber: row.onward_voyage_number,
    onwardEtd: row.onward_etd,
    onwardEta: row.onward_eta,
  }))
}

export async function listBlTransshipments(omissionId: number): Promise<BlTransshipment[]> {
  const { data, error } = await supabase
    .from('bl_transshipments')
    .select('id, bl_id, omission_id, disposition')
    .eq('omission_id', omissionId)
  if (error) throw error
  return (data ?? []).map(mapBlTransshipment)
}

// Um B/L pode ter mais de uma omissao no historico (schema permite uma linha
// por (bl_id, omission_id), nao uma por B/L); ordena pela omissao mais recente
// para escolher a mesma disposicao vigente que o Portal (migration 202).
export async function listBlTransshipmentByBlId(blId: string): Promise<BlTransshipment | null> {
  const { data, error } = await supabase
    .from('bl_transshipments')
    .select(
      'id, bl_id, omission_id, disposition, voyage_omissions!inner(omitted_at)',
    )
    .eq('bl_id', blId)
    .order('omitted_at', { foreignTable: 'voyage_omissions', ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = (data ?? [])[0]
  return row ? mapBlTransshipment(row) : null
}

function parseDisposition(value: string): BlDisposition {
  if (value === 'transshipment' || value === 'cod') return value
  throw new Error(`Disposição de transbordo inválida: ${value}`)
}

function mapBlTransshipment(row: BlTransshipmentRow): BlTransshipment {
  return {
    id: row.id,
    blId: row.bl_id,
    omissionId: row.omission_id,
    disposition: parseDisposition(row.disposition),
  }
}
