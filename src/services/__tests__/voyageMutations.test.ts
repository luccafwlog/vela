import { beforeEach, expect, it, vi } from 'vitest'

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

import { cancelVoyage, createVoyage, deleteVoyage, fetchVoyagesWithUnpaidBls, previewVoyageDeletion, updateVoyage } from '../voyages'
import { deleteVoyagePodSchedule } from '../voyageRouteSchedules'
import { userFacingErrorMessage } from '../../lib/errors'

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

  // 02-viagens-adr:5: o IMO acha o navio e o nome cadastrado fica; só o IMO legado é normalizado.
  expect(vesselsUpdate).toHaveBeenCalledWith({ imo: '9846495' })
  expect(vesselsUpdateEq).toHaveBeenCalledWith('id', 9)
})

it('editar a Viagem não manda navio, número nem status ao Histórico: vêm do gatilho de voyages (migration 408)', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') return { select: () => ({ limit: () => ({ eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }) }) }
    if (table === 'vessels') return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 9, imo: '9846495', carrier_id: 7 }], error: null }) }) }) }
    if (table === 'voyages') return { update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 44 }, error: null }) }) }) }) }
    if (table === 'audit_logs') {
      const rows = { data: [], error: null }
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
      return chain
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
  await updateVoyage(44, { carrierName: 'COSCO', carrierScac: 'CSSC', vesselName: 'COSCO TEST', vesselImo: '9846495', voyageNumber: '41', status: 'active', indicatedFirstBrazilianPort: 'BRSSZ' }, 'user-1')
  const fields = rpcMock.mock.calls
    .filter(([name]) => name === 'record_audit_entries')
    .flatMap(([, args]) => (args as { p_entries: Array<{ field_name: string }> }).p_entries.map((entry) => entry.field_name))
  expect(fields).toEqual(['indicated_first_brazilian_port'])
})

it('02-viagens-adr:4: "Faturamento encerrado" só com todo B/L ativo quitado ou isento; carga solta sem cálculo segura o selo', async () => {
  const calls: Array<[string, ...unknown[]]> = []
  const rows = [
    // Viagem 5: um B/L pago e um isento — encerrada.
    { voyage_id: 5, charge_status: 'calculated', financial_status: 'paid' },
    { voyage_id: 5, charge_status: 'exempt', financial_status: 'pending' },
    // Viagem 6: carga solta ainda sem cálculo (charge_status nulo) — não encerrada.
    { voyage_id: 6, charge_status: null, financial_status: 'pending' },
    // Viagem 7: só B/L cancelado (filtrado pelo banco) — sem B/L ativo, sem selo.
  ]
  const chain = {
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return chain },
    in: (...args: unknown[]) => { calls.push(['in', ...args]); return chain },
    is: (...args: unknown[]) => { calls.push(['is', ...args]); return chain },
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  fromMock.mockImplementation(() => chain)

  await expect(fetchVoyagesWithUnpaidBls([5, 6, 7])).resolves.toEqual(new Set([6, 7]))
  expect(calls).toContainEqual(['is', 'cancelled_at', null])
})

// Recusas de regra do cadastro do navio chegam à tela com o motivo.
it('navio com IMO conflitante: a recusa chega à tela com o motivo', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') return { select: () => ({ limit: () => ({ eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }) }) }
    if (table === 'vessels') {
      return {
        select: () => ({
          eq: (column: string) => ({
            limit: () => Promise.resolve(column === 'imo'
              ? { data: [], error: null }
              : { data: [{ id: 9, imo: '1111111', name: 'GREEN SANTOS', carrier_id: 7 }], error: null }),
          }),
          ilike: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        }),
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })

  const error = await createVoyage({
    carrierName: 'COSCO', carrierScac: 'COSU', vesselName: 'GREEN SANTOS', vesselImo: '2222222', voyageNumber: '40', status: 'active',
  }, 'user-1').catch((caught: unknown) => caught)

  expect((error as Error).message).toBe('Navio GREEN SANTOS com IMO conflitante (1111111 vs 2222222). Corrija antes de importar.')
  expect(userFacingErrorMessage(error, 'Falha ao cadastrar a viagem.')).toBe('Navio GREEN SANTOS com IMO conflitante (1111111 vs 2222222). Corrija antes de importar.')
})

it('IMO gravado fora do formato (nome do navio no campo IMO) é corrigido, não recusado', async () => {
  const vesselUpdates: unknown[] = []
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') return { select: () => ({ limit: () => ({ eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }) }) }
    if (table === 'vessels') {
      return {
        select: () => ({
          eq: (column: string) => ({
            limit: () => Promise.resolve(column === 'imo'
              ? { data: [], error: null }
              : { data: [{ id: 9, imo: 'GREEN SANTOS', name: 'GREEN SANTOS', carrier_id: 7 }], error: null }),
          }),
          ilike: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
        }),
        update: (values: unknown) => { vesselUpdates.push(values); return { eq: () => Promise.resolve({ error: null }) } },
      }
    }
    if (table === 'voyages') {
      return { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 50 }, error: null }) }) }) }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })

  await expect(createVoyage({
    carrierName: 'COSCO', carrierScac: 'COSU', vesselName: 'GREEN SANTOS', vesselImo: '2222222', voyageNumber: '40', status: 'active',
  }, null)).resolves.toEqual({ id: 50 })
  expect(vesselUpdates).toEqual([{ imo: '2222222' }])
})

it('dois navios com o mesmo nome sem IMO: a recusa chega à tela com o motivo', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'carriers') return { select: () => ({ limit: () => ({ eq: () => Promise.resolve({ data: [{ id: 7 }], error: null }) }) }) }
    if (table === 'vessels') {
      return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 9, imo: null, carrier_id: 7 }, { id: 10, imo: null, carrier_id: 7 }], error: null }) }) }) }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })

  const error = await createVoyage({
    carrierName: 'COSCO', carrierScac: 'COSU', vesselName: 'GREEN SANTOS', vesselImo: '', voyageNumber: '40', status: 'active',
  }, 'user-1').catch((caught: unknown) => caught)

  expect(userFacingErrorMessage(error, 'Falha ao cadastrar a viagem.')).toBe('Navio GREEN SANTOS ambíguo: mais de um cadastro sem IMO. Informe o IMO.')
})
