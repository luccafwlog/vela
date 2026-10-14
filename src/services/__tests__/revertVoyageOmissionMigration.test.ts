import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')
const migration309 = fs.readFileSync(path.join(migrationsDir, '309_revert_voyage_omission.sql'), 'utf8')
const migration306 = fs.readFileSync(path.join(migrationsDir, '306_escala_multiplos_terminais.sql'), 'utf8')
const migration308 = fs.readFileSync(path.join(migrationsDir, '308_restore_omit_voyage_escala.sql'), 'utf8')

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const adminId = '00000000-0000-0000-0000-000000030901'
const voyageId = 990309
const carrierId = 990309
const vesselId = 990309
const customerId = 990309
const portId = 990309
const blId = 'BL-309-REVERT'
const depotId = '00000000-0000-0000-0000-000000030902'
const terminalStateId = '00000000-0000-0000-0000-000000030903'
const frontId = '00000000-0000-0000-0000-000000030904'
const reportId = '00000000-0000-0000-0000-000000030905'

function functionBody(source: string, functionName: string) {
  const match = source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${functionName}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$;`, 'i'))
  expect(match, `função ${functionName} não encontrada`).toBeTruthy()
  return match?.[1] ?? ''
}

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function callAsAuthenticated(userId: string, sql: string) {
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
      `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${userId}"}', true); ${sql}; COMMIT;`,
    ],
    { encoding: 'utf8' },
  )
}

function getFunctionDefinition(signature: string) {
  return psql(`SELECT pg_get_functiondef('${signature}'::regprocedure);`)
}

function compact(definition: string) {
  return definition
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .toLowerCase()
}

const rpcSignatures = [
  'public.omit_voyage_escala(bigint,text,text,text,uuid,text,text,text,timestamptz,timestamptz)',
  'public.set_bl_cod(text,bigint,text,uuid)',
  'public.set_bl_transshipment(text,bigint,text,uuid)',
  'public.revert_voyage_omission(bigint,text,uuid)',
]

const cleanupSql = `
  SET session_replication_role = replica;
  DELETE FROM public.alert_item_events WHERE actor_id = '${adminId}';
  DELETE FROM public.portal_notifications WHERE bl_id = '${blId}';
  DELETE FROM public.audit_logs WHERE entity_id IN ('${voyageId}::BRVIX', '${voyageId}', '${blId}') OR changed_by = '${adminId}';
  DELETE FROM public.cod_adjustments WHERE bl_id = '${blId}';
  DELETE FROM public.bl_transshipments WHERE bl_id = '${blId}';
  DELETE FROM public.voyage_omissions WHERE voyage_id = ${voyageId};
  DELETE FROM public.voyage_escala_operation_fronts WHERE id = '${frontId}';
  DELETE FROM public.voyage_escala_terminal_state WHERE id = '${terminalStateId}';
  DELETE FROM public.voyage_escala_revision_state WHERE voyage_id = ${voyageId};
  DELETE FROM public.agency_departure_reports WHERE id = '${reportId}';
  DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
  DELETE FROM public.pricing_rule_versions WHERE customer_id = ${customerId};
  DELETE FROM public.bls WHERE id = '${blId}';
  DELETE FROM public.voyages WHERE id = ${voyageId};
  DELETE FROM public.vessels WHERE id = ${vesselId};
  DELETE FROM public.carriers WHERE id = ${carrierId};
  DELETE FROM public.user_profiles WHERE id = '${adminId}';
  DELETE FROM auth.users WHERE id = '${adminId}';
  DELETE FROM public.depots WHERE id = '${depotId}';
  DELETE FROM public.ports WHERE id = ${portId};
  DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
  DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
  DELETE FROM public.customers WHERE id = ${customerId};
  SET session_replication_role = origin;
`

describe('contrato da reversão de omissão de escala', () => {
  it('define uma RPC Admin-only que bloqueia COD e reverte tudo atomicamente', () => {
    const body = functionBody(migration309, 'revert_voyage_omission')

    expect(migration309).toMatch(/CREATE OR REPLACE FUNCTION public\.revert_voyage_omission\(\s*p_omission_id BIGINT,\s*p_justification TEXT,\s*p_changed_by UUID/i)
    expect(migration309).toMatch(/CREATE OR REPLACE FUNCTION public\.revert_voyage_omission\([\s\S]*?\) RETURNS VOID\s*LANGUAGE plpgsql\s*SECURITY DEFINER/i)
    expect(body).toMatch(/public\.is_admin\(\)/i)
    expect(body).toMatch(/p_changed_by IS DISTINCT FROM auth\.uid\(\)/i)
    expect(body).toMatch(/NULLIF\(btrim\(COALESCE\(p_justification, ''\)\), ''\)/i)
    expect(body).toMatch(/SELECT COUNT\(\*\).*disposition\s*=\s*'cod'/is)
    expect(body).toMatch(/v_cod_count.*RAISE EXCEPTION/is)
    expect(body).toMatch(/v_cod_count.*B\/L/is)
    expect(body).toMatch(/'voyage_pod_schedule'.*'omitted'.*'true'.*'false'/is)
    expect(body).toMatch(/INSERT INTO public\.portal_notifications\s*\(customer_id, bl_id, type, title, message, link\)/i)
    expect(body).toMatch(/Corre[cç][aã]o.*omiss[aã]o|omiss[aã]o.*revertida/is)
    expect(body).toMatch(/reverted_at|revert_justification/i)
    expect(body).not.toMatch(/DELETE FROM public\.(bl_transshipments|voyage_omissions)/i)
    expect(body).toMatch(/FOR UPDATE OF o/i)
    expect(body).toMatch(/'voyage'.*'omissao_revertida'.*v_omission\.omitted_pod.*v_omission\.discharge_pod/is)
    expect(body).not.toMatch(/UPDATE public\.(voyage_escala_terminal_state|voyage_escala_operation_fronts|agency_departure_reports)/i)
    expect(body).not.toMatch(/DELETE FROM public\.(voyage_escala_terminal_state|voyage_escala_operation_fronts|agency_departure_reports)/i)

    expect(migration309).toMatch(/REVOKE ALL ON FUNCTION public\.revert_voyage_omission\(BIGINT, TEXT, UUID\) FROM PUBLIC, anon/i)
    expect(migration309).toMatch(/GRANT EXECUTE ON FUNCTION public\.revert_voyage_omission\(BIGINT, TEXT, UUID\) TO authenticated/i)
  })

  it('serializa reversão e transições de disposição pelo mesmo pai, sem can_edit_voyages', () => {
    for (const functionName of ['revert_voyage_omission', 'set_bl_cod', 'set_bl_transshipment']) {
      expect(functionBody(migration309, functionName)).toMatch(/FOR UPDATE OF o/i)
    }

    const transshipmentBody = functionBody(migration309, 'set_bl_transshipment')
    expect(functionBody(migration309, 'set_bl_cod')).toMatch(
      /SELECT pod, customer_id INTO v_old_pod, v_customer FROM public\.bls WHERE id = p_bl_id FOR UPDATE/i,
    )
    expect(transshipmentBody).toMatch(/PERFORM 1 FROM public\.bls WHERE id = p_bl_id FOR UPDATE/i)
    expect(transshipmentBody).toMatch(/onward_vessel_name\s*=\s*NULLIF\(btrim\(COALESCE\(p_onward_vessel_name, ''\)\), ''\)/i)
    expect(transshipmentBody).toMatch(/onward_carrier\s*=\s*NULLIF\(btrim\(COALESCE\(p_onward_carrier, ''\)\), ''\)/i)
    expect(transshipmentBody).toMatch(/onward_voyage_number\s*=\s*NULLIF\(btrim\(COALESCE\(p_onward_voyage_number, ''\)\), ''\)/i)
    expect(transshipmentBody).toMatch(/onward_etd\s*=\s*p_onward_etd/i)
    expect(transshipmentBody).toMatch(/onward_eta\s*=\s*p_onward_eta/i)
    expect(functionBody(migration309, 'set_bl_cod')).not.toMatch(/can_edit_voyages/i)
    expect(functionBody(migration309, 'set_bl_transshipment')).not.toMatch(/can_edit_voyages/i)
  })

  it('torna a segunda omissão um conflito explícito e preserva o guard catalogado da 308', () => {
    const omitBody = functionBody(migration309, 'omit_voyage_escala')

    expect(omitBody).toMatch(/IF EXISTS[\s\S]*voyage_omissions[\s\S]*omitted_pod[\s\S]*RAISE EXCEPTION/i)
    expect(omitBody).not.toMatch(/ON CONFLICT\s*\(voyage_id, omitted_pod\)\s*DO UPDATE/i)
    expect(migration308).toMatch(/pg_constraint/i)
    expect(migration308).toMatch(/regexp_replace\(lower\(pg_get_constraintdef/i)
    expect(migration308).toMatch(/DROP CONSTRAINT %I/i)
  })

  it('mantém a escala revertida ativa nos dois consumidores do audit omitted', () => {
    const saveBody = functionBody(migration306, 'save_voyage_escala_terminal_state')
    const deadlineBody = functionBody(migration306, 'detect_agency_report_deadline_missed')

    expect(saveBody).toMatch(/latest_omitted[\s\S]*?COALESCE\(o\.new_value, 'false'\) <> 'true'/i)
    expect(deadlineBody).toMatch(/latest_omitted[\s\S]*?o\.new_value = 'true'[\s\S]*?NOT omitted/i)
  })
})

describeLocal('reversão de omissão em replay local do Postgres', () => {
  // This opt-in suite assumes scripts/setup-local-pg.sh completed the
  // disposable replay through migration 309. On the current Homebrew setup,
  // that replay is externally blocked at migration 297 because its ownership
  // guard only matches functions owned by `postgres`, while the local replay
  // creates them under the OS superuser. Keep this suite skipped by default;
  // when enabled against a completed replay, every assertion below exercises
  // the effective catalog definitions and privileges rather than migration
  // text alone.
  beforeAll(() => {
    psql(cleanupSql)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'task309-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${adminId}', 'Task 309 Admin', 'administrativo', true);
      INSERT INTO public.ports (id, name, locode, country)
      VALUES (${portId}, 'Porto Task 309', 'BRVIX', 'Brasil');
      INSERT INTO public.depots (id, code, name, active, tipo, port_id)
      VALUES ('${depotId}', 'TASK-309-TERM', 'Terminal Task 309', true, 'terminal_portuario', ${portId});
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '11222333000181', 'Cliente Task 309')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO public.carriers (id, name)
      VALUES (${carrierId}, 'Armador Task 309');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${vesselId}, 'Navio Task 309', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'TASK-309', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pod)
      VALUES ('${blId}', ${voyageId}, ${customerId}, 'BRVIX');
      INSERT INTO public.voyage_escala_terminal_state
        (id, voyage_id, port, port_id, terminal_id, terminal_atb, revision)
      VALUES ('${terminalStateId}', ${voyageId}, 'BRVIX', ${portId}, '${depotId}', '2026-08-19T10:00:00Z', 1);
      INSERT INTO public.voyage_escala_operation_fronts
        (id, voyage_id, port, port_id, sentido, modalidade, terminal_id, source, revision, last_changed_by)
      VALUES ('${frontId}', ${voyageId}, 'BRVIX', ${portId}, 'importacao', 'carga_cheia', '${depotId}', 'operational_data', 1, '${adminId}');
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, terminal, status)
      VALUES ('${reportId}', ${voyageId}, 'BRVIX', NULL, 'open');
    `)
  })

  it('exerce COD, reversão, duplicata, grants e invariantes terminal/frente/ADR', () => {
    const omit = callAsAuthenticated(
      adminId,
      `SELECT public.omit_voyage_escala(${voyageId}, 'BRVIX', 'BRSSA', 'teste de reversao', '${adminId}')`,
    )
    expect(omit.status).toBe(0)
    const omissionId = omit.stdout.trim().split(/\s+/).find((value) => /^\d+$/.test(value))
    expect(omissionId).toMatch(/^\d+$/)

    const duplicate = callAsAuthenticated(
      adminId,
      `SELECT public.omit_voyage_escala(${voyageId}, 'BRVIX', 'BRSSA', 'duplicata', '${adminId}')`,
    )
    expect(duplicate.status).not.toBe(0)
    expect(`${duplicate.stdout}\n${duplicate.stderr}`).toMatch(/ja foi omitida|duplicate|23505/i)

    for (const signature of rpcSignatures) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${signature}'::regprocedure, 'EXECUTE');`)).toBe('t')
      expect(psql(`SELECT has_function_privilege('anon', '${signature}'::regprocedure, 'EXECUTE');`)).toBe('f')
    }

    const initialTransshipment = callAsAuthenticated(
      adminId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'Definicao inicial', '${adminId}')`,
    )
    expect(initialTransshipment.status).toBe(0)
    expect(psql(`SELECT disposition FROM public.bl_transshipments WHERE bl_id = '${blId}' AND omission_id = ${omissionId}`)).toBe('transshipment')

    const cod = callAsAuthenticated(adminId, `SELECT public.set_bl_cod('${blId}', ${omissionId}, 'Cliente confirmou COD', '${adminId}')`)
    expect(cod.status).toBe(0)
    expect(psql(`SELECT disposition FROM public.bl_transshipments WHERE bl_id = '${blId}' AND omission_id = ${omissionId}`)).toBe('cod')
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${blId}'`)).toBe('BRSSA')
    expect(psql(`SELECT count(*) FROM public.portal_notifications WHERE bl_id = '${blId}' AND title = 'Destino alterado (COD)'`)).toBe('1')
    expect(psql(`SELECT disposition FROM public.bl_transshipments WHERE bl_id = '${blId}' AND omission_id = ${omissionId}`)).toBe('cod')

    const blocked = callAsAuthenticated(
      adminId,
      `SELECT public.revert_voyage_omission(${omissionId}, 'COD impede a reversao', '${adminId}')`,
    )
    expect(blocked.status).not.toBe(0)
    expect(`${blocked.stdout}\n${blocked.stderr}`).toMatch(/1 B\/L|COD/i)
    expect(psql(`SELECT count(*) FROM public.voyage_omissions WHERE id = ${omissionId}`)).toBe('1')

    const transshipment = callAsAuthenticated(
      adminId,
      `SELECT public.set_bl_transshipment('${blId}', ${omissionId}, 'COD revertido pelo cliente', '${adminId}')`,
    )
    expect(transshipment.status).toBe(0)
    expect(psql(`SELECT disposition FROM public.bl_transshipments WHERE bl_id = '${blId}' AND omission_id = ${omissionId}`)).toBe('transshipment')
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${blId}'`)).toBe('BRVIX')

    const invariantBefore = psql(`
      SELECT
        md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd, terminal_rtw, revision), ',' ORDER BY id) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId}), ''))
        || ':' || md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, port_id, sentido, modalidade, terminal_id, source, revision), ',' ORDER BY id) FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId}), ''))
        || ':' || md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, terminal, status, terminal_id, terminal_port_id), ',' ORDER BY id) FROM public.agency_departure_reports WHERE voyage_id = ${voyageId}), ''));
    `)

    const reverted = callAsAuthenticated(
      adminId,
      `SELECT public.revert_voyage_omission(${omissionId}, 'Correção confirmada pelo Admin', '${adminId}')`,
    )
    expect(reverted.status).toBe(0)
    expect(psql(`SELECT count(*) FROM public.voyage_omissions WHERE id = ${omissionId} AND reverted_at IS NOT NULL`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.bl_transshipments WHERE omission_id = ${omissionId}`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.portal_notifications WHERE bl_id = '${blId}' AND title = 'Correção de omissão de escala'`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '${voyageId}::BRVIX' AND field_name = 'omitted' AND old_value = 'true' AND new_value = 'false'`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage' AND entity_id = '${voyageId}' AND field_name = 'omissao_revertida' AND old_value = 'BRVIX' AND new_value = 'BRSSA'`)).toBe('1')

    const invariantAfter = psql(`
      SELECT
        md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd, terminal_rtw, revision), ',' ORDER BY id) FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId}), ''))
        || ':' || md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, port_id, sentido, modalidade, terminal_id, source, revision), ',' ORDER BY id) FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${voyageId}), ''))
        || ':' || md5(COALESCE((SELECT string_agg(format('%s|%s|%s|%s|%s|%s|%s', id, voyage_id, port, terminal, status, terminal_id, terminal_port_id), ',' ORDER BY id) FROM public.agency_departure_reports WHERE voyage_id = ${voyageId}), ''));
    `)
    expect(invariantAfter).toBe(invariantBefore)

    // A8 (ADR 0083, item 8; migration 255): a revertida fica no histórico e o POD pode ser omitido de novo;
    // a unicidade vale só entre as não revertidas.
    const again = callAsAuthenticated(
      adminId,
      `SELECT public.omit_voyage_escala(${voyageId}, 'BRVIX', 'BRSSA', 'nova omissao', '${adminId}')`,
    )
    expect(again.status, again.stderr).toBe(0)
    expect(psql(`SELECT count(*) || ':' || count(*) FILTER (WHERE reverted_at IS NULL) FROM public.voyage_omissions WHERE voyage_id = ${voyageId} AND omitted_pod = 'BRVIX'`)).toBe('2:1')
    const duplicateAgain = callAsAuthenticated(
      adminId,
      `SELECT public.omit_voyage_escala(${voyageId}, 'BRVIX', 'BRSSA', 'duplicata', '${adminId}')`,
    )
    expect(`${duplicateAgain.stdout}\n${duplicateAgain.stderr}`).toMatch(/ja foi omitida/i)

    expect(compact(getFunctionDefinition('public.revert_voyage_omission(bigint,text,uuid)')))
      .toMatch(/where o\.id = p_omission_id for update of o/)
    for (const signature of rpcSignatures.slice(1, 3)) {
      // The lock is in the same SELECT that reads disposition. This is the
      // shared serialization point that prevents revert from counting COD,
      // then allowing COD to commit, then deleting the omission.
      expect(compact(getFunctionDefinition(signature)))
        .toMatch(/from public\.bl_transshipments as t join public\.voyage_omissions as o[\s\S]*for update of o/)
    }
  })

  afterAll(() => {
    psql(cleanupSql)
  })
})
