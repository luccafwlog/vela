import { useQuery } from '@tanstack/react-query'
import { supabase } from '../services/supabase'
import type { BL, BLContainer, Customer, Voyage, Vessel, Carrier } from '../types/database'

// Cliente da fila + contatos visiveis ao operador. O estado do portal nao e
// lido por join porque customer_portal_accounts tem RLS administrativa; as
// pendencias canonicas ja chegam na linha gerenciada de `notes`.
export type ReviewCustomer = Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> & {
  customer_contacts?: { email: string | null }[] | null
}

export type ReviewQueueItem = (BL & {
  consignee_block?: string | null
  cargo_description?: string | null
  manifest_customer_email?: string | null
  customer?: ReviewCustomer | null
  /** B16: Cliente sugerido por nome na importação (`bls.suggested_customer_id`). */
  suggested_customer?: ReviewCustomer | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
    vessel?: (Pick<Vessel, 'id' | 'name'> & {
      carrier?: Pick<Carrier, 'id' | 'name'> | null
    }) | null
  }) | null
  bl_containers?: Pick<BLContainer, 'id' | 'container_number' | 'is_imo' | 'is_oog'>[] | null
  review_reasons?: string[]
  source: 'bl'
})

const REVIEW_PAGE_SIZE = 500

export async function fetchAllReviewPages<T>(loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = []
  for (let from = 0; ; from += REVIEW_PAGE_SIZE) {
    const result = await loadPage(from, from + REVIEW_PAGE_SIZE - 1)
    if (result.error) throw result.error
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < REVIEW_PAGE_SIZE) return rows
  }
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      // O Granito saiu da Revisão no lote 5b (2026-10-19): não tem Cliente.
      const blData = await fetchAllReviewPages((from, to) => supabase
        .from('bls')
        .select(
          `*,
          customer:customers!bls_customer_id_fkey(id, cnpj_cpf, name, customer_contacts(email)),
          suggested_customer:customers!bls_suggested_customer_id_fkey(id, cnpj_cpf, name),
          voyage:voyages(id, voyage_number, vessel:vessels(id, name, carrier:carriers(id, name))),
          bl_containers(id, container_number, is_imo, is_oog)`,
        )
        .eq('review_status', 'pending_review')
        .order('created_at', { ascending: false })
        .range(from, to))

      const blItems = (blData as unknown as (Omit<ReviewQueueItem & { source: 'bl' }, 'source'>)[]).map((row) => ({
        ...row,
        consignee_block: row.consignee_block ?? null,
        cargo_description: row.cargo_description ?? null,
        manifest_customer_email: row.manifest_customer_email ?? null,
        review_reasons: extractReviewReasons((row as { notes?: string | null }).notes),
        source: 'bl' as const,
      }))

      return blItems as ReviewQueueItem[]
    },
  })
}

export function extractReviewReasons(notes?: string | null) {
  if (!notes) return []
  const match = notes.match(/(?:^|\n)Pendencias de importacao:\s*([^\n]*)/i)
  if (!match?.[1]) return []

  return match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
