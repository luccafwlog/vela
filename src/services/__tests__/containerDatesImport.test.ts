import { readFileSync } from 'node:fs'
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
  // A5 do lote 6a: o modelo para baixar passa pelo parser real, limpo.
  for (const extension of ['xlsx', 'csv'] as const) {
    it(`modelo .${extension} de public/templates é lido sem erro`, async () => {
      const raw = readFileSync(`public/templates/datas-container-modelo.${extension}`)
      const parsed = await parseContainerDatesFile(new File([raw], `datas-container-modelo.${extension}`))
      expect(parsed.rowErrors).toEqual([])
      expect(parsed.rows.map((row) => [row.bl_id, row.container_number, row.discharge_date, row.return_date])).toEqual([
        ['CSC456202060W00', 'MSCU1234565', '2026-01-10', '2026-01-20'],
        ['CSC456202060W00', 'MSCU7654323', '2026-01-10', null],
      ])
    })
  }

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
    expect(parsed.rowErrors[0]?.message).toContain('Data de devolução anterior à descarga')
  })

  it('rejeita linha sem descarga', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga inválida ou ausente')
  })

  it('rejeita datas de calendario impossiveis', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '31/02/2026', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga inválida ou ausente')
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

// Regra de 2026-10-19 (migration 333): a planilha inteira vai numa chamada; se
// o banco recusa qualquer B/L, nada é gravado e a resposta lista a recusa.
describe('importContainerDates (arquivo inteiro numa chamada)', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockGetUser.mockResolvedValue({ data: { user: { id: '00000000-0000-0000-0000-000000000401' } }, error: null })
  })

  it('manda todos os B/Ls numa chamada só', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: null, return_date: null, demurrage_status: null },
      { id: 2, bl_id: 'BL002', container_number: 'TCLU2222222', discharge_date: null, return_date: null, demurrage_status: null },
    ])
    mockRpc.mockResolvedValue({ data: { ok: true, updated: 2, unchanged: 0, bls: 2 }, error: null })

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL002', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: null },
    ])

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('apply_container_dates_batch_atomic', expect.objectContaining({
      p_batches: [
        expect.objectContaining({ bl_id: 'BL001' }),
        expect.objectContaining({ bl_id: 'BL002' }),
      ],
    }))
    expect(result).toEqual({ ok: true, updated: 2, unchanged: 0, errors: [] })
  })

  it('recusa do banco em um B/L: nada gravado, recusa listada sem o código e CHECK crua como texto fixo', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20', demurrage_status: 'returned' },
      { id: 2, bl_id: 'BL002', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: '2026-01-20', demurrage_status: 'returned' },
    ])
    const recusa = 'A descarga informada (25/01/2026) do container TCLU1111111 é posterior à devolução gravada (20/01/2026).'
    mockRpc.mockResolvedValue({
      data: {
        ok: false,
        errors: [
          { bl_id: 'BL001', code: '22023', message: recusa },
          { bl_id: 'BL002', code: '23514', message: 'new row for relation "bl_containers" violates check constraint "bl_containers_return_after_discharge_chk"' },
        ],
      },
      error: null,
    })

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-25', return_date: null },
      { bl_id: 'BL002', container_number: 'TCLU2222222', discharge_date: '2026-01-25', return_date: null },
    ])

    expect(result.ok).toBe(false)
    expect(result.updated).toBe(0)
    expect(result.errors.map((error) => error.message)).toEqual([recusa, 'Dados fora das regras do cadastro.'])
  })

  // Revisão automática da PR 929: o estado esperado é o "antes" que a prévia
  // mostrou, não uma releitura na hora de gravar (que esconderia a mudança de
  // outra sessão depois da prévia).
  it('manda como estado esperado as datas que a prévia mostrou', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-12', return_date: '2026-01-25', demurrage_status: 'returned' },
    ])
    mockRpc.mockResolvedValue({ data: { ok: true, updated: 1, unchanged: 0 }, error: null })

    await importContainerDates([{
      bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20',
      found: true, before_discharge: null, before_return: null,
    }])

    expect(mockRpc).toHaveBeenCalledWith('apply_container_dates_batch_atomic', expect.objectContaining({
      p_batches: [expect.objectContaining({
        rows: [expect.objectContaining({ expected_discharge_date: null, expected_return_date: null })],
      })],
    }))
  })

  it('container fora do B/L recusa o arquivo inteiro sem chamar o banco', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: null, return_date: null, demurrage_status: null },
      { id: 2, bl_id: 'BL002', container_number: 'TCLU3333333', discharge_date: null, return_date: null, demurrage_status: null },
    ])

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL002', container_number: 'TCLU3333333', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL001', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(mockRpc).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      updated: 0,
      unchanged: 0,
      errors: [expect.objectContaining({ bl_id: 'BL001', container_number: 'TCLU2222222', message: 'Container não encontrado neste B/L.' })],
    })
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
