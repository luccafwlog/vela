import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportBestEffortFailure: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('../../../lib/telemetry', () => ({ reportBestEffortFailure: mocks.reportBestEffortFailure }))

import { __setDemurrageRateGroupsForTest, calculateDemurrage, ensureDemurrageRatesLoaded, type RateGroup } from '../demurrageRates'

// 20GP: free 21d · P1 [22,30]@30 USD/d · P2 [31,∞]@50 USD/d
// 40GP: free 21d · P1 [22,30]@60 USD/d · P2 [31,∞]@80 USD/d
// 20RF: free 10d · P1 [11,19]@95 USD/d · P2 [20,∞]@110 USD/d
const TEST_RATE_GROUPS: RateGroup[] = [
  { aliases: ['20GP', '20G0', '20HC', '20HQ', '22G1', '20G1'], freeUntil: 21, p1: { range: [22, 30], usd: 30 }, p2: { range: [31, Infinity], usd: 50 } },
  { aliases: ['40GP', '40G0', '40HC', '40HQ', '40G1', '42G1', '45G1'], freeUntil: 21, p1: { range: [22, 30], usd: 60 }, p2: { range: [31, Infinity], usd: 80 } },
  { aliases: ['20RF', '20RQ', '20R1'], freeUntil: 10, p1: { range: [11, 19], usd: 95 }, p2: { range: [20, Infinity], usd: 110 } },
]

function createRatesQuery(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

describe('calculateDemurrage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __setDemurrageRateGroupsForTest(TEST_RATE_GROUPS)
  })

  it('dentro do free time não gera cobrança', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-15') // 14 dias
    expect(r.total_days).toBe(14)
    expect(r.status).toBe('within_free_time')
    expect(r.total_usd).toBe(0)
    expect(r.free_days).toBe(14)
  })

  it('exatamente no limite do free time ainda é gratuito', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-22') // 21 dias
    expect(r.total_days).toBe(21)
    expect(r.status).toBe('within_free_time')
    expect(r.total_usd).toBe(0)
  })

  it('cobra apenas dias do período 1', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26') // 25 dias
    expect(r.total_days).toBe(25)
    expect(r.status).toBe('overdue')
    expect(r.days_p1).toBe(4) // dias 22..25
    expect(r.days_p2).toBe(0)
    expect(r.total_usd).toBe(4 * 30)
    expect(r.free_days).toBe(21)
  })

  it('cobra períodos 1 e 2 combinados', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-05') // 35 dias
    expect(r.total_days).toBe(35)
    expect(r.days_p1).toBe(9) // dias 22..30
    expect(r.days_p2).toBe(5) // dias 31..35
    expect(r.total_usd).toBe(9 * 30 + 5 * 50)
  })

  it('aplica tabela específica por tipo de container (40GP)', () => {
    const r = calculateDemurrage('40GP', '2026-01-01', '2026-01-26') // 25 dias
    expect(r.days_p1).toBe(4)
    expect(r.total_usd).toBe(4 * 60)
  })

  it('reefer tem free time menor (20RF: 10 dias)', () => {
    const r = calculateDemurrage('20RF', '2026-01-01', '2026-01-13') // 12 dias
    expect(r.status).toBe('overdue')
    expect(r.free_days).toBe(10)
    expect(r.days_p1).toBe(2) // dias 11..12
    expect(r.total_usd).toBe(2 * 95)
  })

  it('tipo desconhecido falha sem cair em tarifa arbitrária', () => {
    expect(() => calculateDemurrage('XXX9', '2026-01-01', '2026-01-26')).toThrow(/sem tarifa de Demurrage/)
  })

  it('override de free time recalcula P1 a partir de freeUntil+1', () => {
    // free 25 → P1 = [26, 30] (fim do P1 do grupo), P2 = [31, ∞]
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-29', 25) // 28 dias
    expect(r.free_days).toBe(25)
    expect(r.days_p1).toBe(3) // dias 26..28
    expect(r.total_usd).toBe(3 * 30)
  })

  it('override de free time maior que fim P1 resulta em P1 zero', () => {
    // free 30 → P1 = [31, 30] = vazio, P2 = [31, ∞]
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-05', 30) // 35 dias
    expect(r.free_days).toBe(30)
    expect(r.days_p1).toBe(0)
    expect(r.days_p2).toBe(5) // dias 31..35
    expect(r.total_usd).toBe(5 * 50)
  })

  it('override de free time além do fim de P1 não cobra dias livres como P2', () => {
    // free 33 (> fim P1 do grupo, 30) → cobrança começa no dia 34, direto em P2.
    // Dias 31..33 continuam livres pelo override e não podem virar P2.
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-10', 33) // 40 dias
    expect(r.free_days).toBe(33)
    expect(r.days_p1).toBe(0)
    expect(r.days_p2).toBe(7) // dias 34..40, não 31..40
    expect(r.total_usd).toBe(7 * 50)
  })

  it('override de free time menor expande P1', () => {
    // free 15 → P1 = [16, 30], P2 = [31, ∞]
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26', 15) // 25 dias
    expect(r.free_days).toBe(15)
    expect(r.days_p1).toBe(10) // dias 16..25
    expect(r.total_usd).toBe(10 * 30)
  })

  it('override de tarifa por dia (ov1) é aplicado', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26', null, 100)
    expect(r.days_p1).toBe(4)
    expect(r.rate_p1_usd).toBe(100)
    expect(r.total_usd).toBe(4 * 100)
  })

  it('ov1 = 0 permite taxa P1 zero', () => {
    const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-26', null, 0)
    expect(r.days_p1).toBe(4)
    expect(r.rate_p1_usd).toBe(0)
    expect(r.total_usd).toBe(0)
  })

  it('rejeita datas inválidas', () => {
    expect(() => calculateDemurrage('20GP', '', '2026-01-10')).toThrow()
    expect(() => calculateDemurrage('20GP', '2026-01-01', 'nao-e-data')).toThrow()
  })

  it('rejeita devolucao anterior a descarga', () => {
    expect(() => calculateDemurrage('20GP', '2026-01-10', '2026-01-09')).toThrow(/devolucao|descarga|return|discharge/i)
  })

  it('banco indisponível e sem cache falha explicitamente', async () => {
    __setDemurrageRateGroupsForTest(null)
    mocks.from.mockReturnValue(createRatesQuery({ data: null, error: new Error('offline') }))

    await expect(ensureDemurrageRatesLoaded()).rejects.toThrow(/Tarifas de Demurrage indisponíveis/)
    expect(mocks.reportBestEffortFailure).toHaveBeenCalled()
  })

  it('banco indisponível com cache previamente carregado mantém last-known-good', async () => {
    mocks.from.mockReturnValue(createRatesQuery({ data: null, error: new Error('offline') }))

    await expect(ensureDemurrageRatesLoaded(true)).resolves.toBeUndefined()
    expect(mocks.reportBestEffortFailure).toHaveBeenCalled()
    expect(calculateDemurrage('20GP', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 30)
  })

  it('resultado vazio do banco falha explicitamente sem cache', async () => {
    __setDemurrageRateGroupsForTest(null)
    mocks.from.mockReturnValue(createRatesQuery({ data: [], error: null }))

    await expect(ensureDemurrageRatesLoaded()).rejects.toThrow(/Tarifas de Demurrage indisponíveis/)
    expect(mocks.reportBestEffortFailure).toHaveBeenCalled()
  })

  it('o grupo da tarifa cobre os tipos do cadastro Tipos de container (ADR 0112, D29)', async () => {
    __setDemurrageRateGroupsForTest(null)
    const rates = [
      { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 30, p2_day_from: 31, p2_usd: 50 },
      { id: 2, container_type: '40GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 60, p2_day_from: 31, p2_usd: 80 },
      { id: 4, container_type: '40RF', free_days: 10, p1_day_from: 11, p1_day_to: 19, p1_usd: 190, p2_day_from: 20, p2_usd: 220 },
      { id: 6, container_type: '40FR', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 100, p2_day_from: 31, p2_usd: 140 },
    ]
    const types = [
      { code: '22G1', rate_group: '20GP', active: true },
      { code: '40HC', rate_group: '40GP', active: true },
      { code: '45R1', rate_group: '40RF', active: true },
      { code: '48FR', rate_group: '40FR', active: true },
      { code: '40FM', rate_group: '40FR', active: true },
      { code: '40FP', rate_group: '40FR', active: false },
    ]
    mocks.from.mockImplementation((table: string) => createRatesQuery({ data: table === 'container_types' ? types : rates, error: null }))

    await ensureDemurrageRatesLoaded(true)

    expect(calculateDemurrage('22G1', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 30)
    expect(calculateDemurrage('40HC', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 60)
    expect(calculateDemurrage('45R1', '2026-01-01', '2026-01-13').total_usd).toBe(2 * 190)
    // Os tipos dos B/Ls que não achavam tarifa cobram como 40' especial (D30).
    expect(calculateDemurrage('48FR', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 100)
    expect(calculateDemurrage(' 40fm ', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 100)
    // Tipo inativo ou fora do cadastro não tem tarifa.
    expect(() => calculateDemurrage('40FP', '2026-01-01', '2026-01-26')).toThrow(/sem tarifa de Demurrage/)
    expect(() => calculateDemurrage('45HC', '2026-01-01', '2026-01-26')).toThrow(/sem tarifa de Demurrage/)
  })

  it('tipo com código de grupo desativado também fica sem tarifa; os outros tipos do grupo seguem (migration 546)', async () => {
    __setDemurrageRateGroupsForTest(null)
    const rates = [
      { id: 1, container_type: '20GP', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 30, p2_day_from: 31, p2_usd: 50 },
      { id: 6, container_type: '40FR', free_days: 21, p1_day_from: 22, p1_day_to: 30, p1_usd: 100, p2_day_from: 31, p2_usd: 140 },
    ]
    const types = [
      { code: '20GP', rate_group: '20GP', active: false },
      { code: '20HC', rate_group: '20GP', active: true },
      { code: '40FR', rate_group: '40FR', active: true },
    ]
    mocks.from.mockImplementation((table: string) => createRatesQuery({ data: table === 'container_types' ? types : rates, error: null }))

    await ensureDemurrageRatesLoaded(true)

    expect(() => calculateDemurrage('20GP', '2026-01-01', '2026-01-26')).toThrow(/sem tarifa de Demurrage/)
    expect(calculateDemurrage('20HC', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 30)
    expect(calculateDemurrage('40FR', '2026-01-01', '2026-01-26').total_usd).toBe(4 * 100)
  })

  describe('hierarquia com acordos customizados do cliente', () => {
    it('aplica free time customizado do acordo do cliente quando B/L não tem override', () => {
      // Acordo: 28 dias free time. Sem taxas personalizadas (herda P1/P2 padrão).
      // Descarga 01/01, Devolução 30/01 (29 dias) -> 28 dias livres, 1 dia em P1 (dia 29) a 30 USD
      const agreement = { free_days: 28, p1_usd: null, p2_usd: null }
      const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-30', null, null, null, agreement)

      expect(r.total_days).toBe(29)
      expect(r.free_days).toBe(28)
      expect(r.status).toBe('overdue')
      expect(r.days_p1).toBe(1)
      expect(r.rate_p1_usd).toBe(30)
      expect(r.days_p2).toBe(0)
      expect(r.total_usd).toBe(30)
    })

    it('aplica free time e tarifas P1/P2 do acordo do cliente', () => {
      // Acordo: 25 dias free time, P1=20 USD/dia, P2=40 USD/dia.
      // Descarga 01/01, Devolução 05/02 (35 dias) -> 25 dias livres, P1 [26..30] (5 dias a 20 USD), P2 [31..35] (5 dias a 40 USD)
      const agreement = { free_days: 25, p1_usd: 20, p2_usd: 40 }
      const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-05', null, null, null, agreement)

      expect(r.total_days).toBe(35)
      expect(r.free_days).toBe(25)
      expect(r.days_p1).toBe(5)
      expect(r.rate_p1_usd).toBe(20)
      expect(r.days_p2).toBe(5)
      expect(r.rate_p2_usd).toBe(40)
      expect(r.total_usd).toBe(5 * 20 + 5 * 40) // 100 + 200 = 300
    })

    it('override no B/L tem precedência total sobre o acordo do cliente', () => {
      // Acordo: 28 dias free, P1=20, P2=40
      // B/L Override: 30 dias free, P1=15, P2=35
      // Descarga 01/01, Devolução 05/02 (35 dias) -> usa 30 dias free do B/L, P1=0 (fim P1=30), P2 [31..35] (5 dias a 35 USD)
      const agreement = { free_days: 28, p1_usd: 20, p2_usd: 40 }
      const r = calculateDemurrage('20GP', '2026-01-01', '2026-02-05', 30, 15, 35, agreement)

      expect(r.free_days).toBe(30)
      expect(r.days_p1).toBe(0)
      expect(r.days_p2).toBe(5)
      expect(r.rate_p2_usd).toBe(35)
      expect(r.total_usd).toBe(5 * 35)
    })

    it('override parcial no B/L (somente free time) combina com tarifas do acordo do cliente', () => {
      // Acordo: 25 dias free, P1=22, P2=42
      // B/L Override: apenas free_time=27 dias (sem ov1 nem ov2)
      // Descarga 01/01, Devolução 31/01 (30 dias) -> free=27, P1 [28..30] (3 dias a 22 USD do acordo)
      const agreement = { free_days: 25, p1_usd: 22, p2_usd: 42 }
      const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-31', 27, null, null, agreement)

      expect(r.free_days).toBe(27)
      expect(r.days_p1).toBe(3)
      expect(r.rate_p1_usd).toBe(22)
      expect(r.rate_p2_usd).toBe(42)
      expect(r.total_usd).toBe(3 * 22)
    })

    it('override parcial no B/L (somente tarifa P1) combina com free time do acordo do cliente', () => {
      // Acordo: 28 dias free, P1=20, P2=40
      // B/L Override: apenas ov1=18 (sem free time override nem ov2)
      // Descarga 01/01, Devolução 30/01 (29 dias) -> free=28 do acordo, 1 dia P1 a 18 USD (do B/L), P2 a 40 USD (do acordo)
      const agreement = { free_days: 28, p1_usd: 20, p2_usd: 40 }
      const r = calculateDemurrage('20GP', '2026-01-01', '2026-01-30', null, 18, null, agreement)

      expect(r.free_days).toBe(28)
      expect(r.days_p1).toBe(1)
      expect(r.rate_p1_usd).toBe(18)
      expect(r.rate_p2_usd).toBe(40)
      expect(r.total_usd).toBe(18)
    })
  })
})
