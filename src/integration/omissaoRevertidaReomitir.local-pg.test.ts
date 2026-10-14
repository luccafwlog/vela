import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// A8 (ADR 0083, item 8; migration 255): a unicidade da omissão de escala vale
// só entre as não revertidas. A revertida fica no histórico e o POD pode ser
// omitido de novo; omitir duas vezes sem reverter segue recusado.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '83080000-0000-4000-8000-000000000001'
const CARRIER_ID = 99083081
const VESSEL_ID = 99083082
const VOYAGE_ID = 99083083

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function runAsUser(sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function partialUniqueIndex(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT indexdef LIKE '%WHERE (reverted_at IS NULL)%' FROM pg_indexes WHERE indexname = 'voyage_omissions_voyage_id_omitted_pod_key';`) === 't'
  } catch {
    return false
  }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${USER_ID}' OR entity_id IN ('${VOYAGE_ID}', '${VOYAGE_ID}::BRVIX');
    DELETE FROM public.alert_item_events WHERE actor_id = '${USER_ID}';
    DELETE FROM public.voyage_omissions WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

const describeLocal = describeWithProbe(partialUniqueIndex, 'migration 255 (omissão única só entre não revertidas)')

describeLocal('Omissão de escala revertida pode ser registrada de novo (A8)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'a8-omissao@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'A8 Operações', 'operacoes', true);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador A8');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio A8', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'A8-01', 'active');
    `)
  })
  afterAll(cleanup)

  it('omite, reverte, omite de novo e recusa a duplicata não revertida', () => {
    const omit = (reason: string) => runAsUser(`SELECT public.omit_voyage_escala(${VOYAGE_ID}, 'BRVIX', 'BRSSA', '${reason}', '${USER_ID}')`)

    const first = omit('primeira')
    expect(first.error).toBe('')
    expect(omit('duplicata').error).toMatch(/ja foi omitida/)

    const firstId = psql(`SELECT id FROM public.voyage_omissions WHERE voyage_id = ${VOYAGE_ID} AND reverted_at IS NULL`)
    expect(runAsUser(`SELECT public.revert_voyage_omission(${firstId}, 'registrada por engano', '${USER_ID}')`).error).toBe('')

    expect(omit('de novo').error).toBe('')
    expect(psql(`SELECT count(*) || ':' || count(*) FILTER (WHERE reverted_at IS NULL) FROM public.voyage_omissions
      WHERE voyage_id = ${VOYAGE_ID} AND omitted_pod = 'BRVIX'`)).toBe('2:1')
    expect(psql(`SELECT reverted_at IS NOT NULL FROM public.voyage_omissions WHERE id = ${firstId}`)).toBe('t')
    expect(omit('duplicata outra vez').error).toMatch(/ja foi omitida/)
  })
})
