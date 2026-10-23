import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 453 (ponto 9 de 2026-10-23): colar vários B/Ls ou contêineres na
// busca de /bls e /containers acha cada um; o texto inteiro segue valendo.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN_ID = '45300000-0000-4000-8000-0000000000a1'
const CARRIER_ID = 4530001
const VESSEL_ID = 4530002
const VOYAGE_ID = 4530003
const BLS = ['B453AAA1', 'B453BBB2', 'B453CCC3']

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public.search_term_tokens(text)') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 453 (search_term_tokens)')

// Como a tela: sessão autenticada do Administrativo, RLS do chamador.
function asAdmin(sql: string) {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    ${sql}
    COMMIT;
  `], { encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  return JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}')
}

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`
const bls = (search: string) => asAdmin(`SELECT public.operational_list_bls(p_page => 1, p_page_size => 50, p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`)
  .rows.map((row: { id: string }) => row.id).sort()
const summary = (search: string) => asAdmin(`SELECT public.operational_list_bl_summary(p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`).totalBls
const containers = (search: string) => asAdmin(`SELECT public.operational_list_containers(p_page => 1, p_page_size => 50, p_voyage_id => ${VOYAGE_ID}, p_search => ${lit(search)})::text;`)
  .rows.map((row: { container_number: string }) => row.container_number).sort()

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'B453%';
    DELETE FROM public.bls WHERE id LIKE 'B453%';
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${ADMIN_ID}';
    DELETE FROM auth.users WHERE id = '${ADMIN_ID}';
    SET session_replication_role = origin;
  `)
}

describeLocal('453 — busca por vários B/Ls e contêineres', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email, aud, role) VALUES ('${ADMIN_ID}', 'adm453@test.local', 'authenticated', 'authenticated');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN_ID}', 'Administrativo 453', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Carrier 453');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Vessel 453', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V453', 'active');
      INSERT INTO public.bls (id, voyage_id, pol, pod, consignee, cargo_mode, financial_status, charge_status, review_status) VALUES
        ('${BLS[0]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'ACME IMPORTADORA', 'container', 'pending', 'not_calculated', 'ok'),
        ('${BLS[1]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'BETA LTDA', 'container', 'pending', 'not_calculated', 'ok'),
        ('${BLS[2]}', ${VOYAGE_ID}, 'CNSHA', 'BRSSZ', 'GAMA SA', 'container', 'pending', 'not_calculated', 'ok');
      INSERT INTO public.bl_containers (bl_id, container_number, type) VALUES
        ('${BLS[0]}', 'TCNU4530001', '40HC'), ('${BLS[1]}', 'TCNU4530002', '40HC'), ('${BLS[2]}', 'TCNU4530003', '20DV');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('lista colada com vírgula, ponto e vírgula e quebra de linha acha cada B/L', () => {
    expect(bls(`${BLS[0]}, ${BLS[2]}`)).toEqual([BLS[0], BLS[2]])
    expect(bls(`${BLS[0]};${BLS[1]}\n${BLS[2]}`)).toEqual(BLS)
    expect(summary(`${BLS[0]} ${BLS[1]}`)).toBe(2)
    expect(bls(`${BLS[1]}\n${BLS[1]}`)).toEqual([BLS[1]])
  })

  it('um termo só e o texto inteiro seguem a busca de antes', () => {
    expect(bls('BBB2')).toEqual([BLS[1]])
    expect(bls('ACME IMPORTADORA')).toEqual([BLS[0]])
    expect(bls('NADA453')).toEqual([])
  })

  it('a lista de contêineres acha vários contêineres ou B/Ls colados', () => {
    expect(containers('TCNU4530001 TCNU4530003')).toEqual(['TCNU4530001', 'TCNU4530003'])
    expect(containers(`${BLS[1]}, TCNU4530003`)).toEqual(['TCNU4530002', 'TCNU4530003'])
  })
})
