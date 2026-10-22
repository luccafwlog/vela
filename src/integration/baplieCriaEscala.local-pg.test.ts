// Revisão manual de 2026-10-22 (GREEN ITAJAI / 11), itens D1 e D2:
// - migration 410: BRSEP (Sepetiba) é apelido de BRIGI (Itaguaí) na régua do
//   banco, como BRVIT de BRVIX;
// - migration 411: o Baplie com containers num porto brasileiro que não é
//   escala da Viagem cria a escala quando o operador marca o porto
//   (`p_file.new_escalas`), na mesma transação; sem marcar, a gravação continua
//   recusando o container fora das escalas.
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
const cancelledVoyageId = 99411004
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
    return psql(`SELECT position('new_escalas' IN prosrc) > 0 FROM pg_proc WHERE proname = 'import_baplie_file_atomic'`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(probe, 'migrations 410 e 411 aplicadas')

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

function importBaplie(voyage: number, list: Array<{ container_number: string; pod: string }>, pods: string[], newEscalas: string[]) {
  return asUser(`SELECT public.import_baplie_file_atomic(${voyage}, $r$${JSON.stringify(rows(list))}$r$::jsonb,
    ARRAY[${pods.map((pod) => `'${pod}'`).join(',')}]::text[], '${expected(voyage)}'::jsonb,
    '${JSON.stringify({ voyage_number: '11', new_escalas: newEscalas })}'::jsonb)`)
}

function eligiblePods(voyage: number): string {
  return psql(`SELECT string_agg(pod, ',' ORDER BY pod) FROM public.get_voyage_eligible_pods(${voyage})`)
}

function cleanup() {
  psql(`
    SET LOCAL session_replication_role = replica;
    DELETE FROM public.baplie_containers WHERE voyage_id IN (${voyageId}, ${cancelledVoyageId});
    DELETE FROM public.alert_items WHERE metadata->>'voyage_id' IN ('${voyageId}', '${cancelledVoyageId}')
      OR alert_id IN (SELECT id FROM public.alerts WHERE entity_id IN ('${voyageId}', '${cancelledVoyageId}')
        OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${cancelledVoyageId}::%');
    DELETE FROM public.alerts WHERE entity_id IN ('${voyageId}', '${cancelledVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${cancelledVoyageId}::%';
    DELETE FROM public.internal_notifications WHERE entity_id IN ('${voyageId}', '${cancelledVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${cancelledVoyageId}::%';
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id IN ('${voyageId}', '${cancelledVoyageId}')
      OR entity_id LIKE '${voyageId}::%' OR entity_id LIKE '${cancelledVoyageId}::%';
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageId}, ${cancelledVoyageId});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageId}, ${cancelledVoyageId});
    DELETE FROM public.voyages WHERE id IN (${voyageId}, ${cancelledVoyageId});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}'
  `)
}

describeLocal('Baplie cria a escala do porto marcado e BRSEP é BRIGI (410, 411)', () => {
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
        (${cancelledVoyageId}, ${vesselId}, 'D411C', 'active');
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
        ('voyage_pod_schedule', '${voyageId}::BRVIX', 'eta', NULL, '${eta}', '${actorId}'),
        ('voyage_pod_schedule', '${cancelledVoyageId}::BRVIX', 'eta', NULL, '${eta}', '${actorId}');
      -- Fixture: o gatilho exige cancel_voyage; aqui só importa o status retido.
      SET LOCAL session_replication_role = replica;
      UPDATE public.voyages SET status = 'cancelled' WHERE id = ${cancelledVoyageId}
    `)
  })

  afterAll(cleanup)

  it('410: Sepetiba e seus códigos levam a BRIGI, como Itaguaí', () => {
    expect(psql(`SELECT string_agg(public.normalize_port_code(v), ',' ORDER BY o)
      FROM unnest(ARRAY['BRSEP', 'SEPETIBA', 'BRSPB', 'SPB', 'SEP', 'BRIGI', 'Itaguaí', 'BRVIT']) WITH ORDINALITY AS t(v, o)`))
      .toBe('BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRIGI,BRVIX')
  })

  it('sem marcar o porto, o container fora das escalas continua recusado e nada é criado', () => {
    const result = importBaplie(voyageId, [
      { container_number: 'DQCU4110001', pod: 'BRVIX' },
      { container_number: 'DQCU4110002', pod: 'BRSEP' },
    ], ['BRVIX', 'BRSEP'], [])
    expect(result.error).toMatch(/descarregam fora das escalas da Viagem/)
    expect(eligiblePods(voyageId)).toBe('BRVIX')
  })

  it('porto estrangeiro não vira escala', () => {
    const result = importBaplie(voyageId, [{ container_number: 'DQCU4110003', pod: 'SGSIN' }], ['SGSIN'], ['SGSIN'])
    expect(result.error).toMatch(/Só porto brasileiro vira escala da Viagem \(SGSIN\)/)
    expect(eligiblePods(voyageId)).toBe('BRVIX')
  })

  it('Viagem cancelada não ganha escala', () => {
    const result = importBaplie(cancelledVoyageId, [{ container_number: 'DQCU4110004', pod: 'BRIGI' }], ['BRIGI'], ['BRIGI'])
    expect(result.error).toMatch(/Viagem cancelada é somente leitura/)
    expect(eligiblePods(cancelledVoyageId)).toBe('BRVIX')
  })

  it('porto marcado cria a escala BRIGI (o BRSEP do arquivo) e importa os containers numa transação', () => {
    const result = importBaplie(voyageId, [
      { container_number: 'DQCU4110001', pod: 'BRVIX' },
      { container_number: 'DQCU4110002', pod: 'BRSEP' },
      { container_number: 'DQCU4110005', pod: 'BRSEP' },
    ], ['BRVIX', 'BRSEP'], ['BRSEP'])
    expect(result.error).toBeNull()
    expect(JSON.parse(result.output)).toMatchObject({ staged: 3, escalas_criadas: ['BRIGI'] })
    expect(eligiblePods(voyageId)).toBe('BRIGI,BRVIX')
    // A escala nasce no Histórico com quem importou e o motivo.
    expect(psql(`SELECT string_agg(field_name || '=' || new_value || '|' || changed_by || '|' || justification, ';' ORDER BY field_name)
      FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '${voyageId}::BRIGI'`))
      .toBe([
        `deleted=false|${actorId}|Escala criada pela importação do Baplie (containers com descarga em BRIGI)`,
        `tem_importacao=true|${actorId}|Escala criada pela importação do Baplie (containers com descarga em BRIGI)`,
      ].join(';'))
    expect(psql(`SELECT count(*) FROM public.baplie_containers WHERE voyage_id = ${voyageId}
      AND public.normalize_port_code(pod) = 'BRIGI'`)).toBe('2')
  })

  it('reimportar com a escala já criada não a cria de novo', () => {
    const result = importBaplie(voyageId, [
      { container_number: 'DQCU4110002', pod: 'BRIGI' },
      { container_number: 'DQCU4110005', pod: 'BRIGI' },
    ], ['BRIGI'], ['BRIGI'])
    expect(result.error).toBeNull()
    expect(JSON.parse(result.output)).toMatchObject({ escalas_criadas: [] })
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '${voyageId}::BRIGI'`)).toBe('2')
  })

  it('escala omitida não é recriada pelo Baplie', () => {
    psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by) VALUES
      ('voyage_pod_schedule', '${voyageId}::BRSSA', 'omitted', NULL, 'true', '${actorId}')`)
    const result = importBaplie(voyageId, [{ container_number: 'DQCU4110006', pod: 'BRSSA' }], ['BRSSA'], ['BRSSA'])
    expect(result.error).toMatch(/A escala de BRSSA foi omitida/)
  })
})
