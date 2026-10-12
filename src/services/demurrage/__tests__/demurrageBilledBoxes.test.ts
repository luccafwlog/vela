import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase', () => ({ supabase: {} }))

import { demurrageBoxKey, indexBilledBoxes } from '../demurrageContainers'

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
