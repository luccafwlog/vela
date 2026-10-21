import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// F-12 do plano da frente financeira (ADR 0093, decisão 12; migration 362):
// cancelar a fatura solta o B/L, e a nova fatura só sai pelo Emitir — nem a
// Liberação, nem o efeito da planilha de CE, nem a troca de CE emitem sozinhos.

const w = financeWorld(9305)

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT position('invoice_cancelled_awaiting_emitir' IN prosrc) > 0 FROM pg_proc WHERE proname = '_auto_bill_bl_core'`) === 't'
  } catch {
    return false
  }
}, 'migration 362 aplicada')

describeLocal('362 — fatura cancelada solta o B/L', () => {
  beforeAll(() => {
    w.setup()
    w.table(300)
  })
  afterAll(() => w.cleanup())

  const liveCount = (id: string) => Number(w.psql(`SELECT count(*) FROM public.invoice_bls ib JOIN public.invoices i ON i.id = ib.invoice_id
    WHERE ib.bl_id = '${id}' AND i.status <> 'cancelled'`))

  it('depois de cancelar a fatura, o B/L pode ser cancelado', () => {
    const id = w.createBl('CX')
    w.calculate(id)
    const invoice = w.issueByCe(id, '936200000000001')
    w.asOk('administrativo', `SELECT public.cancel_invoice(${invoice}, 'Cancelada no teste', NULL)`)
    w.cancelBl(id)
    expect(w.psql(`SELECT cancelled_at IS NOT NULL FROM public.bls WHERE id = '${id}'`)).toBe('t')
  })

  it('efeito da planilha de CE, Liberação e troca de CE não emitem de novo; o Emitir emite', () => {
    const id = w.createBl('EM')
    w.calculate(id)
    const invoice = w.issueByCe(id, '936200000000002')
    w.asOk('administrativo', `SELECT public.cancel_invoice(${invoice}, 'Cancelada no teste', NULL)`)
    expect(liveCount(id)).toBe(0)

    const effect = JSON.parse(w.psql(`SELECT public._run_import_effect_local_charges('${id}', '${w.actors.administrativo}'::uuid)`)) as { results: Array<{ status: string; reason?: string }> }
    expect(effect.results[0]).toMatchObject({ status: 'skipped', reason: 'invoice_cancelled_awaiting_emitir' })
    w.closeGate()
    w.openGate()
    w.psql(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${id}', '936200000000003', '${w.actors.administrativo}'::uuid); END $$`)
    expect(liveCount(id)).toBe(0)

    // Revisão das importações, item 2b: desvincular e vincular o Cliente de novo
    // (gatilho do vínculo com CE) também não emite.
    w.psql(`UPDATE public.bls SET customer_id = NULL, customer_reconciliation_status = 'missing_customer' WHERE id = '${id}'`)
    w.psql(`UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'matched_document' WHERE id = '${id}'`)
    expect(liveCount(id)).toBe(0)

    w.asOk('administrativo', `SELECT public.mark_bl_ready_and_create_invoice('${id}')`)
    expect(liveCount(id)).toBe(1)
  })

  // ADR 0094, C1: vincular Cliente a B/L que já tem CE emite na hora; o B/L cuja
  // fatura foi cancelada só sai pelo Emitir (caso acima, item 2b).
  it('C1: vincular Cliente a B/L com CE emite a fatura na hora', () => {
    const id = w.createBl('C1', { customerId: null })
    w.calculate(id)
    w.psql(`DO $$ BEGIN PERFORM public.apply_ce_mercante_update('${id}', '936200000000011', '${w.actors.administrativo}'::uuid); END $$`)
    expect(liveCount(id)).toBe(0)
    w.asOk('operacoes', `UPDATE public.bls SET customer_id = ${w.customerId}, customer_reconciliation_status = 'reconciled' WHERE id = '${id}'`)
    expect(liveCount(id)).toBe(1)
  })

  // ADR 0094, C2: reativar reabre os efeitos encerrados no cancelamento; o
  // local_billing reaberto do B/L com fatura cancelada devolve skipped.
  it('C2: reativar o B/L reabre o efeito local_billing, que não emite a fatura cancelada', () => {
    const id = w.createBl('C2')
    w.calculate(id)
    const invoice = w.issueByCe(id, '936200000000012')
    w.asOk('administrativo', `SELECT public.cancel_invoice(${invoice}, 'Cancelada no teste', NULL)`)
    w.cancelBl(id)
    const effect = w.psql(`INSERT INTO public.import_pending_effects (source_action_id, effect_kind, entity_id, status, result, created_by)
      VALUES (gen_random_uuid(), 'local_billing', '${id}', 'superseded', '{"reason": "bl_cancelled"}'::jsonb, '${w.actors.administrativo}') RETURNING id`)
    w.asOk('administrativo', `SELECT public.reactivate_bl('${id}', 'Cancelado por engano')`)
    expect(w.psql(`SELECT status FROM public.import_pending_effects WHERE id = ${effect}`)).toBe('pending')
    const run = JSON.parse(w.psql(`SELECT public._run_import_effect_local_charges('${id}', '${w.actors.administrativo}'::uuid)`)) as { results: Array<{ status: string; reason?: string }> }
    expect(run.results[0]).toMatchObject({ status: 'skipped', reason: 'invoice_cancelled_awaiting_emitir' })
    expect(liveCount(id)).toBe(0)
  })
})
