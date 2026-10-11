import { describe, expect, it } from 'vitest'
import { buildReconciliationOverview, describeRowCoverage, indexReconciliation } from '../bapliePresentation'
import type { BaplieReconciliationResult } from '../../services/baplieReconciliation'

// E9-15: o índice por número não pode sobrescrever uma divergência com outra
// do mesmo container, e a divergência de perfil IMO/OOG manual aparece na linha.
describe('situação do container com mais de uma divergência', () => {
  const rows = [
    { container_number: 'AAAU0000001', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
    { container_number: 'AAAU0000002', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
    { container_number: 'AAAU0000003', status: 'full', pol: 'CNSHA', pod: 'BRSSZ' },
  ]
  const ownership = (container: string, id: number) => ({ kind: 'ownership_mismatch' as const, container_number: container, bl_container_id: id, bl_id: `BL-${id}`, bl_ownership: 'COC', baplie_ownership: 'SOC' })
  const profile = (container: string, id: number) => ({ kind: 'profile_mismatch' as const, container_number: container, bl_container_id: id, bl_id: `BL-${id}`, bl_profile: 'sem marca', baplie_profile: 'IMO' })
  const reconciliation: BaplieReconciliationResult = {
    source: 'reconciled',
    pendingRoutes: [],
    items: [
      // SOC/COC antes do perfil: o perfil vinha por último e escondia o SOC/COC.
      ownership('AAAU0000001', 1), profile('AAAU0000001', 1),
      profile('AAAU0000002', 2),
      // Part Lot: dois B/Ls do mesmo container, um com cada divergência.
      profile('aaau 0000003', 3), ownership('AAAU0000003', 4),
    ],
  }
  const overview = buildReconciliationOverview({ staged: rows, blsExist: true, reconciliation, loading: false, failed: false })

  it('guarda todas as divergências do container', () => {
    expect([...(indexReconciliation(reconciliation).get('AAAU0000001') ?? [])].sort()).toEqual(['ownership_mismatch', 'profile_mismatch'])
  })

  it('mostra SOC/COC e IMO/OOG manual juntos e entra nos dois filtros', () => {
    const coverage = rows.map((row) => describeRowCoverage(row, overview, reconciliation))
    expect(coverage.map((item) => item?.label)).toEqual([
      'Com B/L · SOC/COC e IMO/OOG manual divergem',
      'Com B/L · IMO/OOG manual diverge',
      'Com B/L · SOC/COC e IMO/OOG manual divergem',
    ])
    expect(coverage.map((item) => item?.keys)).toEqual([['ownership', 'profile'], ['profile'], ['ownership', 'profile']])
  })
})
