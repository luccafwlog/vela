import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [] as Array<{ id: number; voyage_number: string; vessel: { name: string | null; imo: string | null } | null }> }))

vi.mock('../supabase', () => {
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  builder.select = () => builder
  builder.ilike = () => builder
  builder.overrideTypes = () => Promise.resolve({ data: state.rows, error: null })
  return { supabase: { from: () => builder } }
})

import { findVoyageByNumberAndVessel } from '../voyages'

describe('voyage identity S03', () => {
  beforeEach(() => {
    state.rows = []
  })

  it('IMO prevalece sobre grafia (ZYHY vs canônico)', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'ZHONG YUAN HAI YUN JIN QU', imo: '1234567' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '1234567', 'ZYHY JIN QU')).resolves.toBe(1)
  })

  it('aceita IMO rotulado mesmo quando o nome diverge', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'REGISTERED NAME', imo: '1234567' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', 'IMO: 1234567', 'PLANILHA NAME')).resolves.toBe(1)
  })

  it('prioriza o IMO exato antes do fallback de nome sem IMO', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'ZYHY JIN QU', imo: null } },
      { id: 2, voyage_number: '14', vessel: { name: 'ZHONG YUAN HAI YUN JIN QU', imo: '1234567' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '1234567', 'M/V ZYHY JIN QU')).resolves.toBe(2)
  })

  it('IMOs distintos nunca fundem', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: '1111111' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '2222222', 'GREEN SANTOS')).resolves.toBeNull()
  })

  it('sem IMO usa fallback nominal para um único navio já identificado', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: '1111111' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '', 'GREEN SANTOS')).resolves.toBe(1)
  })

  it('conflito explícito em vez de .find arbitrário', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: null } },
      { id: 2, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: null } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '', 'GREEN SANTOS')).rejects.toThrow(/ambígua/)
  })

  it('não usa fallback sem IMO quando ele conflita com outro cadastro identificado', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: null } },
      { id: 2, voyage_number: '14', vessel: { name: 'GREEN SANTOS', imo: '1111111' } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '2222222', 'GREEN SANTOS')).resolves.toBeNull()
  })

  it('CSCL não casa com COSCO por prefixo', async () => {
    state.rows = [
      { id: 1, voyage_number: '14', vessel: { name: 'COSCO SHIPPING ALGOL', imo: null } },
    ]
    await expect(findVoyageByNumberAndVessel('14', '', 'CSCL VENUS')).resolves.toBeNull()
  })
})
