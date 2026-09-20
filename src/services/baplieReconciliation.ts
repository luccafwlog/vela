import { supabase } from './supabase'
import type { BLContainer, BaplieContainer as BaplieContainerRow } from '../types/database'

// Baplie/EDI é soberano para as flags físicas (is_imo, imo_class, un_number,
// is_oog) — CONTEXT.md. Portanto a conciliação NÃO aponta divergência de
// atributo: o valor do Baplie é aplicado automaticamente ao B/L. A única
// divergência apontada é de EXISTÊNCIA: container no Baplie e em nenhum B/L, ou
// em B/L e ausente do Baplie (#306).
export type BaplieReconciliationItem =
  | {
      kind: 'missing_in_manifest'
      container_number: string
      baplie_bl_ref: string | null
      slot: string | null
    }
  | {
      kind: 'missing_in_baplie'
      container_number: string
      bl_container_id: number
      // P2-16: renomeado de bl_number (o valor sempre foi bls.id, nao um
      // "numero" resolvido a parte -- bls.id ja carrega o numero do B/L por
      // desenho de schema, mas o nome do campo sugeria uma resolucao que
      // nunca existiu).
      bl_id: string | null
    }

export type BaplieReconciliationResult = {
  items: BaplieReconciliationItem[]
  // 'not_imported': nenhuma linha de staging do Baplie para a viagem — nao e o
  // mesmo estado que uma reconciliacao concluida com zero divergencias.
  // 'awaiting_route_coverage': ha Baplie, mas NENHUMA rota de containers cheios
  // tem B/L com containers ainda — nada e conciliavel.
  source: 'not_imported' | 'awaiting_route_coverage' | 'reconciled'
  // Rotas de containers cheios do Baplie que ainda nao tem B/L com containers.
  // Ficam de fora da conciliacao (o B/L pode nao ter chegado), mas sao exibidas
  // para que a espera seja visivel em vez de silenciosa.
  pendingRoutes: string[]
}

import { normalizePortCode } from './portCode'

type RouteRow = { pol: string | null; pod: string | null }
type BlRouteRow = RouteRow & { id: string }

function routeKey(row: RouteRow): string | null {
  const pol = normalizePortCode(row.pol) ?? row.pol?.trim().toUpperCase() ?? ''
  const pod = normalizePortCode(row.pod) ?? row.pod?.trim().toUpperCase() ?? ''
  return pol && pod ? `${pol}::${pod}` : null
}

export type BaplieRouteCoverage = {
  /** Rotas EDI (cheios) com pelo menos um B/L com containers — conciliáveis. */
  covered: Set<string>
  /** Rotas EDI (cheios) ainda sem B/L com containers — aguardando importação. */
  pending: string[]
}

/**
 * Cobertura POR ROTA (pura, testável). A regra de negócio é que uma rota de
 * containers cheios prevista pelo Baplie só entra na conciliação quando existe
 * pelo menos um B/L COM CONTAINERS naquela rota — B/L sem container não cobre
 * rota nenhuma. O gate é por rota, e não da viagem inteira: uma rota sem B/L
 * apenas se exclui da conciliação, sem silenciar as demais (#604).
 */
export function computeBaplieRouteCoverage(staged: RouteRow[], blsWithContainers: RouteRow[]): BaplieRouteCoverage {
  const ediRoutes = new Set(staged.map(routeKey).filter((route): route is string => route !== null))
  const blRoutes = new Set(blsWithContainers.map(routeKey).filter((route): route is string => route !== null))
  const covered = new Set([...ediRoutes].filter((route) => blRoutes.has(route)))
  const pending = [...ediRoutes].filter((route) => !blRoutes.has(route)).sort()
  return { covered, pending }
}

/** Compatibilidade: cobertura total (todas as rotas EDI cobertas). */
export function hasCompleteBaplieRouteCoverage(staged: RouteRow[], bls: RouteRow[]): boolean {
  const ediRoutes = new Set(staged.map(routeKey).filter((route): route is string => route !== null))
  // Compatibilidade com chamadas/fixtures legados que não carregam a rota.
  if (!ediRoutes.size) return true
  return computeBaplieRouteCoverage(staged, bls).pending.length === 0
}

type BlContainerPhysical = Pick<
  BLContainer,
  'id' | 'bl_id' | 'container_number' | 'is_imo' | 'imo_class' | 'un_number' | 'is_oog'
>

export type BapliePhysicalUpdate = {
  bl_container_id: number
  previous: {
    is_imo: boolean
    imo_class: string | null
    un_number: string | null
    is_oog: boolean
  }
  is_imo: boolean
  imo_class: string | null
  un_number: string | null
  is_oog: boolean
}

/**
 * Divergências de existência (pura, testável) — as duas direções.
 *
 * `pendingRoutes` são rotas do Baplie ainda sem B/L com containers: os
 * containers dessas rotas não viram divergência `missing_in_manifest` (o B/L
 * pode não ter chegado), mas continuam contando como presentes no Baplie, para
 * não gerar `missing_in_baplie` falso do outro lado.
 */
export function computeExistenceDivergences(
  staged: BaplieContainerRow[],
  blContainers: BlContainerPhysical[],
  pendingRoutes?: Set<string>,
): BaplieReconciliationItem[] {
  const items: BaplieReconciliationItem[] = []

  const blByNumber = new Map<string, BlContainerPhysical[]>()
  for (const c of blContainers) {
    const key = normalizeContainerNumber(c.container_number)
    const list = blByNumber.get(key) ?? []
    list.push(c)
    blByNumber.set(key, list)
  }

  const baplieFullNumbers = new Set<string>()
  for (const b of staged) {
    if (b.status === 'empty') continue
    baplieFullNumbers.add(normalizeContainerNumber(b.container_number))
  }

  // Container no Baplie (full) e em nenhum B/L.
  for (const b of staged) {
    if (b.status === 'empty') continue
    if (pendingRoutes?.size) {
      const route = routeKey({ pol: b.pol, pod: b.pod })
      if (route && pendingRoutes.has(route)) continue
    }
    const key = normalizeContainerNumber(b.container_number)
    if (!blByNumber.has(key)) {
      items.push({
        kind: 'missing_in_manifest',
        container_number: b.container_number,
        baplie_bl_ref: b.bl_ref,
        slot: b.slot,
      })
    }
  }

  // Container em B/L e ausente do Baplie (full).
  for (const mc of blContainers) {
    const key = normalizeContainerNumber(mc.container_number)
    if (!baplieFullNumbers.has(key)) {
      items.push({
        kind: 'missing_in_baplie',
        container_number: mc.container_number,
        bl_container_id: mc.id,
        bl_id: mc.bl_id ?? null,
      })
    }
  }

  return items
}

/**
 * Flags físicas do Baplie que devem sobrescrever o B/L (pura, testável). Para
 * cada container full do Baplie que casa com exatamente um bl_container, se
 * qualquer flag física diferir, produz um update com os valores do Baplie.
 * Quando o Baplie não é IMO, zera classe/ONU.
 */
export function computeBapliePhysicalUpdates(
  staged: BaplieContainerRow[],
  blContainers: BlContainerPhysical[],
): BapliePhysicalUpdate[] {
  const blByNumber = new Map<string, BlContainerPhysical[]>()
  for (const c of blContainers) {
    const key = normalizeContainerNumber(c.container_number)
    const list = blByNumber.get(key) ?? []
    list.push(c)
    blByNumber.set(key, list)
  }

  const updates: BapliePhysicalUpdate[] = []
  for (const b of staged) {
    if (b.status === 'empty') continue
    const matches = blByNumber.get(normalizeContainerNumber(b.container_number))
    if (!matches || matches.length !== 1) continue
    const mc = matches[0]

    const isImo = Boolean(b.is_imo)
    const imoClass = isImo ? (b.imo_class ?? null) : null
    const unNumber = isImo ? (b.un_number ?? null) : null
    const isOog = Boolean(b.is_oog)

    const differs =
      isImo !== Boolean(mc.is_imo) ||
      isOog !== Boolean(mc.is_oog) ||
      normalizeVal(imoClass) !== normalizeVal(mc.imo_class) ||
      normalizeVal(unNumber) !== normalizeVal(mc.un_number)

    if (differs) {
      updates.push({
        bl_container_id: mc.id,
        previous: {
          is_imo: Boolean(mc.is_imo),
          imo_class: mc.imo_class ?? null,
          un_number: mc.un_number ?? null,
          is_oog: Boolean(mc.is_oog),
        },
        is_imo: isImo,
        imo_class: imoClass,
        un_number: unNumber,
        is_oog: isOog,
      })
    }
  }
  return updates
}

async function fetchStagingAndBlContainers(voyageId: number) {
  const { data: blRows, error: blError } = await supabase.from('bls').select('id, pol, pod').eq('voyage_id', voyageId)
  if (blError) throw blError

  const PAGE = 1000
  const staged: BaplieContainerRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('baplie_containers')
      .select('*')
      .eq('voyage_id', voyageId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    staged.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  const blIds = (blRows ?? []).map((b) => b.id)
  const blContainers: BlContainerPhysical[] = []
  if (blIds.length) {
    let fromC = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, is_imo, imo_class, un_number, is_oog')
        .in('bl_id', blIds)
        .range(fromC, fromC + PAGE - 1)
      if (error) throw error
      blContainers.push(...((data ?? []) as BlContainerPhysical[]))
      if (!data || data.length < PAGE) break
      fromC += PAGE
    }
  }

  return { staged: dedupeBaplieContainers(staged), blContainers, blRows: (blRows ?? []) as BlRouteRow[] }
}

type UntypedRpcClient = {
  rpc: (functionName: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
}

async function fetchFirstBrazilianEta(voyageId: number): Promise<string | null> {
  // Esse helper foi criado na migration 326, mas os tipos gerados neste
  // checkout ainda não incluem a função. O cast fica local até a regeneração
  // dos tipos a partir do schema Supabase alvo.
  const rpcClient = supabase as unknown as UntypedRpcClient
  const { data, error } = await rpcClient.rpc('get_voyage_first_brazilian_eta', { p_voyage_id: voyageId })
  if (error) throw error
  return data == null ? null : String(data).slice(0, 10)
}

function saoPauloDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

/** Mantém a mesma regra do SQL: a janela começa em ETA - 7 dias e não expira. */
export function isBaplieReconciliationD7(
  firstBrazilianEta: string | null | undefined,
  today = saoPauloDateKey(),
): boolean {
  if (!firstBrazilianEta) return false
  const etaDate = Date.parse(`${firstBrazilianEta.slice(0, 10)}T00:00:00Z`)
  const todayDate = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(etaDate) || Number.isNaN(todayDate)) return false
  return todayDate >= etaDate - 7 * 24 * 60 * 60 * 1000
}

async function resolveIsD7(
  voyageId: number,
  options?: { isD7?: boolean; firstBrazilianEta?: string | null },
): Promise<boolean> {
  if (options?.isD7 !== undefined) return options.isD7
  const firstBrazilianEta = options && 'firstBrazilianEta' in options
    ? options.firstBrazilianEta
    : await fetchFirstBrazilianEta(voyageId)
  return isBaplieReconciliationD7(firstBrazilianEta)
}

export async function reconcileBaplieWithManifest(
  voyageId: number,
  options?: { isD7?: boolean; firstBrazilianEta?: string | null },
): Promise<BaplieReconciliationResult> {
  const { staged, blContainers, blRows } = await fetchStagingAndBlContainers(voyageId)
  if (!staged.length) return { items: [], source: 'not_imported', pendingRoutes: [] }

  const isD7 = await resolveIsD7(voyageId, options)

  const fullStaged = staged.filter((c) => c.status !== 'empty')
  // Só B/L COM containers cobre rota: um B/L sem container não conferiu nada.
  const blIdsWithContainers = new Set(blContainers.map((c) => String(c.bl_id)))
  const blsWithContainers = blRows.filter((bl) => blIdsWithContainers.has(String(bl.id)))
  const { covered, pending } = computeBaplieRouteCoverage(
    fullStaged.length > 0 ? fullStaged : staged,
    blsWithContainers,
  )

  // D-7 força a conciliação de todas as rotas, inclusive as ainda sem B/L.
  const pendingRoutes = isD7 ? [] : pending
  // Nenhuma rota conciliável e nada forçado: a viagem inteira segue aguardando.
  if (!covered.size && pendingRoutes.length) {
    return { items: [], source: 'awaiting_route_coverage', pendingRoutes }
  }

  return {
    items: computeExistenceDivergences(staged, blContainers, new Set(pendingRoutes)),
    source: 'reconciled',
    pendingRoutes,
  }
}

/**
 * Aplica as flags físicas do Baplie (soberano) aos bl_containers da viagem, com
 * auditoria. Idempotente: só grava onde há diferença. Retorna quantos containers
 * foram atualizados.
 */
export async function applyBapliePhysicalFlags(voyageId: number, actorId: string | null): Promise<number> {
  if (!actorId) throw new Error('Usuário ativo obrigatório para aplicar flags do Baplie.')
  const { data, error } = await supabase.rpc('apply_baplie_physical_flags_atomic', {
    p_voyage_id: voyageId,
    p_changes: null,
    p_changed_by: actorId,
  })
  if (error) throw error
  const applied = (data as { applied?: unknown } | null)?.applied
  return Number.isFinite(Number(applied)) ? Number(applied) : 0
}

function normalizeVal(v: string | null | undefined) {
  return (v ?? '').toUpperCase()
}

function normalizeContainerNumber(v: string | null | undefined) {
  return (v ?? '').replace(/\s+/g, '').toUpperCase()
}

function dedupeBaplieContainers(rows: BaplieContainerRow[]) {
  const byNumber = new Map<string, BaplieContainerRow>()

  for (const row of rows) {
    const key = normalizeContainerNumber(row.container_number)
    if (!/^[A-Z]{4}\d{7}$/.test(key)) continue

    const existing = byNumber.get(key)
    if (!existing) {
      byNumber.set(key, { ...row, container_number: key })
      continue
    }

    existing.status = existing.status === 'full' || row.status === 'full' ? 'full' : 'empty'
    existing.bl_ref = row.bl_ref ?? existing.bl_ref
    existing.slot = row.slot ?? existing.slot
    existing.is_imo = Boolean(existing.is_imo || row.is_imo)
    existing.imo_class = row.imo_class ?? existing.imo_class
    existing.un_number = row.un_number ?? existing.un_number
    existing.is_oog = Boolean(existing.is_oog || row.is_oog)
  }

  return Array.from(byNumber.values())
}
