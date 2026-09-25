import { canonicalizeDocument } from '../lib/cnpj'
import { normalizeText } from '../lib/utils'
import { supabase } from './supabase'

export type CustomerMatchRecord = {
  id: number
  name: string
}

export type CustomerMaps = {
  customersByDocument: Map<string, CustomerMatchRecord>
  customersByName: Map<string, CustomerMatchRecord>
  customersByCanonicalName: Map<string, CustomerMatchRecord>
  canonicalList: { canonical: string; record: CustomerMatchRecord }[]
}

export type CustomerMatchResult = {
  customer: CustomerMatchRecord
  matchType: 'document' | 'name'
}

/**
 * Forma canônica para comparação de nomes de empresa:
 * - Remove acentos e coloca em minúsculas (via normalizeText)
 * - Remove sufixos legais no final ANTES do strip de pontuação (ex: "S/A", "LTDA.")
 * - Strip de caracteres não-alfanuméricos (hífens, pontos, barras, etc.)
 * - Colapsa espaços extras
 *
 * Permite casar "ALLOG GALERIA - TRANSPORTES LTDA." com "ALLOG GALERIA TRANSPORTES"
 * e "SINCERELY LOGISTIC" com "SINCERELY LOGISTIC LTDA".
 */
export function canonicalizeName(name: string): string {
  return normalizeText(name)
    .replace(/[\s,]+(?:ltda\.?|s\/?a\.?|eireli|epp|me|lda\.?|inc\.?|corp\.?)\s*$/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Similaridade de Levenshtein normalizada [0..1]. 1 = idêntico.
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = i
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1] ? dp[j - 1] : 1 + Math.min(prev, dp[j], dp[j - 1])
      dp[j - 1] = prev
      prev = val
    }
    dp[n] = prev
  }
  return 1 - dp[n] / Math.max(m, n)
}

export async function loadCustomerMaps() {
  const customersByDocument = new Map<string, CustomerMatchRecord>()
  const customersByName = new Map<string, CustomerMatchRecord>()
  const customersByCanonicalName = new Map<string, CustomerMatchRecord>()
  const canonicalList: { canonical: string; record: CustomerMatchRecord }[] = []

  let from = 0
  const pageSize = 1000

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('customers')
      .select('id, cnpj_cpf, name')
      // Cliente desativado nao e sugerido na reconciliacao (ADR 0073; migration 092).
      .is('deactivated_at' as never, null as never)
      .order('id', { ascending: true })
      .range(from, to)

    if (error) throw error

    const batch = data ?? []
    for (const customer of batch) {
      const record: CustomerMatchRecord = { id: customer.id, name: customer.name }

      const document = canonicalizeDocument(customer.cnpj_cpf)
      if (document) {
        customersByDocument.set(document, record)
      }

      const normalizedName = normalizeText(customer.name)
      if (normalizedName && !customersByName.has(normalizedName)) {
        customersByName.set(normalizedName, record)
      }

      const canonical = canonicalizeName(customer.name)
      if (canonical && !customersByCanonicalName.has(canonical)) {
        customersByCanonicalName.set(canonical, record)
        canonicalList.push({ canonical, record })
      }
    }

    if (batch.length < pageSize) break
    from += pageSize
  }

  return { customersByDocument, customersByName, customersByCanonicalName, canonicalList }
}

export function findMatchedCustomer(
  candidate: {
    cnpjCpf?: string | null
    consignee?: string | null
  },
  maps: CustomerMaps,
): CustomerMatchResult | null {
  const document = canonicalizeDocument(candidate.cnpjCpf ?? '')
  if (document) {
    const customerByDocument = maps.customersByDocument.get(document)
    if (customerByDocument) {
      return { customer: customerByDocument, matchType: 'document' }
    }
  }

  const consignee = candidate.consignee ?? ''

  const normalizedConsignee = normalizeText(consignee)
  if (normalizedConsignee) {
    const customerByName = maps.customersByName.get(normalizedConsignee)
    if (customerByName) {
      return { customer: customerByName, matchType: 'name' }
    }
  }

  // Nível 3: nome canônico (tolera pontuação diferente e sufixos legais ausentes/presentes)
  const canonicalConsignee = canonicalizeName(consignee)
  if (canonicalConsignee) {
    const customerByCanonical = maps.customersByCanonicalName.get(canonicalConsignee)
    if (customerByCanonical) {
      return { customer: customerByCanonical, matchType: 'name' }
    }
  }

  // Nível 4: fuzzy match por similaridade Levenshtein ≥ 0.90, exigindo que o
  // token distintivo (primeira palavra) coincida. Sem essa guarda, nomes que só
  // compartilham termos genéricos disparam falso-positivo — ex.: "QA COMERCIO
  // EXTERIOR" vs "AJ COMERCIO EXTERIOR" tem distância 2/20 = 0.90 e casaria o
  // cliente errado.
  if (canonicalConsignee && maps.canonicalList.length > 0) {
    const consigneeHead = canonicalConsignee.split(' ', 1)[0]
    let bestScore = 0
    let bestRecord: CustomerMatchRecord | null = null
    for (const entry of maps.canonicalList) {
      if (entry.canonical.split(' ', 1)[0] !== consigneeHead) continue
      const score = levenshteinSimilarity(canonicalConsignee, entry.canonical)
      if (score > bestScore) {
        bestScore = score
        bestRecord = entry.record
      }
    }
    if (bestScore >= 0.90 && bestRecord) {
      return { customer: bestRecord, matchType: 'name' }
    }
  }

  return null
}

// Status que encerram a fila de reconciliação de cliente (decisão tomada,
// automática por documento ou humana).
export type CustomerLink = {
  customerId: number | null
  suggestedCustomerId: number | null
  status: 'matched_document' | 'matched_name' | 'missing_customer'
  notes: string
}

export function resolveCustomerLink(match: CustomerMatchResult | null): CustomerLink {
  if (match?.matchType === 'document') {
    return {
      customerId: match.customer.id,
      suggestedCustomerId: null,
      status: 'matched_document',
      notes: 'Cliente reconciliado automaticamente por CNPJ.',
    }
  }

  if (match?.matchType === 'name') {
    return {
      customerId: null,
      suggestedCustomerId: match.customer.id,
      status: 'matched_name',
      notes: 'Cliente sugerido por nome; validar documento.',
    }
  }

  return {
    customerId: null,
    suggestedCustomerId: null,
    status: 'missing_customer',
    notes: 'Cliente nao encontrado na base cadastral.',
  }
}

export function isCustomerReconciliationResolved(status: string | null | undefined) {
  return status === 'matched_document' || status === 'reconciled'
}
