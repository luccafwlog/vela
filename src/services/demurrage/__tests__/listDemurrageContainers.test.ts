import { describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, calls: [] as string[] }))

// Builder mínimo: aplica `.in`/`.eq` simples e `.range` sobre as linhas da tabela.
vi.mock('../../supabase', () => {
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let range: [number, number] | null = null
    const api: Record<string, unknown> = {
      select: () => api,
      not: () => api,
      order: () => api,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return api },
      in: (column: string, values: unknown[]) => {
        if (!column.includes('.')) filters.push((row) => values.includes(row[column]))
        return api
      },
      range: (from: number, to: number) => { range = [from, to]; return api },
      then: (resolve: (value: unknown) => unknown) => {
        db.calls.push(`${table}:${range?.join('-')}`)
        const rows = (db.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        return resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null })
      },
    }
    return api
  }
  return { supabase: { from: (table: string) => builder(table) } }
})
vi.mock('../demurrageRates', () => ({ ensureDemurrageRatesLoaded: vi.fn(async () => undefined) }))

import { listDemurrageContainers } from '../demurrageContainers'

const bl = (id: string) => ({ id, voyage_id: 3, customer: { id: 7, name: 'ACME', cnpj_cpf: null } })
const groupBl = { voyage_id: 3, customer_id: 7, cancelled_at: null }

describe('listDemurrageContainers', () => {
  it('lê além das 1000 linhas e diz em qual Invoice cada caixa foi cobrada', async () => {
    db.calls = []
    db.tables.demurrage_invoice_items = Array.from({ length: 1200 }, (_, index) => ({
      id: index + 1,
      container_id: 10_000 + index,
      container_number: `MSCU${index}`,
      invoice: { id: 1, doc_number: 'DEM-1', status: 'paid', customer_id: 7, bl_id: 'BL-OLD', bl: { voyage_id: 3 } },
    }))
    db.tables.customer_demurrage_agreements = []
    db.tables.bl_containers = [
      // A 1150ª caixa cobrada: com o corte de 1000 linhas, sumiria a cobrança.
      { id: 1, bl_id: 'BL-1', container_number: 'MSCU1150', demurrage_status: 'returned', return_date: '2026-07-01', ownership: 'COC', bl: bl('BL-1') },
    ]
    const rows = await listDemurrageContainers()
    expect(rows.find((row) => row.id === 1)?.billed_in?.map((ref) => ref.doc_number)).toEqual(['DEM-1'])
    expect(db.calls).toContain('demurrage_invoice_items:1000-1999')
  })

  it('monta o grupo do B/L pendente com a caixa ainda fora que a lista não traz', async () => {
    db.tables.demurrage_invoice_items = []
    db.tables.customer_demurrage_agreements = []
    db.tables.bl_containers = [
      { id: 1, bl_id: 'BL-1', container_number: 'MSCU1', demurrage_status: 'returned', return_date: '2026-07-01', ownership: 'COC', bl: { ...bl('BL-1'), ...groupBl } },
      // Ainda fora, no free time: não entra na lista, mas segura a emissão.
      { id: 2, bl_id: 'BL-1', container_number: 'MSCU2', demurrage_status: 'within_free_time', return_date: null, ownership: 'COC', bl: { ...bl('BL-1'), ...groupBl } },
    ]
    const rows = await listDemurrageContainers()
    expect(rows.map((row) => row.id)).toEqual([1])
    expect(rows[0].billing_group).toMatchObject({ anchorBlId: 'BL-1', boxes: 2, stillOut: 1, uncovered: 2 })
  })
})
