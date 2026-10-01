import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000115001'
const blOpen = 'PERFIL115-OPEN'
const blInvoiced = 'PERFIL115-INVOICED'
const carrierId = 1150011
const vesselId = 1150012
const voyageId = 1150013
const containerOpen = 1150001
const containerInvoiced = 1150002

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function asAuthenticated(sql: string): { ok: boolean; output: string } {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}`.trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'bl' AND entity_id LIKE 'PERFIL115-%';
    DELETE FROM public.charge_calculations WHERE bl_id LIKE 'PERFIL115-%';
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'PERFIL115-%';
    DELETE FROM public.bls WHERE id LIKE 'PERFIL115-%';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('set_bl_container_profile — perfil com justificativa e recálculo', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'perfil115@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Perfil 115', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Perfil115 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Perfil115 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'P115', 'active');
      SET session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, cargo_mode, pod, financial_status) VALUES
        ('${blOpen}', ${voyageId}, 'container', 'BRVIX', NULL),
        ('${blInvoiced}', ${voyageId}, 'container', 'BRVIX', 'invoiced');
      INSERT INTO public.bl_containers (id, bl_id, container_number, is_imo, is_oog, imo_class, un_number) VALUES
        (${containerOpen}, '${blOpen}', 'PFLU1150001', true, false, '3', '1203'),
        (${containerInvoiced}, '${blInvoiced}', 'PFLU1150002', false, false, NULL, NULL);
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('exige justificativa e não altera o container sem ela', () => {
    const result = asAuthenticated(`SELECT public.set_bl_container_profile(${containerOpen}, 'oog', '   ');`)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('justificativa')
    expect(psql(`SELECT is_imo || ',' || is_oog FROM public.bl_containers WHERE id = ${containerOpen}`)).toBe('true,false')
  })

  it('altera o perfil, limpa classe/UN ao sair de IMO, registra o histórico e recalcula', () => {
    const result = asAuthenticated(`SELECT public.set_bl_container_profile(${containerOpen}, 'oog', 'Carga excede a largura do container.');`)
    expect(result.ok, result.output).toBe(true)
    expect(result.output).toContain('"charges"')
    expect(psql(`SELECT is_imo || ',' || is_oog || ',' || COALESCE(imo_class, '-') || ',' || COALESCE(un_number, '-') FROM public.bl_containers WHERE id = ${containerOpen}`)).toBe('false,true,-,-')
    expect(psql(`SELECT field_name || '|' || justification || '|' || changed_by FROM public.audit_logs WHERE entity_id = '${blOpen}' AND field_name = 'container_profile'`))
      .toBe(`container_profile|Carga excede a largura do container.|${actorId}`)
  })

  it('recusa alterar o perfil de B/L já faturado', () => {
    const result = asAuthenticated(`SELECT public.set_bl_container_profile(${containerInvoiced}, 'imo', 'Teste.');`)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('já foi faturado')
    expect(psql(`SELECT is_imo FROM public.bl_containers WHERE id = ${containerInvoiced}`)).toBe('f')
  })
})
