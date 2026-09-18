import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLocalChargeConferenceRows } from '../charges/chargeOperationsService'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: { from: mockFrom, rpc: vi.fn() },
}))

describe('buildLocalChargeConferenceRows', () => {
  let blContainersCallCount = 0

  beforeEach(() => {
    mockFrom.mockReset()
    blContainersCallCount = 0
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: vi.fn((cols: string) => {
            if (cols === 'id, voyage_id') {
              // Achado 7 da review da PR 501: busca os B/Ls container-mode da
              // viagem primeiro, para filtrar cargo_mode e evitar depender do
              // formato de uma relacao aninhada bl_containers->bls.
              return {
                in: vi.fn(() => ({
                  in: vi.fn(() =>
                    Promise.resolve({
                      data: [
                        { id: 'BL1', voyage_id: 10 },
                        { id: 'BL2', voyage_id: 10 },
                      ],
                      error: null,
                    }),
                  ),
                })),
              }
            }
            return {
              in: vi.fn(() =>
                Promise.resolve({
                  data: [{ id: 'BL1', pod: 'BRVIX', voyage_id: 10, customer: { name: 'Cliente X' } }],
                  error: null,
                }),
              ),
            }
          }),
        }
      }
      if (table === 'charge_calculations') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              in: vi.fn(() => ({
                gt: vi.fn(() =>
                  Promise.resolve({
                    data: [
                      {
                        bl_id: 'BL1',
                        quantity: 1,
                        unit_value_brl: 100,
                        total_value_brl: 100,
                        override_applied: false,
                        calculation_key: 'auto:item:1',
                        charge_item: { name: 'THD', application_basis: 'container_distinct_voyage' },
                      },
                    ],
                    error: null,
                  }),
                ),
              })),
            })),
          })),
        }
      }
      if (table === 'bl_containers') {
        return {
          select: vi.fn(() => {
            blContainersCallCount += 1
            const isFirstCall = blContainersCallCount === 1
            return {
              in: vi.fn(() =>
                Promise.resolve({
                  data: isFirstCall
                    ? [{ bl_id: 'BL1', container_number: 'CSCU1234567' }]
                    : [
                        { bl_id: 'BL1', container_number: 'CSCU1234567' },
                        { bl_id: 'BL2', container_number: 'CSCU1234567' },
                      ],
                  error: null,
                }),
              ),
            }
          }),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })
  })

  it('monta uma linha por item calculado com origem do preço e container compartilhado', async () => {
    const rows = await buildLocalChargeConferenceRows(['BL1'])

    expect(rows).toEqual([
      {
        bl_id: 'BL1',
        customer_name: 'Cliente X',
        pod: 'BRVIX',
        charge_name: 'THD',
        application_basis: 'container_distinct_voyage',
        quantity: 1,
        unit_value_brl: 100,
        total_value_brl: 100,
        price_origin: 'Tabela padrão',
        shared_containers: 'CSCU1234567 (2 B/Ls)',
      },
    ])
  })

  it('retorna vazio sem B/Ls', async () => {
    expect(await buildLocalChargeConferenceRows([])).toEqual([])
  })
})
