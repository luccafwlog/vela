import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 610 (ADR 0131, D4): o CE Mercante de B/L de container só entra
// depois do Baplie importado ou da declaração "Viagem sem Baplie", com motivo,
// pela Documentação ou pelo Administrativo. A prévia do CE mostra a
// divergência aberta entre o Baplie e os B/Ls e pede confirmação.
//
// Namespace exclusivo: viagens 6100011/6100012, B/Ls 'BL610-*', usuários 61000000-…

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.declare_voyage_without_baplie(bigint,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 610 (declare_voyage_without_baplie)')

const ADMIN_ID = '61000000-0000-4000-8000-0000000000a1'
const EQP_ID = '61000000-0000-4000-8000-0000000000e1'
const DOC_ID = '61000000-0000-4000-8000-0000000000d1'
const CARRIER_ID = 6100001
const VESSEL_ID = 6100002
const V_MAIN = 6100011
const V_BAPLIE = 6100012
const VOYAGES = [V_MAIN, V_BAPLIE]
const BL_CNTR = 'BL610-CNTR'
const BL_BAPLIE = 'BL610-BAP'
const BLS = [BL_CNTR, BL_BAPLIE]
const MANIFESTO = 'M610000000001'

function asTry(userId: string, sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL "request.jwt.claims" = '{"sub":"${userId}","role":"authenticated"}';
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
}

function preview(voyageId: number, blId: string, ce: string) {
  const run = asTry(DOC_ID, `SELECT public.preview_ce_mercante_rows('${JSON.stringify([{ row: 2, bl_id: blId, ce }])}'::jsonb, '${MANIFESTO}', ${voyageId});`)
  expect(String(run.stderr)).toBe('')
  return JSON.parse(String(run.stdout).trim()) as {
    errors: { message: string }[]; warnings: { message: string }[]; needs_confirmation: boolean; baplie_divergence: string | null
  }
}

const lock = (voyageId: number) => psql(`SELECT COALESCE(public.voyage_ce_mercante_vehicle_lock(${voyageId}), 'livre');`)

function cleanup() {
  psql(`DELETE FROM public.alerts WHERE entity_type = 'voyage' AND entity_id IN ('${VOYAGES.join("', '")}');`)
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.baplie_containers WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.bl_containers WHERE bl_id IN ('${BLS.join("', '")}');
    DELETE FROM public.bls WHERE id IN ('${BLS.join("', '")}');
    DELETE FROM public.voyage_vehicle_declarations WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.voyage_baplie_declarations WHERE voyage_id IN (${VOYAGES.join(', ')});
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}')
      OR (entity_type = 'voyage' AND entity_id IN ('${VOYAGES.join("', '")}'));
    DELETE FROM public.voyages WHERE id IN (${VOYAGES.join(', ')});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.internal_notifications WHERE recipient_id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${EQP_ID}', '${DOC_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('610 — CE Mercante travado sem Baplie', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm610@test.local', 'authenticated', 'authenticated'),
        ('${EQP_ID}', 'eqp610@test.local', 'authenticated', 'authenticated'),
        ('${DOC_ID}', 'doc610@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 610', 'administrativo', true),
        ('${EQP_ID}', 'Equipamentos 610', 'equipamentos', true),
        ('${DOC_ID}', 'Documentação 610', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 610');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 610', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_MAIN}, ${VESSEL_ID}, 'V610M', 'active'), (${V_BAPLIE}, ${VESSEL_ID}, 'V610B', 'active');
      -- A trava dos veículos (597) fica respondida: aqui só o Baplie conta.
      INSERT INTO public.voyage_vehicle_declarations (voyage_id, declared_by) VALUES (${V_MAIN}, '${EQP_ID}'), (${V_BAPLIE}, '${EQP_ID}');
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, review_status, consignee) VALUES
        ('${BL_CNTR}', ${V_MAIN}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 610'),
        ('${BL_BAPLIE}', ${V_BAPLIE}, 'CNSHA', 'BRVIT', 'container', 'ok', 'CONSIGNEE 610');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${BL_CNTR}', 'MSCU6100001', '40HC'), ('${BL_BAPLIE}', 'MSCU6100002', '40HC');
      INSERT INTO public.baplie_containers (voyage_id, container_number, pol, pod, status) VALUES
        (${V_BAPLIE}, 'MSCU6100002', 'CNSHA', 'BRVIT', 'full');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('sem Baplie, o CE de container é recusado na prévia e no banco', () => {
    expect(lock(V_MAIN)).toBe('sem_baplie')
    expect(preview(V_MAIN, BL_CNTR, '152661000000001').errors.map((e) => e.message)).toEqual([
      'CE Mercante travado na viagem Vessel 610 V610M: o Baplie ainda não foi importado. O CE de B/L de container só é vinculado depois do Baplie, ou da declaração "Viagem sem Baplie" com motivo, na tela Baplie.',
    ])
    const linked = asTry(ADMIN_ID, `UPDATE public.bls SET ce_mercante = '152661000000001' WHERE id = '${BL_CNTR}';`)
    expect(String(linked.stderr)).toContain('o Baplie ainda não foi importado')
  })

  it('"Viagem sem Baplie": Equipamentos é recusado, motivo é obrigatório, Documentação declara e o CE é liberado', () => {
    expect(String(asTry(EQP_ID, `SELECT public.declare_voyage_without_baplie(${V_MAIN}, 'motivo');`).stderr))
      .toContain('Somente a Documentação ou o Administrativo')
    expect(String(asTry(DOC_ID, `SELECT public.declare_voyage_without_baplie(${V_MAIN}, '  ');`).stderr))
      .toContain('Informe o motivo')
    const ok = asTry(DOC_ID, `SELECT public.declare_voyage_without_baplie(${V_MAIN}, 'Armador não enviou o Baplie')->>'declared';`)
    expect(String(ok.stderr)).toBe('')
    expect(String(ok.stdout).trim()).toBe('true')
    expect(lock(V_MAIN)).toBe('livre')
    expect(preview(V_MAIN, BL_CNTR, '152661000000001').errors).toEqual([])
    expect(psql(`SELECT field_name || ':' || new_value || ':' || justification FROM public.audit_logs
      WHERE entity_type = 'voyage' AND entity_id = '${V_MAIN}' AND field_name = 'sem_baplie';`))
      .toBe('sem_baplie:declarada:Armador não enviou o Baplie')
  })

  it('desfazer pede motivo e volta a travar', () => {
    expect(String(asTry(ADMIN_ID, `SELECT public.undo_voyage_baplie_declaration(${V_MAIN}, '');`).stderr)).toContain('Informe o motivo')
    expect(String(asTry(ADMIN_ID, `SELECT public.undo_voyage_baplie_declaration(${V_MAIN}, 'O Baplie chegou')->>'declared';`).stdout).trim()).toBe('false')
    expect(lock(V_MAIN)).toBe('sem_baplie')
  })

  it('com Baplie importado, a viagem não se declara e o CE é livre', () => {
    expect(lock(V_BAPLIE)).toBe('livre')
    expect(String(asTry(DOC_ID, `SELECT public.declare_voyage_without_baplie(${V_BAPLIE}, 'motivo');`).stderr))
      .toContain('já tem Baplie importado')
  })

  it('divergência aberta entre o Baplie e os B/Ls aparece na prévia e pede confirmação', () => {
    expect(preview(V_BAPLIE, BL_BAPLIE, '152661000000002').needs_confirmation).toBe(false)
    psql(`SET request.jwt.claim.role = 'service_role';
      SELECT public.upsert_alert_item('voyage_baplie_documentary_coverage', 'voyage', '${V_BAPLIE}',
        '1 container diverge entre o Baplie e os B/Ls.', 'teste_610', '{}'::jsonb, NULL);`)
    const result = preview(V_BAPLIE, BL_BAPLIE, '152661000000002')
    expect(result.errors).toEqual([])
    expect(result.needs_confirmation).toBe(true)
    expect(result.baplie_divergence).toBe('1 container diverge entre o Baplie e os B/Ls.')
    expect(result.warnings.map((w) => w.message)).toContain(
      'Divergência entre o Baplie e os B/Ls da viagem: 1 container diverge entre o Baplie e os B/Ls. Confira em Baplie antes de vincular; para seguir, confirme e informe o motivo.')
  })
})
