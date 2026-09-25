import { supabase } from '../supabase'
import { buildDemurrageRateUpsertPayload, type DemurrageRateUpsertInput } from './demurrageRateUpsertPayload'
import { reportBestEffortFailure } from '../../lib/telemetry'
import type { DemurrageCalcResult, DemurrageRate } from '../../types/database'
import { deleteOneById } from '../deleteRecords'

export type RateGroup = {
  aliases: string[]
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

type ResolvedRate = {
  freeUntil: number
  p1: { range: [number, number]; usd: number }
  p2: { range: [number, number]; usd: number }
}

const RATE_CACHE_TTL_MS = 5 * 60 * 1000
const RATES_UNAVAILABLE_MESSAGE = 'Tarifas de Demurrage indisponíveis. Verifique a tabela de tarifas antes de calcular.'
let dynamicRateGroups: RateGroup[] | null = null
let dynamicRateGroupsLoadedAt = 0
let dynamicRateGroupsLastError: string | null = null
let dynamicRateGroupsLastErrorAt = 0

// O catálogo atual de main guarda apenas uma linha por tipo canônico. Estes
// aliases permanecem aceitos porque aparecem em B/Ls e nas migrations legadas.
const DEMURRAGE_ALIAS_GROUPS = [
  { canonical: '20GP', aliases: ['20GP', '20G0', '20HC', '20HQ', '22G1', '20G1'] },
  { canonical: '40GP', aliases: ['40GP', '40G0', '40HC', '40HQ', '40G1', '42G1', '45G1'] },
  { canonical: '20FR', aliases: ['20FR', '20OT', '20FT'] },
  { canonical: '40FR', aliases: ['40FR', '40OT', '40FT'] },
  { canonical: '20RF', aliases: ['20RF', '20RQ', '20R1'] },
  { canonical: '40RF', aliases: ['40RF', '40RQ', '40R1', '45R1'] },
] as const

const DEMURRAGE_ALIAS_TO_CANONICAL: Map<string, string> = new Map(
  DEMURRAGE_ALIAS_GROUPS.flatMap(({ canonical, aliases }) => aliases.map((alias) => [alias, canonical] as const)),
)
const DEMURRAGE_ALIASES_BY_CANONICAL: Map<string, readonly string[]> = new Map(
  DEMURRAGE_ALIAS_GROUPS.map(({ canonical, aliases }) => [canonical, aliases] as const),
)

function normalizeContainerType(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function resolveActiveRateGroups(): RateGroup[] {
  if (dynamicRateGroups && dynamicRateGroups.length > 0) {
    if (Date.now() - dynamicRateGroupsLoadedAt < RATE_CACHE_TTL_MS) {
      return dynamicRateGroups
    }
    // Cache stale — serve current data, trigger background refresh
    void ensureDemurrageRatesLoaded(true).catch(() => undefined)
    return dynamicRateGroups
  }
  // A tarifa do banco é a única fonte de verdade; não existe fallback estático
  // (CONTEXT.md, Tarifa de Demurrage).
  throw new Error(RATES_UNAVAILABLE_MESSAGE)
}

function toRateGroups(rows: DemurrageRate[]): RateGroup[] {
  const grouped = new Map<string, { row: DemurrageRate; aliases: Set<string> }>()
  for (const row of rows) {
    const rowType = normalizeContainerType(row.container_type)
    if (!rowType) continue

    const canonicalType = DEMURRAGE_ALIAS_TO_CANONICAL.get(rowType) ?? rowType
    const existing = grouped.get(canonicalType)
    if (existing) {
      existing.aliases.add(rowType)
      continue
    }

    const aliases = new Set<string>(DEMURRAGE_ALIASES_BY_CANONICAL.get(canonicalType) ?? [rowType])
    aliases.add(rowType)
    grouped.set(canonicalType, { row, aliases })
  }

  const groups: RateGroup[] = []
  for (const { row, aliases } of grouped.values()) {
    groups.push({
      aliases: [...aliases],
      freeUntil: Number(row.free_days ?? 0),
      p1: {
        range: [Number(row.p1_day_from ?? 0), Number(row.p1_day_to ?? 0)],
        usd: Number(row.p1_usd ?? 0),
      },
      p2: {
        range: [Number(row.p2_day_from ?? 0), Infinity],
        usd: Number(row.p2_usd ?? 0),
      },
    })
  }
  return groups
}

export async function ensureDemurrageRatesLoaded(force = false) {
  const now = Date.now()
  if (!force && dynamicRateGroups && now - dynamicRateGroupsLoadedAt < RATE_CACHE_TTL_MS) {
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('demurrage_rates')
    .select('*')
    .eq('active', true)
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })

  const resolved = error ? [] : toRateGroups((data ?? []) as DemurrageRate[])
  if (error || resolved.length === 0) {
    dynamicRateGroupsLastError = error?.message ?? 'demurrage_rates vazia'
    dynamicRateGroupsLastErrorAt = now
    reportBestEffortFailure(
      'ensureDemurrageRatesLoaded: tarifas de demurrage indisponiveis',
      error ?? new Error('demurrage_rates vazia'),
      { rowCount: data?.length ?? 0 },
    )
    if (!dynamicRateGroups) {
      throw new Error(RATES_UNAVAILABLE_MESSAGE)
    }
    return
  }

  dynamicRateGroups = resolved
  dynamicRateGroupsLoadedAt = now
  dynamicRateGroupsLastError = null
  dynamicRateGroupsLastErrorAt = 0
}

export type DemurrageRatesCacheState = {
  loadedAt: string | null
  ageMs: number | null
  stale: boolean
  lastError: string | null
  lastErrorAt: string | null
}

export function getDemurrageRatesCacheState(now = Date.now()): DemurrageRatesCacheState {
  const hasCache = dynamicRateGroups != null && dynamicRateGroups.length > 0
  const ageMs = hasCache ? Math.max(0, now - dynamicRateGroupsLoadedAt) : null
  return {
    loadedAt: hasCache ? new Date(dynamicRateGroupsLoadedAt).toISOString() : null,
    ageMs,
    stale: !hasCache || (ageMs != null && ageMs >= RATE_CACHE_TTL_MS),
    lastError: dynamicRateGroupsLastError,
    lastErrorAt: dynamicRateGroupsLastErrorAt ? new Date(dynamicRateGroupsLastErrorAt).toISOString() : null,
  }
}

/** Emissao e faturamento nao podem continuar usando uma tarifa expirada. */
export async function ensureDemurrageRatesFresh(): Promise<void> {
  await ensureDemurrageRatesLoaded(true)
  if (getDemurrageRatesCacheState().stale) {
    throw new Error(RATES_UNAVAILABLE_MESSAGE)
  }
}

export function invalidateDemurrageRatesCache() {
  dynamicRateGroupsLoadedAt = 0
}

// CRUD administrativo das tarifas. Toda escrita invalida o cache em memoria
// usado pelo calculo, para a proxima resolucao de tarifa ler o banco.
export async function listDemurrageRates(): Promise<DemurrageRate[]> {
  const { data, error } = await supabase
    .from('demurrage_rates')
    .select('*')
    .order('container_type', { ascending: true })
  if (error) throw error
  return (data ?? []) as DemurrageRate[]
}

export async function upsertDemurrageRate(rate: DemurrageRateUpsertInput) {
  const { error } = await supabase.from('demurrage_rates').upsert(buildDemurrageRateUpsertPayload(rate))
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function deleteDemurrageRate(id: number) {
  const { error } = await deleteOneById('demurrage_rates', id)
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function toggleDemurrageRateActive(id: number, active: boolean) {
  const { error } = await supabase.from('demurrage_rates').update({ active }).eq('id', id)
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export type CustomerAgreementRates = {
  free_days?: number | null
  p1_usd?: number | null
  p2_usd?: number | null
} | null

function getRate(
  containerType: string | null,
  freeTimeOverride?: number | null,
  ov1?: number | null,
  ov2?: number | null,
  customerAgreement?: CustomerAgreementRates,
): ResolvedRate {
  const type = normalizeContainerType(containerType)
  const groups = resolveActiveRateGroups()
  const group = groups.find((g) => g.aliases.includes(type))
  if (!group) {
    throw new Error(`Tipo de container "${type || '(vazio)'}" sem tarifa de Demurrage cadastrada. Cadastre a tarifa em Tarifas de Demurrage antes de calcular.`)
  }

  const freeUntil = freeTimeOverride != null
    ? freeTimeOverride
    : customerAgreement?.free_days != null
      ? customerAgreement.free_days
      : group.freeUntil

  const p1Start = freeUntil + 1
  const p1End = group.p1.range[1]
  const p1Range: [number, number] = [p1Start, p1End]
  const p2Range: [number, number] = [group.p2.range[0], Infinity]

  const p1Usd = ov1 != null
    ? ov1
    : customerAgreement?.p1_usd != null
      ? customerAgreement.p1_usd
      : group.p1.usd

  const p2Usd = ov2 != null
    ? ov2
    : customerAgreement?.p2_usd != null
      ? customerAgreement.p2_usd
      : group.p2.usd

  return {
    freeUntil,
    p1: { range: p1Range, usd: p1Usd },
    p2: { range: p2Range, usd: p2Usd },
  }
}

export function __setDemurrageRateGroupsForTest(groups: RateGroup[] | null) {
  dynamicRateGroups = groups
  dynamicRateGroupsLoadedAt = groups ? Date.now() : 0
}

function noonMs(dateStr: string): number {
  if (!dateStr) throw new Error(`Data inválida em cálculo de demurrage: string vazia`)
  const ms = new Date(`${dateStr}T12:00:00`).getTime()
  if (!Number.isFinite(ms)) throw new Error(`Data inválida em cálculo de demurrage: "${dateStr}"`)
  return ms
}

export function calculateDemurrage(
  containerType: string | null,
  dischargeDate: string,
  returnDate: string,
  freeTimeOverride?: number | null,
  ov1?: number | null,
  ov2?: number | null,
  customerAgreement?: CustomerAgreementRates,
): DemurrageCalcResult {
  const rate = getRate(containerType, freeTimeOverride, ov1, ov2, customerAgreement)
  const dischargeMs = noonMs(dischargeDate)
  const returnMs = noonMs(returnDate)
  if (returnMs < dischargeMs) {
    throw new Error('Data de devolucao nao pode ser anterior a descarga.')
  }
  const dc = Math.round((returnMs - dischargeMs) / 86400000)

  if (dc <= rate.freeUntil) {
    return { total_days: dc, free_days: dc, days_p1: 0, rate_p1_usd: rate.p1.usd, days_p2: 0, rate_p2_usd: rate.p2.usd, total_usd: 0, status: 'within_free_time' }
  }

  const diasP1 = Math.max(0, Math.min(dc, rate.p1.range[1]) - rate.p1.range[0] + 1)
  // P2 nunca pode incluir dias dentro do free time: quando o override empurra o
  // início da cobrança (freeUntil+1) além do início da faixa P2 do grupo, a
  // contagem de P2 começa na cobrança, não no dia fixo da faixa.
  const p2Start = Math.max(rate.p2.range[0], rate.freeUntil + 1)
  const diasP2 = Math.max(0, dc - p2Start + 1)
  const totalUSD = diasP1 * rate.p1.usd + diasP2 * rate.p2.usd

  return { total_days: dc, free_days: rate.freeUntil, days_p1: diasP1, rate_p1_usd: rate.p1.usd, days_p2: diasP2, rate_p2_usd: rate.p2.usd, total_usd: totalUSD, status: 'overdue' }
}
