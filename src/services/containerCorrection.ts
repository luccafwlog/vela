import { supabase } from './supabase'
import { CONTAINER_PROFILE_LABELS, containerProfileOf, type ContainerProfile } from './vaziosNatureza'
import { containerOwnershipLabel, type ContainerOwnership } from '../lib/containerOwnership'

/** O que a janela Corrigir da aba Carga mostra e edita de um container. */
export type ContainerCorrectionValues = {
  profile: ContainerProfile
  ownership: ContainerOwnership | ''
  seal: string
  grossWeightKg: string
  cbm: string
  discharge: string
  returnDate: string
}

type ContainerRow = {
  is_imo?: boolean | null
  is_oog?: boolean | null
  ownership?: string | null
  seal_number?: string | null
  gross_weight_kg?: number | string | null
  cbm?: number | string | null
  discharge_date?: string | null
  return_date?: string | null
}

const numberText = (value: number | string | null | undefined) => (value == null || value === '' ? '' : String(Number(value)))

export function containerCorrectionValues(container: ContainerRow): ContainerCorrectionValues {
  return {
    profile: containerProfileOf(container),
    ownership: container.ownership === 'SOC' || container.ownership === 'COC' ? container.ownership : '',
    seal: container.seal_number ?? '',
    grossWeightKg: numberText(container.gross_weight_kg),
    cbm: numberText(container.cbm),
    discharge: (container.discharge_date ?? '').slice(0, 10),
    returnDate: (container.return_date ?? '').slice(0, 10),
  }
}

// Os campos são numéricos (`type="number"`): chega "47900" ou "24.5".
function parseNumber(text: string): number | null | 'invalid' {
  if (!text.trim()) return null
  const value = Number(text.trim())
  return Number.isFinite(value) && value >= 0 ? value : 'invalid'
}

export type ContainerCorrectionPlan = {
  /** Linhas de antes e depois para a confirmação. */
  changes: Array<{ field: string; before: string; after: string }>
  profile: ContainerProfile | null
  ownership: ContainerOwnership | null
  data: { seal: string | null; grossWeightKg: number | null; cbm: number | null } | null
  dates: { discharge: string; returnDate: string | null } | null
  error: string | null
}

/**
 * Compara o que está gravado com o que a pessoa digitou e diz que correção
 * cada caminho do banco recebe: perfil, COC/SOC, dados físicos (lacre, peso
 * bruto, CBM) e datas. Só o que mudou entra no plano.
 */
export function planContainerCorrection(before: ContainerCorrectionValues, after: ContainerCorrectionValues): ContainerCorrectionPlan {
  const changes: ContainerCorrectionPlan['changes'] = []
  const empty = (text: string) => text.trim() || '—'
  const plan: ContainerCorrectionPlan = { changes, profile: null, ownership: null, data: null, dates: null, error: null }

  if (after.profile !== before.profile) {
    plan.profile = after.profile
    changes.push({ field: 'Perfil', before: CONTAINER_PROFILE_LABELS[before.profile], after: CONTAINER_PROFILE_LABELS[after.profile] })
  }
  if (after.ownership && after.ownership !== before.ownership) {
    plan.ownership = after.ownership
    changes.push({ field: 'COC/SOC', before: containerOwnershipLabel(before.ownership || null), after: after.ownership })
  }

  const weight = parseNumber(after.grossWeightKg)
  const cbm = parseNumber(after.cbm)
  if (weight === 'invalid' || cbm === 'invalid') {
    return { ...plan, error: 'Peso bruto e CBM aceitam só números positivos.' }
  }
  const dataChanged = after.seal.trim() !== before.seal.trim()
    || weight !== parseNumber(before.grossWeightKg)
    || cbm !== parseNumber(before.cbm)
  if (dataChanged) {
    plan.data = { seal: after.seal.trim() || null, grossWeightKg: weight, cbm }
    if (after.seal.trim() !== before.seal.trim()) changes.push({ field: 'Lacre', before: empty(before.seal), after: empty(after.seal) })
    if (weight !== parseNumber(before.grossWeightKg)) changes.push({ field: 'Peso bruto (kg)', before: empty(before.grossWeightKg), after: empty(after.grossWeightKg) })
    if (cbm !== parseNumber(before.cbm)) changes.push({ field: 'CBM (m³)', before: empty(before.cbm), after: empty(after.cbm) })
  }

  if (after.discharge !== before.discharge || after.returnDate !== before.returnDate) {
    if (!after.discharge) return { ...plan, error: 'Informe a data de descarga para corrigir as datas.' }
    if (after.returnDate && after.returnDate < after.discharge) return { ...plan, error: 'A devolução não pode ser anterior à descarga.' }
    plan.dates = { discharge: after.discharge, returnDate: after.returnDate || null }
    if (after.discharge !== before.discharge) changes.push({ field: 'Descarga', before: empty(before.discharge), after: after.discharge })
    if (after.returnDate !== before.returnDate) changes.push({ field: 'Devolução', before: empty(before.returnDate), after: empty(after.returnDate) })
  }
  return plan
}

/** Lacre, peso bruto e CBM (migration 288): sempre corrigíveis, para todo o Part Lot. */
export async function correctContainerData(input: {
  containerId: number
  seal: string | null
  grossWeightKg: number | null
  cbm: number | null
  justification: string
}): Promise<void> {
  const { error } = await supabase.rpc('correct_bl_container_data' as never, {
    p_container_id: input.containerId,
    p_seal_number: input.seal,
    p_gross_weight_kg: input.grossWeightKg,
    p_cbm: input.cbm,
    p_justification: input.justification,
  } as never)
  if (error) throw error
}
