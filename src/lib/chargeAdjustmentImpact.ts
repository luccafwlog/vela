import type { BlChargeImpact, BlChargeImpactItem } from '../services/charges/chargeOperationsService'
import { applicationBasisLabel } from './applicationBasis'

// Frases da seção **Taxas alteradas à mão** das prévias e do diálogo **Taxas
// alteradas à mão serão afetadas** (ADR 0111, D6; spec, seção 7).

function money(value: number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${String(currency ?? 'BRL').toUpperCase() === 'USD' ? 'US$' : 'R$'} ${amount}`
}

const qty = (value: number | null | undefined) => Number(value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

const DISCARD_REASON: Record<string, string> = { pod: 'POD', modalidade: 'modalidade', tabela: 'tabela' }

export function describeImpactItem(blId: string, item: BlChargeImpactItem) {
  const head = `${blId} · ${item.charge_name}`
  switch (item.outcome) {
    case 'discarded': {
      const reason = DISCARD_REASON[item.reason ?? ''] ?? 'tabela'
      return `${head}: alteração descartada — o B/L passa para a tabela ${item.table_name ?? 'nenhuma'} (${reason})`
    }
    case 'total_kept':
      return `${head}: valor total alterado mantido em ${money(item.total, item.currency)}; a quantidade passa de ${qty(item.quantity)} para ${qty(item.after_quantity)}`
    case 'removed':
      return `${head}: sai da cobrança (quantidade ${qty(item.quantity)} → 0); o valor total alterado de ${money(item.total, item.currency)} fica guardado e volta se a taxa voltar ao B/L`
    case 'quantity':
      return `${head}: quantidade muda de ${qty(item.quantity)} para ${qty(item.after_quantity)} — total ${money(item.total, item.currency)} → ${money(item.after_total, item.currency)}`
    case 'remapped':
      return `${head}: mantida, passa para a tabela nova`
    default: {
      if (item.kind === 'excluded') return `${head}: mantida (excluída)`
      if (item.kind === 'total') return `${head}: mantida (${money(item.value, item.currency)} no total)`
      const basis = applicationBasisLabel(item.basis)
      return `${head}: mantida (${money(item.value, item.currency)}${basis ? ` ${basis}` : ''})`
    }
  }
}

/** Uma linha por alteração; B/L isento à mão vira uma linha só. */
export function describeImpact(entries: readonly BlChargeImpact[]) {
  return entries.flatMap((entry) => {
    if (entry.manual_exempt) return [`${entry.bl_id}: isento à mão — continua isento`]
    return entry.items.map((item) => describeImpactItem(entry.bl_id, item))
  })
}

/** Linhas que pedem o **Gravar mesmo assim**: descarte, total alterado com quantidade nova e taxa com total alterado que sai da cobrança. */
export function impactNeedingConfirmation(entries: readonly BlChargeImpact[]) {
  return entries.flatMap((entry) => (entry.manual_exempt ? [] : entry.items
    .filter((item) => item.needs_confirmation)
    .map((item) => ({ blId: entry.bl_id, text: describeImpactItem(entry.bl_id, item) }))))
}

/** Recusa do **Gravar mesmo assim** dentro de uma importação: nada foi gravado. */
export const IMPORT_CANCELLED_BY_CHARGES = 'Importação cancelada antes de gravar: nada foi alterado.'
