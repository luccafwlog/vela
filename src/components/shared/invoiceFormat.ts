import type { InvoiceDetail } from '../../services/billing'
import { formatDate } from '../../lib/utils'
import { formatCnpj } from '../../lib/cnpj'
import type React from 'react'

// Helpers de formatação e estilos compartilhados pelos documentos imprimíveis
// de fatura (ver InvoiceDocumentKit.tsx para os blocos JSX compartilhados).

export function fmtBRL(v: number | null | undefined): string {
  if (v == null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  const formatted = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-R$ ${formatted}` : `R$ ${formatted}`
}

export function fmtUSD(v: number | null | undefined): string {
  if (v == null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  const formatted = Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-US$ ${formatted}` : `US$ ${formatted}`
}

// Etapa 11 do plano de faturamento (ADR 0038 decisão 6, achado 7): item
// cadastrado em USD converte para BRL no momento da emissão, pelo ROE vigente
// (exchange_rate_reference), e fica congelado com o resto da fatura — sem o
// Recálculo Diário que o Demurrage usa. create_invoice_from_bls_core e
// create_local_consolidated_invoice_core gravam o ROE e a data de vigência
// usados em snapshot_payload; esta nota é a rastreabilidade desse câmbio no
// documento impresso.
export function describeUsdConversionNote(item: {
  currency?: string | null
  unit_value_usd?: number | null
  snapshot_payload?: unknown
}) {
  if (item.currency !== 'USD') return null
  const payload = (item.snapshot_payload ?? null) as { roe?: number | null; roe_effective_date?: string | null } | null
  const roe = payload?.roe ?? null
  if (roe == null) return null
  const roeLabel = Number(roe).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  const dateLabel = payload?.roe_effective_date ? ` em ${formatDate(payload.roe_effective_date)}` : ''
  return `${fmtUSD(item.unit_value_usd)} × ROE ${roeLabel}${dateLabel}`
}

export function fmtCNPJ(s: string | null | undefined) {
  return s ? formatCnpj(s) : ''
}

export function longDate() {
  return new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

// Etapa 1 do plano de faturamento (ADR 0038, achado 3): o detalhamento de uma
// invoice individual vem congelado em invoice_items desde a emissão (migration
// 025_billing_orchestration_portal.sql), então recálculos posteriores do B/L
// não o alteram. Desde a migration 261, consolidadas também congelam o
// detalhamento no momento da consolidação (create_local_consolidated_invoice_core);
// a reconstrução ao vivo a partir de charge_calculations só roda como rede de
// seguranca para consolidadas antigas que não passaram pelo backfill.
export function describeInvoiceItemsFreezeNote(invoice: { invoice_type?: string | null; issued_at?: string | null }) {
  if (invoice.invoice_type === 'consolidated') {
    return `Emitida em ${formatDate(invoice.issued_at)}. Consolidada: o detalhamento por B/L reflete o saldo de cada B/L congelado no momento da consolidação e não muda com recálculos posteriores.`
  }
  return `Itens automáticos (Origem: Auto) refletem o cálculo do B/L congelado na emissão (${formatDate(invoice.issued_at)}) e não mudam com recálculos posteriores. Itens manuais podem ter sido lançados depois da emissão — veja a coluna Origem.`
}

// Paleta única dos documentos imprimíveis (fatura de taxas locais, fatura/recibo
// de Demurrage e Agency Departure Report). A fatura de taxas locais é o modelo:
// barra de cabeçalho navy com texto branco, zebra clara nas linhas, barra de
// total âmbar e faixa clara para agrupar blocos. Quem imprimir um documento novo
// consome estes tokens em vez de repetir hex solto.
export const DOC_NAVY = '#1A2744'
export const DOC_ACCENT = '#F59E0B'
export const DOC_BORDER = '#e5e7eb'
export const DOC_ROW_RULE = '#eee'
export const DOC_ZEBRA = '#f9fafb'
export const DOC_GROUP = '#e8edf5'
export const DOC_SUBTOTAL = '#f0f4fa'
export const DOC_MUTED = '#6b7280'

export const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${DOC_BORDER}` }
export const labelCell: React.CSSProperties = { ...cell, fontWeight: 700, width: 130, whiteSpace: 'nowrap' }

export const documentRoot: React.CSSProperties = { fontFamily: 'Arial, sans-serif', fontSize: '13px', color: '#111', background: 'white' }

// Tabela de itens no padrão da fatura: cabeçalho navy, zebra e barra de total.
export const dataTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', margin: '6px 0 12px', fontSize: '12px' }
export const dataHeadRow: React.CSSProperties = { background: DOC_NAVY, color: 'white' }
export const dataHeadCell: React.CSSProperties = { padding: '9px 7px', textAlign: 'left', fontWeight: 600 }
export const dataCell: React.CSSProperties = { padding: '8px 7px', textAlign: 'left', fontWeight: 400 }
export const dataNumberCell: React.CSSProperties = { ...dataCell, textAlign: 'right' }
export const dataTotalRow: React.CSSProperties = { background: DOC_ACCENT, fontWeight: 700 }
export const dataTotalCell: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontWeight: 700 }

export function zebraRow(index: number): React.CSSProperties {
  return { background: index % 2 === 0 ? DOC_ZEBRA : 'white', borderBottom: `1px solid ${DOC_ROW_RULE}` }
}

// Faixa que agrupa um bloco do documento — a mesma da linha "B/L …" da fatura
// consolidada, reaproveitada como título de seção no impresso do ADR.
export const groupBar: React.CSSProperties = { background: DOC_GROUP, color: DOC_NAVY, fontWeight: 700, fontSize: '11px', letterSpacing: '0.04em', textTransform: 'uppercase', padding: '6px 8px', margin: '16px 0 0' }

// Nome padronizado do arquivo de fatura de taxas locais (sem extensao):
// "NumeroFatura - FATURA TAXAS LOCAIS - PrimeiroNomeCliente - BL(s)".
// Ex.: "INV-2026-0127 - FATURA TAXAS LOCAIS - GOLDEN - CSC45630201C00".
export function buildInvoiceFileBaseName(detail: InvoiceDetail): string {
  const invoice = detail.invoice
  const invoiceNumber = invoice?.invoice_number ?? (invoice ? `INV-${invoice.id}` : 'Fatura')
  const firstName = (invoice?.customer_name ?? '').trim().split(/\s+/)[0] ?? ''
  const validBls = Array.isArray(detail.bls)
    ? (detail.bls.map((b) => b.bl_id).filter(Boolean) as string[])
    : []
  const blPart =
    validBls.length <= 3
      ? validBls.join(', ')
      : `${validBls.slice(0, 3).join(', ')} e mais ${validBls.length - 3}`
  const base = [invoiceNumber, 'FATURA TAXAS LOCAIS', firstName, blPart]
    .filter((part) => part && part.trim().length > 0)
    .join(' - ')
  // Remove caracteres invalidos em nomes de arquivo, normaliza espacos e limita tamanho a 200 caracteres.
  const sanitized = base.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
  return sanitized.length > 200 ? sanitized.slice(0, 200).trim() : sanitized
}

export type InvoiceItemCategory = 'container' | 'carga_solta' | 'documental'

export function classifyInvoiceItem(item: {
  description?: string | null
  calculation_key?: string | null
  snapshot_payload?: unknown
}): InvoiceItemCategory {
  const snapshot = (item.snapshot_payload ?? {}) as Record<string, unknown>

  // 1. Explicit metadata in snapshot_payload
  const directCategory = String(snapshot.category || snapshot.item_category || snapshot.cargo_mode || '').toLowerCase()
  if (directCategory === 'container' || directCategory === 'cntr') return 'container'
  if (directCategory === 'carga_solta' || directCategory === 'breakbulk' || directCategory === 'bb') return 'carga_solta'
  if (directCategory === 'documental' || directCategory === 'bl' || directCategory === 'administrative') return 'documental'

  const basis = String(snapshot.application_basis || '').toLowerCase()
  if (basis === 'bl' || basis === 'documental') return 'documental'
  if (['container', 'container_distinct_voyage', 'teu'].includes(basis)) return 'container'
  if (['weight_ton', 'ton', 'weight', 'cbm', 'breakbulk'].includes(basis)) return 'carga_solta'

  // 2. Calculation key patterns
  const calcKey = String(item.calculation_key || snapshot.calculation_key || '').toLowerCase()
  if (calcKey.includes('bl_fee') || calcKey.includes('documental') || calcKey.includes(':bl:')) return 'documental'
  if (calcKey.includes('breakbulk') || calcKey.includes(':bb:') || calcKey.includes('weight')) return 'carga_solta'
  if (calcKey.includes('container') || calcKey.includes(':cntr:') || calcKey.includes('thd')) return 'container'

  // 3. Description heuristics
  const desc = (item.description || '').toLowerCase()
  if (
    desc.includes('bl fee') ||
    desc.includes('b/l fee') ||
    desc.includes('expedição') ||
    desc.includes('expedicao') ||
    desc.includes('taxa de bl') ||
    desc.includes('taxa documental') ||
    desc.includes('taxas documentais') ||
    desc.includes('administrativa') ||
    desc.includes('correction letter') ||
    desc.includes('carta de corre') ||
    desc.includes('reissuing') ||
    desc.includes('reemiss') ||
    desc.includes('desconsolidação')
  ) {
    return 'documental'
  }

  if (
    desc.includes('carga solta') ||
    desc.includes('breakbulk') ||
    desc.includes('peso bruto') ||
    desc.includes('/ ton') ||
    desc.includes('tonelada')
  ) {
    return 'carga_solta'
  }

  if (
    desc.includes('thd') ||
    desc.includes('isps') ||
    desc.includes('drop off') ||
    desc.includes('damage protection') ||
    desc.includes('container') ||
    desc.includes('cntr') ||
    /\b(20|40)['’](hc|dc|ot|fr|rf|gp)\b/i.test(item.description || '')
  ) {
    return 'container'
  }

  return 'documental'
}
