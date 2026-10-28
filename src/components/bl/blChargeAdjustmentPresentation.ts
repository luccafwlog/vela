import { applicationBasisLabel } from '../billing/conferenciaCalculo'
import { formatBRL, formatDate, formatDateTime, formatUSD } from '../../lib/utils'
import { toAmount } from '../../pages/taxasLocaisHelpers'
import type { BlChargeHistoryEvent, LocalChargeLine } from '../../services/charges/chargeOperationsService'

// Alterar, excluir e desfazer Taxa Local do B/L (ADR 0111; spec 2026-10-28,
// "Mensagens"). Funções puras: a aba Cobranças decide o que mostrar com elas.

export type ChargeLineAction = 'alter' | 'restore' | 'exclude' | 'reinclude' | 'editManual' | 'deleteManual'

export const isExcludedLine = (line: { status: string | null }) => line.status === 'excluded'
type AdjustmentMark = { adjustment_id?: number | null; adjustment_kind?: string | null }

export const isAdjustedLine = (line: AdjustmentMark) =>
  line.adjustment_id != null && line.adjustment_kind !== 'excluded'

/** Ações da linha (spec, "Ações na linha"); B/L só consulta e linha em revisão ficam sem nenhuma. */
export function chargeLineActions(
  line: AdjustmentMark & { source: string | null; status: string | null },
  readOnly: boolean,
): ChargeLineAction[] {
  if (readOnly || line.status === 'review_required' || line.status === 'exempt') return []
  if (isExcludedLine(line)) return ['reinclude']
  const restore: ChargeLineAction[] = isAdjustedLine(line) ? ['restore'] : []
  if (line.source === 'manual') return ['editManual', 'alter', ...restore, 'deleteManual']
  return ['alter', ...restore, 'exclude']
}

export function formatChargeMoney(value: number | null | undefined, currency: string | null | undefined) {
  return currency === 'USD' ? formatUSD(Number(value ?? 0)) : formatBRL(Number(value ?? 0))
}

const isUsd = (line: Pick<LocalChargeLine, 'currency'>) => line.currency === 'USD'
export const tableUnitValue = (line: LocalChargeLine) => Number((isUsd(line) ? line.table_unit_value_usd : line.table_unit_value_brl) ?? 0)
export const tableTotalValue = (line: LocalChargeLine) => Number((isUsd(line) ? line.table_total_value_usd : line.table_total_value_brl) ?? 0)
export const chargedUnitValue = (line: LocalChargeLine) => Number((isUsd(line) ? line.unit_value_usd : line.unit_value_brl) ?? 0)
export const chargedTotalValue = (line: LocalChargeLine) => Number((isUsd(line) ? line.total_value_usd : line.total_value_brl) ?? 0)

function perBasis(basis: string | null | undefined) {
  const label = applicationBasisLabel(basis)
  return label ? ` ${label}` : ' por unidade'
}

/** "Tabela: R$ 1.420,00 por container · alterada por Fulano em 28/10/2026 10:00 · motivo". */
export function adjustmentTooltip(line: LocalChargeLine) {
  const parts = [`Tabela: ${formatChargeMoney(tableUnitValue(line), line.currency)}${perBasis(line.application_basis)}`]
  const verb = isExcludedLine(line) ? 'excluída' : 'alterada'
  if (line.adjusted_by_name || line.adjusted_at) {
    parts.push(`${verb}${line.adjusted_by_name ? ` por ${line.adjusted_by_name}` : ''}${line.adjusted_at ? ` em ${formatDateTime(line.adjusted_at)}` : ''}`)
  }
  if (line.adjustment_justification) parts.push(line.adjustment_justification)
  return parts.join(' · ')
}

// O banco grava o motivo da isenção à mão com este prefixo (migration 492);
// a isenção pelo veículo LCL tem outro texto.
const MANUAL_EXEMPTION_PREFIX = 'Isenção manual:'
export const isManualExemption = (reason: string | null | undefined) => Boolean(reason?.startsWith(MANUAL_EXEMPTION_PREFIX))

/** Fato **Isenção**: "Isenção manual: <justificativa> · por <nome> em dd/mm/aaaa". */
export function exemptionFact(reason: string, events: Pick<BlChargeHistoryEvent, 'event' | 'actor_name' | 'created_at'>[] | undefined) {
  if (!isManualExemption(reason)) return reason
  const last = events?.find((event) => event.event === 'exempted')
  if (!last) return reason
  return `${reason}${last.actor_name ? ` · por ${last.actor_name}` : ''} em ${formatDate(last.created_at)}`
}

export type ChargeValueDraft = { kind: 'unit' | 'total'; value: string; justification: string }

/** Valida o modal "Alterar valor"; devolve o valor lido ou a mensagem da spec. */
export function readChargeValueDraft(draft: ChargeValueDraft, line: LocalChargeLine):
  | { ok: true; value: number }
  | { ok: false; field: 'value' | 'justification'; message: string } {
  const value = toAmount(draft.value)
  if (!draft.value.trim() || !Number.isFinite(value)) return { ok: false, field: 'value', message: 'Informe um valor válido, como 1.420,50.' }
  if (value <= 0) return { ok: false, field: 'value', message: 'Informe um valor maior que zero. Para não cobrar a taxa, use Excluir taxa.' }
  const rounded = Math.round(value * 100) / 100
  const current = draft.kind === 'unit' ? chargedUnitValue(line) : chargedTotalValue(line)
  const sameKind = (line.adjustment_kind ?? 'unit') === draft.kind || !isAdjustedLine(line)
  if (sameKind && Math.abs(rounded - current) < 0.005) return { ok: false, field: 'value', message: 'O valor é igual ao atual: nada a alterar.' }
  if (draft.justification.trim().length < 10) return { ok: false, field: 'justification', message: 'Escreva a justificativa (ao menos 10 caracteres).' }
  return { ok: true, value: rounded }
}

/** Linha viva do modal: "Novo total: R$ 2.400,00 · −15,5% sobre a tabela". */
export function newTotalPreview(kind: 'unit' | 'total', rawValue: string, line: LocalChargeLine) {
  const value = toAmount(rawValue)
  if (!rawValue.trim() || !Number.isFinite(value) || value <= 0) return null
  const quantity = Number(line.quantity ?? 0)
  const total = kind === 'unit' ? Math.round(quantity * value * 100) / 100 : Math.round(value * 100) / 100
  const table = tableTotalValue(line)
  if (!table) return `Novo total: ${formatChargeMoney(total, line.currency)}`
  const pct = ((total - table) / table) * 100
  const pctText = `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  return `Novo total: ${formatChargeMoney(total, line.currency)} · ${pctText} sobre a tabela`
}

type Snapshot = { kind?: string; unit?: number | string; total?: number | string; quantity?: number | string; currency?: string; basis?: string | null }

function snapshotValue(snapshot: Snapshot | null, kind: 'unit' | 'total') {
  if (!snapshot) return null
  const value = kind === 'unit' ? snapshot.unit : snapshot.total
  return value == null ? null : formatChargeMoney(Number(value), snapshot.currency)
}

const qty = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

const DISCARD_REASON: Record<string, string> = {
  pod: 'POD',
  modalidade: 'modalidade',
  tabela: 'tabela',
}

/** Coluna **O que mudou** do Histórico das taxas (spec, "Mensagens"). */
export function historyChangePhrase(event: Pick<BlChargeHistoryEvent, 'event' | 'before' | 'after'>) {
  const before = event.before as Snapshot | null
  const after = event.after as (Snapshot & { reason?: string; table_name?: string | null; pod?: string | null }) | null
  switch (event.event) {
    case 'altered': {
      const kind = after?.kind === 'total' ? 'total' : 'unit'
      const label = kind === 'unit' ? 'Valor por unidade' : 'Valor total'
      return `${label}: ${snapshotValue(before, kind) ?? '—'} → ${snapshotValue(after, kind) ?? '—'}`
    }
    case 'excluded':
      return `Excluída da cobrança (era ${snapshotValue(before, 'total') ?? '—'})`
    case 'restored':
      return `Voltou ao valor da tabela (${snapshotValue(after, 'unit') ?? '—'}${perBasis(after?.basis)})`
    case 'reincluded':
      return 'Incluída de novo'
    case 'manual_deleted':
      return 'Cobrança manual excluída'
    case 'exempted':
      return 'B/L isento das Taxas Locais'
    case 'exemption_removed':
      return 'Isenção retirada'
    case 'remapped':
      return `Alteração passou para a tabela ${after?.table_name ?? '—'}, preço refixado`
    case 'discarded': {
      const reason = DISCARD_REASON[after?.reason ?? ''] ?? 'tabela'
      return `Alteração descartada pelo sistema: o B/L passou para a tabela ${after?.table_name ?? '—'} (${reason}${reason === 'POD' && after?.pod ? ` ${after.pod}` : ''})`
    }
    case 'quantity_changed':
      return `Quantidade mudou de ${qty(before?.quantity)} para ${qty(after?.quantity)}; valor total alterado mantido em ${formatChargeMoney(Number(after?.total ?? 0), after?.currency)}`
    default:
      return event.event
  }
}

/** Coluna **Efeito na fatura**; até o lote 3 só existe B/L sem fatura. */
export function historyInvoiceEffect(event: Pick<BlChargeHistoryEvent, 'invoice_effect'>) {
  const effect = event.invoice_effect as { summary?: string } | null
  return effect?.summary ?? 'Sem fatura'
}
