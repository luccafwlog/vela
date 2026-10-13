import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: {} }))

import { buildBillingGroups, demurrageBoxKey, indexBilledBoxes, type GroupBoxRow } from '../demurrageContainers'

describe('caixa cobrada por Viagem, Cliente e número (migration 214)', () => {
  it('normaliza o número como o banco e separa Viagem e Cliente', () => {
    expect(demurrageBoxKey(3, 7, ' mscu1234567 ')).toBe('3|7|MSCU1234567')
    expect(demurrageBoxKey(null, 7, 'MSCU1234567')).toBeNull()
    expect(demurrageBoxKey(3, 7, '')).toBeNull()
  })

  it('a caixa de B/L irmão é achada pela chave, mesmo com outro container_id, e lista todas as Invoices vivas', () => {
    const index = indexBilledBoxes([
      { container_id: 100, container_number: 'MSCU1234567', invoice: { id: 1, doc_number: 'DEM-1', status: 'paid', customer_id: 7, bl_id: 'BL-100', bl: { voyage_id: 3 } } },
      { container_id: 101, container_number: 'mscu1234567', invoice: { id: 2, doc_number: 'DEM-2', status: 'issued', customer_id: 7, bl_id: 'BL-100', bl: { voyage_id: 3 } } },
      { container_id: 102, container_number: 'MSCU1234567', invoice: { id: 3, doc_number: 'DEM-3', status: 'issued', customer_id: 8, bl_id: 'BL-200', bl: { voyage_id: 3 } } },
    ])
    expect(index.get('3|7|MSCU1234567')?.map((ref) => ref.doc_number)).toEqual(['DEM-1', 'DEM-2'])
    expect(index.get('3|8|MSCU1234567')?.map((ref) => ref.doc_number)).toEqual(['DEM-3'])
  })
})

describe('grupo de cobrança como demurrage_group_bl_ids (191) e a emissão (214)', () => {
  const bl = (voyage = 3, customer = 7, cancelled: string | null = null) => ({ voyage_id: voyage, customer_id: customer, cancelled_at: cancelled })
  const box = (blId: string, number: string, returned: boolean, extra: Partial<GroupBoxRow> = {}): GroupBoxRow => ({
    bl_id: blId, container_number: number, ownership: 'COC', return_date: returned ? '2026-07-01' : null, bl: bl(), ...extra,
  })

  it('liga B/Ls da mesma Viagem e Cliente pelo container compartilhado; âncora é o menor id', () => {
    const groups = buildBillingGroups([
      box('BL-B', 'SHAR1', true), box('BL-B', 'MSCU2', true),
      box('BL-A', 'shar1 ', true),
      box('BL-C', 'SHAR1', true, { bl: bl(3, 8) }),
      box('BL-D', 'SHAR1', true, { bl: bl(3, 7, '2026-01-01') }),
    ], new Map())
    expect(groups.get('BL-B')).toMatchObject({ anchorBlId: 'BL-A', blIds: ['BL-A', 'BL-B'], boxes: 2, uncovered: 2, stillOut: 0 })
    expect(groups.get('BL-C')?.blIds).toEqual(['BL-C'])
    expect(groups.has('BL-D')).toBe(false)
  })

  it('caixa fora segura o grupo (inclusive sem número); SOC não conta; cobertura pela chave', () => {
    const billed = indexBilledBoxes([{ container_id: 1, container_number: 'MSCU1', invoice: { id: 4, doc_number: 'DEM-4', status: 'issued', customer_id: 7, bl_id: 'BL-A', bl: { voyage_id: 3 } } }])
    const groups = buildBillingGroups([
      box('BL-A', 'MSCU1', true), box('BL-A', 'MSCU2', true),
      box('BL-A', '', false), box('BL-A', 'SOCU9', false, { ownership: 'SOC' }),
    ], billed)
    expect(groups.get('BL-A')).toMatchObject({ boxes: 2, uncovered: 1, stillOut: 1 })
    expect(groups.get('BL-A')?.invoices.map((ref) => ref.doc_number)).toEqual(['DEM-4'])
  })
})
