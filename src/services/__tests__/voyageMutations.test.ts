import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

import { cancelVoyage, createVoyage, deleteVoyage } from '../voyages'
import { deleteVoyagePodSchedule } from '../voyageRouteSchedules'

function countResult(count: number) {
  const value: Record<string, unknown> = {
    select: () => value,
    eq: () => value,
    range: () => value,
    then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ count, error: null }).then(resolve, reject),
  }
  return value
}

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

it('US-215: exclui a viagem quando nao ha dependencias', async () => {
  const deleteEq = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: 1 }], error: null }) }))
  const deleteFn = vi.fn(() => ({ eq: deleteEq }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return { delete: deleteFn }
    return countResult(0)
  })

  await expect(deleteVoyage(1)).resolves.toBeUndefined()
  expect(deleteFn).toHaveBeenCalledTimes(1)
  expect(deleteEq).toHaveBeenCalledWith('id', 1)
})

it('US-215: bloqueia a exclusao quando ha B/Ls vinculados', async () => {
  const deleteFn = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'voyages') return { delete: deleteFn }
    if (table === 'bls') return countResult(2)
    return countResult(0)
  })

  await expect(deleteVoyage(1)).rejects.toThrow(/Nao e possivel excluir esta viagem/)
  expect(deleteFn).not.toHaveBeenCalled()
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
