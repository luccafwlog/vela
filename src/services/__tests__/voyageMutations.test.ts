import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

import { cancelVoyage, createVoyage, deleteVoyage, previewVoyageDeletion } from '../voyages'
import { deleteVoyagePodSchedule } from '../voyageRouteSchedules'

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
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
  const insertFn = vi.fn(() => Promise.resolve({ error: null }))
  fromMock.mockImplementation(() => ({ insert: insertFn }))

  await deleteVoyagePodSchedule({ voyageId: 5, pod: 'brvit', changedBy: 'user-1' })

  expect(fromMock).toHaveBeenCalledWith('audit_logs')
  expect(insertFn).toHaveBeenCalledTimes(1)
  const [rows] = insertFn.mock.calls[0] as unknown as [Array<Record<string, unknown>>]
  expect(rows[0]).toMatchObject({
    entity_type: 'voyage_pod_schedule',
    field_name: 'deleted',
    old_value: 'false',
    new_value: 'true',
    changed_by: 'user-1',
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
