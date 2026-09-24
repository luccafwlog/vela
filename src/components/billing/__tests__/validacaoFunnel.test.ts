import { describe, expect, it } from 'vitest'
import { getBillingBlock, getBillingBlockReason, isAwaitingCeMercante, isBlLockedForRecalc, isPendingBillingReview } from '../validacaoPipeline'

const base = { customer_reconciliation_status: 'matched_document', financial_status: 'pending', charge_status: 'calculated', review_status: null, notes: null, billing_hold_reason: null, customer_reconciliation_notes: null, charge_exemption_reason: null, ce_mercante: null as string | null, cargo_mode: 'container', customer: { id: 1 }, totals: { total_brl: 100, line_count: 1, review_required_count: 0 } }
describe('billing blocks', () => {
  it('classifica container calculado sem CE como aguardando_ce', () => expect(getBillingBlock(base).code).toBe('aguardando_ce'))
  // Decisão de 2026-09-23 (ADR 0042): o banco exige CE para emitir em todo modo
  // faturável; a fila não pode chamar de pronto o que a emissão vai recusar.
  it('classifica carga solta sem CE como aguardando_ce', () => expect(getBillingBlock({ ...base, cargo_mode: 'carga_solta' }).code).toBe('aguardando_ce'))
  it('classifica misto sem CE como aguardando_ce', () => expect(getBillingBlock({ ...base, cargo_mode: 'misto' }).code).toBe('aguardando_ce'))
  it('libera carga solta com CE para emissão', () => expect(getBillingBlock({ ...base, cargo_mode: 'carga_solta', ce_mercante: '152605123456789' }).code).toBe('pronto'))
  it('classifica Granito como apoio operacional sem depender de CE', () => expect(getBillingBlock({ ...base, cargo_mode: 'granito' }).code).toBe('operacao_granito'))
  it('mantém Granito operacional mesmo quando há CE', () => expect(getBillingBlock({ ...base, cargo_mode: 'granito', ce_mercante: '122605051526081' }).code).toBe('operacao_granito'))
  it('prioriza causa estrutural sobre hold livre', () => expect(getBillingBlock({ ...base, customer: null, billing_hold_reason: 'texto livre' }).code).toBe('sem_cliente'))
  it('prioriza hold de cálculo sobre Aguardando CE', () => expect(getBillingBlock({ ...base, ce_mercante: null, billing_hold_reason: 'review:no_table' }).code).toBe('calculo_incompleto'))
  it('mantem o detalhe na API legada', () => expect(getBillingBlockReason({ ...base, review_status: 'pending_review', notes: 'Pendencias de importacao: Portal' })).toContain('Revis'))
  it('separa faturado e isento', () => { expect(getBillingBlock({ ...base, financial_status: 'invoiced' }).code).toBe('faturado'); expect(getBillingBlock({ ...base, charge_status: 'exempt' }).code).toBe('isento') })
})

// Gate de Portal (ADR 0054, migrations 337/367/368): a pendencia canonica vive
// em `notes`, escrita pela save_bl_review. O `billing_hold_reason` do gate
// nunca chegou ao disco — o UPDATE morria no rollback da excecao, e a 368 o
// removeu. Antes disto a pendencia aparecia como "Calculo incompleto", rotulo
// errado para um calculo que esta completo.
describe('bloqueio por portal não provisionado', () => {
  const withCe = { ...base, ce_mercante: '122605051526081' }
  const portalNotes = 'Pendencias de importacao: Acesso ao portal nao provisionado'

  it('nomeia o motivo quando o portal é a única pendência', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', notes: portalNotes })
    expect(block.code).toBe('portal_nao_provisionado')
    expect(block.label).toBe('Portal não provisionado')
  })

  it('não trata como problema de cálculo: totais e linhas seguem íntegros', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', notes: portalNotes })
    expect(block.code).not.toBe('calculo_incompleto')
  })

  it('cede a vez a pendências que não são do portal', () => {
    const block = getBillingBlock({
      ...withCe,
      review_status: 'pending_review',
      notes: 'Pendencias de importacao: Cliente sem e-mail cadastrado, Acesso ao portal nao provisionado',
    })
    expect(block.code).toBe('calculo_incompleto')
  })

  // Regressao: um hold proprio do B/L (gravado pela save_bl_review) com notas de
  // portal era lido como "so o portal", escondia o hold real e rotulava errado.
  it('não confunde hold próprio do B/L com pendência de portal', () => {
    const hold = 'B/L sem linhas faturaveis. Recalcule as taxas antes de faturar.'
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', notes: portalNotes, billing_hold_reason: hold })
    expect(block.code).toBe('calculo_incompleto')
    expect(block.detail).toBe(hold)
  })

  // ADR 0070: o CE sem Portal retém a fatura e grava o motivo no B/L, com a
  // revisão já concluída (sem notas de pendência).
  it('reconhece a retenção do CE sem Portal gravada no B/L', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'reviewed', notes: null, billing_hold_reason: 'Acesso ao portal nao provisionado' })
    expect(block.code).toBe('portal_nao_provisionado')
  })

  it('não esconde pendência de revisão atrás da retenção do Portal', () => {
    const block = getBillingBlock({
      ...withCe,
      review_status: 'pending_review',
      notes: 'Pendencias de importacao: Cliente sem e-mail cadastrado',
      billing_hold_reason: 'Acesso ao portal nao provisionado',
    })
    expect(block.code).toBe('calculo_incompleto')
  })

  it('fica atrás do CE Mercante na precedência', () => {
    const block = getBillingBlock({ ...base, ce_mercante: null, review_status: 'pending_review', notes: portalNotes })
    expect(block.code).toBe('aguardando_ce')
  })

  it('fica atrás do cliente não vinculado', () => {
    const block = getBillingBlock({ ...withCe, customer: null, review_status: 'pending_review', notes: portalNotes })
    expect(block.code).toBe('sem_cliente')
  })

  it('não bloqueia quem tem cálculo com linhas em revisão de verdade', () => {
    const block = getBillingBlock({ ...withCe, review_status: 'pending_review', notes: portalNotes, totals: { total_brl: 100, line_count: 2, review_required_count: 1 } })
    expect(block.code).toBe('calculo_incompleto')
  })
})
describe('legacy predicates', () => {
  it('reconhece revisão pendente', () => expect(isPendingBillingReview(base)).toBe(true))
  it('trava financeiros faturados', () => expect(isBlLockedForRecalc('invoiced')).toBe(true))
  it('reconhece aguardando CE', () => expect(isAwaitingCeMercante(base)).toBe(true))
  it('conta carga solta sem CE no backlog de aguardando CE', () => expect(isAwaitingCeMercante({ ...base, cargo_mode: 'carga_solta' })).toBe(true))
  it('não conta Granito com CE no backlog de aguardando CE', () => expect(isAwaitingCeMercante({ ...base, cargo_mode: 'granito', ce_mercante: '122605051526081' })).toBe(false))
  it('não conta Granito sem CE no backlog de aguardando CE', () => expect(isAwaitingCeMercante({ ...base, cargo_mode: 'granito', ce_mercante: null })).toBe(false))
})
