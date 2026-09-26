// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

// Fake PostgREST: caps each response at 1000 rows and, without .order(),
// returns rows in a different arbitrary order on every request.
const tables: Record<string, Row[]> = {}
let requestCount = 0
const urls: string[] = []

function query(table: string) {
  let filter: { column: string; values: unknown[] } | null = null
  let ordered = false
  let range: [number, number] = [0, 999]
  const builder = {
    select: () => builder,
    in: (column: string, values: unknown[]) => { filter = { column, values }; return builder },
    order: () => { ordered = true; return builder },
    range: (from: number, to: number) => { range = [from, to]; return builder },
    then: (resolve: (value: { data: Row[]; error: null }) => void) => {
      requestCount += 1
      // Embedded filter `manifest.voyage_id` resolves through the manifest row.
      const valueOf = (row: Row, column: string) => column === 'manifest.voyage_id'
        ? tables.vazios_importacao_manifests?.find((m) => m.id === row.manifest_id)?.voyage_id
        : row[column]
      let rows = (tables[table] ?? []).filter((row) => !filter || filter.values.includes(valueOf(row, filter.column)))
      if (table === 'vazios_importacao_containers') urls.push(filter?.column ?? '')
      if (ordered) rows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      else rows = [...rows].sort((a, b) => ((Number(String(a.id).slice(1)) * (requestCount + 7)) % 997) - ((Number(String(b.id).slice(1)) * (requestCount + 7)) % 997))
      const [from, to] = range
      resolve({ data: rows.slice(from, Math.min(to, from + 999) + 1), error: null })
    },
  }
  return builder
}

vi.mock('../../services/supabase', () => ({ supabase: { from: (table: string) => query(table) } }))

const { useVaziosImportacaoStats } = await import('../useVaziosImportacaoStats')

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client }, children)
}

const pad = (n: number) => String(n).padStart(5, '0')

describe('useVaziosImportacaoStats', () => {
  it('counts every manifest and container past the 1000-row page limit', async () => {
    // Voyage 1: 1200 manifests; voyage 2: 300 manifests (first page alone would cut it off).
    tables.vazios_importacao_manifests = Array.from({ length: 1500 }, (_, i) => ({
      id: `m${pad(i)}`,
      voyage_id: i < 1200 ? 1 : 2,
    }))
    // One distinct 20DC container per manifest, all bound to POD BRSSZ.
    tables.vazios_importacao_containers = Array.from({ length: 1500 }, (_, i) => ({
      id: `c${pad(i)}`,
      manifest_id: `m${pad(i)}`,
      container_number: `CONT${pad(i)}`,
      container_type: '20DC',
      pol: 'CNSHA',
      pod: 'BRSSZ',
    }))

    const { result } = renderHook(() => useVaziosImportacaoStats([1, 2]), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const stats = result.current.data!.byVoyageId

    expect(stats[1].totalManifests).toBe(1200)
    expect(stats[2].totalManifests).toBe(300)
    expect(stats[1].distinctContainers).toBe(1200)
    expect(stats[2].distinctContainers).toBe(300)
    // Type counts are per row, so duplicated/skipped rows across pages would show here.
    expect(stats[1].containerTypes).toBe('20DC (1200)')
    expect(stats[2].containerTypes).toBe('20DC (300)')
    // Containers are filtered by voyage, so the request never carries 1500 manifest ids.
    expect(urls.every((column) => column === 'manifest.voyage_id')).toBe(true)
  })
})
