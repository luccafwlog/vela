import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'
import { financeWorld } from './frenteFinanceira'

// Migration 493 (ADR 0111, D8 e D9; lote 3): alterar, excluir e isentar as
// Taxas Locais de B/L faturado passam pela correção automática da fatura. A
// fatura emitida nunca é editada: sem pagamento ela é reemitida; paga com valor
// menor abate e restitui; paga com valor maior abre Fatura desatualizada. O
// efeito fica no Histórico das taxas e a prévia diz o mesmo antes de gravar.

const w = financeWorld(9493)
const JUST = 'Acordo comercial com o Cliente'
const q = (value: string) => `'${value.replace(/'/g, "''")}'`
let item = 0
const key = () => `auto:item:${item}`

function extraCleanup() {
  w.psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_local_charge_exemptions WHERE bl_id LIKE '${w.prefix}%';
    DELETE FROM public.bl_charge_adjustment_events WHERE bl_id LIKE '${w.prefix}%';
    UPDATE public.charge_calculations SET adjustment_id = NULL WHERE bl_id LIKE '${w.prefix}%';
    DELETE FROM public.bl_charge_adjustments WHERE bl_id LIKE '${w.prefix}%';
    DELETE FROM public.customer_portal_accounts WHERE auth_user_id = '${PORTAL_USER}';
    DELETE FROM auth.users WHERE id = '${PORTAL_USER}';
    SET session_replication_role = origin;
  `)
}

const alter = (id: string, unit: number) =>
  w.as('operacoes', `SELECT public.alter_bl_charge_value(${q(id)}, ${q(key())}, 'unit', ${unit}, ${q(JUST)}, '${w.actors.operacoes}'::uuid)`)
const preview = (id: string, action: string, extra = 'NULL, NULL, NULL') =>
  w.json<Record<string, unknown>>('operacoes', `SELECT public.preview_bl_charge_change_effect(${q(id)}, ${q(action)}, ${extra}, ${q(JUST)})`)
const lastEffect = (id: string) => JSON.parse(w.psql(`SELECT coalesce(invoice_effect, 'null'::jsonb) FROM public.bl_charge_adjustment_events
  WHERE bl_id = ${q(id)} ORDER BY id DESC LIMIT 1`)) as { summary?: string; situation?: string; result?: Record<string, unknown> } | null
const PORTAL_USER = '00000000-0000-0000-9493-000000000099'
const numberOf = (invoice: number) => w.psql(`SELECT invoice_number FROM public.invoices WHERE id = ${invoice}`)

let ce = 949300000000000
function billed(name: string) {
  const id = w.createBl(name)
  w.calculate(id)
  const invoice = w.issueByCe(id, String(++ce))
  expect(w.invoice(invoice).total).toBe(300)
  return { id, invoice }
}

const describeLocal = describeWithProbe(() => {
  if (process.env.LOCAL_PG_INTEGRATION !== '1') return false
  try {
    return w.psql(`SELECT to_regprocedure('public.preview_bl_charge_change_effect(text,text,text,text,numeric,text)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}, 'migration 493 (preview_bl_charge_change_effect)')

describeLocal('493 — taxa alterada no B/L faturado', () => {
  beforeAll(() => {
    extraCleanup()
    w.setup()
    item = w.table(300)[1]
  })
  afterAll(() => {
    extraCleanup()
    w.cleanup()
  })

  it('sem pagamento: a prévia avisa a reemissão e a alteração cancela e reemite a fatura', () => {
    const { id, invoice } = billed('RE')
    const p = preview(id, 'alter', `${q(key())}, 'unit', 250`)
    expect(p).toMatchObject({ situation: 'reissue', current_brl: 300, new_brl: 250 })
    expect(p.message).toBe(`A fatura ${numberOf(invoice)} (R$ 300,00) será cancelada e reemitida com número novo, no valor de R$ 250,00. O Cliente recebe o aviso no Portal e um Pix novo.`)
    // A prévia não grava nada.
    expect(w.invoice(invoice).status).not.toBe('cancelled')
    expect(w.psql(`SELECT count(*) FROM public.bl_charge_adjustments WHERE bl_id = ${q(id)}`)).toBe('0')

    const run = alter(id, 250)
    expect(run.status, run.stderr).toBe(0)
    expect(w.invoice(invoice).status).toBe('cancelled')
    const next = w.successorOf(invoice)!
    expect(w.invoice(next).total).toBe(250)
    expect(lastEffect(id)?.summary).toBe(`${numberOf(invoice)} cancelada e reemitida como ${numberOf(next)}`)
    // D9: o item da fatura nova guarda a alteração, que o Portal não lê.
    expect(w.psql(`SELECT snapshot_payload->'charge_adjustment'->>'kind' FROM public.invoice_items WHERE invoice_id = ${next}`)).toBe('unit')
    const vela = w.asOk('administrativo', `SELECT jsonb_path_query_array(public.list_invoice_details(${next}), '$.items[*].snapshot_payload.charge_adjustment.kind')`)
    expect(vela.split('\n').at(-1)).toBe('["unit"]')
    w.psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${PORTAL_USER}', 'p493@example.test', 'authenticated', 'authenticated');
      INSERT INTO public.customer_portal_accounts (customer_id, active, auth_user_id, provisioning_decision, account_situation, recovery_email, portal_email, login_cnpj)
      SELECT id, true, '${PORTAL_USER}', 'aprovado_para_provisionar', 'ativo', 'p493@example.test', 'p493@example.test', cnpj_cpf
        FROM public.customers WHERE id = ${w.customerId}
      ON CONFLICT (customer_id) DO UPDATE SET active = true, auth_user_id = EXCLUDED.auth_user_id, account_situation = 'ativo', credentials_revoked_at = NULL`)
    const portal = w.psql(`SET request.jwt.claim.sub = '${PORTAL_USER}'; SET request.jwt.claim.role = 'authenticated';
      SELECT set_config('request.jwt.claims', '{"sub":"${PORTAL_USER}","role":"authenticated"}', false);
      SELECT public.portal_invoice_details(${next})::text`).split('\n').at(-1) ?? ''
    expect(portal).toContain('"items"')
    expect(portal).toContain('250')
    expect(portal).not.toContain('charge_adjustment')
  })

  it('o Recalcular continua recusando o B/L faturado', () => {
    const { id } = billed('RC')
    expect(() => w.calculate(id)).toThrow(/ja foi faturado/)
  })

  it('paga com valor menor: abate o saldo e o resto vira Restituição', () => {
    const { id, invoice } = billed('PM')
    w.pay(invoice, 200)
    const p = preview(id, 'alter', `${q(key())}, 'unit', 50`)
    expect(p).toMatchObject({ situation: 'refund', offset_brl: 100, refund_brl: 150 })
    const run = alter(id, 50)
    expect(run.status, run.stderr).toBe(0)
    expect(lastEffect(id)?.summary).toBe('Abatido R$ 100,00 do saldo; Restituição de R$ 150,00')
  })

  it('paga com valor maior: abre Fatura desatualizada e a diferença vai por avulsa', () => {
    const { id, invoice } = billed('PX')
    w.pay(invoice, 300)
    const p = preview(id, 'alter', `${q(key())}, 'unit', 400`)
    expect(p).toMatchObject({ situation: 'stale', diff_brl: 100 })
    const run = alter(id, 400)
    expect(run.status, run.stderr).toBe(0)
    expect(w.invoice(invoice).status).toBe('paid')
    expect(lastEffect(id)?.summary).toBe('Fatura desatualizada: diferença de R$ 100,00 a cobrar por avulsa')
  })

  it('isentar sem pagamento cancela a fatura sem nova; com pagamento, tudo vira Restituição', () => {
    const free = billed('IS')
    expect(preview(free.id, 'exempt')).toMatchObject({ situation: 'cancel' })
    const run = w.as('operacoes', `SELECT public.exempt_bl_local_charges(${q(free.id)}, ${q(JUST)}, '${w.actors.operacoes}'::uuid)`)
    expect(run.status, run.stderr).toBe(0)
    expect(w.invoice(free.invoice).status).toBe('cancelled')
    expect(w.successorOf(free.invoice)).toBeNull()
    expect(lastEffect(free.id)?.summary).toBe(`${numberOf(free.invoice)} cancelada sem nova fatura (B/L isento)`)

    const paid = billed('IP')
    w.pay(paid.invoice, 300)
    expect(preview(paid.id, 'exempt')).toMatchObject({ situation: 'refund', offset_brl: 0, refund_brl: 300 })
    const paidRun = w.as('operacoes', `SELECT public.exempt_bl_local_charges(${q(paid.id)}, ${q(JUST)}, '${w.actors.operacoes}'::uuid)`)
    expect(paidRun.status, paidRun.stderr).toBe(0)
    expect(lastEffect(paid.id)?.summary).toBe('Restituição de R$ 300,00')
  })

  // 497: a prévia segue a mesma ordem de decisão da correção automática.
  it('reemissão travada pelo Portal: a prévia diz o mesmo que a correção', () => {
    const { id, invoice } = billed('GT')
    w.psql(`UPDATE public.customer_portal_accounts SET active = false WHERE customer_id = ${w.customerId}`)
    w.closeGate()
    try {
      const p = preview(id, 'alter', `${q(key())}, 'unit', 250`)
      expect(p).toMatchObject({ situation: 'blocked', invoice_id: invoice })
      expect(p.message).toMatch(/não pode ser reemitida agora \(Portal do Cliente não está pronto/)
      const run = alter(id, 250)
      expect(run.status, run.stderr).toBe(0)
      expect(w.invoice(invoice).status).not.toBe('cancelled')
      expect(lastEffect(id)?.summary).toMatch(/^Correção pendente: Portal do Cliente não está pronto/)
    } finally {
      w.openGate()
      w.psql(`UPDATE public.customer_portal_accounts SET active = true WHERE customer_id = ${w.customerId}`)
    }
  })

  it('consolidada paga em parte: a prévia abate e restitui o mesmo que a correção', () => {
    const a = billed('CA')
    const b = billed('CB')
    const consolidated = w.consolidate([a.id, b.id])
    w.pay(consolidated, 400)
    // O B/L que ainda tem saldo: a correção abate primeiro o saldo dele.
    const open = [a, b].find((x) => Number(w.psql(`SELECT balance_brl FROM public.bl_receivables
      WHERE bl_id = ${q(x.id)} AND source = 'local_charges'`)) > 0)!
    const p = preview(open.id, 'alter', `${q(key())}, 'unit', 50`)
    const run = alter(open.id, 50)
    expect(run.status, run.stderr).toBe(0)
    const real = lastEffect(open.id)?.result as { status: string; offset_brl: number; refund_brl: number }
    expect(real.status).toBe('corrected')
    expect(Number(real.offset_brl)).toBeGreaterThan(0)
    expect(p).toMatchObject({ situation: 'refund', offset_brl: Number(real.offset_brl), refund_brl: Number(real.refund_brl) })
  })

  it('consolidada sem pagamento: a prévia fala da fatura do B/L e da consolidada que volta', () => {
    const a = billed('KA')
    const b = billed('KB')
    const consolidated = w.consolidate([a.id, b.id])
    const p = preview(a.id, 'alter', `${q(key())}, 'unit', 250`)
    expect(p).toMatchObject({ situation: 'reissue', invoice_id: a.invoice, current_brl: 300, new_brl: 250 })
    expect(p.message).toBe(`A fatura ${numberOf(a.invoice)} (R$ 300,00) será cancelada e reemitida com número novo, no valor de R$ 250,00. `
      + `A consolidada ${numberOf(consolidated)} volta só com os mesmos B/Ls. O Cliente recebe o aviso no Portal e um Pix novo.`)
    const run = alter(a.id, 250)
    expect(run.status, run.stderr).toBe(0)
    const next = w.successorOf(a.invoice)!
    expect(w.invoice(next).total).toBe(250)
    expect(lastEffect(a.id)?.summary).toBe(`${numberOf(a.invoice)} cancelada e reemitida como ${numberOf(next)}`)
    expect(w.invoice(b.invoice).status).not.toBe('cancelled')
  })

  it('isentar B/L de consolidada sem pagamento: a prévia diz que a consolidada encerra, como a correção', () => {
    const a = billed('XA')
    const b = billed('XB')
    const consolidated = w.consolidate([a.id, b.id])
    const p = preview(a.id, 'exempt')
    expect(p).toMatchObject({ situation: 'cancel', invoice_id: a.invoice })
    expect(p.message).toBe(`A fatura ${numberOf(a.invoice)} será cancelada, sem nova fatura. A consolidada ${numberOf(consolidated)} `
      + 'é encerrada sem reemissão; os demais B/Ls seguem pelas individuais. O Cliente vê a fatura em Canceladas no Portal.')
    const run = w.as('operacoes', `SELECT public.exempt_bl_local_charges(${q(a.id)}, ${q(JUST)}, '${w.actors.operacoes}'::uuid)`)
    expect(run.status, run.stderr).toBe(0)
    expect(w.invoice(a.invoice).status).toBe('cancelled')
    expect(w.successorOf(a.invoice)).toBeNull()
    expect(w.invoice(consolidated).status).toBe('cancelled')
    expect(w.successorOf(consolidated)).toBeNull()
    expect(w.invoice(b.invoice).status).toBe('issued')
  })

  it('a prévia mostra a mesma recusa da ação e não toca a fatura', () => {
    const { id, invoice } = billed('EQ')
    const run = w.as('operacoes', `SELECT public.preview_bl_charge_change_effect(${q(id)}, 'alter', ${q(key())}, 'unit', 300, ${q(JUST)})`)
    expect(run.stderr).toMatch(/O valor é igual ao atual: nada a alterar/)
    expect(w.invoice(invoice).status).not.toBe('cancelled')
  })

  // 494 (lote 4): a leitura da Validação, da consolidada e da ficha do Cliente.
  it('o resumo por B/L traz a taxa alterada, a isenção à mão e o autor, por B/L ou por Cliente', () => {
    const rows = JSON.parse(w.asOk('operacoes', `SELECT coalesce(jsonb_agg(to_jsonb(s.*)), '[]') FROM public.list_bl_charge_adjustment_summaries(NULL, ${w.customerId}) s`)
      .split('\n').at(-1) ?? '[]') as Array<{ bl_id: string; manual_exempt: boolean; items: Array<Record<string, unknown>>; last_actor_name: string | null }>
    const byBl = new Map(rows.map((row) => [row.bl_id, row]))
    expect(byBl.get(w.bl('RE'))?.items).toEqual([expect.objectContaining({ charge_name: expect.any(String), kind: 'unit', excluded: false, unit: 250, table_unit: 300 })])
    expect(byBl.get(w.bl('IS'))).toMatchObject({ manual_exempt: true })
    expect(byBl.get(w.bl('RE'))?.last_actor_name).toBeTruthy()
    // B/L sem alteração não aparece; a lista por B/L só traz os pedidos.
    expect(byBl.has(w.bl('RC'))).toBe(false)
    const one = w.asOk('operacoes', `SELECT count(*) FROM public.list_bl_charge_adjustment_summaries(ARRAY['${w.bl('PM')}'], NULL)`)
    expect(one.split('\n').at(-1)).toBe('1')
    expect(w.as('operacoes', 'SELECT * FROM public.list_bl_charge_adjustment_summaries(NULL, NULL)').stderr).toMatch(/Informe os B\/Ls ou o Cliente/)
  })
})
