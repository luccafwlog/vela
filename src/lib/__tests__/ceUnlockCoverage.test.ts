import { describe, expect, it } from 'vitest'
import type { CeUnlockDocument } from '../../types/ceUnlock'
import { coveredUntil } from '../ceUnlockCoverage'

const doc = (patch: Partial<CeUnlockDocument>): CeUnlockDocument => ({
  id: 'd', version: 1, customer_id: 1, request_id: null, type: 'termo', source: 'vip_annual', status: 'approved',
  file_name: 'termo.pdf', size_bytes: 1, valid_from: '2026-01-01', valid_until: '2026-12-31', coverage_year: 2026, reason: null,
  created_at: '2026-01-02T00:00:00Z', ...patch,
})

describe('coveredUntil', () => {
  it('lê a data do aprovado e vigente hoje do mesmo tipo', () => {
    expect(coveredUntil([doc({}), doc({ type: 'procuracao', valid_until: '2026-06-30' })], 'termo', '2026-10-14')).toBe('2026-12-31')
  })
  it('ignora vencido, em análise e com correção pedida', () => {
    expect(coveredUntil([
      doc({ valid_until: '2025-12-31' }),
      doc({ status: 'uploaded' }),
      doc({ status: 'changes_requested' }),
    ], 'termo', '2026-10-14')).toBeNull()
  })
  it('entre dois vigentes, fica o mais recente', () => {
    expect(coveredUntil([
      doc({ valid_until: '2026-12-31', created_at: '2026-01-02T00:00:00Z' }),
      doc({ valid_until: '2027-12-31', created_at: '2026-09-01T00:00:00Z' }),
    ], 'termo', '2026-10-14')).toBe('2027-12-31')
  })
})
