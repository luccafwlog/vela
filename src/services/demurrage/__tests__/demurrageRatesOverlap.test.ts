import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  reactivate: vi.fn(),
}))

vi.mock('../../supabase', () => ({
  supabase: { from: mocks.from },
}))
vi.mock('../../deleteRecords', () => ({
  deleteOneById: vi.fn(),
  reactivateCatalogRow: mocks.reactivate,
}))

import { toggleDemurrageRateActive, upsertDemurrageRate } from '../demurrageRates'

// O que o PostgREST devolve quando a tarifa nova colide com a vigente do grupo
// (`demurrage_rates_one_per_group`, migration 514; ADR 0112 D28).
const overlap = { code: '23P01', message: 'conflicting key value violates exclusion constraint "demurrage_rates_one_per_group"' }
const rate = { container_type: '40GP', free_days: 14, p1_day_from: 15, p1_day_to: 30, p1_usd: 70, p2_day_from: 31, p2_usd: 90, valid_from: '2027-01-01' }

function tables(upsertError: unknown, groupName: string | null) {
  mocks.from.mockImplementation((table: string) => table === 'demurrage_rates'
    ? { upsert: vi.fn().mockResolvedValue({ error: upsertError }) }
    : {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: groupName ? { name: groupName } : null, error: null }),
          })),
        })),
      })
}

beforeEach(() => {
  mocks.from.mockReset()
  mocks.reactivate.mockReset()
})

describe('tarifa sobreposta no grupo (ADR 0112 D28)', () => {
  it('a segunda tarifa ativa do grupo diz o grupo e o caminho, não o texto do Postgres', async () => {
    tables(overlap, "40' dry")
    await expect(upsertDemurrageRate(rate)).rejects.toThrow("Já existe tarifa vigente para o grupo 40' dry: feche a vigência da atual antes.")
  })

  it('sem o nome do grupo, usa o código', async () => {
    tables(overlap, null)
    await expect(upsertDemurrageRate(rate)).rejects.toThrow('Já existe tarifa vigente para o grupo 40GP: feche a vigência da atual antes.')
  })

  it('reativar a tarifa com outra vigente no grupo também explica', async () => {
    mocks.reactivate.mockRejectedValue(overlap)
    await expect(toggleDemurrageRateActive(9, true, 'Tarifa voltou a valer'))
      .rejects.toThrow('Já existe tarifa vigente para o mesmo grupo nesse período: feche a vigência da atual antes de reativar esta.')
  })

  it('outra recusa do banco segue como veio', async () => {
    const other = { code: '23514', message: 'Faixas inválidas.' }
    tables(other, "40' dry")
    await expect(upsertDemurrageRate(rate)).rejects.toBe(other)
  })
})
