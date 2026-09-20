import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../supabase', () => ({ supabase: { from: (table: string) => from(table) } }))

function builder(result: { data: unknown; error: unknown }) {
  let data = Array.isArray(result.data) ? result.data : result.data
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'or', 'ilike', 'limit', 'not', 'overrideTypes', 'gte', 'lte']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.eq = vi.fn((field: string, value: unknown) => {
    if (Array.isArray(data) && data.some((row) => row && typeof row === 'object' && field in row)) {
      data = data.filter((row) => row && typeof row === 'object' && (row as Record<string, unknown>)[field] === value)
    }
    return chain
  })
  chain.in = vi.fn((field: string, values: unknown[]) => {
    if (Array.isArray(data) && data.some((row) => row && typeof row === 'object' && field in row)) {
      data = data.filter((row) => row && typeof row === 'object' && values.includes((row as Record<string, unknown>)[field]))
    }
    return chain
  })
  chain.range = vi.fn(() => chain)
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: result.error }).then(resolve)
  return chain
}

function byTable(tables: Record<string, unknown[]>) {
  return (table: string) => builder({ data: tables[table] ?? [], error: null })
}

const VOYAGE = {
  id: 24,
  voyage_number: '24W',
  status: 'active',
  vessel: { name: 'MV TESTE' },
  pol: { name: 'Vitoria', locode: 'BRVIX' },
}

describe('fetchLineUpSnapshot', () => {
  beforeEach(() => from.mockReset())

  it('devolve snapshot vazio sem consultar mais nada quando nao ha viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({}))
    await expect(fetchLineUpSnapshot()).resolves.toEqual({ rows: [], lastChangedAt: null })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['voyages'])
  })

  it('propaga a recusa do banco em vez de devolver snapshot parcial', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(() => builder({ data: null, error: { code: '42501', message: 'permission denied' } }))
    await expect(fetchLineUpSnapshot()).rejects.toBeTruthy()
  })

  it('monta uma linha de importacao por Escala da viagem', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRSSZ', cargo_mode: 'carga_solta', ce_mercante: 'CE1', bb_machine_qty: 2, bb_packages_qty: 10 }],
      audit_logs: [
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRSSZ', field_name: 'eta', new_value: '2026-08-01', changed_at: '2026-07-27T00:00:00Z' },
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRSSZ', field_name: 'ata', new_value: '2026-08-02', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))
    const snapshot = await fetchLineUpSnapshot()
    const row = snapshot.rows.find((candidate) => candidate.pod === 'BRSSZ')
    expect(row).toBeDefined()
    expect(row).toMatchObject({ voyageId: 24, voyageNumber: '24W', vesselName: 'MV TESTE', rowType: 'import', ata: '2026-08-02', bbMachines: 2 })
  })

  it('projeta containers pelo read-model dos B/Ls sem segunda consulta por ids', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{
        id: 'BL1',
        voyage_id: 24,
        pod: 'BRVIX',
        cargo_mode: 'container',
        ce_mercante: 'CE1',
        bb_machine_qty: 0,
        bb_packages_qty: 0,
        bl_containers: [
          { id: 1, bl_id: 'BL1', container_number: 'MSCU0000001', tare_weight_kg: 2000, gross_weight_kg: 12000 },
        ],
      }],
    }))

    const snapshot = await fetchLineUpSnapshot()
    const row = snapshot.rows.find((candidate) => candidate.id === '24::BRVIX')
    expect(row).toMatchObject({ total: 1, car: 0, cg: 1 })
    expect(from.mock.calls.map(([table]) => table).filter((table) => table === 'bl_containers')).toHaveLength(1)
  })

  it('contabiliza vazios de importação por viagem em uma leitura filtrada do manifesto', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRVIX', cargo_mode: 'container', ce_mercante: 'CE1', bb_machine_qty: 0, bb_packages_qty: 0 }],
      vazios_importacao_containers: [
        { manifest: { voyage_id: 24 } },
        { manifest: { voyage_id: 24 } },
      ],
    }))

    const row = (await fetchLineUpSnapshot()).rows.find((candidate) => candidate.voyageId === 24)
    expect(row?.mty).toBe(2)
    expect(from.mock.calls.map(([table]) => table)).not.toContain('vazios_importacao_manifests')
  })

  it('monta linha de exportacao com datas da escala unificada', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      voyage_export_schedules: [{
        id: 'EXP1',
        voyage_id: 24,
        pol: 'BRVIX',
        tem_exportacao: true,
        has_granite: true,
        containers_qty: 12,
        movements_qty: 14,
        ce_status: 'received',
        linked: true,
      }],
      voyage_escala_terminal_state: [{
        voyage_id: 24, port: 'BRVIX', terminal_id: 't1', terminal_etb: '2026-08-02', terminal_atb: null,
        terminal_etd: null, terminal_atd: '2026-08-05', terminal_rtw: null, revision: 1,
      }],
      voyage_escala_operation_fronts: [{ voyage_id: 24, port: 'BRVIX', sentido: 'exportacao', terminal_id: 't1' }],
      depots: [{ id: 't1', code: 'TVV' }],
      audit_logs: [
        // ETA/ATA continuam na escala; as datas de berço vêm da Atracação.
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRVIX', field_name: 'eta', new_value: '2026-08-01', changed_at: '2026-07-27T00:00:00Z' },
        { entity_type: 'voyage_pol_schedule', entity_id: '24::BRVIX', field_name: 'atd', new_value: '2026-08-05', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))

    const snapshot = await fetchLineUpSnapshot()
    const row = snapshot.rows.find((candidate) => candidate.id === 'exp::24::BRVIX')

    expect(row).toBeDefined()
    expect(row).toMatchObject({
      voyageId: 24,
      pod: 'BRVIX',
      rowType: 'export',
      eta: '2026-08-01',
      etb: '2026-08-02',
      ata: null,
      atb: null,
      atd: '2026-08-05',
      exportHasGranite: true,
      exportContainersQty: 12,
      exportMovementsQty: 14,
      exportCeStatus: 'received',
      exportLinked: true,
    })
  })

  it('preserva importacao e exportacao quando a mesma escala tem B/L e agenda EXP', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRVIX', cargo_mode: 'container', ce_mercante: 'CE1', bb_machine_qty: 0, bb_packages_qty: 0 }],
      voyage_export_schedules: [{
        id: 'EXP1',
        voyage_id: 24,
        pol: 'BRVIX',
        tem_exportacao: true,
        has_granite: false,
        containers_qty: 7,
        movements_qty: 9,
        ce_status: 'received',
        linked: true,
      }],
      audit_logs: [
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRVIX', field_name: 'eta', new_value: '2026-08-01', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))

    const snapshot = await fetchLineUpSnapshot()
    const rows = snapshot.rows.filter((candidate) => candidate.voyageId === 24 && candidate.pod === 'BRVIX')

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => ({ id: row.id, rowType: row.rowType }))).toEqual([
      { id: '24::BRVIX', rowType: 'import' },
      { id: 'exp::24::BRVIX', rowType: 'export' },
    ])
    expect(rows.find((row) => row.rowType === 'export')).toMatchObject({
      exportContainersQty: 7,
      exportMovementsQty: 9,
      exportCeStatus: 'received',
      exportLinked: true,
    })
  })

  it('projeta uma linha por escala com terminais de importacao e exportacao', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRVIX', cargo_mode: 'container', ce_mercante: 'CE1', bb_machine_qty: 0, bb_packages_qty: 0 }],
      voyage_export_schedules: [{
        id: 'EXP1', voyage_id: 24, pol: 'BRVIX', tem_exportacao: true, has_granite: true, has_empty: false,
        containers_qty: null, movements_qty: null, ce_status: 'waiting', linked: false,
      }],
      voyage_escala_operation_fronts: [
        { voyage_id: 24, port: 'BRVIX', sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 'inactive-terminal' },
        { voyage_id: 24, port: 'BRVIX', sentido: 'exportacao', modalidade: 'granito', terminal_id: 'export-terminal' },
      ],
      voyage_escala_terminal_state: [
        {
          voyage_id: 24,
          port: 'BRVIX',
          terminal_id: 'inactive-terminal',
          terminal_etb: '2026-08-01',
          terminal_atb: '2026-08-02',
          terminal_atd: '2026-08-04',
          terminal_rtw: null,
          revision: 1,
        },
        {
          voyage_id: 24,
          port: 'BRVIX',
          terminal_id: 'export-terminal',
          terminal_etb: '2026-08-05',
          terminal_atb: '2026-08-06',
          terminal_atd: '2026-08-08',
          terminal_rtw: null,
          revision: 1,
        },
      ],
      depots: [
        { id: 'inactive-terminal', code: 'TVV', active: false },
        { id: 'export-terminal', code: 'PORTMAC', active: true },
      ],
    }))

    const rows = (await fetchLineUpSnapshot()).rows.filter((row) => row.pod === 'BRVIX')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => ({ rowType: row.rowType, terminal: row.rowType === 'import' ? row.importTerminal : row.exportTerminal }))).toEqual([
      { rowType: 'import', terminal: 'TVV' },
      { rowType: 'export', terminal: 'PORTMAC' },
    ])
    expect(rows.find((row) => row.rowType === 'import')).toMatchObject({ etb: '2026-08-01', atb: '2026-08-02', atd: '2026-08-04' })
    expect(rows.find((row) => row.rowType === 'export')).toMatchObject({ etb: '2026-08-05', atb: '2026-08-06', atd: '2026-08-08' })
  })

  it('mantem exportacao declarada sem operacao e apresenta TBC sem salvar placeholder', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      voyage_export_schedules: [{
        id: 'EXP1', voyage_id: 24, pol: 'BRVIX', tem_exportacao: true, has_granite: true, has_empty: false,
        containers_qty: null, movements_qty: null, ce_status: 'waiting', linked: false,
      }],
    }))

    const rows = (await fetchLineUpSnapshot()).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ rowType: 'export', exportTerminal: 'TBC', exportContainersQty: null, exportMovementsQty: null })
  })

  it('marca as duas linhas da escala omitida sem perder rowType nem terminais', async () => {
    const { fetchLineUpSnapshot } = await import('../lineup')
    from.mockImplementation(byTable({
      voyages: [VOYAGE],
      bls: [{ id: 'BL1', voyage_id: 24, pod: 'BRVIX', cargo_mode: 'container', ce_mercante: 'CE1', bb_machine_qty: 0, bb_packages_qty: 0 }],
      voyage_export_schedules: [{
        id: 'EXP1', voyage_id: 24, pol: 'BRVIX', tem_exportacao: true, has_granite: true,
        containers_qty: 7, movements_qty: 9, ce_status: 'waiting', linked: false,
      }],
      voyage_escala_operation_fronts: [
        { voyage_id: 24, port: 'BRVIX', sentido: 'importacao', modalidade: 'carga_cheia', terminal_id: 'import-terminal' },
        { voyage_id: 24, port: 'BRVIX', sentido: 'exportacao', modalidade: 'granito', terminal_id: 'export-terminal' },
      ],
      voyage_escala_terminal_state: [
        { voyage_id: 24, port: 'BRVIX', terminal_id: 'import-terminal', terminal_atb: '2026-08-02', terminal_atd: null, terminal_rtw: null, revision: 1 },
        { voyage_id: 24, port: 'BRVIX', terminal_id: 'export-terminal', terminal_atb: '2026-08-03', terminal_atd: null, terminal_rtw: null, revision: 1 },
      ],
      depots: [
        { id: 'import-terminal', code: 'TVV', active: true },
        { id: 'export-terminal', code: 'PORTMAC', active: true },
      ],
      audit_logs: [
        { entity_type: 'voyage_pod_schedule', entity_id: '24::BRVIX', field_name: 'omitted', new_value: 'true', changed_at: '2026-07-27T00:00:00Z' },
      ],
    }))

    const rows = (await fetchLineUpSnapshot()).rows.filter((row) => row.pod === 'BRVIX')

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => ({ rowType: row.rowType, omitted: row.omitted }))).toEqual([
      { rowType: 'import', omitted: true },
      { rowType: 'export', omitted: true },
    ])
    expect(rows.find((row) => row.rowType === 'import')).toMatchObject({ importTerminal: 'TVV', exportTerminal: 'TBC' })
    expect(rows.find((row) => row.rowType === 'export')).toMatchObject({ importTerminal: 'TBC', exportTerminal: 'PORTMAC' })
  })
})

describe('compareLineUpRows', () => {
  it('prioriza berço efetivo sobre ETA mais antigo e mantém escala concluída depois', async () => {
    const { compareLineUpRows } = await import('../lineup')
    const base = { id: 'x', voyageId: 1, voyageNumber: '1', voyageStatus: 'active' as const, vesselName: 'V', pod: 'BRVIX', eta: null, etb: null, ata: null, atb: null, rowType: 'import' as const, omitted: false, importTerminal: 'TBC', exportTerminal: 'TBC', vin: 0, car: 0, cg: 0, total: 0, mty: 0, rtw: null, bbMachines: 0, bbPackages: 0, bbTotal: 0, atd: null, ceStatus: 'missing' as const, linked: false, exportHasGranite: null, exportContainersQty: null, exportMovementsQty: null, exportCeStatus: null, exportLinked: null }
    const active = { ...base, id: 'active', atb: '2026-08-10', eta: '2026-07-01' }
    const pending = { ...base, id: 'pending', eta: '2026-07-02' }
    const completed = { ...base, id: 'done', atb: '2026-07-03', atd: '2026-07-04' }
    expect([pending, completed, active].sort(compareLineUpRows).map((row) => row.id)).toEqual(['active', 'pending', 'done'])
  })
})

describe('projectLineUpTerminals', () => {
  it('cobre import-only, export-only, ambos e TBC', async () => {
    const { projectLineUpTerminals } = await import('../lineup')
    const fronts = [
      { sentido: 'importacao' as const, terminalId: 't-import' },
      { sentido: 'exportacao' as const, terminalId: 't-export' },
    ]
    const states = [
      { terminalId: 't-import', terminalAtb: '2026-08-02' },
      { terminalId: 't-export', terminalAtb: '2026-08-03' },
    ]
    const codes = new Map([['t-import', 'TVV'], ['t-export', 'PORTMAC']])

    expect(projectLineUpTerminals({ fronts, terminalStates: states, terminalCodes: codes, direction: 'importacao' })).toBe('TVV')
    expect(projectLineUpTerminals({ fronts, terminalStates: states, terminalCodes: codes, direction: 'exportacao' })).toBe('PORTMAC')
    expect(projectLineUpTerminals({ fronts: [], terminalStates: states, terminalCodes: codes, direction: 'importacao' })).toBe('TBC')
    expect(projectLineUpTerminals({ fronts: [{ sentido: 'exportacao', terminalId: null }], terminalStates: [], terminalCodes: codes, direction: 'exportacao' })).toBe('TBC')
  })

  it('ordena multiplos terminais por ATB, sem ATB e codigo, preservando historico inativo', async () => {
    const { projectLineUpTerminals } = await import('../lineup')
    expect(projectLineUpTerminals({
      fronts: [
        { sentido: 'importacao', terminalId: 't-z' },
        { sentido: 'importacao', terminalId: 't-a' },
        { sentido: 'importacao', terminalId: 't-inactive' },
        { sentido: 'importacao', terminalId: null },
      ],
      terminalStates: [
        { terminalId: 't-z', terminalAtb: null },
        { terminalId: 't-a', terminalAtb: '2026-08-01' },
        { terminalId: 't-inactive', terminalAtb: '2026-08-01' },
      ],
      terminalCodes: new Map([['t-z', 'ZZZ'], ['t-a', 'AAA'], ['t-inactive', 'OLD']]),
      direction: 'importacao',
    })).toBe('AAA / OLD / ZZZ / TBC')
  })
})
