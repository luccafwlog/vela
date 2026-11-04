import type { ConsolidatableReceivable } from '../../types/database'
import { voyageLabel } from '../../lib/utils'

// Only receivables flagged 'eligible' by the ledger can enter a consolidated invoice.
export function isReceivableSelectable(r: Pick<ConsolidatableReceivable, 'eligibility_status'>): boolean {
  return r.eligibility_status === 'eligible'
}

/**
 * Consolidada só com dois B/Ls ou mais (decisão do dono de 2026-11-04, migration 591):
 * com um B/L só, vale a fatura individual dele. O banco recusa também; a tela só
 * desliga o botão antes.
 */
export const CONSOLIDATION_MIN_BLS = 2
export const CONSOLIDATION_MIN_BLS_MESSAGE = 'A fatura consolidada precisa de pelo menos dois B/Ls. Para um B/L só, use a fatura individual dele.'

/** B/Ls distintos da seleção: um B/L pode ter mais de um recebível. */
export function countSelectedBls(rows: Pick<ConsolidatableReceivable, 'bl_id'>[]): number {
  return new Set(rows.map((row) => row.bl_id)).size
}

export type ConsolidationSummary = {
  selectedCount: number
  eligibleCount: number
  total: number
}

export type ReceivableVoyageOption = {
  id: number
  label: string
}

export function listReceivableVoyageOptions(rows: ConsolidatableReceivable[]): ReceivableVoyageOption[] {
  const options = new Map<number, string>()

  for (const row of rows) {
    if (row.voyage_id == null) continue
    if (!['open', 'partially_settled'].includes(row.receivable_status)) continue
    if (Number(row.balance_brl ?? 0) <= 0) continue

    options.set(Number(row.voyage_id), voyageLabel(row.vessel_name, row.voyage_number, row.voyage_id))
  }

  return Array.from(options, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
}

export function summarizeConsolidation(
  rows: ConsolidatableReceivable[],
  selectedIds: number[],
): ConsolidationSummary {
  const selectedRows = rows.filter((r) => selectedIds.includes(r.receivable_id))
  return {
    selectedCount: selectedRows.length,
    eligibleCount: rows.filter(isReceivableSelectable).length,
    total: selectedRows.reduce((s, r) => s + Number(r.balance_brl ?? 0), 0),
  }
}
