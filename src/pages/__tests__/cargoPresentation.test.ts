import { describe, expect, it } from 'vitest'
import { formatDate } from '../../lib/utils'
import {
  containersSearchFromFilters,
  countActiveContainerFilters,
  describeReturn,
  filtersFromContainersSearch,
  ownershipSourceLabel,
} from '../containersListState'
import { groupVehiclesByContainer, unpackingScopeText } from '../veiculosPresentation'
import { buildReconciliationOverview, describeRowCoverage } from '../bapliePresentation'
import type { BaplieReconciliationResult } from '../../services/baplieReconciliation'

describe('estado da lista /containers na URL', () => {
  it('lê os links do Line-Up e da Viagem e faz ida e volta sem perder o recorte', () => {
    const filters = filtersFromContainersSearch(new URLSearchParams('voyage=10&pod=BRSSZ&vehicle_container=true&type=40HC&page=2&pageSize=50'))
    expect(filters).toMatchObject({ voyageId: '10', pod: 'BRSSZ', vehicleContainer: 'true', containerType: '40HC', page: 2, pageSize: 50 })
    expect(filtersFromContainersSearch(new URLSearchParams(containersSearchFromFilters(filters)))).toEqual(filters)
    expect(countActiveContainerFilters(filters)).toBe(4)
  })

  it('aceita o parâmetro antigo `search` e descarta valores inválidos', () => {
    const filters = filtersFromContainersSearch(new URLSearchParams('search=CSNU&vehicle_container=talvez&page=-1&pageSize=7'))
    expect(filters).toMatchObject({ search: 'CSNU', vehicleContainer: '', page: 1, pageSize: 20 })
    expect(containersSearchFromFilters(filters)).toBe('q=CSNU')
  })
})

describe('linha de /containers', () => {
  it('diz de onde vem o SOC/COC que vale, e nada quando não há valor', () => {
    expect(ownershipSourceLabel('manual', 'SOC')).toBe('Correção manual')
    expect(ownershipSourceLabel('baplie', 'COC')).toBe('Pelo Baplie')
    expect(ownershipSourceLabel('bl', 'COC')).toBe('Pelo B/L')
    expect(ownershipSourceLabel('bl', null)).toBeNull()
  })

  it('não apresenta devolução pendente para SOC', () => {
    expect(describeReturn('2026-10-07', 'COC', formatDate).text).toBe('07/10/2026')
    expect(describeReturn(null, 'SOC', formatDate).text).toBe('Não se aplica (SOC)')
    expect(describeReturn(null, null, formatDate)).toMatchObject({ text: '—', srText: 'Sem devolução registrada' })
  })
})

describe('veículos agrupados por container', () => {
  it('agrupa na ordem da página, separa veículos sem container e junta os B/Ls distintos', () => {
    const c1 = { id: 1, container_number: 'CSNU6012309' }
    const c2 = { id: 2, container_number: 'CSNU6012310' }
    const groups = groupVehiclesByContainer([
      { id: 10, container: c2, bl: { id: 'BL-B' } },
      { id: 11, container: c1, bl: { id: 'BL-A' } },
      { id: 12, container: c2, bl: { id: 'BL-C' } },
      { id: 13, container: null, bl: { id: 'BL-A' } },
      { id: 14, container: c2, bl: { id: 'BL-B' } },
    ])
    expect(groups.map((group) => group.key)).toEqual(['container:2', 'container:1', 'none'])
    expect(groups[0].vehicles.map((row) => row.id)).toEqual([10, 12, 14])
    expect(groups[0].blIds).toEqual(['BL-B', 'BL-C'])
    expect(groups[2].container).toBeNull()
  })

  it('diz o alcance real da edição do local de desova', () => {
    expect(unpackingScopeText(1)).toBe('Vale para o veículo deste container')
    expect(unpackingScopeText(3)).toBe('Vale para os 3 veículos deste container')
  })
})

describe('conciliação Baplie × B/L', () => {
  const staged = [
    { container_number: 'AAAU0000001', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
    { container_number: 'AAAU0000002', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
    { container_number: 'AAAU0000003', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
    { container_number: 'AAAU0000004', status: 'full', pol: 'CNSHA', pod: 'BRVIX' },
    { container_number: 'AAAU0000005', status: 'empty', pol: 'CNSHA', pod: 'BRSSZ' },
  ]
  const reconciliation: BaplieReconciliationResult = {
    source: 'reconciled',
    pendingRoutes: ['CNSHA::BRVIX'],
    items: [
      { kind: 'missing_in_manifest', container_number: 'AAAU0000002', baplie_bl_ref: null, slot: '010203' },
      { kind: 'missing_in_baplie', container_number: 'BBBU0000001', bl_container_id: 9, bl_id: 'BL-9' },
      { kind: 'ownership_mismatch', container_number: 'AAAU0000003', bl_container_id: 3, bl_id: 'BL-3', bl_ownership: 'COC', baplie_ownership: 'SOC' },
    ],
  }

  it('mede a cobertura só dos cheios em conciliação e separa as rotas sem B/L', () => {
    const overview = buildReconciliationOverview({ staged, blsExist: true, reconciliation, loading: false, failed: false })
    expect(overview).toMatchObject({
      state: 'divergent', full: 4, empty: 1, inScope: 3, covered: 2,
      missingInManifest: 1, missingInBaplie: 1, ownershipMismatch: 1, onPendingRoutes: 1,
    })
  })

  it('dá a cada container uma situação em texto, não só cor', () => {
    const overview = buildReconciliationOverview({ staged, blsExist: true, reconciliation, loading: false, failed: false })
    const labels = staged.map((row) => describeRowCoverage(row, overview, reconciliation)?.label)
    expect(labels).toEqual(['Com B/L', 'Sem B/L', 'Com B/L · SOC/COC diverge', 'Fora · rota sem B/L', 'Fora da conciliação'])
  })

  it('não confunde viagem sem B/L, carregamento ou erro com "sem divergência"', () => {
    expect(buildReconciliationOverview({ staged, blsExist: false, reconciliation: undefined, loading: false, failed: false }).state).toBe('no_bls')
    expect(buildReconciliationOverview({ staged, blsExist: true, reconciliation: undefined, loading: true, failed: false }).state).toBe('loading')
    const failed = buildReconciliationOverview({ staged, blsExist: true, reconciliation: undefined, loading: false, failed: true })
    expect(failed.state).toBe('error')
    expect(describeRowCoverage(staged[0], failed, undefined)).toBeNull()
    const clean = buildReconciliationOverview({ staged, blsExist: true, reconciliation: { ...reconciliation, items: [], pendingRoutes: [] }, loading: false, failed: false })
    expect(clean).toMatchObject({ state: 'clean', inScope: 4, covered: 4 })
    const awaiting = buildReconciliationOverview({ staged, blsExist: true, reconciliation: { source: 'awaiting_route_coverage', items: [], pendingRoutes: ['CNSHA::BRSSZ', 'CNSHA::BRVIX'] }, loading: false, failed: false })
    expect(awaiting.state).toBe('awaiting_route_coverage')
  })
})
