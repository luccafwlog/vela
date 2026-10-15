import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const closerId = '10000000-0000-0000-0000-000000000001'
const viewerId = '20000000-0000-0000-0000-000000000002'
const inactiveId = '30000000-0000-0000-0000-000000000003'
const voyageId = 9917217
const carrierId = 9917217
const vesselId = 9917217

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function deniedAs(role: 'authenticated' | 'anon', userId?: string) {
  const claims = userId ? `SELECT set_config('request.jwt.claim.sub', '${userId}', true);` : ''
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE ${role}; ${claims} SELECT public.get_agency_report_closer_name(${voyageId}, 'BRVIX'); COMMIT;`,
  ], { encoding: 'utf8' })
}

describeLocal('migration 217 — autorização local do nome do autor do ADR', () => {
  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${closerId}', 'closer-217@example.test'),
        ('${viewerId}', 'viewer-217@example.test'),
        ('${inactiveId}', 'inactive-217@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${closerId}', 'Autor do Fechamento', 'operacoes', true),
        ('${viewerId}', 'Leitor Não Admin', 'documentacao', true),
        ('${inactiveId}', 'Leitor Inativo', 'documentacao', false)
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, active = EXCLUDED.active;
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier Local 217')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel Local 217', ${carrierId})
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${voyageId}, ${vesselId}, 'LOCAL-217')
      ON CONFLICT (id) DO NOTHING;
      DELETE FROM public.agency_departure_reports WHERE voyage_id = ${voyageId} AND port = 'BRVIX';
      INSERT INTO public.agency_departure_reports (voyage_id, port, status, closed_by)
      VALUES (${voyageId}, 'BRVIX', 'closed', '${closerId}');
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.agency_departure_reports WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.user_profiles WHERE id IN ('${closerId}', '${viewerId}', '${inactiveId}');
      DELETE FROM auth.users WHERE id IN ('${closerId}', '${viewerId}', '${inactiveId}');
    `)
  })

  it('permite ao usuário ativo não-admin resolver o autor deste ADR', () => {
    const value = psql(`
      BEGIN;
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${viewerId}', true);
      SELECT public.get_agency_report_closer_name(${voyageId}, 'BRVIX');
      COMMIT;
    `)

    expect(value).toContain('Autor do Fechamento')
  })

  it('nega um usuário interno inativo', () => {
    const inactive = deniedAs('authenticated', inactiveId)

    expect(inactive.status).not.toBe(0)
    expect(inactive.stderr).toContain('42501')
  })

  it('nega um usuário anônimo', () => {
    const anonymous = deniedAs('anon')

    expect(anonymous.status).not.toBe(0)
    expect(anonymous.stderr).toContain('42501')
  })
})
