import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeBapliePhysicalUpdates,
  computeExistenceDivergences,
  isBaplieReconciliationD7,
  reconcileBaplieWithManifest,
  applyBapliePhysicalFlags,
} from '../baplieReconciliation'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

type QueryResult = { data: unknown; error: unknown; count?: number | null }

function createBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    range: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

const mutationCalls: { table: string; method: string; payload: unknown }[] = []

function createMutationBuilder(table: string, method: string, payload: unknown) {
  const builder = {
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
  }
  mutationCalls.push({ table, method, payload })
  return builder
}

function installReconcileMocks(input: { bls?: unknown[]; baplie?: unknown[]; containers?: unknown[] }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bls') return createBuilder({ data: input.bls ?? [], error: null })
    if (table === 'baplie_containers') return createBuilder({ data: input.baplie ?? [], error: null })
    if (table === 'bl_containers') {
      const builder = createBuilder({ data: input.containers ?? [], error: null })
      builder.update.mockImplementation(((payload: unknown) => createMutationBuilder(table, 'update', payload)) as never)
      return builder
    }
    if (table === 'audit_logs') {
      return {
        insert: vi.fn((payload: unknown) => {
          mutationCalls.push({ table, method: 'insert', payload })
          return Promise.resolve({ data: null, error: null })
        }),
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

type Staged = Parameters<typeof computeExistenceDivergences>[0]
type BlCs = Parameters<typeof computeExistenceDivergences>[1]

function staged(rows: Array<Record<string, unknown>>): Staged {
  return rows as unknown as Staged
}
function blcs(rows: Array<Record<string, unknown>>): BlCs {
  return rows as unknown as BlCs
}

describe('computeExistenceDivergences', () => {
  it('aponta container no Baplie (full) e em nenhum B/L', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01' }]),
      blcs([]),
    )
    expect(items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: 'BL1', slot: '01' },
    ])
  })

  it('aponta container em B/L e ausente do Baplie', () => {
    const items = computeExistenceDivergences(
      staged([]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }]),
    )
    expect(items).toEqual([
      { kind: 'missing_in_baplie', container_number: 'ABCD1234567', bl_container_id: 10, bl_id: 'BL1' },
    ])
  })

  it('não aponta nada quando o container existe nas duas fontes (normalizando)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD 1234567', status: 'full' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }]),
    )
    expect(items).toEqual([])
  })

  it('ignora containers vazios do Baplie (só full participam da existência)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'empty' }]),
      blcs([]),
    )
    expect(items).toEqual([])
  })

  it('não aponta divergência de atributo (IMO/OOG divergentes mas mesmo container)', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }]),
    )
    expect(items).toEqual([])
  })
})

describe('computeBapliePhysicalUpdates (Baplie soberano)', () => {
  it('sobrescreve OOG do B/L com o do Baplie', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true, is_imo: false }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false, is_imo: false }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, previous: { is_imo: false, imo_class: null, un_number: null, is_oog: false }, is_imo: false, imo_class: null, un_number: null, is_oog: true },
    ])
  })

  it('sobrescreve IMO/classe/ONU do B/L com os do Baplie', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '3', un_number: '1203' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, imo_class: null, un_number: null }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, previous: { is_imo: false, imo_class: null, un_number: null, is_oog: false }, is_imo: true, imo_class: '3', un_number: '1203', is_oog: false },
    ])
  })

  it('não gera update quando as flags já batem', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '9', un_number: '3166' }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: true, imo_class: '9', un_number: '3166', is_oog: false }]),
    )
    expect(updates).toEqual([])
  })

  it('zera classe/ONU quando o Baplie não é IMO', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: false, imo_class: null, un_number: null }]),
      blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: true, imo_class: '3', un_number: '1203' }]),
    )
    expect(updates).toEqual([
      { bl_container_id: 10, previous: { is_imo: true, imo_class: '3', un_number: '1203', is_oog: false }, is_imo: false, imo_class: null, un_number: null, is_oog: false },
    ])
  })

  it('não atualiza container Part Lot (mais de um B/L com o mesmo número)', () => {
    const updates = computeBapliePhysicalUpdates(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '3', un_number: '1203' }]),
      blcs([
        { id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false },
        { id: 11, bl_id: 'BL2', container_number: 'ABCD1234567', is_imo: false },
      ]),
    )
    expect(updates).toEqual([])
  })
})

describe('reconcileBaplieWithManifest', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: null, error: null })
    mutationCalls.length = 0
  })

  it('aplica a janela D-7 sobre a data da primeira ETA brasileira', () => {
    expect(isBaplieReconciliationD7('2026-09-07', '2026-08-31')).toBe(true)
    expect(isBaplieReconciliationD7('2026-09-08', '2026-08-31')).toBe(false)
    expect(isBaplieReconciliationD7(null, '2026-08-31')).toBe(false)
  })

  it('não gera divergência de atributo — mesmo container com IMO/OOG divergentes retorna vazio', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: null, is_oog: true }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }],
    })
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [], source: 'reconciled', pendingRoutes: [] })
  })

  it('gera divergência de existência quando o container do Baplie não está em nenhum B/L', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01', is_oog: false }],
      containers: [],
    })
    const result = await reconcileBaplieWithManifest(1)
    expect(result.items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: 'BL1', slot: '01' },
    ])
  })

  it('deduplica containers repetidos no staging antes de reconciliar', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [
        { container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: '01', is_oog: false },
        { container_number: 'ABCD 1234567', status: 'full', bl_ref: 'BL1', slot: '02', is_oog: false },
      ],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }],
    })
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [], source: 'reconciled', pendingRoutes: [] })
  })

  it('sinaliza source not_imported quando nao ha staging do Baplie para a viagem, distinto de reconciliado sem divergencias', async () => {
    installReconcileMocks({ bls: [{ id: 'BL1' }], baplie: [], containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_oog: false }] })
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [], source: 'not_imported', pendingRoutes: [] })
  })

  it('concilia a rota coberta e mantém a rota sem B/L fora da conciliação; D-7 força as duas', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1', pol: 'CNTAO', pod: 'BRSSZ' }],
      baplie: [
        { container_number: 'ABCD1234567', pol: 'CNTAO', pod: 'BRSSZ', status: 'full' },
        { container_number: 'XYZU9876543', pol: 'CNNBO', pod: 'BRSSZ', status: 'full' },
      ],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }],
    })

    // Gate por rota: CNTAO::BRSSZ tem B/L com containers e concilia (sem divergência);
    // CNNGB::BRSSZ ainda não tem B/L e fica pendente, sem virar divergência nem silenciar a viagem.
    await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({
      items: [],
      source: 'reconciled',
      pendingRoutes: ['CNNGB::BRSSZ'],
    })

    // Forçando D-7: reconcilia também a rota pendente e aponta a divergência de existência
    const result = await reconcileBaplieWithManifest(1, { isD7: true })
    expect(result.source).toBe('reconciled')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ kind: 'missing_in_manifest', container_number: 'XYZU9876543' })
  })

  it('resolve D-7 automaticamente pela RPC quando o chamador não informa isD7', async () => {
    mockRpc.mockResolvedValue({ data: '2000-01-01', error: null })
    installReconcileMocks({
      bls: [{ id: 'BL1', pol: 'CNTAO', pod: 'BRSSZ' }],
      baplie: [{ container_number: 'ABCD1234567', pol: 'CNTAO', pod: 'BRSSZ', status: 'full' }],
      containers: [],
    })

    const result = await reconcileBaplieWithManifest(1)

    expect(result.source).toBe('reconciled')
    expect(result.pendingRoutes).toEqual([])
    expect(result.items).toMatchObject([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567' },
    ])
    expect(mockRpc).toHaveBeenCalledWith('get_voyage_first_brazilian_eta', { p_voyage_id: 1 })
  })

  it('aplica flags Baplie pelo RPC atomico server-side', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '3', un_number: '1203', is_oog: true }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, imo_class: null, un_number: null, is_oog: false }],
    })
    mockRpc.mockImplementation(async (name: string) => name === 'apply_baplie_physical_flags_atomic'
      ? { data: { applied: 1, updated_ids: [10] }, error: null }
      : { data: null, error: null })

    await expect(applyBapliePhysicalFlags(1, 'u1')).resolves.toBe(1)
    expect(mockRpc).toHaveBeenCalledWith('apply_baplie_physical_flags_atomic', {
      p_voyage_id: 1,
      p_changes: null,
      p_changed_by: 'u1',
    })
  })

  it('ativa conciliação e acusa containers faltantes quando 4 portos de origem (ex.: Taicang) têm BL mas nem todos os containers foram importados', async () => {
    installReconcileMocks({
      bls: [
        { id: 'BL-NSA', pol: 'CNNSA', pod: 'BRVIX' },
        { id: 'BL-NGB', pol: 'CNNGB', pod: 'BRVIX' },
        { id: 'BL-SHA', pol: 'CNSHA', pod: 'BRVIX' },
        { id: 'BL-TAC', pol: 'CNTAC', pod: 'BRVIX' }, // Taicang
      ],
      baplie: [
        { container_number: 'CNSA1000001', pol: 'CNNSA', pod: 'BRVIX', status: 'full', bl_ref: null, slot: null },
        { container_number: 'CNGB1000001', pol: 'CNNGB', pod: 'BRVIX', status: 'full', bl_ref: null, slot: null },
        { container_number: 'CSHA1000001', pol: 'CNSHA', pod: 'BRVIX', status: 'full', bl_ref: null, slot: null },
        { container_number: 'CTAC1000001', pol: 'CNTAI', pod: 'BRVIX', status: 'full', bl_ref: null, slot: null }, // No Baplie veio CNTAI
        { container_number: 'CTAC1000002', pol: 'CNTAI', pod: 'BRVIX', status: 'full', bl_ref: null, slot: null }, // Container que ficou de fora do BL
        { container_number: 'EMPU1000001', pol: 'CNTAI', pod: 'BRVIX', status: 'empty', bl_ref: null, slot: null }, // Container vazio no Baplie
      ],
      containers: [
        { id: 1, bl_id: 'BL-NSA', container_number: 'CNSA1000001' },
        { id: 2, bl_id: 'BL-NGB', container_number: 'CNGB1000001' },
        { id: 3, bl_id: 'BL-SHA', container_number: 'CSHA1000001' },
        { id: 4, bl_id: 'BL-TAC', container_number: 'CTAC1000001' },
      ],
    })

    const result = await reconcileBaplieWithManifest(1)
    expect(result.source).toBe('reconciled')
    expect(result.items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'CTAC1000002', baplie_bl_ref: null, slot: null },
    ])
  })
})
