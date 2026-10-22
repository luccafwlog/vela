import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

import { cancelVoyage, createVoyage, deleteVoyage, previewVoyageDeletion } from '../voyages'
import { deleteVoyagePodSchedule } from '../voyageRouteSchedules'

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  // O Histórico grava pela RPC `record_audit_entries` (migration 404).
  rpcMock.mockResolvedValue({ data: 1, error: null })
})

it('cancela a viagem e audita o motivo', async () => {
  rpcMock.mockResolvedValueOnce({ data: { changed: true }, error: null })

  await cancelVoyage({ voyageId: 7, reason: 'Escala retirada pelo armador', changedBy: 'user-1' })

  expect(rpcMock).toHaveBeenCalledWith('cancel_voyage', {
    p_voyage_id: 7,
    p_reason: 'Escala retirada pelo armador',
    p_changed_by: 'user-1',
  })
})

it('US-215: exclui a viagem pelo banco, com o motivo', async () => {
  rpcMock.mockResolvedValueOnce({ data: { deleted: ['1'], blocked: [] }, error: null })

  await expect(deleteVoyage(1, 'cadastro duplicado')).resolves.toEqual({ deletableIds: [1], blockedIds: [] })
  expect(rpcMock).toHaveBeenCalledWith('delete_records', {
    p_kind: 'voyage', p_ids: ['1'], p_dry_run: false, p_reason: 'cadastro duplicado',
  })
})

it('US-215: a prévia devolve a trava e o que vai junto', async () => {
  rpcMock.mockImplementation((name: string) => Promise.resolve(name === 'delete_records'
    ? { data: { deleted: [], blocked: [{ id: '1', reasons: ['B/L com CE Mercante'] }] }, error: null }
    : { data: { items: [{ table: 'bls', action: 'delete', label: 'B/L(s), com containers e taxas', count: 3 }] }, error: null }))

  const preview = await previewVoyageDeletion(1)
  expect(preview.report.blockedIds).toEqual([{ id: 1, reasons: ['B/L com CE Mercante'] }])
  expect(preview.items).toEqual([{ table: 'bls', action: 'delete', label: 'B/L(s), com containers e taxas', count: 3 }])
  expect(rpcMock).toHaveBeenCalledWith('delete_records', expect.objectContaining({ p_kind: 'voyage', p_dry_run: true }))
})

it('US-218: exclusao de POD grava evento insert-only deleted=true', async () => {
  await deleteVoyagePodSchedule({ voyageId: 5, pod: 'brvit', changedBy: 'user-1' })

  expect(fromMock).not.toHaveBeenCalledWith('audit_logs')
  expect(rpcMock).toHaveBeenCalledTimes(1)
  const [name, args] = rpcMock.mock.calls[0] as unknown as [string, { p_entries: Array<Record<string, unknown>> }]
  expect(name).toBe('record_audit_entries')
  const rows = args.p_entries
  expect(rows[0]).toMatchObject({
    entity_type: 'voyage_pod_schedule',
    field_name: 'deleted',
    old_value: 'false',
    new_value: 'true',
  })
  expect(String(rows[0].entity_id)).toMatch(/^5::/)
})

it('salva IMO quando a viagem usa um navio ja existente sem IMO', async () => {
  const vesselsUpdateEq = vi.fn(() => Promise.resolve({ error: null }))
  const vesselsUpdate = vi.fn(() => ({ eq: vesselsUpdateEq }))
  const voyagesInsertSingle = vi.fn(() => Promise.resolve({ data: { id: 42 }, error: null }))
  const auditInsert = vi.fn(() => Promise.resolve({ error: null }))

  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') {
      return {
        select: () => ({
          limit: () => ({
            eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }),
          }),
        }),
      }
    }

    if (table === 'vessels') {
      return {
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: [{ id: 9, imo: null }], error: null }),
          }),
        }),
        update: vesselsUpdate,
      }
    }

    if (table === 'voyages') {
      return {
        insert: () => ({
          select: () => ({
            single: voyagesInsertSingle,
          }),
        }),
      }
    }

    if (table === 'audit_logs') return { insert: auditInsert }

    throw new Error(`Tabela nao mockada: ${table}`)
  })

  await createVoyage(
    {
      carrierName: 'COSCO',
      carrierScac: 'COSU',
      vesselName: 'COSCO TEST',
      vesselImo: '9846495',
      voyageNumber: '39',
      status: 'active',
    },
    'user-1',
  )

  expect(vesselsUpdate).toHaveBeenCalledWith({ imo: '9846495', carrier_id: 7 })
  expect(vesselsUpdateEq).toHaveBeenCalledWith('id', 9)
})

it('reaproveita IMO legado rotulado em vez de criar ou rejeitar o mesmo navio', async () => {
  const vesselsUpdateEq = vi.fn(() => Promise.resolve({ error: null }))
  const vesselsUpdate = vi.fn(() => ({ eq: vesselsUpdateEq }))
  const voyagesInsertSingle = vi.fn(() => Promise.resolve({ data: { id: 43 }, error: null }))
  const auditInsert = vi.fn(() => Promise.resolve({ error: null }))
  const legacyVessel = { id: 9, imo: 'IMO: 9846495', name: 'REGISTERED NAME', carrier_id: 7 }

  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') {
      return {
        select: () => ({
          limit: () => ({
            eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }),
          }),
        }),
      }
    }

    if (table === 'vessels') {
      return {
        select: () => ({
          eq: (field: string) => ({
            limit: () => Promise.resolve({
              data: field === 'imo' ? [] : [legacyVessel],
              error: null,
            }),
          }),
          ilike: () => ({ limit: () => Promise.resolve({ data: [legacyVessel], error: null }) }),
        }),
        update: vesselsUpdate,
      }
    }

    if (table === 'voyages') {
      return {
        insert: () => ({
          select: () => ({
            single: voyagesInsertSingle,
          }),
        }),
      }
    }

    if (table === 'audit_logs') return { insert: auditInsert }

    throw new Error(`Tabela nao mockada: ${table}`)
  })

  await expect(createVoyage({
    carrierName: 'COSCO',
    carrierScac: 'COSU',
    vesselName: 'PLANILHA NAME',
    vesselImo: 'IMO: 9846495',
    voyageNumber: '40',
    status: 'active',
  }, 'user-1')).resolves.toEqual({ id: 43 })

  expect(vesselsUpdate).toHaveBeenCalledWith({ name: 'PLANILHA NAME', imo: '9846495' })
  expect(vesselsUpdateEq).toHaveBeenCalledWith('id', 9)
})

// ADR 0095, decisão 14 (migration 410): os códigos digitados na Viagem vão ao armador.
it('grava os códigos do Baplie no armador da viagem quando o operador os informa', async () => {
  const carrierUpdateEq = vi.fn(() => Promise.resolve({ error: null }))
  const carrierUpdate = vi.fn(() => ({ eq: carrierUpdateEq }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') {
      return {
        select: () => ({ limit: () => ({ eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }) }),
        update: carrierUpdate,
      }
    }
    if (table === 'vessels') {
      return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 9, imo: '9846495', carrier_id: 7 }], error: null }) }) }) }
    }
    if (table === 'voyages') return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 44 }, error: null }) }) }) }
    if (table === 'audit_logs') return { insert: () => Promise.resolve({ error: null }) }
    throw new Error(`Tabela nao mockada: ${table}`)
  })

  const form = { carrierName: 'COSCO', carrierScac: 'CSSC', vesselName: 'COSCO TEST', vesselImo: '9846495', voyageNumber: '40', status: 'active' as const }
  await createVoyage({ ...form, carrierBaplieCodes: 'cos, COSCO' }, 'user-1')
  expect(carrierUpdate).toHaveBeenCalledWith({ baplie_codes: ['COS', 'COSCO'] })
  expect(carrierUpdateEq).toHaveBeenCalledWith('id', 7)

  carrierUpdate.mockClear()
  await createVoyage(form, 'user-1')
  expect(carrierUpdate).not.toHaveBeenCalled()
})

it('Viagem que falha ao salvar não altera os códigos do Baplie do armador', async () => {
  const carrierUpdate = vi.fn()
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit', 'order']) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return q
  }
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') {
      const q = chain({ data: [{ id: 3, baplie_codes: ['COS'] }], error: null })
      q.update = (...args: unknown[]) => { carrierUpdate(...args); return chain({ error: null }) }
      return q
    }
    if (table === 'vessels') return chain({ data: [{ id: 9, imo: '9000001', name: 'GREEN SANTOS', carrier_id: 3 }], error: null })
    if (table === 'voyages') {
      return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('falhou') }) }) }) }
    }
    throw new Error(`tabela inesperada ${table}`)
  })
  rpcMock.mockResolvedValue({ data: [{ id: 9, imo: '9000001', name: 'GREEN SANTOS', carrier_id: 3 }], error: null })

  await expect(createVoyage({
    carrierName: 'COSCO', carrierScac: 'COSU', carrierBaplieCodes: 'COS, COSCO',
    vesselName: 'GREEN SANTOS', vesselImo: '9000001', voyageNumber: '12N', status: 'scheduled',
  } as never, 'user-1')).rejects.toThrow('falhou')
  expect(carrierUpdate).not.toHaveBeenCalled()
})
