// Texto da faixa da Situação do B/L na Validação (lote 1 da identidade).
import { formatDate } from '../../lib/utils'

/** Estados que não pedem ação: a faixa fica neutra, sem âmbar. */
export const CALM_CODES = new Set(['faturado', 'isento', 'operacao_granito'])

export type ReasonEvent = { kind: 'auto_issue_failed' | 'calculation_blocked'; at: string }

/**
 * "Sem linhas de taxa: …" já diz o motivo; os outros levam o rótulo antes do
 * detalhe. Quando o histórico explica o motivo, a data entra na faixa
 * (lote 1 da identidade, 2026-10-14).
 */
export function bandText(block: { code: string; label: string; detail: string }, event?: ReasonEvent) {
  const text = baseBandText(block)
  if (!event || CALM_CODES.has(block.code) || (block.code === 'pronto' && event.kind !== 'auto_issue_failed')) return text
  const when = formatDate(event.at)
  return event.kind === 'auto_issue_failed'
    ? `A emissão automática falhou em ${when}. ${text}`
    : `Cálculo bloqueado desde ${when}. ${text}`
}

function baseBandText(block: { code: string; label: string; detail: string }) {
  if (!block.detail) return block.label
  if (/^[^:]{3,40}: /.test(block.detail)) return block.detail
  return `${block.label}: ${block.detail.replace(/^./, (first) => first.toLowerCase())}`
}
