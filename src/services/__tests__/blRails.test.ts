import { describe, expect, it } from 'vitest'
import {
  buildDocumentalRail,
  buildOperationalRail,
  pickNextAction,
  summarizeDocumentalRail,
} from '../blRails'

const baseBl = {
  id: 'BL1',
  voyage_id: 7,
  cargo_mode: 'container',
  ce_mercante: null,
  review_status: 'pending_review',
  customer_reconciliation_status: 'missing_customer',
  customer_id: null,
  charge_status: 'not_calculated',
  financial_status: 'pending',
  billing_hold_reason: null,
} as Parameters<typeof buildDocumentalRail>[0]['bl']

function makeBl(overrides: Partial<typeof baseBl> = {}) {
  return { ...baseBl, ...overrides }
}

function makeDocumental(overrides: Partial<typeof baseBl> = {}, input: Partial<Parameters<typeof buildDocumentalRail>[0]> = {}) {
  return buildDocumentalRail({
    bl: makeBl(overrides),
    latestInvoice: null,
    demurrageInvoices: [],
    portalVisibility: { visible: true, reasons: [] },
    ...input,
  })
}

describe('B/L rails', () => {
  it('mantem saida pendente sem ATD e mostra ETD como detalhe', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: { etd: '2026-07-01', atd: null }, podSchedule: { eta: '2026-07-20', ata: null }, containers: [], omission: null })
    expect(rail[0]).toMatchObject({ key: 'pol', state: 'pending', detail: expect.stringMatching(/ETD/) })
  })

  it('marca POD como desviado quando ha omissao', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: { etd: null, atd: '2026-07-02' }, podSchedule: null, containers: [], omission: { omittedPod: 'VITORIA', dischargePod: 'SANTOS' } })
    expect(rail[1]).toMatchObject({ key: 'pod', state: 'diverted' })
    expect(rail[1].detail).toMatch(/SANTOS/)
  })

  it('conta descarga e devolucao por container distinto', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: null, podSchedule: null, omission: null, containers: [
      { container_number: 'ABCD1234567', discharge_date: '2026-07-21', return_date: '2026-07-25' },
      { container_number: 'ABCD7654321', discharge_date: '2026-07-21', return_date: null },
    ] })
    expect(rail[2].detail).toBe('2/2 descarregados')
    expect(rail[3].detail).toBe('1/2 devolvidos')
  })

  it('não deixa etapas sem containers pendentes como 0/0', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: null, podSchedule: null, omission: null, containers: [] })
    expect(rail[2]).toMatchObject({ detail: 'Sem containers', state: 'done' })
    expect(rail[3]).toMatchObject({ detail: 'Sem containers', state: 'done' })
  })

  it('expõe exatamente os quatro cards documentais e não usa revisão como estado', () => {
    const rail = makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'reconciled',
      customer_id: 9,
      charge_status: 'calculated',
    }, { portalVisibility: { visible: true, reasons: [] } })

    expect(rail.slice(0, 4).map((stage) => stage.key)).toEqual(['customer', 'charges', 'ce', 'invoice'])
    expect(rail.slice(0, 4).map((stage) => stage.label)).toEqual(['Cliente', 'Taxas Locais', 'CE Mercante', 'Fatura'])
    expect(rail.some((stage) => /revisão|revisado/i.test(`${stage.label} ${stage.detail}`))).toBe(false)
    expect(rail.some((stage) => stage.key === 'payment')).toBe(false)
  })

  it('mapeia cliente ausente e reconciliação pendente para o card Cliente', () => {
    expect(makeDocumental().find((stage) => stage.key === 'customer')).toMatchObject({
      state: 'blocked',
      detail: 'Sem cliente vinculado',
      href: '/revisao?bl=BL1',
    })

    expect(makeDocumental({
      customer_id: 9,
      customer_reconciliation_status: 'matched_name',
      review_status: 'pending_review',
    }).find((stage) => stage.key === 'customer')).toMatchObject({
      state: 'blocked',
      detail: 'Pendente de reconciliação',
    })
  })

  it('marca o cliente como apto quando vínculo, reconciliação e Portal estão resolvidos', () => {
    expect(makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'matched_document',
      customer_id: 9,
    }, { portalVisibility: { visible: true, reasons: [] } }).find((stage) => stage.key === 'customer')).toMatchObject({
      state: 'done',
      detail: 'Cliente apto',
    })
  })

  it('não transforma o bloqueio de CE do Portal em uma pendência de Cliente', () => {
    const rail = makeDocumental({
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      charge_status: 'calculated',
      review_status: 'reviewed',
    }, {
      latestInvoice: { id: 55, status: 'paid', total_brl: 100, invoice_type: 'individual' },
      portalVisibility: { visible: false, reasons: ['CE Mercante ausente'] },
    })

    expect(rail.find((stage) => stage.key === 'customer')).toMatchObject({ state: 'done', detail: 'Cliente apto' })
    expect(rail.find((stage) => stage.key === 'ce')).toMatchObject({ state: 'blocked' })
    expect(summarizeDocumentalRail(rail)).toEqual({ pendingCount: 1, label: '1 pendência' })
  })

  it('não distingue cálculo automático de manual e exibe o estado documental das taxas', () => {
    expect(makeDocumental({ charge_status: 'not_calculated' }).find((stage) => stage.key === 'charges')).toMatchObject({
      state: 'pending',
      detail: 'Não calculado',
    })
    expect(makeDocumental({ charge_status: 'calculated' }).find((stage) => stage.key === 'charges')).toMatchObject({
      state: 'done',
      detail: 'Calculado',
    })
    expect(makeDocumental({ charge_status: 'exempt' }).find((stage) => stage.key === 'charges')).toMatchObject({
      state: 'done',
      detail: 'Isento',
    })
    expect(makeDocumental({ charge_status: 'review_required' }, { reviewReasons: ['Peso BB ausente'] }).find((stage) => stage.key === 'charges')).toMatchObject({
      state: 'blocked',
      detail: 'Bloqueado · Peso BB ausente',
    })
  })

  it('direciona peso BB ausente de carga solta para Taxas Locais mesmo com notas obsoletas', () => {
    const rail = makeDocumental({
      cargo_mode: 'carga_solta',
      bb_weight_ton: null,
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      review_status: 'pending_review',
      charge_status: 'calculated',
    })

    expect(rail.find((stage) => stage.key === 'charges')).toMatchObject({
      state: 'blocked',
      detail: 'Bloqueado · Peso BB ausente',
    })
    expect(rail.find((stage) => stage.key === 'customer')).toMatchObject({ state: 'done', detail: 'Cliente apto' })
    expect(pickNextAction(rail)?.key).toBe('charges')
  })

  it('falha fechado no card Cliente enquanto a prontidao do Portal nao foi carregada', () => {
    const rail = makeDocumental({
      ce_mercante: 'CE-1',
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      charge_status: 'calculated',
      review_status: 'reviewed',
    }, { portalVisibility: null })

    expect(rail.find((stage) => stage.key === 'customer')).toMatchObject({
      state: 'blocked',
      detail: 'Conta do Portal não está ativa/provisionada',
    })
  })

  it('não expõe o termo legado de revisão quando a pendência do cálculo não tem motivo detalhado', () => {
    const rail = makeDocumental({
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      charge_status: 'review_required',
      review_status: 'reviewed',
    })

    expect(rail.find((stage) => stage.key === 'charges')).toMatchObject({ detail: 'Bloqueado · Cálculo pendente' })
    expect(rail.some((stage) => /revis/i.test(`${stage.label} ${stage.detail}`))).toBe(false)
  })

  it.each(['container', 'carga_solta'])('trata CE ausente como bloqueio de emissão e Portal para %s', (cargoMode) => {
    const ce = makeDocumental({ cargo_mode: cargoMode, customer_id: 9, customer_reconciliation_status: 'reconciled' })
      .find((stage) => stage.key === 'ce')
    expect(ce).toMatchObject({ state: 'blocked' })
    expect(ce?.detail).toMatch(/bloqueia emissão e Portal/i)
  })

  it('trata CE em branco como ausente', () => {
    expect(makeDocumental({ ce_mercante: '   ' }).find((stage) => stage.key === 'ce')).toMatchObject({ state: 'blocked' })
  })

  it.each([
    ['draft', 'Rascunho', 'pending'],
    ['issued', 'Emitida', 'done'],
    ['partially_paid', 'Parcialmente paga', 'done'],
    ['paid', 'Paga', 'done'],
    ['covered', 'Coberta', 'done'],
    ['cancelled', 'Cancelada', 'blocked'],
    ['obsolete', 'Obsoleta', 'blocked'],
    ['overdue', 'Emitida', 'done'],
  ] as const)('apresenta o estado de fatura %s sem vencimento', (status, label, state) => {
    const invoice = makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'reconciled',
      customer_id: 9,
      charge_status: 'calculated',
    }, {
      portalVisibility: { visible: true, reasons: [] },
      latestInvoice: { id: 55, invoice_number: 'INV-55', status, total_brl: 100, invoice_type: 'individual' },
    }).find((stage) => stage.key === 'invoice')

    expect(invoice).toMatchObject({ state, detail: expect.stringContaining(label) })
    expect(invoice?.detail.toLowerCase()).not.toContain('venc')
  })

  it('identifica uma fatura consolidada sem criar um card de pagamento', () => {
    const rail = makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'reconciled',
      customer_id: 9,
      charge_status: 'ready_for_billing',
    }, {
      portalVisibility: { visible: true, reasons: [] },
      latestInvoice: { id: 2048, invoice_number: null, status: 'paid', total_brl: 100, invoice_type: 'consolidated' },
    })

    expect(rail.find((stage) => stage.key === 'invoice')).toMatchObject({ state: 'done', detail: '#2048 · Paga · Consolidada' })
    expect(rail.map((stage) => stage.key)).not.toContain('payment')
  })

  it('rotula uma fatura avulsa no card da fatura', () => {
    const rail = makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'reconciled',
      customer_id: 9,
      charge_status: 'calculated',
    }, {
      portalVisibility: { visible: true, reasons: [] },
      latestInvoice: { id: 2050, invoice_number: 'INV-AV-2050', status: 'issued', total_brl: 100, invoice_type: 'manual' },
    })

    expect(rail.find((stage) => stage.key === 'invoice')).toMatchObject({
      detail: '#INV-AV-2050 · Emitida · Avulsa',
    })
  })

  it('conta apenas os cards documentais bloqueantes e ignora Demurrage na próxima ação', () => {
    const rail = makeDocumental({
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      charge_status: 'calculated',
      review_status: 'reviewed',
    }, { demurrageInvoices: [{ id: 7, status: 'issued' }] })
    const summary = summarizeDocumentalRail(rail)

    expect(summary).toEqual({ pendingCount: 2, label: '2 pendências' })
    expect(pickNextAction(rail)?.key).toBe('ce')
  })

  it('considera o trilho documental resolvido mesmo com Demurrage pendente', () => {
    const rail = makeDocumental({
      ce_mercante: '123',
      review_status: 'reviewed',
      customer_reconciliation_status: 'reconciled',
      customer_id: 9,
      charge_status: 'ready_for_billing',
    }, {
      portalVisibility: { visible: true, reasons: [] },
      latestInvoice: { id: 55, status: 'paid', total_brl: 100, invoice_type: 'individual' },
      demurrageInvoices: [{ id: 7, status: 'issued' }],
    })

    expect(summarizeDocumentalRail(rail)).toEqual({ pendingCount: 0, label: 'Sem pendências' })
    expect(pickNextAction(rail)).toBeNull()
  })

  it('classifica pendências com underscore para os cards corretos (ce_mercante, no_table)', () => {
    const rail = makeDocumental({
      ce_mercante: null,
      customer_id: 9,
      customer_reconciliation_status: 'reconciled',
      charge_status: 'review_required',
      review_status: 'reviewed',
    }, {
      portalVisibility: { visible: true, reasons: [] },
      reviewReasons: ['ce_mercante', 'no_table'],
    })

    expect(rail.find((stage) => stage.key === 'customer')).toMatchObject({ state: 'done', detail: 'Cliente apto' })
    expect(rail.find((stage) => stage.key === 'charges')).toMatchObject({ state: 'blocked', detail: 'Bloqueado · Tabela não encontrada' })
    expect(rail.find((stage) => stage.key === 'ce')).toMatchObject({ state: 'blocked' })
  })
})
