// Revisão manual de 2026-10-22 (GREEN ITAJAI / 11), itens D1 e D2:
// - migration 410: BRSEP (Sepetiba) é apelido de BRIGI (Itaguaí) na régua do
//   banco, como BRVIT de BRVIX;
// - migration 418 (D1 revisado pelo dono em 2026-10-23): o Baplie nunca cria
//   escala nem depende dela. O porto brasileiro marcado que não é escala da
//   Viagem entra sem escala; porto estrangeiro fora das escalas e escala
//   omitida continuam recusados. (A 411, que criava a escala, foi substituída.)
//
// Namespace exclusivo: ids 99411xxx, containers 'DQCU411xxxx', usuário ...000411001.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { execPsql, spawnPsql } from './localPsql'
import { describeWithProbe } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000411001'
const carrierId = 99411001
const vesselId = 99411002
const voyageId = 99411003
const noEscalaVoyageId = 99411004
const claims = `SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${actorId}';`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${claims} ${sql}; COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Papel `authenticated`, como o PostgREST executa a chamada da tela. */
function asUser(sql: string): { output: string; error: string | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; ${claims} ${sql}; COMMIT;`], { encoding: 'utf8' })
  const error = run.stderr.split('\n').find((line) => line.startsWith('ERROR:')) ?? null
  return { output: run.stdout.trim(), error: error?.trim() ?? null }
}

function probe(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('portos_sem_escala' IN prosrc) > 0 FROM pg_proc WHERE proname = 'import_baplie_file_atomic'`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migrations 410 e 418 aplicadas')

function rows(list: Array<{ container_number: string; pod: string }>) {
  return list.map((row) => ({
    container_number: row.container_number, size_type: '40HC', status: 'full', weight_kg: 3800,
    pol: 'CNTAO', pod: row.pod, final_dest: null, bl_ref: null, slot: null,
    is_imo: false, imo_class: null, un_number: null, is_oog: false, ownership: null,
  }))
}

function expected(voyage: number): string {
  return psql(`SELECT (public._baplie_staging_version(${voyage}) || jsonb_build_object('vazios_manifest', NULL))::text`)
}

function importBaplie(voyage: number, list: Array<{ container_number: string; pod: string }>, pods: string[], file: Record<string, unknown> = {}) {
  return asUser(`SELECT public.import_baplie_file_atomic(${voyage}, $r$${JSON.stringify(rows(list))}$r$::jsonb,
    ARRAY[${pods.map((pod) => `'${pod}'`).join(',')}]::text[], '${expected(voyage)}'::jsonb,
    '${JSON.stringify({ voyage_number: '11', ...file })}'::jsonb)`)
}

function podScheduleRows(voyage: number, pod: string): string {
  return psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule'
    AND entity_id LIKE '${voyage}::%' AND public.normalize_port_code(split_part(entity_id, '::', 2)) = '${pod}'`)
}

function eligiblePods(voyage: number): string {
  return psql(`SELECT string_agg(pod, ',' ORDER BY pod) FROM public.get_voyage_eligible_pods(${voyage})`)
}

function cleanup() {
  psql(`
    SET LOCAL session_replication_role = replica;
    DELETE FROM public.baplie_containers WHERE voyage_id IN (${voyageId}, ${noEscalaVoyageId});
    DELETE FROM public.alert_items WHERE metadata->>'voyage_id' IN ('${voyageId}', '${noEscalaVoyageId}')
      OR alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN ('${voyageId}', '${noEscalaVoyageId}')
        OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${noEscalaVoyageId}::%');
    DELETE FROM public.alerts WHERE entity_id IN ('${voyageId}', '${noEscalaVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${noEscalaVoyageId}::%';
    DELETE FROM public.internal_notifications WHERE entity_id IN ('${voyageId}', '${noEscalaVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${noEscalaVoyageId}::%';
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id IN ('${voyageId}', '${noEscalaVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${noEscalaVoyageId}::%';
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageId}, ${noEscalaVoyageId});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageId}, ${noEscalaVoyageId});
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${noEscalaVoyageId});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

describeLocal('Baplie importa porto sem escala sem criar escala e BRSEP é BRIGI (410, 418)', () => {
  beforeAll(() => {
    cleanup()
    const eta = psql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 60)::text`)
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'd411@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'D411 Operações', 'operacoes', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'D411 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'D411 GREEN ITAJAI', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageId}, ${vesselId}, 'D411', 'active'),
        (${noEscalaVoyageId}, ${vesselId}, 'D411S', 'active');
      -- Só a primeira Viagem tem escala (BRVIX); a segunda não tem nenhuma.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
        ('voyage_pod_schedule', '${voyageId}::BRVIX', 'eta', NULL, '${eta}', '${actorId}')
    `)
  })

  afterAll(cleanup)

  it('410: Sepetiba e seus códigos levam a BRIGI, como Itaguaí', () => {
    expect(psql(`SELECT string_agg(public.normalize_port_code(v), ',' ORDER BY o)
      FROM unnest(ARRAY['BRSEP', 'SEPETIBA', 'BRSPB', 'SPB', 'SEP', 'BRIGI', 'Itaguaí', 'BRVIT']) WITH ORDINALITY AS t(v, o)`))
      .toBe('BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRVIX')
  })

  it('porto brasileiro marcado que não é escala entra sem escala, e nenhuma escala é criada (nem pedindo)', () => {
    // `new_escalas` é o campo da 411: continua aceito e não cria nada.
    const result = importBaplie(voyageId, [
      { container_number: 'DQCU4110001', pod: 'BRVIX' },
      { container_number: 'DQCU4110002', pod: 'BRSEP' },
      { container_number: 'DQCU4110005', pod: 'BRSEP' },
    ], ['BRVIX', 'BRSEP'], { new_escalas: ['BRSEP'] })
    expect(result.error).toBeNull()
    expect(JSON.parse(result.output)).toMatchObject({ staged: 3, portos_sem_escala: ['BRIGI'] })
    expect(eligiblePods(voyageId)).toBe('BRVIX')
    expect(podScheduleRows(voyageId, 'BRIGI')).toBe('0')
    expect(psql(`SELECT count(*) FROM public.baplie_containers WHERE voyage_id = ${voyageId}
      AND public.normalize_port_code(pod) = 'BRIGI'`)).toBe('2')
  })

  it('porto estrangeiro fora das escalas continua recusado', () => {
    const result = importBaplie(voyageId, [{ container_number: 'DQCU4110003', pod: 'SGSIN' }], ['SGSIN'])
    expect(result.error).toMatch(/porto estrangeiro fora das escalas da Viagem \(SGSIN\)/)
  })

  it('escala omitida continua recusada: o Baplie não contradiz a omissão', () => {
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
      ('voyage_pod_schedule', '${voyageId}::BRSSA', 'omitted', NULL, 'true', '${actorId}')`)
    const result = importBaplie(voyageId, [{ container_number: 'DQCU4110006', pod: 'BRSSA' }], ['BRSSA'])
    expect(result.error).toMatch(/A escala de BRSSA foi omitida/)
  })

  it('Viagem sem nenhuma escala importa todos os portos, sem conferir e sem criar escala', () => {
    const result = importBaplie(noEscalaVoyageId, [
      { container_number: 'DQCU4110007', pod: 'BRSSZ' },
      { container_number: 'DQCU4110008', pod: 'BRPNG' },
    ], ['BRSSZ', 'BRPNG'])
    expect(result.error).toBeNull()
    expect(JSON.parse(result.output)).toMatchObject({ staged: 2, portos_sem_escala: [] })
    expect(eligiblePods(noEscalaVoyageId)).toBe('')
  })
})
