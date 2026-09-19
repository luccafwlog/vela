import { describe, expect, it, vi } from 'vitest'
import {
  AGENCY_REPORT_SECTIONS,
  addOccurrence,
  buildContainerTypeMatrix,
  groupEmptyEmbarkBookings,
  groupVehiclesByBrand,
  summarizeVehiclesByContainerTypeAndModel,
  getAgencyReportDerivedData,
  getAgencyReportOwnData,
  setDepartmentSignoff,
  setSectionObservation,
  setSignoff,
} from '../agencyDepartureReport'

const { fromMock, schedulesMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  schedulesMock: vi.fn(),
}))

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))
vi.mock('../voyageRouteSchedules', () => ({
  buildVoyagePodEntityId: (voyageId: number, port: string) => `${voyageId}::${port}`,
  listVoyagePodSchedules: schedulesMock,
  listVoyageEscalaSchedulesByVoyageIds: schedulesMock,
  getVoyageUnifiedAtd: vi.fn().mockResolvedValue({ atd: null, atdSource: null, atdRegisteredAt: null }),
}))

it('consolida containers distintos por tipo e veiculos distintos por modelo', () => {
  expect(summarizeVehiclesByContainerTypeAndModel([
    { chassis: 'V1', model: 'SUV', containerNumber: 'CONT1', containerType: '40HC' },
    { chassis: 'V2', model: 'SUV', containerNumber: 'CONT1', containerType: '40HC' },
    { chassis: 'V3', model: 'SEDAN', containerNumber: 'CONT2', containerType: '40HC' },
  ])).toEqual({
    containersByType: [{ label: '40HC', count: 2 }],
    vehiclesByModel: [{ label: 'SUV', count: 2 }, { label: 'SEDAN', count: 1 }],
  })
})
vi.mock('../vaziosExportOperations', () => ({
  computeStorageTotals: vi.fn(() => ({ containers: 0, days: 0 })),
}))

function queryBuilder(data: unknown[] = []) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  }
  return builder
}

// Simula a paginação real do PostgREST: `.range(from, to)` recorta o dataset
// completo, em vez de sempre devolver tudo de uma vez (ao contrário de
// queryBuilder). Usado para provar que fetchAllRows (Task 6/10) não perde
// linhas quando o resultado passa de uma página.
function pagedQueryBuilder(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      const page = data.slice(from, to + 1)
      return { then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: page, error: null }).then(resolve) }
    }),
  }
  return builder
}

function singleQueryBuilder(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error: null })),
  }
  return builder
}

describe('buildContainerTypeMatrix', () => {
  it('agrupa contagens por tipo e categoria', () => {
    const matrix = buildContainerTypeMatrix([
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'carga_geral' },
      { type: '40HC', category: 'imo' },
      { type: '20GP', category: 'veiculos' },
    ])

    expect(matrix.rows['40HC']).toEqual({ carga_geral: 2, imo: 1 })
    expect(matrix.rows['20GP']).toEqual({ veiculos: 1 })
    expect(matrix.totals).toEqual({ carga_geral: 2, imo: 1, veiculos: 1 })
  })
})

describe('groupVehiclesByBrand', () => {
  it('agrega marcas com qty de BLs distintos e chassis', () => {
    const grouped = groupVehiclesByBrand([
      { brand: 'BYD', bl_id: 'a', chassis: '1' },
      { brand: 'BYD', bl_id: 'a', chassis: '2' },
      { brand: 'BYD', bl_id: 'b', chassis: '3' },
      { brand: 'GWM', bl_id: 'c', chassis: '4' },
    ])

    expect(grouped).toEqual([
      { brand: 'BYD', blCount: 2, vinCount: 3, transshipmentVinCount: 0 },
      { brand: 'GWM', blCount: 1, vinCount: 1, transshipmentVinCount: 0 },
    ])
  })

  it('conta os VINs em transbordo separado do total (Task 1 do ADR 2026-07-31)', () => {
    const grouped = groupVehiclesByBrand([
      { brand: 'BYD', bl_id: 'a', chassis: '1', isTransshipment: false },
      { brand: 'BYD', bl_id: 'b', chassis: '2', isTransshipment: true },
      { brand: 'GWM', bl_id: 'c', chassis: '3', isTransshipment: true },
    ])

    expect(grouped).toEqual([
      { brand: 'BYD', blCount: 2, vinCount: 2, transshipmentVinCount: 1 },
      { brand: 'GWM', blCount: 1, vinCount: 1, transshipmentVinCount: 1 },
    ])
  })
})

describe('groupEmptyEmbarkBookings', () => {
  it('agrupa por (tipo, condição, local), traduz a condição e ordena alfabeticamente, sem célula zerada', () => {
    const rows = groupEmptyEmbarkBookings([
      { type: '40HC', condition: 'vazio', localLabel: 'VBR' },
      { type: '40HC', condition: 'vazio', localLabel: 'VBR' },
      { type: '40HC', condition: 'material', localLabel: 'VBR' },
      { type: '20DV', condition: 'vazio', localLabel: 'TVV' },
    ])

    expect(rows).toEqual([
      { type: '20DV', condition: 'EMPTY', localLabel: 'TVV', quantity: 1 },
      { type: '40HC', condition: 'EMPTY', localLabel: 'VBR', quantity: 2 },
      { type: '40HC', condition: 'EMPTY W/ MATERIAL', localLabel: 'VBR', quantity: 1 },
    ])
  })
})

describe('AGENCY_REPORT_SECTIONS', () => {
  it('mapeia as 6 secoes aos departamentos donos (ocorrencias saiu na ADR 0030; operacao_patio na 0036)', () => {
    expect(AGENCY_REPORT_SECTIONS).toEqual({
      datas: 'operacoes',
      carga_descarregada: 'documentacao',
      carga_carregada: 'equipamentos',
      veiculos: 'equipamentos',
      vazios_embarcados: 'equipamentos',
      vazios_descarregados: 'documentacao',
    })
    expect(Object.keys(AGENCY_REPORT_SECTIONS)).toHaveLength(6)
  })
})

describe('getAgencyReportDerivedData', () => {
  it('não consulta unidades ou linhas de serviço quando a escala não possui operação de vazios', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'vazios_export_operations' ? singleQueryBuilder(null) : queryBuilder(),
    )
    schedulesMock.mockResolvedValue(new Map())

    await getAgencyReportDerivedData(179, 'BRSSA')

    expect(fromMock).not.toHaveBeenCalledWith('vazios_bookings')
    expect(fromMock).not.toHaveBeenCalledWith('vazios_export_service_lines')
    expect(fromMock).not.toHaveBeenCalledWith('depots')
  })

  it('resolve o local das unidades sem depender do relacionamento embutido do PostgREST', async () => {
    const bookingsQuery = queryBuilder([{ container_number: 'ABCD1234567', local_id: 'local-1', condition: 'vazio' }])
    const depotsQuery = queryBuilder([{ id: 'local-1', code: 'DEP', name: 'Depot teste', tipo: 'depot' }])
    fromMock.mockImplementation((table: string) => {
      if (table === 'vazios_bookings') return bookingsQuery
      if (table === 'depots') return depotsQuery
      if (table === 'vazios_export_operations') return singleQueryBuilder({ id: 'operation-1' })
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(bookingsQuery.select).not.toHaveBeenCalledWith(expect.stringContaining('local:depots'))
    expect(result.vaziosExp).toMatchObject([{
      container_number: 'ABCD1234567',
      local: { id: 'local-1', code: 'DEP', name: 'Depot teste', tipo: 'depot' },
    }])
    expect(result.costs).not.toHaveProperty('qtyTotal')
  })

  it('agrega a carga solta dos B/Ls Breakbulk apenas no porto da escala', async () => {
    const breakbulkQuery = queryBuilder([
      // total_weight_kg é peso de contêiner e não entra na tonelagem de carga
      // solta: desde a migration 061 as duas colunas são disjuntas.
      { cargo_mode: 'carga_solta', bb_machine_qty: 2, bb_packages_qty: 8, bb_weight_ton: 3.5, total_weight_kg: 9999, bb_cbm: 12.25 },
      { cargo_mode: 'carga_solta', bb_machine_qty: 1, bb_packages_qty: 4, bb_weight_ton: 2.5, total_weight_kg: null, bb_cbm: 7.75 },
    ])
    fromMock.mockImplementation((table: string) => table === 'bls' ? breakbulkQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map())

    await expect(getAgencyReportDerivedData(7, 'BRSSZ')).resolves.toMatchObject({
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
    })

    expect(breakbulkQuery.eq).toHaveBeenCalledWith('voyage_id', 7)
    expect(breakbulkQuery.in).toHaveBeenCalledWith('cargo_mode', ['carga_solta', 'misto'])
    expect(breakbulkQuery.in).toHaveBeenCalledWith('pod', expect.arrayContaining(['BRSSZ']))
  })

  it('restringe veículos ao POD do BL, evitando misturar escalas da mesma viagem', async () => {
    const vehiclesQuery = queryBuilder([{ brand: 'BYD', bl_id: 'bl-1', chassis: '1', container_id: 10 }])
    fromMock.mockImplementation((table: string) => table === 'vehicles' ? vehiclesQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map([['7::BRSSZ', null]]))

    await getAgencyReportDerivedData(7, 'BRSSZ')

    expect(vehiclesQuery.eq).toHaveBeenCalledWith('bl.voyage_id', 7)
    // P0-3: igualdade crua contra 'BRSSZ' perdia veículos de B/Ls gravados na
    // forma legada do porto (ex. 'BRVIT'); casa por variantes, como
    // baplie/vazios/granito já fazem.
    expect(vehiclesQuery.in).toHaveBeenCalledWith('bl.pod', expect.arrayContaining(['BRSSZ']))
  })

  it('busca o local de desova do container para o bloco de veículos', async () => {
    const vehiclesQuery = queryBuilder()
    fromMock.mockImplementation((table: string) => table === 'vehicles' ? vehiclesQuery : queryBuilder())
    schedulesMock.mockResolvedValue(new Map())

    await getAgencyReportDerivedData(7, 'BRSSZ')

    expect(vehiclesQuery.select).toHaveBeenCalledWith(expect.stringContaining('unpacking_location'))
  })

  it('compoe a matriz por B/L, flags do BAPLI e categorias operacionais', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bl_containers') {
        return queryBuilder([
          { id: 10, container_number: 'docu 1234567', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          { id: 11, container_number: 'TRNS1234567', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
          { id: 12, container_number: 'NOBP1234567', type: '40GP', is_imo: true, bl: { transshipments: [] } },
        ])
      }
      if (table === 'baplie_containers') {
        return queryBuilder([
          { container_number: 'DOCU1234567', size_type: '45G1', status: 'full', is_imo: true, pod: 'BRVIX' },
          { container_number: 'TRNS1234567', size_type: '22G1', status: 'full', is_imo: false, pod: 'BRVIX' },
          { container_number: 'ORPH1234567', size_type: '42G1', status: 'full', is_imo: false, pod: 'BRVIX' },
        ])
      }
      if (table === 'vehicles') return queryBuilder([{ brand: 'BYD', bl_id: 'bl-1', chassis: '1', container_id: 10 }])
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    await expect(getAgencyReportDerivedData(179, 'BRVIX')).resolves.toMatchObject({
      containers: [
        { container_number: 'docu 1234567', size_type: '40HC', is_imo: true, is_transshipment: false, category: 'imo' },
        { container_number: 'TRNS1234567', size_type: '20GP', is_imo: false, is_transshipment: true, category: 'carga_geral' },
        { container_number: 'NOBP1234567', size_type: '40GP', is_imo: true, is_transshipment: false, category: 'imo' },
      ],
      // ORPH1234567 é cheio no Baplie sem B/L correspondente: sai da matriz e
      // vira divergência (Task 3, CAR-1), não mais 'carga_geral'.
      dischargeDivergence: { orphanFullContainers: 1 },
    })
  })

  it('faz OOG vencer IMO, respeita a precedência do Baplie e preserva o merge', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bl_containers') {
        return queryBuilder([
          { id: 20, container_number: 'OOGIMO00001', type: '40HC', is_imo: true, is_oog: false, bl: { transshipments: [] } },
          { id: 21, container_number: 'OOGIMO00001', type: null, is_imo: false, is_oog: true, bl: { transshipments: [] } },
          { id: 22, container_number: 'IMOONLY00001', type: '20GP', is_imo: true, is_oog: false, bl: { transshipments: [] } },
          { id: 23, container_number: 'BAPOOG00001', type: '20GP', is_imo: false, is_oog: false, bl: { transshipments: [] } },
          { id: 24, container_number: 'BAPNOOOG0001', type: '20GP', is_imo: false, is_oog: true, bl: { transshipments: [] } },
        ])
      }
      if (table === 'baplie_containers') {
        return queryBuilder([
          { container_number: 'BAPOOG00001', size_type: '22G1', status: 'full', is_imo: false, is_oog: true, pod: 'BRVIX' },
          { container_number: 'BAPNOOOG0001', size_type: '22G1', status: 'full', is_imo: false, is_oog: false, pod: 'BRVIX' },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.containers).toEqual(expect.arrayContaining([
      { container_number: 'OOGIMO00001', size_type: '40HC', is_imo: true, is_oog: true, is_transshipment: false, category: 'oog' },
      { container_number: 'IMOONLY00001', size_type: '20GP', is_imo: true, is_oog: false, is_transshipment: false, category: 'imo' },
      { container_number: 'BAPOOG00001', size_type: '20GP', is_imo: false, is_oog: true, is_transshipment: false, category: 'oog' },
      { container_number: 'BAPNOOOG0001', size_type: '20GP', is_imo: false, is_oog: false, is_transshipment: false, category: 'carga_geral' },
    ]))
    expect(result.containers.filter((container) => container.container_number === 'OOGIMO00001')).toHaveLength(1)
  })

  it('classifica containers de veículos pela natureza (IMO/OOG/Carga geral) para a matriz de descarga', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bl_containers') {
        return queryBuilder([
          { id: 101, container_number: 'FM400000001', type: '40FM', is_imo: true, is_oog: false, bl: { transshipments: [] } },
          { id: 102, container_number: 'FR480000001', type: '48FR', is_imo: true, is_oog: false, bl: { transshipments: [] } },
          { id: 103, container_number: 'HC400000001', type: '40HC', is_imo: false, is_oog: false, bl: { transshipments: [] } },
        ])
      }
      if (table === 'vehicles') {
        return queryBuilder([
          { brand: 'BYD', bl_id: 'bl-v1', chassis: 'VIN1', container_id: 101 },
          { brand: 'GWM', bl_id: 'bl-v2', chassis: 'VIN2', container_id: 102 },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.containers).toEqual([
      { container_number: 'FM400000001', size_type: '40FM', is_imo: true, is_oog: false, is_transshipment: false, category: 'imo' },
      { container_number: 'FR480000001', size_type: '48FR', is_imo: true, is_oog: false, is_transshipment: false, category: 'imo' },
      { container_number: 'HC400000001', size_type: '40HC', is_imo: false, is_oog: false, is_transshipment: false, category: 'carga_geral' },
    ])
    const matrix = buildContainerTypeMatrix(result.containers.map((c) => ({ type: c.size_type ?? '—', category: c.category })))
    expect(matrix.rows['40FM']).toEqual({ imo: 1 })
    expect(matrix.rows['48FR']).toEqual({ imo: 1 })
    expect(matrix.rows['40HC']).toEqual({ carga_geral: 1 })
  })

  describe('um cálculo só para a linha de serviço (ADR 2026-07-31, Task 8)', () => {
    it('o total de uma linha legada de armazenagem com percentual não nulo bate com o "Total da operação"', async () => {
      fromMock.mockImplementation((table: string) => {
        if (table === 'vazios_export_operations') return singleQueryBuilder({ id: 'operation-1' })
        if (table === 'depots') {
          return queryBuilder([
            { id: 'depot-1', code: 'DEP', name: 'Depot 1', tipo: 'depot', free_time_vazio_days: 0, free_time_material_days: 0 },
          ])
        }
        if (table === 'vazios_bookings') {
          return queryBuilder([
            { container_number: 'ABCD1234567', local_id: 'depot-1', condition: 'vazio', hand_in_date: '2026-01-01', hand_out_date: '2026-01-10' },
          ])
        }
        if (table === 'vazios_export_service_lines') {
          return queryBuilder([
            {
              id: 'line-1', service_id: 'svc-1', local_id: 'depot-1', destino_id: null,
              condition: 'vazio', quantidade: 1, percentual: 50, valor_unitario: 100, quantidade_manual: false,
            },
          ])
        }
        if (table === 'depot_services') return queryBuilder([{ id: 'svc-1', name: 'Armazenagem', natureza: 'armazenagem' }])
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      // 10 dias cobráveis (free time 0) × R$100 × multiplicador 1 (armazenagem
      // ignora percentual legado, ADR 0033) = 1000, tanto na linha quanto na
      // soma que compõe "Total da operação".
      expect(result.costs.serviceLines).toEqual([expect.objectContaining({ total: 1000 })])
      expect(result.costs.total).toBe(1000)
      expect(result.costs).not.toHaveProperty('rows')
    })
  })

  describe('B/L conta os cheios; Baplie compara os vazios (ADR 0035, Bloco 5.5)', () => {
    it('exclui cheio órfão do Baplie da matriz e mantém vazio fora da Carga descarregada', async () => {
      fromMock.mockImplementation((table: string) => {
        if (table === 'bl_containers') {
          return queryBuilder([
            { id: 1, container_number: 'FULL0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            { id: 2, container_number: 'FULL0000002', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            { id: 3, container_number: 'FULL0000003', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          ])
        }
        if (table === 'baplie_containers') {
          return queryBuilder([
            { container_number: 'FULL0000001', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'FULL0000002', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'FULL0000003', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'ORPH0000009', size_type: '40HC', status: 'full', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000001', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000002', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.containers).toHaveLength(3)
      const fullFromBl = result.containers.filter((c) => c.category === 'carga_geral')
      expect(fullFromBl.map((c) => c.container_number).sort()).toEqual(['FULL0000001', 'FULL0000002', 'FULL0000003'])
      expect(result.containers.some((c) => c.container_number === 'ORPH0000009')).toBe(false)
      expect(result.dischargeDivergence).toEqual({ orphanFullContainers: 1 })
      expect(result.vaziosDivergence).toEqual({
        baplieCount: 2,
        moduleCount: 0,
        unclassifiedCount: 0,
        diverges: true,
      })
    })

    it('reporta divergência entre a contagem de vazios do Baplie e a do módulo de vazios, com quantas estão sem natureza', async () => {
      fromMock.mockImplementation((table: string) => {
        if (table === 'baplie_containers') {
          return queryBuilder([
            { container_number: 'EMTY0000001', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000002', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
            { container_number: 'EMTY0000003', size_type: '20GP', status: 'empty', is_imo: false, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_importacao_containers') {
          return queryBuilder([
            { container_type: '20GP', natureza: 'cama', pod: 'BRVIX' },
            { container_type: '20GP', natureza: null, pod: 'BRVIX' },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.vaziosDivergence).toEqual({
        baplieCount: 3,
        moduleCount: 2,
        unclassifiedCount: 1,
        diverges: true,
      })
    })
  })

  describe('carga em transbordo (ADR 2026-07-31, Task 1)', () => {
    it('inclui containers, carga solta e veículos de B/Ls em transbordo de um porto omitido', async () => {
      let blContainersCall = 0
      let vehiclesCall = 0
      let blsCall = 0
      fromMock.mockImplementation((table: string) => {
        if (table === 'voyage_omissions') return queryBuilder([{ id: 42 }])
        if (table === 'bl_transshipments') return queryBuilder([{ bl_id: 'BL-T1' }, { bl_id: 'BL-T2' }])
        if (table === 'bl_containers') {
          blContainersCall += 1
          if (blContainersCall === 1) {
            return queryBuilder([
              { id: 1, container_number: 'OWN0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
              { id: 2, container_number: 'OWN0000002', type: '40HC', is_imo: false, bl: { transshipments: [] } },
              { id: 3, container_number: 'OWN0000003', type: '40HC', is_imo: false, bl: { transshipments: [] } },
            ])
          }
          return queryBuilder([
            { id: 4, container_number: 'TRB0000001', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
            { id: 5, container_number: 'TRB0000002', type: '20GP', is_imo: false, bl: { transshipments: [{ disposition: 'transshipment' }] } },
          ])
        }
        if (table === 'bls') {
          blsCall += 1
          // 1ª chamada: listVoyageEscalaPorts (Task 10), sem pod/pol relevantes
          // aqui — as duas seguintes são a carga solta própria e a em
          // transbordo, na mesma ordem de antes.
          if (blsCall === 1) return queryBuilder([])
          if (blsCall === 2) {
            return queryBuilder([{ bb_machine_qty: 1, bb_packages_qty: 2, bb_weight_ton: 1, total_weight_kg: null, bb_cbm: 3 }])
          }
          return queryBuilder([{ bb_machine_qty: 5, bb_packages_qty: 6, bb_weight_ton: 2, total_weight_kg: null, bb_cbm: 4 }])
        }
        if (table === 'vehicles') {
          vehiclesCall += 1
          if (vehiclesCall === 1) return queryBuilder([{ brand: 'BYD', bl_id: 'BL-OWN', chassis: 'own-1', container_id: null }])
          return queryBuilder([{ brand: 'GWM', bl_id: 'BL-T1', chassis: 'trb-1', container_id: null }])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(result.containers).toHaveLength(5)
      const transbordo = result.containers.filter((container) => container.is_transshipment)
      expect(transbordo.map((container) => container.container_number).sort()).toEqual(['TRB0000001', 'TRB0000002'])

      expect(result.cargaSolta).toMatchObject({
        bls: 1,
        machines: 1,
        packages: 2,
        transshipment: { bls: 1, machines: 5, packages: 6 },
      })

      expect(result.vehicles).toEqual([
        expect.objectContaining({ bl_id: 'BL-OWN', isTransshipment: false }),
        expect.objectContaining({ bl_id: 'BL-T1', isTransshipment: true }),
      ])
    })

    it('não dispara consultas extras nem altera o resultado quando a escala não possui omissão', async () => {
      fromMock.mockClear()
      let blContainersCall = 0
      fromMock.mockImplementation((table: string) => {
        if (table === 'voyage_omissions') return queryBuilder([])
        if (table === 'bl_containers') {
          blContainersCall += 1
          return queryBuilder([
            { id: 1, container_number: 'OWN0000001', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          ])
        }
        if (table === 'vazios_export_operations') return singleQueryBuilder(null)
        return queryBuilder()
      })
      schedulesMock.mockResolvedValue(new Map())

      const result = await getAgencyReportDerivedData(179, 'BRVIX')

      expect(fromMock).not.toHaveBeenCalledWith('bl_transshipments')
      expect(blContainersCall).toBe(1)
      expect(result.containers).toEqual([
        { container_number: 'OWN0000001', size_type: '40HC', is_imo: false, is_oog: false, is_transshipment: false, category: 'carga_geral' },
      ])
      expect(result.cargaSolta.transshipment).toMatchObject({ bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 })
    })
  })
})

describe('Granito casa por porto normalizado, com fallback do manifesto (ADR 2026-07-31, Task 6)', () => {
  it('casa loading_port em LOCODE, em texto livre e via fallback do manifesto contra a escala BRVIX', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'granite_bls') {
        return queryBuilder([
          { real_weight_kg: 1000, blocks_qty: 1, loading_port: 'BRVIX', manifest: { loading_port: null } },
          { real_weight_kg: 2000, blocks_qty: 2, loading_port: 'VITORIA', manifest: { loading_port: null } },
          { real_weight_kg: 3000, blocks_qty: 3, loading_port: 'Vitoria, Brazil', manifest: { loading_port: null } },
          { real_weight_kg: 4000, blocks_qty: 4, loading_port: null, manifest: { loading_port: 'BRVIX' } },
          // outro porto: não deve casar com a escala BRVIX
          { real_weight_kg: 5000, blocks_qty: 5, loading_port: 'BRSSA', manifest: { loading_port: null } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.granite).toHaveLength(4)
    expect(result.granite.map((bl) => bl.real_weight_kg).sort()).toEqual([1000, 2000, 3000, 4000])
  })

  it('a própria escala vem em forma não canônica (BRVIT) e ainda assim casa o granito, sem virar órfão', async () => {
    // Regressão: comparar o granito normalizado contra o `port` cru (sem
    // normalizar) faz BRVIT !== BRVIX e derruba o granito da seção normal —
    // e como BRVIX (a forma normalizada) está em escalaPorts, ele também não
    // vira órfão: some silenciosamente das duas listas.
    fromMock.mockImplementation((table: string) => {
      if (table === 'bls') return queryBuilder([{ pod: 'BRVIT', pol: 'CNSHA' }])
      if (table === 'granite_bls') {
        return queryBuilder([
          { real_weight_kg: 1000, blocks_qty: 1, loading_port: 'BRVIT', manifest: { loading_port: null } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIT')

    expect(result.granite).toHaveLength(1)
    expect(result.granite[0].real_weight_kg).toBe(1000)
    expect(result.orphanData.granito).toEqual([])
  })

  it('não perde linhas de granito além de uma página do PostgREST (Task 6 trocou o filtro por porto por consulta da viagem inteira)', async () => {
    const rows = Array.from({ length: 1250 }, () => ({
      real_weight_kg: 1,
      blocks_qty: 1,
      loading_port: 'BRVIX',
      manifest: { loading_port: null },
    }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'granite_bls') return pagedQueryBuilder(rows)
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.granite).toHaveLength(1250)
  })

  it('não perde veículos nem containers além de uma página do PostgREST', async () => {
    const vehicleRows = Array.from({ length: 1200 }, (_, index) => ({
      brand: 'BYD', bl_id: `bl-${index}`, chassis: String(index), container_id: null,
    }))
    const containerRows = Array.from({ length: 1200 }, (_, index) => ({
      id: index,
      container_number: `DOCU${String(index).padStart(7, '0')}`,
      type: '40HC',
      is_imo: false,
      bl: { transshipments: [] },
    }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'vehicles') return pagedQueryBuilder(vehicleRows)
      if (table === 'bl_containers') return pagedQueryBuilder(containerRows)
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.vehicles).toHaveLength(1200)
    expect(result.containers).toHaveLength(1200)
  })

  it('deduplica um container compartilhado entre dois B/Ls: conta uma vez, com IMO/categoria mais específica vencendo', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bl_containers') {
        return queryBuilder([
          { id: 1, container_number: 'SHRD1234567', type: '40HC', is_imo: false, bl: { transshipments: [] } },
          { id: 2, container_number: 'SHRD1234567', type: '40HC', is_imo: true, bl: { transshipments: [] } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.containers).toEqual([
      { container_number: 'SHRD1234567', size_type: '40HC', is_imo: true, is_oog: false, is_transshipment: false, category: 'imo' },
    ])
  })
})

describe('Aviso de dado órfão: granito/vazios embarcados fora de qualquer escala da viagem (ADR 2026-07-31, Task 10)', () => {
  it('verificação do plano: granito em BRSSA numa viagem cuja única escala é BRVIX aparece como órfão, não some numa seção zerada', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bls') return queryBuilder([{ pod: 'BRVIX', pol: 'CNSHA' }])
      if (table === 'granite_bls') {
        return queryBuilder([
          { real_weight_kg: 5000, blocks_qty: 5, loading_port: 'BRSSA', manifest: { loading_port: null } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.granite).toHaveLength(0)
    expect(result.orphanData.granito).toEqual([{ port: 'BRSSA', count: 1 }])
  })

  it('granito numa segunda escala VÁLIDA da mesma viagem não é órfão', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bls') return queryBuilder([{ pod: 'BRVIX', pol: null }, { pod: 'BRSSA', pol: null }])
      if (table === 'granite_bls') {
        return queryBuilder([
          { real_weight_kg: 5000, blocks_qty: 5, loading_port: 'BRSSA', manifest: { loading_port: null } },
        ])
      }
      if (table === 'vazios_export_operations') return singleQueryBuilder(null)
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.granite).toHaveLength(0)
    expect(result.orphanData.granito).toEqual([])
  })

  it('Embarque de Vazios numa operação de porto que não é escala vira órfão, com a quantidade de unidades da operação', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'bls') return queryBuilder([{ pod: 'BRVIX', pol: null }])
      if (table === 'vazios_export_operations') {
        // O mesmo queryBuilder atende as duas consultas da tabela: a de
        // .eq('embark_port', port).maybeSingle() (nesta escala) ignora `data`
        // e sempre resolve null; a de Task 10, sem filtro de porto, resolve
        // via `then` com a operação órfã em BRSSA.
        return queryBuilder([{ id: 'op-orphan', embark_port: 'BRSSA' }])
      }
      if (table === 'vazios_bookings') return queryBuilder([{ operation_id: 'op-orphan' }, { operation_id: 'op-orphan' }])
      return queryBuilder()
    })
    schedulesMock.mockResolvedValue(new Map())

    const result = await getAgencyReportDerivedData(179, 'BRVIX')

    expect(result.orphanData.vaziosEmbarcados).toEqual([{ port: 'BRSSA', count: 2 }])
  })
})

describe('getAgencyReportOwnData', () => {
  it('resolve nomes dos atores pelo RPC unico, autorizado no escopo do ADR', async () => {
    const reportQuery = singleQueryBuilder({ id: 'adr-1', closed_by: 'other-user' })
    fromMock.mockImplementation(() => reportQuery)
    rpcMock.mockResolvedValue({ data: [{ user_id: 'other-user', full_name: 'Lucca F.' }], error: null })

    await expect(getAgencyReportOwnData(7, 'BRVIX')).resolves.toMatchObject({
      closed_by_name: 'Lucca F.',
      actor_names: { 'other-user': 'Lucca F.' },
    })

    expect(reportQuery.is).toHaveBeenCalledWith('terminal_id', null)

    expect(rpcMock).toHaveBeenCalledWith('get_agency_report_actor_names', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
    })
    expect(fromMock).not.toHaveBeenCalledWith('user_profiles')
  })

  it('degrada sem autor quando a RPC de nomes dos atores falha (migration ausente no remoto)', async () => {
    const reportQuery = singleQueryBuilder({ id: 'adr-1', closed_by: 'other-user' })
    fromMock.mockImplementation(() => reportQuery)
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(getAgencyReportOwnData(7, 'BRVIX')).resolves.toMatchObject({ closed_by_name: null })

    consoleErrorSpy.mockRestore()
  })
})

describe('setSignoff', () => {
  it('chama a RPC da migration 213 com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setSignoff({ voyageId: 7, port: 'BRVIX', section: 'datas', state: 'confirmed' })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_signoff', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_section: 'datas',
      p_state: 'confirmed',
    })
  })
})

describe('addOccurrence', () => {
  it('chama a RPC com a tag de seção opcional', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await addOccurrence({ voyageId: 7, port: 'BRVIX', body: 'Atracação concluída.', section: 'vazios_embarcados' })

    expect(rpcMock).toHaveBeenCalledWith('add_agency_report_occurrence', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_body: 'Atracação concluída.',
      p_section: 'vazios_embarcados',
    })
  })

  it('omite a seção quando não informada', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await addOccurrence({ voyageId: 7, port: 'BRVIX', body: 'Sem tag.' })

    expect(rpcMock).toHaveBeenCalledWith('add_agency_report_occurrence', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_body: 'Sem tag.',
      p_section: undefined,
    })
  })
})

describe('setSectionObservation', () => {
  it('chama a RPC de Observação por seção (ADR 0030) com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setSectionObservation({ voyageId: 7, port: 'BRVIX', section: 'veiculos', observation: 'Nota de apoio.' })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_section_observation', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_section: 'veiculos',
      p_observation: 'Nota de apoio.',
    })
  })
})

describe('setDepartmentSignoff', () => {
  it('chama a RPC do sign-off departamental com os argumentos tipados', async () => {
    rpcMock.mockResolvedValue({ error: null })

    await setDepartmentSignoff({ voyageId: 7, port: 'BRVIX', department: 'equipamentos', signed: true })

    expect(rpcMock).toHaveBeenCalledWith('set_agency_report_department_signoff', {
      p_voyage_id: 7,
      p_port: 'BRVIX',
      p_department: 'equipamentos',
      p_signed: true,
      p_justification: undefined,
    })
  })
})
