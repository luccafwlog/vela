import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, supabasePortal } = vi.hoisted(() => {
  const rpc = vi.fn()
  return { rpc, supabasePortal: { rpc } }
})

vi.mock('../supabase', () => ({
  supabasePortal,
}))

import { normalizePortalOperationRows, portalListOperationBls } from '../portalOperation'

beforeEach(() => {
  rpc.mockReset()
})

describe('portalOperation', () => {
  it('normaliza B/Ls operacionais e converte numeros vindos do RPC', () => {
    const rows = normalizePortalOperationRows([
      {
        bl_id: 'BL001',
        ce_mercante: '123456789012345',
        pol: 'CNSHA',
        pod: 'BRVIX',
        voyage_id: '10',
        voyage_number: '001W',
        vessel_name: 'NAVIO TESTE',
        transshipment: {
          omission_id: '9', disposition: 'transshipment', omitted_pod: 'VITÓRIA', discharge_pod: 'SANTOS',
          onward_vessel_name: 'COSCO STAR', onward_carrier: 'COSCO', onward_voyage_number: 'T-1',
          onward_etd: '2026-07-20', onward_eta: null,
        },
        container_count: '2',
        containers_in_demurrage: '1',
        containers_returned: '1',
        containers: [
          {
            id: '7',
            container_number: 'ABCD1234567',
            type: '40GP',
            discharge_date: '2026-06-01',
            return_date: '2026-06-20',
            usage_days: '19',
            free_time_days: '21',
            demurrage_days: '0',
            status: 'devolvido',
          },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        bl_id: 'BL001',
        ce_mercante: '123456789012345',
        pol: 'CNSHA',
        pod: 'BRVIX',
        voyage_id: 10,
        voyage_number: '001W',
        vessel_name: 'NAVIO TESTE',
        transshipment: {
          omission_id: 9, disposition: 'transshipment', omitted_pod: 'VITÓRIA', discharge_pod: 'SANTOS',
          onward_vessel_name: 'COSCO STAR', onward_carrier: 'COSCO', onward_voyage_number: 'T-1',
          onward_etd: '2026-07-20', onward_eta: null,
        },
        container_count: 2,
        containers_in_demurrage: 1,
        containers_returned: 1,
        containers: [
          {
            id: 7,
            container_number: 'ABCD1234567',
            type: '40GP',
            discharge_date: '2026-06-01',
            return_date: '2026-06-20',
            usage_days: 19,
            free_time_days: 21,
            demurrage_days: 0,
            status: 'devolvido',
          },
        ],
        cargo_mode: null,
        bb_weight_ton: null,
        bb_packages_qty: null,
      },
    ])
  })

  it('normaliza B/Ls operacionais com dados de carga mista', () => {
    const rows = normalizePortalOperationRows([
      {
        bl_id: 'BL-MISTO',
        cargo_mode: 'misto',
        bb_weight_ton: '15.75',
        bb_packages_qty: '12',
        container_count: '1',
      },
    ])

    expect(rows[0]).toMatchObject({
      bl_id: 'BL-MISTO',
      cargo_mode: 'misto',
      bb_weight_ton: 15.75,
      bb_packages_qty: 12,
      container_count: 1,
    })
  })

  it('usa defaults quando o RPC traz containers e contadores nulos', () => {
    const rows = normalizePortalOperationRows([
      {
        bl_id: 'BL002',
        ce_mercante: null,
        pol: null,
        pod: null,
        voyage_id: null,
        voyage_number: null,
        vessel_name: null,
        container_count: null,
        containers_in_demurrage: null,
        containers_returned: null,
        containers: null,
      },
    ])

    expect(rows[0]).toMatchObject({
      bl_id: 'BL002',
      ce_mercante: null,
      container_count: 0,
      containers_in_demurrage: 0,
      containers_returned: 0,
      containers: [],
    })
  })

  it('chama portal_list_operation_bls pelo cliente Supabase do portal', async () => {
    rpc.mockImplementationOnce(function (this: unknown) {
      expect(this).toBe(supabasePortal)
      return Promise.resolve({
        data: [{
          bl_id: 'BL001',
          containers: [],
          transshipment: {
            omission_id: 9,
            disposition: 'transshipment',
            omitted_pod: 'VITÓRIA',
            discharge_pod: 'SANTOS',
            reason: 'justificativa interna',
            onward_vessel_name: 'COSCO STAR',
            onward_carrier: 'COSCO',
            onward_voyage_number: 'T-1',
            onward_etd: '2026-07-20T00:00:00Z',
            onward_eta: '2026-07-22T00:00:00Z',
          },
        }],
        error: null,
      })
    })

    const rows = await portalListOperationBls()

    expect(rpc).toHaveBeenCalledWith('portal_list_operation_bls')
    expect(rows[0]?.bl_id).toBe('BL001')
    expect(rows[0]?.transshipment).toMatchObject({
      disposition: 'transshipment',
      onward_vessel_name: 'COSCO STAR',
      onward_etd: '2026-07-20T00:00:00Z',
    })
    expect(rows[0]?.transshipment && 'reason' in rows[0].transshipment).toBe(false)
  })

  it('propaga erro retornado pelo RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('RPC falhou') })

    await expect(portalListOperationBls()).rejects.toThrow('RPC falhou')
  })
})
