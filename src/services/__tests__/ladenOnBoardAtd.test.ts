import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeScheduleMocks = vi.hoisted(() => ({
  buildVoyagePolEntityId: vi.fn((voyageId: number, pol: string | null | undefined) => `${voyageId}::${String(pol ?? '').trim().toUpperCase() || '-'}`),
  listVoyagePolSchedules: vi.fn(),
  saveVoyagePolSchedule: vi.fn(),
}))

vi.mock('../voyageRouteSchedules', () => routeScheduleMocks)

import { applyLadenOnBoardAtd, resolveCanonicalPolAtd } from '../ladenOnBoardAtd'

beforeEach(() => {
  routeScheduleMocks.buildVoyagePolEntityId.mockClear()
  routeScheduleMocks.listVoyagePolSchedules.mockReset()
  routeScheduleMocks.saveVoyagePolSchedule.mockReset()
})

describe('resolveCanonicalPolAtd', () => {
  it('adota a menor data entre os B/Ls importados', () => {
    expect(resolveCanonicalPolAtd(null, ['2026-07-12', '2026-07-10', '2026-07-15'])).toBe('2026-07-10')
  })

  it('permite avançar o ATD quando a correção remove a menor data histórica', () => {
    expect(resolveCanonicalPolAtd('2026-07-08', ['2026-07-10'])).toBe('2026-07-10')
  })

  it('substitui quando chega data mais antiga', () => {
    expect(resolveCanonicalPolAtd('2026-07-10', ['2026-07-08'])).toBe('2026-07-08')
  })

  it('sem datas novas mantem o atual', () => {
    expect(resolveCanonicalPolAtd('2026-07-10', [])).toBe('2026-07-10')
    expect(resolveCanonicalPolAtd(null, [])).toBeNull()
  })
})

describe('applyLadenOnBoardAtd', () => {
  it('agrupa Laden on Board por Viagem+POL e salva apenas o menor ATD novo', async () => {
    routeScheduleMocks.listVoyagePolSchedules.mockResolvedValue(new Map([
      ['7::CNSHA', { entityId: '7::CNSHA', voyageId: 7, pol: 'CNSHA', etd: '2026-07-07', atd: '2026-07-10', escalaNumber: null }],
    ]))

    await applyLadenOnBoardAtd({
      changedBy: 'user-1',
      rows: [
        { voyageId: 7, ladenOnBoard: '2026-07-09', payload: { pol: 'CNSHA' } },
        { voyageId: 7, ladenOnBoard: '2026-07-08', payload: { pol: 'cnsha' } },
        { voyageId: 7, ladenOnBoard: null, payload: { pol: 'CNSHA' } },
        { voyageId: null, ladenOnBoard: '2026-07-01', payload: { pol: 'CNSHA' } },
        { voyageId: 7, ladenOnBoard: '2026-07-01', payload: null },
      ],
    })

    expect(routeScheduleMocks.listVoyagePolSchedules).toHaveBeenCalledWith(['7::CNSHA'])
    expect(routeScheduleMocks.saveVoyagePolSchedule).toHaveBeenCalledTimes(1)
    expect(routeScheduleMocks.saveVoyagePolSchedule).toHaveBeenCalledWith({
      voyageId: 7,
      pol: 'CNSHA',
      etd: '2026-07-07',
      atd: '2026-07-08',
      changedBy: 'user-1',
      justification: 'ATD derivado do Laden on Board do B/L (ADR 0025)',
    })
  })

  it('nao salva quando a reimportacao traz apenas datas posteriores ou iguais', async () => {
    routeScheduleMocks.listVoyagePolSchedules.mockResolvedValue(new Map([
      ['7::CNSHA', { entityId: '7::CNSHA', voyageId: 7, pol: 'CNSHA', etd: null, atd: '2026-07-08', escalaNumber: null }],
    ]))

    await applyLadenOnBoardAtd({
      changedBy: 'user-1',
      rows: [
        { voyageId: 7, ladenOnBoard: '2026-07-08', payload: { pol: 'CNSHA' } },
        { voyageId: 7, ladenOnBoard: '2026-07-10', payload: { pol: 'CNSHA' } },
      ],
    })

    expect(routeScheduleMocks.saveVoyagePolSchedule).not.toHaveBeenCalled()
  })
})
