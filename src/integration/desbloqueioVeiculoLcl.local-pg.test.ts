// Migration 575 (decisão do dono de 2026-11-03): o B/L de veículo LCL com Taxas
// Locais isentas é desbloqueado só com a entrega do B/L original. Não precisa
// de termo, de procuração nem de solicitação no Portal; o desk registra a
// entrega e exporta para a ZPT com as quatro colunas "Sim". A isenção à mão
// continua dispensando só o pagamento. Cada cenário roda numa transação
// desfeita no fim.
import { execPsql } from './localPsql'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { syntheticCnpj } from './localTestData'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const customer = 998575
const admin = '00000000-0000-0000-0000-000000575001'
const client = '00000000-0000-0000-0000-000000575002'
const ce = '998575000000101'

function sql(q: string): string {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim()
}
function error(q: string): string {
  try { sql(q); return '' } catch (e) { return String((e as { stderr: string }).stderr) }
}
const last = (out: string) => JSON.parse(out.split('\n').at(-1) ?? 'null')
const lines = (out: string) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l))

type Bl = { movement: string | null; vehicle: boolean; cargoMode?: string; chargeStatus?: string }

/** B/L com CE, liberado no Portal, isento e com (ou sem) veículo; tudo desfeito no ROLLBACK. */
function blFixture(bl: Bl) {
  return `
    SET LOCAL session_replication_role=replica;
    INSERT INTO public.bls(id,voyage_id,customer_id,ce_mercante,cargo_mode,movement_to,charge_status)
      VALUES('CE575-A',${customer},${customer},'${ce}','${bl.cargoMode ?? 'container'}',${bl.movement ? `'${bl.movement}'` : 'NULL'},'${bl.chargeStatus ?? 'exempt'}');
    ${bl.vehicle ? `INSERT INTO public.bl_containers(id,bl_id,container_number,type) VALUES(998575,'CE575-A','TSTU5750001','40HC');
      INSERT INTO public.vehicles(voyage_id,container_id,bl_id,chassis,brand,model,weight_kg,cbm) VALUES(${customer},998575,'CE575-A','CE575CHASSI0001','Marca','Modelo',1500,10);` : ''}
    SET LOCAL session_replication_role=origin;`
}
const asAdmin = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${admin}';`
const asClient = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${client}';`
const delivery = (version: number) =>
  `public.ce_unlock_command('delivery',jsonb_build_object('bl_id','CE575-A','delivered',true,'expected_version',${version},'request_key',gen_random_uuid()))`
const exportZpt = `public.ce_unlock_command('export',jsonb_build_object('bl_ids',jsonb_build_array('CE575-A'),'request_key',gen_random_uuid()))`

local('desbloqueio CE — veículo LCL isento só com o B/L original (migration 575)', () => {
  const cleanup = () => sql(`SET session_replication_role=replica;
    DELETE FROM ce_unlock_private.receipts WHERE actor_id IN('${admin}','${client}');
    DELETE FROM public.ce_unlock_events WHERE actor_id IN('${admin}','${client}');
    DELETE FROM public.ce_unlock_direct_exports WHERE bl_id LIKE 'CE575-%';
    DELETE FROM public.ce_unlock_exports WHERE created_by='${admin}';
    DELETE FROM public.ce_unlock_bl_deliveries WHERE bl_id LIKE 'CE575-%';
    DELETE FROM public.vehicles WHERE bl_id LIKE 'CE575-%';
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'CE575-%';
    DELETE FROM public.bls WHERE id LIKE 'CE575-%';
    DELETE FROM public.customer_portal_accounts WHERE customer_id=${customer};
    DELETE FROM public.voyages WHERE id=${customer}; DELETE FROM public.vessels WHERE id=${customer}; DELETE FROM public.carriers WHERE id=${customer};
    DELETE FROM public.customers WHERE id=${customer};
    DELETE FROM public.user_profiles WHERE id='${admin}';
    DELETE FROM auth.users WHERE id IN('${client}','${admin}');
    SET session_replication_role=origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users(id,email) VALUES('${client}','ce575@example.test'),('${admin}','ce575-admin@example.test');
      INSERT INTO public.user_profiles(id,full_name,role,active) VALUES('${admin}','CE575 admin','administrativo',true);
      INSERT INTO public.customers(id,cnpj_cpf,name) VALUES(${customer},'${syntheticCnpj(57501)}','CE 575');
      INSERT INTO public.customer_portal_accounts(customer_id,auth_user_id,active,account_situation) VALUES(${customer},'${client}',true,'ativo')
        ON CONFLICT(customer_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id,active=true,account_situation='ativo';
      INSERT INTO public.carriers(id,name) VALUES(${customer},'CE575 carrier');
      INSERT INTO public.vessels(id,name,carrier_id) VALUES(${customer},'CE575 vessel',${customer});
      INSERT INTO public.voyages(id,vessel_id,voyage_number,status) VALUES(${customer},${customer},'CE-575','active');`)
  })
  afterAll(cleanup)

  it('sem solicitação e sem documentos: a entrega do original deixa o B/L apto e a exportação manda quatro "Sim"', () => {
    const [before, delivered, exported, after, ready, directRow] = lines(sql(`BEGIN; ${blFixture({ movement: 'CFS/LCL', vehicle: true })}
      SELECT ce_unlock_private.item('CE575-A');
      ${asAdmin}
      SELECT ${delivery(0)};
      SELECT ${exportZpt};
      RESET ROLE;
      SELECT ce_unlock_private.item('CE575-A');
      SELECT ce_unlock_private.list(NULL,'{"situation":"ready"}',1)->'items';
      SELECT to_jsonb(d) - 'exported_by' - 'exported_at' - 'export_id' FROM public.ce_unlock_direct_exports d WHERE d.bl_id='CE575-A';
      ROLLBACK;`))
    expect(before).toMatchObject({ documents_dispensed: true, direct: true, termo: true, procuracao: true, paid: true, paid_exempt: true,
      delivered: false, can_submit: false, can_export: false, request_id: null, state: 'no_request', sla_started_at: null })
    expect(before.reasons).toEqual(['B/L físico aguardando entrega'])
    expect(delivered).toMatchObject({ delivered: true, can_export: true, reasons: [] })
    expect(delivered.sla_started_at).not.toBeNull()
    // As quatro colunas da planilha da ZPT saem "Sim" (zptRows em ceUnlockRules.ts).
    expect(exported.rows).toEqual([{ bl_id: 'CE575-A', termo: true, procuracao: true, delivered: true, paid: true }])
    expect(after).toMatchObject({ export_state: 'exported', sent_to_zpt: true })
    expect(after.exported_at).not.toBeNull()
    expect(directRow).toEqual({ bl_id: 'CE575-A', ce_mercante: ce })
    expect(ready.map((i: { bl_id: string }) => i.bl_id)).toContain('CE575-A')
  })

  it('a conciliação conta o envio direto, e o CE trocado volta a "Não exportado"', () => {
    const out = lines(sql(`BEGIN; ${blFixture({ movement: 'LCL', vehicle: true })}
      ${asAdmin}
      SELECT ${delivery(0)}; SELECT ${exportZpt};
      SELECT public.ce_unlock_reconcile(jsonb_build_array(jsonb_build_object('ce','${ce}','status','Bloqueado','description','Falta BL')));
      RESET ROLE;
      SELECT ce_unlock_private.item('CE575-A');
      SET LOCAL session_replication_role=replica;
      UPDATE public.bls SET ce_mercante='998575000000102' WHERE id='CE575-A';
      SET LOCAL session_replication_role=origin;
      SELECT ce_unlock_private.item('CE575-A');
      ROLLBACK;`))
    const [summary, zpt, changed] = out.slice(-3)
    expect(summary).toMatchObject({ divergent: 1, ignored: 0 })
    expect(zpt.zpt_status).toBe('divergent')
    expect(changed).toMatchObject({ export_state: 'not_exported', can_export: true })
  })

  it('o Portal não abre solicitação para o B/L dispensado e explica o porquê', () => {
    const msg = error(`BEGIN; ${blFixture({ movement: 'CFS', vehicle: true })}
      ${asClient}
      SELECT public.portal_ce_unlock_command('draft',jsonb_build_object('bl_ids',jsonb_build_array('CE575-A'),'request_key',gen_random_uuid()));
      ROLLBACK;`)
    expect(msg).toContain('não precisa de solicitação')
    const listed = last(sql(`BEGIN; ${blFixture({ movement: 'CFS', vehicle: true })}
      ${asClient}
      SELECT public.portal_list_ce_unlock_bls('{}',1)->'items'->0;
      ROLLBACK;`))
    expect(listed).toMatchObject({ bl_id: 'CE575-A', documents_dispensed: true, can_submit: false, paid_exempt: true })
    expect(listed).not.toHaveProperty('export_state')
  })

  it.each([
    ['isenção à mão em FCL', { movement: 'CY/CY', vehicle: true }],
    ['isento sem veículo', { movement: 'CFS/LCL', vehicle: false }],
    ['carga solta', { movement: 'LCL', vehicle: true, cargoMode: 'carga_solta' }],
    ['veículo LCL ainda não isento', { movement: 'LCL', vehicle: true, chargeStatus: 'calculated' }],
  ] as const)('%s: termo e procuração continuam exigidos', (_label, bl) => {
    const r = last(sql(`BEGIN; ${blFixture(bl)}
      ${asAdmin}
      SELECT ${delivery(0)};
      ROLLBACK;`))
    expect(r).toMatchObject({ documents_dispensed: false, direct: false, termo: false, procuracao: false, can_export: false })
  })

  it('a aba B/Ls do Portal mostra o B/L isento como Isentas', () => {
    const r = last(sql(`BEGIN; ${blFixture({ movement: 'CY', vehicle: false })}
      SELECT public._portal_bl_local_charges(${customer},'CE575-A','[]'::jsonb);
      ROLLBACK;`))
    expect(r).toEqual({ status: 'exempt' })
  })
})
