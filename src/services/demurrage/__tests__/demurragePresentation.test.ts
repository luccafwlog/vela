import { describe, expect, it } from 'vitest'

import { formatBRL } from '../../../lib/utils'
import { fmtBRL, isPtaxWarningEligible } from '../demurragePresentation'

describe('fmtBRL', () => {
  it('preserva o placeholder nullish e delega valores ao formatador canônico', () => {
    expect(fmtBRL(null)).toBe('---')
    expect(fmtBRL(undefined)).toBe('---')
    expect(fmtBRL(1234.56)).toBe(formatBRL(1234.56))
  })
})

describe('isPtaxWarningEligible', () => {
  it('only allows the PTAX warning from 14:00 onward', () => {
    expect(isPtaxWarningEligible(new Date(2026, 6, 17, 13, 59))).toBe(false)
    expect(isPtaxWarningEligible(new Date(2026, 6, 17, 14, 0))).toBe(true)
  })
})

import { vi } from 'vitest'
import {
  agreementSituation,
  blBillingState,
  demurrageInvoiceNotices,
  discountPreview,
  freeTimeSource,
  invoiceNetUsd,
  earlierLiveInvoices,
} from '../demurragePresentation'
import type { DemurrageContainerRow } from '../demurrageContainers'

vi.mock('../demurrageRates', () => ({
  calculateDemurrage: (_type: string, _discharge: string, end: string) => ({
    total_days: 30, free_days: 10, days_p1: 20, rate_p1_usd: 10, days_p2: 0, rate_p2_usd: 20,
    total_usd: end === '2026-06-05' ? 0 : 200, status: end === '2026-06-05' ? 'within_free_time' : 'overdue',
  }),
}))

function box(id: number, options: { returned?: string | null; billed?: number[] } = {}): DemurrageContainerRow {
  return {
    id,
    bl_id: 'BL-1',
    container_number: `BOX${id}`,
    type: '20GP',
    discharge_date: '2026-06-01',
    return_date: options.returned === undefined ? '2026-07-01' : options.returned,
    demurrage_status: options.returned === null ? 'overdue' : 'returned',
    billed_in: (options.billed ?? []).map((invoiceId) => ({ id: invoiceId, doc_number: `DEM-${invoiceId}`, status: 'issued', bl_id: 'BL-1' })),
    bl: { id: 'BL-1', free_time_override: null } as never,
  } as DemurrageContainerRow
}

describe('blBillingState (Invoice por caixa, migration 214)', () => {
  it('primeira emissão quando nenhuma caixa tem Invoice e há sobreestadia', () => {
    expect(blBillingState([box(1), box(2)]).action).toBe('generate')
  })

  it('complementar só com as caixas ainda não cobradas', () => {
    const state = blBillingState([box(1, { billed: [9] }), box(2)])
    expect(state.action).toBe('complement')
    expect(state.uncovered.map((container) => container.container_number)).toEqual(['BOX2'])
    expect(state.invoices.map((ref) => ref.doc_number)).toEqual(['DEM-9'])
    expect(state.uncoveredUsd).toBe(200)
  })

  it('todas cobradas: nada a emitir, ainda que haja mais de uma Invoice', () => {
    const state = blBillingState([box(1, { billed: [9] }), box(2, { billed: [10] })])
    expect(state.action).toBe('covered')
    expect(state.invoices).toHaveLength(2)
  })

  it('caixa ainda fora espera a devolução', () => {
    const state = blBillingState([box(1), box(2, { returned: null })])
    expect(state.action).toBe('waiting')
    expect(state.stillOut).toBe(1)
  })

  it('devolvido no free time não tem o que faturar', () => {
    expect(blBillingState([box(1, { returned: '2026-06-05' })]).action).toBe('none')
  })
})

describe('freeTimeSource', () => {
  it('B/L vence o acordo, que vence a tabela (mesma ordem do banco)', () => {
    expect(freeTimeSource({ ...box(1), bl: { free_time_override: 30 } as never, customer_agreement: { id: 1, free_days: 28, p1_usd: null, p2_usd: null } })).toBe('bl')
    expect(freeTimeSource({ ...box(1), customer_agreement: { id: 1, free_days: 28, p1_usd: null, p2_usd: null } })).toBe('acordo')
    expect(freeTimeSource(box(1))).toBe('tabela')
  })
})

describe('demurrageInvoiceNotices', () => {
  const base = { status: 'issued', dunning_suspended_reason: null, dispute_open: false, roe_source: 'bcb_live' as const, paid_at: null }

  it('Invoice paga com datas alteradas: fora da Régua, tratar por restituição ou avulsa', () => {
    const notices = demurrageInvoiceNotices({ ...base, status: 'paid', paid_at: '2026-07-10', dunning_suspended_reason: 'Datas de container alteradas depois do pagamento; conferir a diferença.' })
    expect(notices.map((notice) => notice.key)).toEqual(['dates-paid'])
    expect(notices[0].text).toContain('restituição de Demurrage')
  })

  it('com desconto ou disputa: reemissão à mão (ADR 0079, decisão 1)', () => {
    const notices = demurrageInvoiceNotices({ ...base, dispute_open: true, dunning_suspended_reason: 'Datas de container alteradas em Invoice com desconto ou disputa; reemitir à mão.' })
    expect(notices.map((notice) => notice.key)).toEqual(['dates-negotiated', 'dispute'])
  })

  it('cancelada não mostra suspensão; cache de PTAX só na emitida não paga', () => {
    expect(demurrageInvoiceNotices({ ...base, status: 'cancelled', dunning_suspended_reason: 'x', roe_source: 'cached' as const })).toEqual([])
    expect(demurrageInvoiceNotices({ ...base, roe_source: 'cached' as const }).map((notice) => notice.key)).toEqual(['roe-cache'])
  })
})

describe('earlierLiveInvoices (Invoice complementar)', () => {
  const original = { id: 1, status: 'paid', created_at: '2026-07-01T10:00:00Z' }
  const cancelled = { id: 2, status: 'cancelled', created_at: '2026-07-02T10:00:00Z' }
  const complement = { id: 3, status: 'issued', created_at: '2026-07-05T10:00:00Z' }
  const third = { id: 4, status: 'issued', created_at: '2026-07-06T10:00:00Z' }

  it('a complementar aponta as Invoices vivas anteriores; a original não aponta nenhuma', () => {
    expect(earlierLiveInvoices(complement, [original, cancelled, complement]).map((i) => i.id)).toEqual([1])
    expect(earlierLiveInvoices(original, [original, cancelled, complement])).toEqual([])
    expect(earlierLiveInvoices(third, [third, complement, original]).map((i) => i.id)).toEqual([1, 3])
  })

  it('reemissão depois de cancelamento não é complementar', () => {
    expect(earlierLiveInvoices(complement, [cancelled, complement])).toEqual([])
  })

  it('emissões na mesma transação (mesmo created_at) desempatam pelo id', () => {
    const a = { id: 10, status: 'issued', created_at: '2026-07-05T10:00:00Z' }
    const b = { id: 11, status: 'issued', created_at: '2026-07-05T10:00:00Z' }
    expect(earlierLiveInvoices(b, [a, b]).map((i) => i.id)).toEqual([10])
    expect(earlierLiveInvoices(a, [a, b])).toEqual([])
  })
})

describe('desconto em USD antes da conversão', () => {
  it('percentual e valor fixo em centavos, como a RPC', () => {
    expect(discountPreview(1000, 'percent', '12,5')).toEqual({ totalUsd: 1000, discountUsd: 125, netUsd: 875 })
    expect(discountPreview(1000, 'fixed', 1500)).toMatchObject({ exceedsTotal: true })
    // Mesmo leitor do formulário: "1.000" é mil, não um dólar.
    expect(discountPreview(2000, 'fixed', '1.000')).toEqual({ totalUsd: 2000, discountUsd: 1000, netUsd: 1000 })
    expect(discountPreview(2000, 'fixed', '1.234,56')).toEqual({ totalUsd: 2000, discountUsd: 1234.56, netUsd: 765.44 })
    // A RPC arredonda o desconto (round(total × % / 100, 2)), não o líquido.
    expect(discountPreview(4350.1, 'percent', 5)?.netUsd).toBe(4132.59)
    expect(discountPreview(1.01, 'percent', 50)?.discountUsd).toBe(0.51)
    expect(discountPreview(1000, 'percent', '')).toBeNull()
  })

  it('sem desconto, o USD a cobrar é o total dos itens', () => {
    expect(invoiceNetUsd({ total_usd: 400, discount_mode: null, discount_value: null }).netUsd).toBe(400)
  })
})

describe('agreementSituation', () => {
  it('vigente, começa depois, encerrado e inativo', () => {
    expect(agreementSituation({ active: true, valid_from: '2026-01-01', valid_to: null }, '2026-10-12')).toBe('vigente')
    expect(agreementSituation({ active: true, valid_from: '2026-11-01', valid_to: null }, '2026-10-12')).toBe('futuro')
    expect(agreementSituation({ active: true, valid_from: '2026-01-01', valid_to: '2026-06-30' }, '2026-10-12')).toBe('encerrado')
    expect(agreementSituation({ active: false, valid_from: '2026-01-01', valid_to: null }, '2026-10-12')).toBe('inativo')
  })
})
