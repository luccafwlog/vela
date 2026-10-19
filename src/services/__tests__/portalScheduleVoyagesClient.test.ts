import { beforeEach, describe, expect, it, vi } from 'vitest'

const { internalRpc, portalRpc } = vi.hoisted(() => ({ internalRpc: vi.fn(), portalRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc: internalRpc }, supabasePortal: { rpc: portalRpc } }))

import { fetchInternalScheduleVoyages, fetchPortalScheduleVoyages } from '../portalScheduleVoyages'

const row = { voyage_id: 7, vessel_name: 'A', voyage: '1', imo_number: null, port_code: 'BRSSA', kind: 'pod', date_value: '2026-01-22' }

// Desde a migration 320 (ADR 0090) `anon` não executa portal_ship_schedule:
// cada tela precisa chamar pelo cliente que tem a sua sessão.
describe('cliente da programação de navios', () => {
  beforeEach(() => {
    internalRpc.mockReset().mockResolvedValue({ data: [row], error: null })
    portalRpc.mockReset().mockResolvedValue({ data: [row], error: null })
  })

  it('/chegadas-saidas lê com a sessão interna, nunca pelo cliente do Portal', async () => {
    const voyages = await fetchInternalScheduleVoyages()
    expect(internalRpc).toHaveBeenCalledWith('portal_ship_schedule')
    expect(portalRpc).not.toHaveBeenCalled()
    expect(voyages.map((voyage) => voyage.voyageId)).toEqual([7])
  })

  it('o Portal lê com a sessão do Cliente', async () => {
    await fetchPortalScheduleVoyages()
    expect(portalRpc).toHaveBeenCalledWith('portal_ship_schedule')
    expect(internalRpc).not.toHaveBeenCalled()
  })

  it('erro da RPC interna chega à tela', async () => {
    internalRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(fetchInternalScheduleVoyages()).rejects.toMatchObject({ code: '42501' })
  })
})
