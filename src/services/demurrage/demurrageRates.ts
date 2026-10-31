import { supabase } from '../supabase'
import { buildDemurrageRateUpsertPayload, type DemurrageRateUpsertInput } from './demurrageRateUpsertPayload'
import { reportBestEffortFailure } from '../../lib/telemetry'
import type { DemurrageCalcResult, DemurrageRate } from '../../types/database'
import { deleteOneById, reactivateCatalogRow } from '../deleteRecords'
import { saoPauloTodayIso } from '../../lib/dates'

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

/**
 * Uma tarifa por grupo (migration 514, ADR 0112 D28): a linha guarda o código
 * do grupo, e os tipos que o grupo cobre vêm do cadastro Tipos de container,
 * como no banco (`_demurrage_canonical_type`). Tipo inativo ou fora do cadastro
 * não acha grupo, também o que tem o código de um grupo, como o 20GP (migration
 * 546). As linhas chegam pela vigência mais recente: a primeira de cada grupo
 * vale, como em `_active_demurrage_rates`.
 */
function toRateGroups(rows: DemurrageRate[], types: ReadonlyArray<{ code: string; rate_group: string; active: boolean }>): RateGroup[] {
  const grouped = new Map<string, DemurrageRate>()
  for (const row of rows) {
    const group = normalizeContainerType(row.container_type)
    if (group && !grouped.has(group)) grouped.set(group, row)
  }

  const groups: RateGroup[] = []
  for (const [group, row] of grouped) {
    const aliases = new Set<string>()
    for (const type of types) {
      if (type.active && normalizeContainerType(type.rate_group) === group) aliases.add(normalizeContainerType(type.code))
    }
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

  // Vigência pelo dia de Brasília, como o banco (`_active_demurrage_rates`).
  const today = saoPauloTodayIso()
  const [ratesRes, typesRes] = await Promise.all([
    supabase
      .from('demurrage_rates')
      .select('*')
      .eq('active', true)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order('valid_from', { ascending: false })
      .order('id', { ascending: false }),
    supabase
      .from('container_types' as never)
      .select('code, rate_group, active'),
  ])
  const data = ratesRes.data
  const error = ratesRes.error ?? typesRes.error

  const resolved = error ? [] : toRateGroups((data ?? []) as DemurrageRate[], (typesRes.data ?? []) as Array<{ code: string; rate_group: string; active: boolean }>)
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
    .order('valid_from', { ascending: false })
  if (error) throw error
  return (data ?? []) as DemurrageRate[]
}

/**
 * 23P01 de `demurrage_rates_one_per_group` (migration 514, ADR 0112 D28): o
 * banco recusa a segunda tarifa ativa do grupo com vigência sobreposta. O texto
 * do Postgres é técnico e em inglês; a tela recebe o caminho, como no acordo.
 */
function isRateGroupOverlap(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  return code === '23P01' || (typeof message === 'string' && message.includes('demurrage_rates_one_per_group'))
}

/** Nome do grupo de tarifa ("40' dry"); sem ele, o próprio código. */
async function rateGroupLabel(code: string): Promise<string> {
  const { data } = await supabase
    .from('demurrage_rate_groups' as never)
    .select('name')
    .eq('code', code)
    .maybeSingle()
  return (data as { name?: string } | null)?.name?.trim() || code
}

export async function upsertDemurrageRate(rate: DemurrageRateUpsertInput) {
  const { error } = await supabase.from('demurrage_rates').upsert(buildDemurrageRateUpsertPayload(rate))
  if (isRateGroupOverlap(error)) {
    throw new Error(`Já existe tarifa vigente para o grupo ${await rateGroupLabel(rate.container_type)}: feche a vigência da atual antes.`)
  }
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function deleteDemurrageRate(id: number, reason: string) {
  const { error } = await deleteOneById('demurrage_rates', id, reason)
  if (error) throw error
  invalidateDemurrageRatesCache()
}

export async function toggleDemurrageRateActive(id: number, active: boolean, reason?: string) {
  // B13: reativar pede motivo e passa pela RPC do Administrativo (migration 261).
  if (active) {
    try {
      await reactivateCatalogRow('demurrage_rates', id, reason ?? '')
    } catch (error) {
      if (isRateGroupOverlap(error)) {
        throw new Error('Já existe tarifa vigente para o mesmo grupo nesse período: feche a vigência da atual antes de reativar esta.', { cause: error })
      }
      throw error
    }
  } else {
    const { error } = await supabase.from('demurrage_rates').update({ active }).eq('id', id)
    if (error) throw error
  }
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
    throw new Error(`Tipo de container "${type || '(vazio)'}" sem tarifa de Demurrage: confira o cadastro do tipo e a tarifa do grupo em Tarifas e acordos.`)
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

/**
 * Free time e diárias que valem para o tipo de container (B/L > acordo >
 * tabela), para mostrar a condição vigente na ficha do B/L.
 */
export function demurrageRateFor(
  containerType: string | null,
  freeTimeOverride?: number | null,
  ov1?: number | null,
  ov2?: number | null,
  customerAgreement?: CustomerAgreementRates,
) {
  return getRate(containerType, freeTimeOverride, ov1, ov2, customerAgreement)
}

/**
 * Free time que vale para o container (B/L > acordo > tabela). O
 * `free_days` de `calculateDemurrage` é o dia corrido quando a caixa ainda
 * está dentro do free time, não o prazo.
 */
export function demurrageFreeTimeDays(
  containerType: string | null,
  freeTimeOverride?: number | null,
  customerAgreement?: CustomerAgreementRates,
): number {
  return getRate(containerType, freeTimeOverride, null, null, customerAgreement).freeUntil
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
