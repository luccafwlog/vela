import { beforeEach, describe, expect, it, vi } from 'vitest'
import { annotateContainerDates, importContainerDates, parseContainerDatesFile } from '../containerDatesImport'
import { jsonToBuffer } from './testWorkbook'

type FakeContainer = {
  id: number
  bl_id: string
  container_number: string
  discharge_date: string | null
  return_date: string | null
  demurrage_status: string | null
}

const { mockFrom, mockRpc, mockGetUser, mockEnsureRates, state } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockGetUser: vi.fn(),
  mockEnsureRates: vi.fn(),
  state: { containers: [] as unknown[] },
}))

function setContainers(rows: FakeContainer[]) {
  state.containers = rows
}

// Cada `from(...)` do import devolve so o encadeamento que aquela tabela usa.
mockFrom.mockImplementation((table: string) => {
  if (table === 'bl_containers') {
    return {
      select: () => ({ in: () => Promise.resolve({ data: state.containers, error: null }) }),
      update: () => ({ eq: vi.fn() }),
    }
  }
  if (table === 'bls') {
    return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
  }
  return {
    select: () => ({ in: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
  }
})

vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc, auth: { getUser: mockGetUser } } }))
vi.mock('../demurrage/demurrageRates', () => ({
  ensureDemurrageRatesLoaded: mockEnsureRates,
  calculateDemurrage: () => ({ totalUsd: 0 }),
}))

describe('containerDatesImport', () => {
  it('aceita linha com devolucao opcional em branco', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '2026-01-10', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toEqual([{
      bl_id: 'BL001',
      container_number: 'TCLU1234567',
      discharge_date: '2026-01-10',
      return_date: null,
      row_number: 2,
    }])
  })

  it('preserva o formato brasileiro em CSV sem inverter dia e mes', async () => {
    const csv = [
      'BL,Container,Discharge,Return',
      'BL001,TCLU1234567,01/08/2026,',
    ].join('\n')
    const parsed = await parseContainerDatesFile(new File([csv], 'datas-container.csv', { type: 'text/csv' }))

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows[0]?.discharge_date).toBe('2026-08-01')
  })

  it('rejeita devolucao anterior a descarga', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'BL001',
        Container: 'TCLU1234567',
        Descarga: '2026-01-10',
        Devolucao: '2026-01-09',
      },
    ])
    const file = new File([buffer], 'datas-container.xlsx')

    const parsed = await parseContainerDatesFile(file)

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('Data de devolucao anterior a descarga')
  })

  it('rejeita linha sem descarga', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga invalida ou ausente')
  })

  it('rejeita datas de calendario impossiveis', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '31/02/2026', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga invalida ou ausente')
  })

  it('bloqueia duplicata conflitante do mesmo BL e container', async () => {
    const buffer = jsonToBuffer([
      { BL: 'BL001', Container: 'TCLU1234567', Descarga: '01/08/2026', Devolucao: '' },
      { BL: 'BL001', Container: 'TCLU1234567', Descarga: '02/08/2026', Devolucao: '' },
    ])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/duplicata conflitante/i) }),
    ])
  })
})

// Regressao do lote parcial: cada B/L agora e uma unidade atomica. Uma falha
// em qualquer container nao deixa linhas irmas gravadas nem dispara fatura.
describe('importContainerDates (lote parcial)', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockGetUser.mockResolvedValue({ data: { user: { id: '00000000-0000-0000-0000-000000000401' } }, error: null })
  })

  it('desfaz o B/L inteiro quando o RPC atomico falha', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: null, return_date: null, demurrage_status: null },
      { id: 2, bl_id: 'BL001', container_number: 'TCLU2222222', discharge_date: null, return_date: null, demurrage_status: null },
    ])
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'conflito de escrita' } })

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL001', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]?.container_number).toBe('TCLU1111111')
    expect(result.errors[0]?.message).toContain('conflito de escrita')
  })

  it('deixa a emissão de Demurrage para o efeito persistido da RPC', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20', demurrage_status: 'returned' },
    ])
    mockRpc.mockResolvedValue({ data: { updated_ids: [], unchanged_ids: [1], billing_state: 'ready_for_billing' }, error: null })

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(result.unchanged).toBe(1)
    expect(result.updated).toBe(0)
    expect(mockRpc).toHaveBeenCalledWith('apply_container_dates_atomic', expect.objectContaining({ p_bl_id: 'BL001' }))
  })

  it('nao atualiza parcialmente um B/L quando outro container do mesmo lote nao existe', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: null, return_date: null, demurrage_status: null },
    ])

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL001', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(mockRpc).not.toHaveBeenCalled()
    expect(result.updated).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.missing).toBe(1)
    expect(result.errors).toEqual([
      expect.objectContaining({
        bl_id: 'BL001',
        container_number: 'TCLU2222222',
        message: expect.stringContaining('B/L foi ignorado'),
      }),
    ])
  })

  // ADR 0078, item 19: a prévia mostra "antes → depois", devolução vazia mantém
  // a gravada e o mesmo container com datas diferentes na Viagem é recusado.
  it('prévia: devolução vazia mantém a gravada e datas diferentes no mesmo container da Viagem são recusadas', () => {
    const current = [
      { bl_id: 'BL001', container_number: 'TCLU1234567', voyage_id: 1, discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL002', container_number: 'TCLU7654321', voyage_id: 1, discharge_date: null, return_date: null },
      { bl_id: 'BL003', container_number: 'TCLU7654321', voyage_id: 1, discharge_date: null, return_date: null },
    ]
    const preview = annotateContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1234567', discharge_date: '2026-01-10', return_date: null, row_number: 2 },
      { bl_id: 'BL002', container_number: 'TCLU7654321', discharge_date: '2026-01-11', return_date: null, row_number: 3 },
      { bl_id: 'BL003', container_number: 'TCLU7654321', discharge_date: '2026-01-12', return_date: null, row_number: 4 },
    ], current)
    expect(preview.rows).toEqual([expect.objectContaining({
      bl_id: 'BL001', before_return: '2026-01-20', after_return: '2026-01-20', changed: false,
    })])
    expect(preview.conflicts.map((conflict) => [conflict.row_number, conflict.bl_id])).toEqual([[3, 'BL002'], [4, 'BL003']])
  })
})
