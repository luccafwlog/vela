import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 088 (ADR 0071): o CE Mercante trava a exclusão; sem trava, a
// viagem sai com tudo que é dela; escala e atracação respeitam a trava e o
// Administrativo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function functionPresent() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.delete_escala(bigint,text,boolean,text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = functionPresent() ? describe : describe.skip

const ADMIN_ID = '08800000-0000-4000-8000-0000000000a1'
const OPS_ID = '08800000-0000-4000-8000-0000000000b1'
const CARRIER_ID = 8800001
const VESSEL_ID = 8800002
const V_FREE = 8800003
const V_LOCKED = 8800004
const V_CANCELLED = 8800005
const DEPOT_ID = '08800000-0000-4000-8000-00000000d001'

// Como a funcao do modal (SECURITY DEFINER): roda como dono, com a sessao do usuario.
function asOwnerFor(userId: string, sql: string) {
  return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    ${sql}
    ROLLBACK;
  `], { encoding: 'utf8' })
}

function as(userId: string, sql: string) {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  const last = run.stdout.trim().split('\n').pop() ?? ''
  return { ...run, json: run.status === 0 && last.startsWith('{') ? JSON.parse(last) : null }
}

const VOYAGES = `${V_FREE}, ${V_LOCKED}, ${V_CANCELLED}`

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.voyage_export_schedules WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.vehicles WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.vehicles WHERE bl_id LIKE 'BL088%';
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'BL088%';
    DELETE FROM public.bls WHERE voyage_id IN (${VOYAGES});
    DELETE FROM public.voyages WHERE id IN (${VOYAGES});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.depots WHERE id = '${DEPOT_ID}';
    DELETE FROM public.user_profiles WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    DELETE FROM auth.users WHERE id IN ('${ADMIN_ID}', '${OPS_ID}');
    SET session_replication_role = origin;
  `)
}

describeLocal('088 — trava de exclusão pelo CE Mercante', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES
        ('${ADMIN_ID}', 'adm088@test.local', 'authenticated', 'authenticated'),
        ('${OPS_ID}', 'ops088@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADMIN_ID}', 'Administrativo 088', 'administrativo', true),
        ('${OPS_ID}', 'Operações 088', 'operacoes', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 088');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 088', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${V_FREE}, ${VESSEL_ID}, 'V088F', 'active'),
        (${V_LOCKED}, ${VESSEL_ID}, 'V088L', 'active'),
        (${V_CANCELLED}, ${VESSEL_ID}, 'V088C', 'cancelled');
      INSERT INTO public.depots (id, code, port_id, tipo) VALUES ('${DEPOT_ID}', 'T088', 2, 'terminal_portuario');
      INSERT INTO public.bls (id, voyage_id, pol, pod) VALUES
        ('BL088FREE', ${V_FREE}, 'CNSHA', 'BRSSZ'),
        ('BL088SSZ', ${V_LOCKED}, 'CNSHA', 'BRSSZ'),
        ('BL088PNG', ${V_LOCKED}, 'CNSHA', 'BRPNG');
      UPDATE public.bls SET ce_mercante = '088000000000001' WHERE id = 'BL088SSZ';
      INSERT INTO public.bl_containers (bl_id, container_number) VALUES ('BL088FREE', 'TEST0880001');
      INSERT INTO public.voyage_export_schedules (voyage_id, pol, tem_exportacao) VALUES
        (${V_FREE}, 'BRSSZ', true), (${V_LOCKED}, 'BRVIX', true);
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id) VALUES
        (${V_FREE}, 'BRSSZ', 2, '${DEPOT_ID}'),
        (${V_LOCKED}, 'BRSSZ', 2, '${DEPOT_ID}');
    `)
  })

  afterAll(cleanup)

  it('prévia conta o que vai junto com a viagem, da mesma lista que exclui', () => {
    const run = as(ADMIN_ID, `SELECT public.voyage_delete_preview(${V_FREE});`)
    const count = (table: string) => run.json.items.find((item: { table: string }) => item.table === table)?.count
    expect(count('bls')).toBe(1)
    expect(count('bl_containers')).toBe(1)
    expect(count('voyage_export_schedules')).toBe(1)
    expect(count('voyage_escala_terminal_state')).toBe(1)
  })

  it('prévia de exclusão de viagem é só do Administrativo', () => {
    expect(as(OPS_ID, `SELECT public.voyage_delete_preview(${V_FREE});`).stderr).toMatch(/Somente o Administrativo/)
  })

  it('B/L com CE, o container e o veículo dele não se excluem; B/L sem CE sai', () => {
    psql(`INSERT INTO public.bl_containers (bl_id, container_number) VALUES ('BL088SSZ', 'TEST0880002');`)
    const containerId = psql(`SELECT id FROM public.bl_containers WHERE bl_id = 'BL088SSZ';`)
    const bl = as(ADMIN_ID, `SELECT public.delete_records('bl', ARRAY['BL088SSZ'], false, 'erro');`)
    expect(bl.json.blocked).toEqual([{ id: 'BL088SSZ', reasons: ['B/L com CE Mercante'] }])
    const container = as(ADMIN_ID, `SELECT public.delete_records('container', ARRAY['${containerId}'], false, 'erro');`)
    expect(container.json.blocked).toEqual([{ id: containerId, reasons: ['B/L com CE Mercante'] }])
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE id = ${containerId};`)).toBe('1')

    const direct = as(ADMIN_ID, `DELETE FROM public.bls WHERE id = 'BL088SSZ';`)
    expect(direct.stderr).toMatch(/permission denied/i)

    const preview = as(ADMIN_ID, `SELECT public.delete_records('bl', ARRAY['BL088PNG'], true);`)
    expect(preview.json.deleted).toEqual(['BL088PNG'])
  })

  it('excluir exige motivo; a prévia não', () => {
    const run = as(ADMIN_ID, `SELECT public.delete_records('bl', ARRAY['BL088PNG'], false, '  ');`)
    expect(run.stderr).toMatch(/Informe o motivo/)
    const escala = as(ADMIN_ID, `SELECT public.delete_escala(${V_LOCKED}, 'BRVIX', false, NULL);`)
    expect(escala.stderr).toMatch(/Informe o motivo/)
  })

  it('viagem com B/L com CE fica travada; cancelada fica retida', () => {
    const run = as(ADMIN_ID, `SELECT public.delete_records('voyage', ARRAY['${V_LOCKED}', '${V_CANCELLED}'], false, 'teste');`)
    expect(run.json.deleted).toEqual([])
    expect(run.json.blocked).toEqual([
      { id: String(V_LOCKED), reasons: ['B/L com CE Mercante'] },
      { id: String(V_CANCELLED), reasons: ['viagem cancelada fica retida'] },
    ])
  })

  it('viagem sem trava sai com B/Ls, carga, escalas e atracações', () => {
    const run = as(ADMIN_ID, `SELECT public.delete_records('voyage', ARRAY['${V_FREE}'], false, 'cadastro duplicado');`)
    expect(run.json.deleted).toEqual([String(V_FREE)])
    expect(psql(`SELECT count(*) FROM public.voyages WHERE id = ${V_FREE};`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.bls WHERE voyage_id = ${V_FREE};`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.bl_containers WHERE bl_id = 'BL088FREE';`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = ${V_FREE};`)).toBe('0')
    expect(psql(`SELECT justification FROM public.audit_logs
      WHERE entity_type = 'voyages' AND entity_id = '${V_FREE}' AND field_name = 'deleted';`)).toBe('cadastro duplicado')
  })

  it('escala com B/L com CE fica travada; a de outro porto sai', () => {
    const locked = as(ADMIN_ID, `SELECT public.delete_escala(${V_LOCKED}, 'brssz', false, 'erro');`)
    expect(locked.json).toMatchObject({ deleted: false, reasons: ['B/L com CE Mercante'] })

    const previewFree = as(ADMIN_ID, `SELECT public.delete_escala(${V_LOCKED}, 'BRVIX', true);`)
    expect(previewFree.json).toMatchObject({ deleted: false, deletable: true, scope: { export_schedules: 1 } })

    const free = as(ADMIN_ID, `SELECT public.delete_escala(${V_LOCKED}, 'BRVIX', false, 'escala errada');`)
    expect(free.json).toMatchObject({ deleted: true })
    expect(psql(`SELECT count(*) FROM public.voyage_export_schedules WHERE voyage_id = ${V_LOCKED} AND pol = 'BRVIX';`)).toBe('0')
  })

  it('só o Administrativo exclui escala e remove atracação; a trava vale para ele', () => {
    const escala = as(OPS_ID, `SELECT public.delete_escala(${V_LOCKED}, 'BRPNG');`)
    expect(escala.stderr).toMatch(/Somente o Administrativo pode excluir escala/)

    const opsTerminal = asOwnerFor(OPS_ID, `DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${V_LOCKED};`)
    expect(opsTerminal.stderr).toMatch(/Somente o Administrativo remove atracação/)

    const adminTerminal = asOwnerFor(ADMIN_ID, `DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${V_LOCKED};`)
    expect(adminTerminal.stderr).toMatch(/Atracação travada: B\/L com CE Mercante/)
  })

  it('"não escala" (marca de POD removido) segue a regra de Excluir escala (migration 090)', () => {
    const mark = (userId: string, port: string) => as(userId, `INSERT INTO public.audit_logs
      (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('voyage_pod_schedule', '${V_LOCKED}::${port}', 'deleted', 'false', 'true', '${userId}', 'não escala');`)

    expect(mark(OPS_ID, 'BRPNG').stderr).toMatch(/Somente o Administrativo retira escala/)
    expect(mark(ADMIN_ID, 'BRSSZ').stderr).toMatch(/Escala BRSSZ travada: B\/L com CE Mercante/)
    // A tela lê a marca normalizada; 'TRUE' não escapa da regra.
    const upper = as(OPS_ID, `INSERT INTO public.audit_logs
      (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('voyage_pod_schedule', '${V_LOCKED}::BRSSZ', 'deleted', 'false', ' TRUE', '${OPS_ID}', 'não escala');`)
    expect(upper.stderr).toMatch(/Somente o Administrativo retira escala/)
    expect(mark(ADMIN_ID, 'BRPNG').status).toBe(0)
  })

  it('taxa manual do B/L exige o Administrativo', () => {
    const run = as(OPS_ID, `SELECT public.delete_manual_bl_charge(1, NULL);`)
    expect(run.stderr).toMatch(/Somente o Administrativo exclui taxa manual/)
  })
})
