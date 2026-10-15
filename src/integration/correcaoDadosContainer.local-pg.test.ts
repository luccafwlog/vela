import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000292001'
const blA = 'DADOS292-A'
const blB = 'DADOS292-B'
const blCancelled = 'DADOS292-CANC'
const carrierId = 2920011
const vesselId = 2920012
const voyageId = 2920013
const containerA = 2920001
const containerB = 2920002
const containerCancelled = 2920003

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function asAuthenticated(sql: string): { ok: boolean; output: string } {
  const result = spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}`.trim() }
}

function container(id: number): string {
  return psql(`SELECT concat_ws(',', seal_number, trim_scale(gross_weight_kg)::text, trim_scale(cbm)::text) FROM public.bl_containers WHERE id = ${id}`)
}

function auditFields(id: number): string {
  return psql(`SELECT string_agg(split_part(field_name, '|', 1), ',' ORDER BY field_name) FROM public.audit_logs WHERE entity_type = 'bl_container' AND entity_id = '${id}'`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'bl_container' AND entity_id IN ('${containerA}', '${containerB}', '${containerCancelled}');
    DELETE FROM public.bl_containers WHERE bl_id LIKE 'DADOS292-%';
    DELETE FROM public.bls WHERE id LIKE 'DADOS292-%';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

// Part Lot: o container MSDU2920001 está nos B/Ls A (faturado) e B, cada um com
// o peso e o CBM da sua parte; o lacre é o mesmo.
describeLocal('correct_bl_container_data — lacre, peso e CBM no Part Lot (289/292)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'dados292@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Dados 292', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Dados292 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Dados292 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'D292', 'active');
      SET session_replication_role = replica;
      INSERT INTO public.bls (id, voyage_id, cargo_mode, pod, financial_status, cancelled_at) VALUES
        ('${blA}', ${voyageId}, 'container', 'BRVIX', 'invoiced', NULL),
        ('${blB}', ${voyageId}, 'container', 'BRVIX', NULL, NULL),
        ('${blCancelled}', ${voyageId}, 'container', 'BRVIX', NULL, now());
      INSERT INTO public.bl_containers (id, bl_id, container_number, seal_number, gross_weight_kg, cbm) VALUES
        (${containerA}, '${blA}', 'MSDU2920001', 'S-100', 8000, 20),
        (${containerB}, '${blB}', 'MSDU2920001', 'S-100', 4000, 10),
        (${containerCancelled}, '${blCancelled}', 'MSDU2920003', 'S-300', 1000, 5);
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('corrigir só o lacre não leva o peso e o CBM do B/L A para o B/L B', () => {
    const result = asAuthenticated(`SELECT public.correct_bl_container_data(${containerA}, 'S-200', 8000, 20, 'Lacre trocado na vistoria');`)
    expect(result.ok, result.output).toBe(true)
    expect(container(containerA)).toBe('S-200,8000,20')
    expect(container(containerB)).toBe('S-200,4000,10')
    expect(auditFields(containerA)).toBe('seal_number')
    expect(auditFields(containerB)).toBe('seal_number')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE entity_type = 'bl_container' AND entity_id = '${containerB}'`))
      .toBe(`Lacre trocado na vistoria (mesmo container do B/L ${blA}, Part Lot)`)
  })

  it('o campo corrigido vale para o Part Lot, também com o B/L faturado', () => {
    const result = asAuthenticated(`SELECT public.correct_bl_container_data(${containerA}, 'S-200', 8200, 20, 'Peso conferido na balança');`)
    expect(result.ok, result.output).toBe(true)
    expect(container(containerA)).toBe('S-200,8200,20')
    expect(container(containerB)).toBe('S-200,8200,10')
  })

  it('recusa quando nada mudou no container aberto, mesmo que o Part Lot difira', () => {
    const result = asAuthenticated(`SELECT public.correct_bl_container_data(${containerA}, 'S-200', 8200, 20, 'Sem mudança');`)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('Nenhum dado do container mudou')
    expect(container(containerB)).toBe('S-200,8200,10')
  })

  it('exige justificativa e recusa B/L cancelado e número negativo', () => {
    expect(asAuthenticated(`SELECT public.correct_bl_container_data(${containerA}, 'S-9', 1, 1, '  ');`).output).toContain('justificativa')
    expect(asAuthenticated(`SELECT public.correct_bl_container_data(${containerA}, 'S-9', -1, 1, 'x');`).output).toContain('negativo')
    expect(asAuthenticated(`SELECT public.correct_bl_container_data(${containerCancelled}, 'S-9', 1000, 5, 'x');`).output).toContain('cancelado')
    expect(container(containerCancelled)).toBe('S-300,1000,5')
  })
})
