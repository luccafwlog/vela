import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeBapliePhysicalUpdates,
  computeExistenceDivergences,
  computeOwnershipDivergences,
  ownershipResolutionKey,
  computePendingBapliePhysicalFlags,
  computeProfileDivergences,
  countPendingBapliePhysicalFlags,
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
    order: vi.fn(() => builder),
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

const builders: Record<string, ReturnType<typeof createBuilder>> = {}

function installReconcileMocks(input: { bls?: unknown[]; baplie?: unknown[]; containers?: unknown[]; resolutions?: unknown[] }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bls') return createBuilder({ data: input.bls ?? [], error: null })
    if (table === 'baplie_containers') return (builders[table] = createBuilder({ data: input.baplie ?? [], error: null }))
    if (table === 'baplie_reconciliation_resolutions') {
      // Como o PostgREST: no máximo 1.000 linhas por resposta, a página que
      // `range` pedir (sem `range`, a primeira).
      const all = input.resolutions ?? []
      let window = { from: 0, to: 999 }
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        order: vi.fn(() => builder),
        range: vi.fn((from: number, to: number) => { window = { from, to: Math.min(to, from + 999) }; return builder }),
        then: (resolve: (value: QueryResult) => unknown) =>
          Promise.resolve({ data: all.slice(window.from, window.to + 1), error: null }).then(resolve),
      }
      return builder
    }
    if (table === 'bl_containers') {
      const builder = createBuilder({ data: input.containers ?? [], error: null })
      builders[table] = builder
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

  // E9-15: B/L cancelado fica de fora da conciliação (ADR 0078, item 21).
  it('ignora container de B/L cancelado nas duas direções', () => {
    const items = computeExistenceDivergences(
      staged([{ container_number: 'ABCD1234567', status: 'full', bl_ref: null, slot: '01' }]),
      blcs([
        // Único B/L do container do Baplie está cancelado: continua "sem B/L".
        { id: 10, bl_id: 'BL-CANC', container_number: 'ABCD1234567', cancelled: true },
        // Container só em B/L cancelado: não aparece "em B/L, fora do Baplie".
        { id: 11, bl_id: 'BL-CANC', container_number: 'WXYZ7654321', cancelled: true },
      ]),
    )
    expect(items).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: null, slot: '01' },
    ])
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

describe('computePendingBapliePhysicalFlags (mesma regra da função do banco)', () => {
  const bl = (over: Record<string, unknown>) => ({ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, imo_class: null, un_number: null, is_oog: false, ownership: null, ownership_source: null, ...over })

  it('é zero quando o B/L já tem o que o Baplie diz, e conta o que falta aplicar', () => {
    const baplie = staged([{ container_number: 'abcd1234567 ', status: 'full', is_imo: true, imo_class: '3', un_number: '1203', is_oog: false }])
    expect(computePendingBapliePhysicalFlags(baplie, blcs([bl({ is_imo: true, imo_class: '3', un_number: '1203' })]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(baplie, blcs([bl({})]))).toBe(1)
  })

  it('como no banco: ignora status ausente ou vazio e número inválido; conta cada B/L ativo do container', () => {
    expect(computePendingBapliePhysicalFlags(staged([{ container_number: 'ABCD1234567', status: null, is_oog: true }]), blcs([bl({})]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(staged([{ container_number: 'ABCD1234567', status: 'empty', is_oog: true }]), blcs([bl({})]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(staged([{ container_number: 'ABC123', status: 'full', is_oog: true }]), blcs([bl({ container_number: 'ABC123' })]))).toBe(0)
    // Migration 182: o container em dois B/Ls recebe a marca nos dois; o cancelado fica de fora.
    expect(computePendingBapliePhysicalFlags(
      staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true }]),
      blcs([bl({}), bl({ id: 11, bl_id: 'BL2' }), bl({ id: 12, bl_id: 'BL3', cancelled: true })]),
    )).toBe(2)
  })

  it('perfil manual não conta como pendente; marca do Baplie anterior fora do arquivo conta', () => {
    const oog = staged([{ container_number: 'ABCD1234567', status: 'full', is_oog: true }])
    expect(computePendingBapliePhysicalFlags(oog, blcs([bl({ profile_source: 'manual' })]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(staged([]), blcs([bl({ is_imo: true, profile_source: 'baplie' })]))).toBe(1)
    expect(computePendingBapliePhysicalFlags(staged([]), blcs([bl({ is_imo: true, profile_source: null })]))).toBe(0)
  })

  it('agrega linhas repetidas por OU e maior classe, e zera classe/ONU sem IMO', () => {
    const rows = staged([
      { container_number: 'ABCD1234567', status: 'full', is_imo: true, imo_class: '2.1', un_number: null },
      { container_number: 'ABCD1234567', status: 'full', is_imo: false, imo_class: '3', un_number: '1203', is_oog: true },
    ])
    expect(computePendingBapliePhysicalFlags(rows, blcs([bl({ is_imo: true, imo_class: '3', un_number: '1203', is_oog: true })]))).toBe(0)
    const notImo = staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: false, imo_class: '3', un_number: '1203' }])
    expect(computePendingBapliePhysicalFlags(notImo, blcs([bl({})]))).toBe(0)
  })

  it('SOC/COC só conta quando a origem não é o B/L nem correção manual', () => {
    const soc = staged([{ container_number: 'ABCD1234567', status: 'full', ownership: 'SOC' }])
    expect(computePendingBapliePhysicalFlags(soc, blcs([bl({ ownership: 'COC', ownership_source: 'bl' })]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(soc, blcs([bl({ ownership: 'COC', ownership_source: 'manual' })]))).toBe(0)
    expect(computePendingBapliePhysicalFlags(soc, blcs([bl({ ownership: null, ownership_source: null })]))).toBe(1)
    expect(computePendingBapliePhysicalFlags(soc, blcs([bl({ ownership: 'SOC', ownership_source: 'baplie' })]))).toBe(0)
  })

  it('lê o Baplie e os containers dos B/Ls da viagem', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', is_oog: true }],
      containers: [bl({})],
    })
    await expect(countPendingBapliePhysicalFlags(1)).resolves.toBe(1)
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

  it('perfil manual resolvido com "Vale o B/L" para dois valores do Baplie não volta a divergir em nenhum', async () => {
    // A tabela guarda uma resolução por valor do Baplie (IMO e depois OOG): a
    // leitura que guardava uma só por container reabria a outra.
    const resolutions = [
      { bl_container_id: 10, baplie_value: 'OOG', manifest_value: 'sem marca', field_name: 'profile', resolution: 'vale_o_bl' },
      { bl_container_id: 10, baplie_value: 'IMO', manifest_value: 'sem marca', field_name: 'profile', resolution: 'vale_o_bl' },
    ]
    const container = { id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, is_oog: false, profile_source: 'manual' }
    for (const flags of [{ is_imo: true }, { is_oog: true }]) {
      installReconcileMocks({
        bls: [{ id: 'BL1' }],
        baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: null, ...flags }],
        containers: [container],
        resolutions,
      })
      await expect(reconcileBaplieWithManifest(1)).resolves.toEqual({ items: [], source: 'reconciled', pendingRoutes: [] })
    }
  })

  it('lê as resoluções além da primeira página de 1.000 linhas', async () => {
    const filler = Array.from({ length: 1000 }, (_, index) => (
      { bl_container_id: 5000 + index, baplie_value: 'IMO', manifest_value: 'sem marca', field_name: 'profile', resolution: 'vale_o_bl' }))
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full', bl_ref: 'BL1', slot: null, is_imo: true }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, is_oog: false, profile_source: 'manual' }],
      resolutions: [...filler, { bl_container_id: 10, baplie_value: 'IMO', manifest_value: 'sem marca', field_name: 'profile', resolution: 'vale_o_bl' }],
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

  // E9-17: paginação sem ORDER BY pode repetir ou pular linhas entre páginas.
  it('pagina Baplie e containers dos B/Ls em ordem estável', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1' }],
      baplie: [{ container_number: 'ABCD1234567', status: 'full' }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }],
    })
    await reconcileBaplieWithManifest(1, { isD7: false })
    expect(builders.baplie_containers.order).toHaveBeenCalledWith('id')
    expect(builders.bl_containers.order).toHaveBeenCalledWith('id')
  })

  it('B/L cancelado não cobre a rota nem entra na conciliação', async () => {
    installReconcileMocks({
      bls: [{ id: 'BL1', pol: 'CNTAO', pod: 'BRSSZ', cancelled_at: '2026-10-01T00:00:00Z' }],
      baplie: [{ container_number: 'ABCD1234567', pol: 'CNTAO', pod: 'BRSSZ', status: 'full' }],
      containers: [{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }],
    })
    await expect(reconcileBaplieWithManifest(1, { isD7: false })).resolves.toEqual({
      items: [], source: 'awaiting_route_coverage', pendingRoutes: ['CNTAO::BRSSZ'],
    })
    const forced = await reconcileBaplieWithManifest(1, { isD7: true })
    expect(forced.items).toEqual([expect.objectContaining({ kind: 'missing_in_manifest', container_number: 'ABCD1234567' })])
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

describe('computeOwnershipDivergences — SOC/COC (B/L soberano)', () => {
  it('aponta SOC/COC divergente só quando as duas fontes informam valores diferentes', () => {
    const items = computeOwnershipDivergences(
      staged([
        { container_number: 'ABCD1234567', status: 'full', ownership: 'SOC' },
        { container_number: 'ABCD7654321', status: 'full', ownership: 'SOC' },
        { container_number: 'ABCD1111111', status: 'full', ownership: null },
        { container_number: 'ABCD2222222', status: 'empty', ownership: 'SOC' },
      ]),
      blcs([
        { id: 1, bl_id: 'BL1', container_number: 'ABCD1234567', ownership: 'COC' },
        { id: 2, bl_id: 'BL1', container_number: 'ABCD7654321', ownership: 'SOC' },
        { id: 3, bl_id: 'BL1', container_number: 'ABCD1111111', ownership: 'COC' },
        { id: 4, bl_id: 'BL1', container_number: 'ABCD2222222', ownership: 'COC' },
      ]),
    )
    expect(items).toEqual([
      { kind: 'ownership_mismatch', container_number: 'ABCD1234567', bl_container_id: 1, bl_id: 'BL1', bl_ownership: 'COC', baplie_ownership: 'SOC' },
    ])
  })
})

describe('computeOwnershipDivergences — correção manual e "Vale o B/L" (migration 194)', () => {
  it('SOC/COC corrigido à mão continua divergente até "Vale o B/L" daqueles valores', () => {
    const baplie = staged([{ container_number: 'ABCD1234567', status: 'full', ownership: 'SOC' }])
    const containers = blcs([{ id: 1, bl_id: 'BL1', container_number: 'ABCD1234567', ownership: 'COC', ownership_source: 'manual' }])
    expect(computeOwnershipDivergences(baplie, containers)).toHaveLength(1)
    expect(computeOwnershipDivergences(baplie, containers, new Map([[1, new Set([ownershipResolutionKey('SOC', 'COC')])]]))).toEqual([])
    // Resolução de outro par de valores não encerra a divergência atual.
    expect(computeOwnershipDivergences(baplie, containers, new Map([[1, new Set([ownershipResolutionKey('COC', 'SOC')])]]))).toHaveLength(1)
  })
})

describe('computeProfileDivergences — perfil manual (migration 182)', () => {
  it('aponta o perfil manual que o Baplie contradiz e some depois de "Vale o B/L"', () => {
    const baplie = staged([{ container_number: 'ABCD1234567', status: 'full', is_imo: true }])
    const containers = blcs([{ id: 1, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, is_oog: false, profile_source: 'manual' }])
    expect(computeProfileDivergences(baplie, containers)).toEqual([
      { kind: 'profile_mismatch', container_number: 'ABCD1234567', bl_container_id: 1, bl_id: 'BL1', bl_profile: 'sem marca', baplie_profile: 'IMO' },
    ])
    expect(computeProfileDivergences(baplie, containers, new Map([[1, new Set(['IMO'])]]))).toEqual([])
  })
})

describe('countOpenBaplieDivergences (faixa de viagens)', () => {
  it('conta as divergências de cada viagem numa leitura só, com a regra da ficha', async () => {
    mockRpc.mockResolvedValue({ data: '2020-01-01', error: null })
    installReconcileMocks({
      bls: [
        { id: 'BL-A', voyage_id: 1, pol: 'CNSHA', pod: 'BRSSZ' },
        { id: 'BL-B', voyage_id: 2, pol: 'CNSHA', pod: 'BRSSZ' },
      ],
      baplie: [
        { id: 1, voyage_id: 1, container_number: 'ABCD1234567', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
        { id: 2, voyage_id: 1, container_number: 'ZZZZ7654321', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
        { id: 3, voyage_id: 2, container_number: 'EFGH1234567', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
      ],
      containers: [
        { id: 10, bl_id: 'BL-A', container_number: 'ABCD1234567' },
        { id: 11, bl_id: 'BL-B', container_number: 'EFGH1234567' },
      ],
    })
    const { countOpenBaplieDivergences } = await import('../baplieReconciliation')
    const counts = await countOpenBaplieDivergences([2, 1])
    // Viagem 1: ZZZZ7654321 está no Baplie e em nenhum B/L. Viagem 2 confere.
    expect(Object.fromEntries(counts)).toEqual({ 1: 1, 2: 0 })
    expect(mockFrom.mock.calls.filter(([table]) => table === 'baplie_containers')).toHaveLength(1)
  })
})

// ADR 0095, decisão 15 (B12c; migration 410): o transbordo aparece na
// conciliação, marcado, mas não leva IMO/OOG nem SOC/COC aos B/Ls.
describe('transbordo na conciliação', () => {
  const transbordo = { container_number: 'ABCD1234567', status: 'full', is_transshipment: true, is_imo: true, imo_class: '3', un_number: '1203', is_oog: true, ownership: 'SOC' }

  it('aparece marcado como transbordo e conta como presente no Baplie', () => {
    expect(computeExistenceDivergences(staged([{ ...transbordo, bl_ref: null, slot: '01' }]), blcs([]))).toEqual([
      { kind: 'missing_in_manifest', container_number: 'ABCD1234567', baplie_bl_ref: null, slot: '01', transshipment: true },
    ])
    expect(computeExistenceDivergences(staged([transbordo]), blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567' }]))).toEqual([])
  })

  it('não leva marcas: nada pendente, nada a atualizar e nenhuma divergência de SOC/COC ou IMO/OOG', () => {
    const bl = blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, is_oog: false, ownership: 'COC', ownership_source: 'bl', profile_source: 'manual' }])
    expect(computePendingBapliePhysicalFlags(staged([transbordo]), blcs([{ id: 10, bl_id: 'BL1', container_number: 'ABCD1234567', is_imo: false, is_oog: false }]))).toBe(0)
    expect(computeBapliePhysicalUpdates(staged([transbordo]), bl)).toEqual([])
    expect(computeOwnershipDivergences(staged([transbordo]), bl)).toEqual([])
    expect(computeProfileDivergences(staged([transbordo]), bl)).toEqual([])
  })
})
