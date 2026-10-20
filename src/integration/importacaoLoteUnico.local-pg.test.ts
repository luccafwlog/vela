// Regra de 2026-10-19 (lote 6a): importação com erro é recusada inteira. As
// RPCs de lote único das datas de container (migration 333) e da Base de
// Clientes (migration 334) desfazem tudo quando o banco recusa uma linha, e
// devolvem o que foi recusado.
//
// Namespace exclusivo: ids 99325xxx, B/Ls 'L333-*', usuário ...000000325001.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000325001'
const customerId = 99325001
const carrierId = 99325002
const vesselId = 99325003
const voyageId = 99325004
const blA = 'L333-BL-A'
const blB = 'L333-BL-B'
const containerA = 'LAAA3250001'
const containerB = 'LBBB3250002'
const containerIds = [99325005, 99325006]
const ownerCnpj = syntheticCnpj(32501)
const baseCnpjOk = syntheticCnpj(32502)
const baseCnpjBad = syntheticCnpj(32503)
const baseCnpjs = [baseCnpjOk, baseCnpjBad].map((cnpj) => `'${cnpj}'`).join(', ')

function asUser(sql: string): string {
  return execPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function cleanup() {
  asUser(`
    SET session_replication_role = replica;
    DELETE FROM public.import_pending_effects WHERE entity_id IN ('${blA}', '${blB}');
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}' OR entity_id IN ('${blA}', '${blB}');
    DELETE FROM public.bl_containers WHERE id = ANY(ARRAY[${containerIds.join(',')}]::bigint[]);
    DELETE FROM public.bls WHERE id IN ('${blA}', '${blB}');
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs}) OR id = ${customerId});
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs}) OR id = ${customerId}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs}) OR id = ${customerId});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs}) OR id = ${customerId});
    DELETE FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs}) OR id = ${customerId};
    SET session_replication_role = origin;
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
  `)
}

describeLocal('Importação com erro não grava nada (migrations 333 e 334)', () => {
  beforeAll(() => {
    cleanup()
    asUser(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'l333@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'L333', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${ownerCnpj}', 'Cliente L333');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier L333');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel L333', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'L333', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode) VALUES
        ('${blA}', ${voyageId}, ${customerId}, 'container'),
        ('${blB}', ${voyageId}, ${customerId}, 'container');
      INSERT INTO public.bl_containers (id, bl_id, container_number) VALUES
        (${containerIds[0]}, '${blA}', '${containerA}'),
        (${containerIds[1]}, '${blB}', '${containerB}');
    `)
  })

  afterAll(cleanup)

  it('datas: um B/L recusado desfaz os outros e a resposta lista a recusa', () => {
    const result = JSON.parse(asUser(`
      SELECT public.apply_container_dates_batch_atomic(gen_random_uuid(), '[
        {"bl_id":"${blA}","rows":[{"container_number":"${containerA}","discharge_date":"2026-01-10","return_date":null}]},
        {"bl_id":"${blB}","rows":[{"container_number":"L333MISSING","discharge_date":"2026-01-10","return_date":null}]}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; errors: Array<{ bl_id: string; message: string }> }

    expect(result.ok).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].bl_id).toBe(blB)
    expect(result.errors[0].message).toMatch(/L333MISSING/)
    // O B/L aceito não ficou gravado, nem o Histórico da importação.
    expect(asUser(`SELECT count(*) FROM public.bl_containers WHERE id = ${containerIds[0]} AND discharge_date IS NULL;`)).toBe('1')
    expect(asUser(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${blA}' AND field_name = 'container_dates_import';`)).toBe('0')
  })

  it('datas: o arquivo sem recusa grava todos os B/Ls numa chamada', () => {
    const result = JSON.parse(asUser(`
      SELECT public.apply_container_dates_batch_atomic(gen_random_uuid(), '[
        {"bl_id":"${blA}","rows":[{"container_number":"${containerA}","discharge_date":"2026-01-10","return_date":null}]},
        {"bl_id":"${blB}","rows":[{"container_number":"${containerB}","discharge_date":"2026-01-11","return_date":"2026-01-15"}]}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; updated: number; bls: number }

    expect(result).toMatchObject({ ok: true, updated: 2, bls: 2 })
    expect(asUser(`SELECT discharge_date::text FROM public.bl_containers WHERE id = ${containerIds[1]};`)).toBe('2026-01-11')
  })

  it('datas: ator diferente da sessão é recusado antes de qualquer gravação', () => {
    expect(() => asUser(`
      SELECT public.apply_container_dates_batch_atomic(gen_random_uuid(),
        '[{"bl_id":"${blA}","rows":[{"container_number":"${containerA}","discharge_date":"2026-02-10"}]}]'::jsonb,
        '00000000-0000-0000-0000-000000325999'::uuid);
    `)).toThrow()
    expect(asUser(`SELECT discharge_date::text FROM public.bl_containers WHERE id = ${containerIds[0]};`)).toBe('2026-01-10')
  })

  it('base de clientes: um Cliente recusado desfaz os outros', () => {
    const result = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 CLIENTE OK","emails":["ok@l325.example.test"]},
        {"cnpj":"${baseCnpjBad}","name":"L333 CLIENTE RUIM","emails":["sem-arroba"]}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; errors: Array<{ cnpj: string; message: string }> }

    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.cnpj)).toEqual([baseCnpjBad])
    expect(asUser(`SELECT count(*) FROM public.customers WHERE cnpj_cpf IN (${baseCnpjs});`)).toBe('0')
  })

  it('base de clientes: o arquivo sem recusa grava todos; troca de razão social exige o nome que a prévia viu', () => {
    const result = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 CLIENTE OK","emails":["ok@l325.example.test"]},
        {"cnpj":"${baseCnpjBad}","name":"L333 CLIENTE DOIS","emails":["dois@l325.example.test"]}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; imported: number; contacts_created: number }
    expect(result).toMatchObject({ ok: true, imported: 2, contacts_created: 2 })

    const stale = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 NOME NOVO","emails":["ok@l325.example.test"],
         "confirm_name_change":true,"expected_current_name":"OUTRO NOME"}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; errors: Array<{ message: string }> }
    expect(stale.ok).toBe(false)
    expect(stale.errors[0].message).toMatch(/mudou depois da prévia/)
    expect(asUser(`SELECT name FROM public.customers WHERE cnpj_cpf = '${baseCnpjOk}';`)).toBe('L333 CLIENTE OK')

    const renamed = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 NOME NOVO","emails":["ok@l325.example.test"],
         "confirm_name_change":true,"expected_current_name":"L333 CLIENTE OK"}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; updated: number }
    expect(renamed).toMatchObject({ ok: true, updated: 1 })
    expect(asUser(`SELECT name FROM public.customers WHERE cnpj_cpf = '${baseCnpjOk}';`)).toBe('L333 NOME NOVO')
  })

  // A tela manda o nome como o banco o devolveu; a RPC compara exatamente,
  // sem `btrim` (que não tira NBSP, ao contrário do trim do navegador).
  it('base de clientes: o nome de antes é conferido exatamente como gravado', () => {
    asUser(`UPDATE public.customers SET name = E'L333 NOME NOVO\\u00a0' WHERE cnpj_cpf = '${baseCnpjOk}';`)
    const trimmed = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 TERCEIRO","emails":["ok@l325.example.test"],
         "confirm_name_change":true,"expected_current_name":"L333 NOME NOVO"}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; errors: Array<{ message: string }> }
    expect(trimmed.ok).toBe(false)
    expect(trimmed.errors[0].message).toMatch(/mudou depois da prévia/)

    const exact = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${baseCnpjOk}","name":"L333 TERCEIRO","emails":["ok@l325.example.test"],
         "confirm_name_change":true,"expected_current_name":"L333 NOME NOVO\\u00a0"}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean }
    expect(exact.ok).toBe(true)
    expect(asUser(`SELECT name FROM public.customers WHERE cnpj_cpf = '${baseCnpjOk}';`)).toBe('L333 TERCEIRO')
  })

  it('base de clientes: recusas de vários Clientes apontam cada CNPJ, em ordem de CNPJ', () => {
    // Nomes já gravados pelos testes anteriores: só o e-mail é recusado.
    const names: Record<string, string> = { [baseCnpjOk]: 'L333 TERCEIRO', [baseCnpjBad]: 'L333 CLIENTE DOIS' }
    const [first, second] = [baseCnpjOk, baseCnpjBad].sort()
    const result = JSON.parse(asUser(`
      SELECT public.apply_customer_base_batch_atomic('[
        {"cnpj":"${second}","name":"${names[second]}","emails":["sem-arroba-2"]},
        {"cnpj":"${first}","name":"${names[first]}","emails":["sem-arroba-1"]}
      ]'::jsonb, '${actorId}'::uuid);
    `)) as { ok: boolean; errors: Array<{ cnpj: string; message: string }> }
    expect(result.ok).toBe(false)
    expect(result.errors.map((error) => error.cnpj)).toEqual([first, second])
    expect(result.errors[0].message).toMatch(/sem-arroba-1/)
  })

  it('datas: planilha acima de 300 B/Ls é recusada antes de gravar (teto de 60 s)', () => {
    expect(() => asUser(`
      SELECT public.apply_container_dates_batch_atomic(gen_random_uuid(),
        (SELECT jsonb_agg(jsonb_build_object('bl_id', 'L333-X' || g, 'rows', '[]'::jsonb)) FROM generate_series(1, 301) g),
        '${actorId}'::uuid);
    `)).toThrow(/mais de 300 B\/Ls/)
  })
})
