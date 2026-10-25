import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/supabase', () => ({ supabase: {} }))

import { coverageRefetchDelay } from '../useCustomerCommunications'
import type { VoyageCommunicationCoverageSummary } from '../../services/customerCommunications'

// Melhoria 10: com Comunicado na fila, a Cobertura relê 90 s depois da
// próxima rodada (minutos ímpares desde a migration 458) para virar
// "enviado" sozinha.
const row = (state: 'na_fila' | 'enviado') => ({
  details: [{ customerId: 1, customerName: 'A', cells: {
    ce_mercante_taxas: { state, sentAt: null, communicationId: null, reason: null },
    aviso_chegada_noa: { state: 'nao_devido', sentAt: null, communicationId: null, reason: null },
    aviso_prontidao_nor: { state: 'nao_devido', sentAt: null, communicationId: null, reason: null },
    aviso_atracacao_nob: { state: 'nao_devido', sentAt: null, communicationId: null, reason: null },
  } }],
}) as unknown as VoyageCommunicationCoverageSummary

describe('coverageRefetchDelay', () => {
  it('relê depois da próxima rodada só quando há algo na fila', () => {
    const now = new Date('2026-10-20T19:05:00Z')
    expect(coverageRefetchDelay([row('na_fila')], now)).toBe(2 * 60_000 + 90_000)
    expect(coverageRefetchDelay([row('enviado')], now)).toBe(false)
    expect(coverageRefetchDelay(undefined, now)).toBe(false)
  })
})
