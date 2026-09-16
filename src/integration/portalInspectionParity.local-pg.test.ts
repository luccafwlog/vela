import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PORTAL_READ_INSPECT_MAP,
  PORTAL_WRITE_CONTRACTS,
  REPORT_ID_RPC_VARIANTS,
} from '../services/portalRpcContracts'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl =
  process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const inspectorId = '00000000-0000-0000-0000-000000011301'
const portalUserA = '00000000-0000-0000-0000-000000011302'
const customerA = 990131
const customerB = 990132
const carrierId = 990131
const vesselId = 990131
const voyageId = 990131
const blA = 'BL-S11-A'
const blB = 'BL-S11-B'
const customerACnpj = syntheticCnpj(11301)
const customerBCnpj = syntheticCnpj(11302)

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function callAs(userId: string, sql: string) {
  return spawnSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-d',
      databaseUrl,
      '-c',
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${userId}', true); ${sql} COMMIT;`,
    ],
    { encoding: 'utf8' },
  )
}

function lastJson(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[') || line.startsWith('{'))
  return lines.pop() ?? '[]'
}

function procExists(signature: string) {
  return (
    psql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.oid = '${signature}'::regprocedure;`) !== '0'
  )
}

describeLocal('S11 — paridade de Inspeção das disputas', () => {
  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${inspectorId}', 's11-inspector@example.test'),
        ('${portalUserA}', 's11-portal-a@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${inspectorId}', 'S11 Inspector', 'operacoes', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerA}, '${customerACnpj}', 'Cliente S11 A'),
        (${customerB}, '${customerBCnpj}', 'Cliente S11 B')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO public.customer_portal_accounts (customer_id, active, auth_user_id) VALUES
        (${customerA}, true, '${portalUserA}')
      ON CONFLICT (customer_id) DO UPDATE SET active = true, auth_user_id = '${portalUserA}';
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S11') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S11', ${carrierId}) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'S11-001', 'active') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, pod) VALUES
        ('${blA}', ${voyageId}, ${customerA}, 'container', 'BRVIX') ,
        ('${blB}', ${voyageId}, ${customerB}, 'container', 'BRSSZ')
      ON CONFLICT (id) DO UPDATE SET customer_id = EXCLUDED.customer_id;
      UPDATE public.bls SET ce_mercante = 'CE-S11-A' WHERE id = '${blA}';
      INSERT INTO public.demurrage_invoices (doc_number, bl_id, customer_id, total_usd, status) VALUES
        ('S11-DEM-A', '${blA}', ${customerA}, 100, 'issued'),
        ('S11-DEM-B', '${blB}', ${customerB}, 200, 'issued')
      ON CONFLICT (doc_number) DO NOTHING;
      INSERT INTO public.demurrage_disputes (demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
      SELECT i.id, ${customerA}, 'aberta', 'equipamentos', 'assunto A', 'cliente'
      FROM public.demurrage_invoices i WHERE i.doc_number = 'S11-DEM-A'
      ON CONFLICT DO NOTHING;
      INSERT INTO public.demurrage_disputes (demurrage_invoice_id, customer_id, state, next_responder, subject, opened_by)
      SELECT i.id, ${customerB}, 'aberta', 'equipamentos', 'assunto B', 'cliente'
      FROM public.demurrage_invoices i WHERE i.doc_number = 'S11-DEM-B'
      ON CONFLICT DO NOTHING;
    `)
  })

  afterAll(() => {
    // ponytail: clientes/contas/eventos de provisionamento são append-only
    // (portal_events_block_mutation veta o SET NULL do FK); ficam com ids de
    // teste e o beforeAll é idempotente via ON CONFLICT.
    psql(`
      DELETE FROM public.demurrage_disputes WHERE customer_id IN (${customerA}, ${customerB});
      DELETE FROM public.demurrage_invoices WHERE doc_number IN ('S11-DEM-A', 'S11-DEM-B');
      DELETE FROM public.bls WHERE id IN ('${blA}', '${blB}');
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.user_profiles WHERE id = '${inspectorId}';
      DELETE FROM auth.users WHERE id IN ('${inspectorId}', '${portalUserA}');
    `)
  })

  it('expõe núcleo privado + dois invólucros com grants fechados', () => {
    expect(procExists('public._portal_list_disputes_core(bigint)')).toBe(true)
    expect(procExists('public.portal_list_disputes()')).toBe(true)
    expect(procExists('public.portal_inspect_list_disputes(bigint)')).toBe(true)
    expect(psql(`SELECT has_function_privilege('authenticated', 'public._portal_list_disputes_core(bigint)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('anon', 'public._portal_list_disputes_core(bigint)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.portal_list_disputes()', 'EXECUTE');`)).toBe('t')
    expect(psql(`SELECT has_function_privilege('anon', 'public.portal_inspect_list_disputes(bigint)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.portal_inspect_list_disputes(bigint)', 'EXECUTE');`)).toBe('t')
    expect(procExists('public._portal_list_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(procExists('public.portal_list_invoices_page(integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(procExists('public.portal_inspect_list_invoices_page(bigint,integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(procExists('public._portal_list_demurrage_invoices_page_core(bigint,integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(procExists('public.portal_list_demurrage_invoices_page(integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(procExists('public.portal_inspect_list_demurrage_invoices_page(bigint,integer,integer,text,text,text,text,date,date)')).toBe(true)
    expect(psql(`SELECT has_function_privilege('anon', 'public.portal_list_invoices_page(integer,integer,text,text,text,text,date,date)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.portal_inspect_list_invoices_page(bigint,integer,integer,text,text,text,text,date,date)', 'EXECUTE');`)).toBe('t')
  })

  it('inspeção recebe página limitada e contagem server-side para as duas listas', () => {
    const localPage = callAs(inspectorId, `SELECT public.portal_inspect_list_invoices_page(${customerA}, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL);`)
    expect(localPage.status, `${localPage.stdout}\n${localPage.stderr}`).toBe(0)
    const localPayload = JSON.parse(lastJson(localPage.stdout)) as { rows: unknown[]; total_count: number }
    expect(localPayload.rows).toHaveLength(0)
    expect(localPayload.total_count).toBe(0)

    const demurragePage = callAs(inspectorId, `SELECT public.portal_inspect_list_demurrage_invoices_page(${customerA}, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL);`)
    expect(demurragePage.status, `${demurragePage.stdout}\n${demurragePage.stderr}`).toBe(0)
    const demurragePayload = JSON.parse(lastJson(demurragePage.stdout)) as { rows: unknown[]; total_count: number }
    expect(demurragePayload.rows).toHaveLength(1)
    expect(demurragePayload.total_count).toBe(1)
  })

  it('Portal A e Inspeção A veem os mesmos dados; B fica isolado', () => {
    const portal = callAs(portalUserA, `SELECT public.portal_list_disputes();`)
    expect(portal.status, `${portal.stdout}\n${portal.stderr}`).toBe(0)
    const portalRows = JSON.parse(lastJson(portal.stdout)) as Array<{ subject: string }>
    expect(portalRows.map((r) => r.subject)).toContain('assunto A')
    expect(portalRows.map((r) => r.subject)).not.toContain('assunto B')

    const inspectA = callAs(inspectorId, `SELECT public.portal_inspect_list_disputes(${customerA});`)
    expect(inspectA.status, `${inspectA.stdout}\n${inspectA.stderr}`).toBe(0)
    expect(JSON.parse(lastJson(inspectA.stdout))).toEqual(portalRows)

    const inspectB = callAs(inspectorId, `SELECT public.portal_inspect_list_disputes(${customerB});`)
    expect(inspectB.status).toBe(0)
    const rowsB = JSON.parse(lastJson(inspectB.stdout)) as Array<{ subject: string }>
    expect(rowsB.map((r) => r.subject)).toContain('assunto B')
    expect(rowsB.map((r) => r.subject)).not.toContain('assunto A')
  })

  it('mapa literal cobre callers, leituras têm wrapper e escritas não ganham variante', () => {
    const callers = [
      'portal_list_consolidatable_receivables', 'portal_list_invoices', 'portal_invoice_details',
      'portal_get_current_roe', 'portal_list_demurrage_invoices', 'portal_get_demurrage_invoice_detail',
      'portal_list_notifications', 'portal_notification_unread_count', 'portal_list_operation_bls',
      'portal_get_profile', 'portal_get_contact_configuration', 'portal_list_disputes', 'portal_ship_schedule',
      'portal_open_demurrage_dispute', 'portal_add_dispute_message', 'add_demurrage_dispute_attachment',
      'portal_request_dispute_reopen', 'portal_update_profile', 'portal_create_consolidation',
      'portal_obsolete_consolidation', 'portal_mark_notification_read', 'portal_mark_all_notifications_read',
      'portal_save_contact_configuration',
    ]
    const reads = Object.keys(PORTAL_READ_INSPECT_MAP)
    const writes = [...PORTAL_WRITE_CONTRACTS]
    for (const caller of callers) expect([...reads, ...writes]).toContain(caller)
    for (const [client, inspect] of Object.entries(PORTAL_READ_INSPECT_MAP)) {
      if (client === 'portal_ship_schedule') {
        expect(inspect).toBe('portal_ship_schedule')
        continue
      }
      const pageSignature = inspect.includes('_page') ? 'bigint, integer, integer, text, text, text, text, date, date' : null
      expect(procExists(`public.${inspect}(${pageSignature ?? (inspect.includes('invoice_details') || inspect.includes('invoice_detail') ? 'bigint, bigint' : inspect.includes('list_notifications') ? 'bigint, integer' : 'bigint')})`)).toBe(true)
    }
    for (const write of writes) {
      const candidate = write.startsWith('portal_') ? `public.portal_inspect_${write.slice(7)}` : `public.portal_inspect_${write}`
      expect(psql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${candidate.split('.')[1]}';`)).toBe('0')
    }
    expect(Object.keys(REPORT_ID_RPC_VARIANTS)).toHaveLength(5)
  })

  it('assinaturas regeneradas conferem com pg_proc e fantasmas seguem ausentes', () => {
    const identity = (proname: string) =>
      psql(`SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${proname}';`)
    expect(identity('settle_cod_adjustment')).toBe(
      'p_adjustment_id bigint, p_actor uuid, p_resulting_document_id bigint, p_resulting_document_type text',
    )
    expect(identity('revert_voyage_omission')).toBe('p_omission_id bigint, p_justification text, p_changed_by uuid')
    expect(identity('portal_open_inspection')).toBe('p_customer_id bigint, p_origin text')
    expect(identity('portal_inspect_list_disputes')).toBe('p_customer_id bigint')
    for (const ghost of [
      'can_edit_customers', 'can_edit_depots', 'can_edit_voyages',
      'is_active_non_equipamentos_user', 'is_equipamentos_user',
      'portal_list_operation_bls_without_transshipment',
    ]) {
      expect(
        psql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${ghost}';`),
      ).toBe('0')
    }
  })
})
