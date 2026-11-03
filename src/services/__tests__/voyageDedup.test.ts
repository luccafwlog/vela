import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ ilike: vi.fn(), rows: [] as unknown[] }))

vi.mock('../supabase', () => {
  const builder = {
    select: () => builder,
    ilike: (...args: unknown[]) => {
      calls.ilike(...args)
      return builder
    },
    overrideTypes: () => Promise.resolve({ data: calls.rows, error: null }),
  }
  return { supabase: { from: () => builder } }
})

import { findVoyageByNumberAndVessel } from '../voyages'

describe('findVoyageByNumberAndVessel - escape do ilike', () => {
  beforeEach(() => {
    calls.ilike.mockReset()
    calls.rows = []
  })

  it('escapa metacaracteres LIKE do numero de viagem', async () => {
    await findVoyageByNumberAndVessel('50%_A', '', 'NAVIO')
    expect(calls.ilike).toHaveBeenCalledWith('voyage_number', '50\\%\\_A')
  })
})

describe('findVoyageByNumberAndVessel - IMO gravado fora do formato (568)', () => {
  beforeEach(() => {
    calls.rows = []
  })

  it('acha a Viagem do navio com o nome no campo IMO: a planilha atualiza, não cria outra', async () => {
    calls.rows = [{ id: 15, voyage_number: '015N', vessel: { name: 'COSCO SHIPPING ROSE', imo: 'COSCO SHIPPING ROSE' } }]
    await expect(findVoyageByNumberAndVessel('015N', '9900019', 'COSCO SHIPPING ROSE')).resolves.toBe(15)
  })

  it('IMO gravado válido e diferente continua sendo outro navio', async () => {
    calls.rows = [{ id: 15, voyage_number: '015N', vessel: { name: 'COSCO SHIPPING ROSE', imo: 'IMO 9900020' } }]
    await expect(findVoyageByNumberAndVessel('015N', '9900019', 'COSCO SHIPPING ROSE')).resolves.toBeNull()
  })
})
