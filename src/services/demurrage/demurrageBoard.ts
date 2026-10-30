import { supabase } from '../supabase'
import { matchesAnyToken } from '../../lib/searchTerms'
import { DEMURRAGE_DIVISIONS, DEMURRAGE_DIVISION_LABELS, type DemurrageDivision } from './demurrageDivisions'

/**
 * Classificação da cobrança de Demurrage feita pelo banco
 * (`list_demurrage_billing_board`, migration 515; ADR 0112, D1 a D5): um grupo
 * de cobrança por linha, com a divisão, o motivo e as caixas não-SOC com o
 * cálculo de hoje. A tela só apresenta; não recalcula nem decide.
 */
export { DEMURRAGE_DIVISIONS, DEMURRAGE_DIVISION_LABELS, type DemurrageDivision }

export type TravadoReason = 'sem_tarifa' | 'bl_cancelado' | 'sem_cliente' | 'sem_ce' | 'portal'

export type BoardBoxState = 'covered' | 'waived' | 'no_discharge' | 'no_rate' | 'running' | 'in_free_time' | 'returned_overstay' | 'returned_free'

export type BoardBox = {
  container_id: number
  bl_id: string
  container_number: string
  type: string | null
  rate_group: string | null
  discharge_date: string | null
  return_date: string | null
  total_days: number | null
  free_days: number | null
  free_source: 'bl' | 'acordo' | 'tabela' | null
  last_free_day: string | null
  days_p1: number | null
  rate_p1_usd: number | null
  days_p2: number | null
  rate_p2_usd: number | null
  /** US$ de hoje, só da caixa sem Invoice (Correndo ou devolvida com sobreestadia). */
  usd: number | null
  state: BoardBoxState
  covered_by: number | null
  covered_doc: string | null
  /** Dispensa da cobrança da caixa (migration 517). */
  waiver_id?: number | null
}

export type BoardGroup = {
  anchor_bl_id: string
  bl_ids: string[]
  voyage_id: number | null
  voyage_label: string | null
  customer_id: number | null
  customer_name: string | null
  customer_cnpj: string | null
  division: DemurrageDivision
  reason_code: TravadoReason | null
  reason: string | null
  /** Em Correndo e Esperando: o que vai travar a emissão (sem CE, Portal). */
  warning: string | null
  no_rate_types: string | null
  /** Em A emitir (migration 525): Invoice cancelada à mão que as caixas esperam (D10). */
  cancelled_doc?: string | null
  /** Em A emitir (migration 525): a emissão automática já está na fila. */
  issue_queued?: boolean
  usd: number
  boxes: BoardBox[]
}

export type DemurrageBoardFilters = { customerId?: number | null; voyageId?: number | null }

export async function listDemurrageBillingBoard(filters: DemurrageBoardFilters = {}): Promise<BoardGroup[]> {
  const { data, error } = await supabase.rpc('list_demurrage_billing_board' as never, {
    p_customer_id: filters.customerId ?? null,
    p_voyage_id: filters.voyageId ?? null,
  } as never)
  if (error) throw error
  return ((data ?? []) as BoardGroup[]).map((group) => ({ ...group, usd: Number(group.usd ?? 0) }))
}

/** Caixas de Correndo, para o aviso do cabeçalho (migration 516). */
export async function countDemurrageRunningBoxes(): Promise<number> {
  const { data, error } = await supabase.rpc('count_demurrage_running_boxes' as never)
  if (error) throw error
  return Number(data ?? 0)
}

export type DivisionTotals = Record<DemurrageDivision, { groups: number; boxes: number; usd: number }>

/** Contagem e US$ por divisão: caixas sem Invoice que contam na divisão. */
export function divisionTotals(groups: readonly BoardGroup[]): DivisionTotals {
  const totals = Object.fromEntries(DEMURRAGE_DIVISIONS.map((division) => [division, { groups: 0, boxes: 0, usd: 0 }])) as DivisionTotals
  for (const group of groups) {
    const total = totals[group.division]
    total.groups += 1
    total.boxes += group.boxes.filter((box) => box.state !== 'covered' && box.state !== 'waived').length
    total.usd += group.usd
  }
  return totals
}

export function boxCounts(group: BoardGroup) {
  const returned = group.boxes.filter((box) => box.return_date).length
  return { out: group.boxes.length - returned, returned, total: group.boxes.length }
}

export function matchesBoardSearch(group: BoardGroup, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  const texts = [
    group.anchor_bl_id, ...group.bl_ids, group.customer_name ?? '', group.voyage_label ?? '',
    ...group.boxes.flatMap((box) => [box.container_number, box.covered_doc ?? '']),
  ]
  return texts.some((text) => text.toLowerCase().includes(term)) || matchesAnyToken(term, texts)
}

/**
 * Próximo passo da linha (D4, D5): a ação que o banco aceita, o atalho que
 * destrava ou a espera. Gerar Invoice só em A emitir.
 */
export type NextStep =
  | { kind: 'generate'; complement: boolean; cancelledDoc: string | null; queued: boolean }
  | { kind: 'link'; label: string; href: string; note: string }
  | { kind: 'wait'; text: string }
  | { kind: 'running'; text: string }
  | { kind: 'note'; text: string }

export function nextStep(group: BoardGroup): NextStep {
  if (group.division === 'a_emitir') {
    return {
      kind: 'generate',
      complement: group.boxes.some((box) => box.state === 'covered'),
      cancelledDoc: group.cancelled_doc ?? null,
      queued: Boolean(group.issue_queued),
    }
  }
  if (group.division === 'travado') {
    const note = group.reason ?? 'A cobrança está travada.'
    const bl = encodeURIComponent(group.anchor_bl_id)
    switch (group.reason_code) {
      case 'sem_ce': return { kind: 'link', label: 'Cadastrar CE', href: `/bls/${bl}`, note }
      case 'sem_cliente': return { kind: 'link', label: 'Vincular Cliente', href: `/bls/${bl}`, note }
      case 'sem_tarifa': {
        const type = (group.no_rate_types ?? '').split(',')[0]?.trim()
        return { kind: 'link', label: 'Cadastrar tipo', href: `/demurrage/taxas?tab=tipos${type && type !== '(vazio)' ? `&tipo=${encodeURIComponent(type)}` : ''}`, note }
      }
      case 'portal': return group.customer_cnpj
        ? { kind: 'link', label: 'Abrir Cliente', href: `/clientes/${encodeURIComponent(group.customer_cnpj)}`, note }
        : { kind: 'note', text: note }
      default: return { kind: 'note', text: note }
    }
  }
  if (group.division === 'esperando') {
    const waiting = group.boxes.filter((box) => !box.return_date && box.state !== 'covered')
    const first = waiting[0]
    if (!first) return { kind: 'wait', text: 'Aguarda a devolução das caixas do grupo' }
    const until = first.last_free_day ? ` até ${formatShort(first.last_free_day)}` : ''
    const more = waiting.length > 1 ? ` e mais ${waiting.length - 1}` : ''
    return { kind: 'wait', text: `Aguarda ${first.container_number}${until}${more}` }
  }
  const running = group.boxes.filter((box) => box.state === 'running').length
  return { kind: 'running', text: `${running} ${running === 1 ? 'caixa correndo' : 'caixas correndo'}; a Invoice sai quando todas voltarem` }
}

function formatShort(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}` : iso
}

/** Caixa que ainda pode ter a cobrança dispensada (ADR 0112, D24). */
export function canWaiveBox(box: BoardBox): boolean {
  return box.state === 'running' || box.state === 'returned_overstay' || box.state === 'no_rate'
}

/**
 * Dispensa a cobrança de Demurrage de uma caixa (migration 517): qualquer
 * Departamento, com justificativa de 10 ou mais caracteres. A caixa conta como
 * coberta: sai da aba Containers e da emissão.
 */
export async function waiveDemurrageBox(blId: string, containerNumber: string, reason: string): Promise<void> {
  const text = reason.trim()
  if (text.length < 10) throw new Error('Informe a justificativa da dispensa (mínimo de 10 caracteres).')
  const { error } = await supabase.rpc('waive_demurrage_box' as never, { p_bl_id: blId, p_container_number: containerNumber, p_reason: text } as never)
  if (error) throw error
}

export async function revokeDemurrageBoxWaiver(waiverId: number, reason: string): Promise<void> {
  const text = reason.trim()
  if (text.length < 10) throw new Error('Informe a justificativa para desfazer a dispensa (mínimo de 10 caracteres).')
  const { error } = await supabase.rpc('revoke_demurrage_box_waiver' as never, { p_waiver_id: waiverId, p_reason: text } as never)
  if (error) throw error
}
