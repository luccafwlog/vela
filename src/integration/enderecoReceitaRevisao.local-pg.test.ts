// Endereço da Receita no cadastro do Cliente pela Revisão (migration 596,
// ADR 0127): `complete_review_customer_group` grava o perfil (`p_profile`)
// só no Cliente que ela cria; o já cadastrado não muda; UF e CEP fora do
// formato viram nulos; a chamada sem perfil continua igual; anon não executa.
//
// Namespace exclusivo: CNPJs 99595xxx, B/Ls 'A595-*', usuário ...000000595001.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const DOC = '00000000-0000-0000-0000-000000595001'
const carrierId = 99595001
const vesselId = 99595002
const voyageId = 99595003
const existingId = 99595004
const CNPJ_NEW = '99595001000193'
const CNPJ_EXISTING = '99595002000138'
const CNPJ_NO_PROFILE = '99595003000182'
const CNPJS = [CNPJ_NEW, CNPJ_EXISTING, CNPJ_NO_PROFILE]
const cnpjList = CNPJS.map((value) => `'${value}'`).join(', ')
const BL_NEW = 'A595-NOVO'
const BL_EXISTING = 'A595-EXISTENTE'
const BL_NO_PROFILE = 'A595-SEMPERFIL'
const bls = [BL_NEW, BL_EXISTING, BL_NO_PROFILE]
const blList = bls.map((id) => `'${id}'`).join(', ')
const customersOf = `SELECT id FROM public.customers WHERE cnpj_cpf IN (${cnpjList})`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(user: string, sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${user}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function onboard(bl: string, cnpj: string, profile: unknown | undefined) {
  const profileArg = profile === undefined ? '' : `, p_profile => '${JSON.stringify(profile)}'::jsonb`
  return asUser(DOC, `SELECT public.complete_review_customer_group(p_bl_ids => ARRAY['${bl}'], p_customer_id => NULL, p_cnpj_cpf => '${cnpj}', p_name => 'A595 CLIENTE LTDA', p_email => 'a595-${bl.toLowerCase()}@example.test', p_changed_by => '${DOC}'${profileArg});`)
}

const receitaProfile = { trade_name: 'A595 FANTASIA', address: 'AVENIDA A595, 10 - CENTRO', city: 'VITORIA', state: 'es', zip: '29010-000' }

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.billing_run_logs WHERE bl_id IN (${blList});
    DELETE FROM public.charge_calculations WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.audit_logs WHERE entity_id IN (${blList}) OR changed_by = '${DOC}';
    DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${customersOf});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_contact_preferences WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (${customersOf}));
    DELETE FROM public.customer_contacts WHERE customer_id IN (${customersOf});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customersOf});
    DELETE FROM public.customers WHERE cnpj_cpf IN (${cnpjList});
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${DOC}';
    DELETE FROM auth.users WHERE id = '${DOC}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Endereço da Receita no cadastro pela Revisão (migration 596)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${DOC}', 'a595-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${DOC}', 'A595 Documentação', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A595 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A595 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A595', 'active');
      INSERT INTO public.customers (id, cnpj_cpf, name, address, city, state, zip) VALUES
        (${existingId}, '${CNPJ_EXISTING}', 'A595 EXISTENTE LTDA', 'Rua Antiga, 1', 'Serra', 'ES', '29160000');
      INSERT INTO public.bls (id, voyage_id, pol, pod, cargo_mode, consignee, manifest_customer_cnpj_cpf, customer_reconciliation_status, review_status) VALUES
        ('${BL_NEW}', ${voyageId}, 'A595O', 'A595P', 'container', 'A595 NOVO', '${CNPJ_NEW}', 'missing_customer', 'pending_review'),
        ('${BL_EXISTING}', ${voyageId}, 'A595O', 'A595P', 'container', 'A595 EXISTENTE', '${CNPJ_EXISTING}', 'missing_customer', 'pending_review'),
        ('${BL_NO_PROFILE}', ${voyageId}, 'A595O', 'A595P', 'container', 'A595 SEM PERFIL', '${CNPJ_NO_PROFILE}', 'missing_customer', 'pending_review');
    `)
  })

  afterAll(cleanup)

  it('o Cliente criado pela Revisão recebe nome fantasia, endereço, cidade, UF e CEP normalizados', () => {
    const run = onboard(BL_NEW, CNPJ_NEW, receitaProfile)
    expect(run.stderr).toBe('')
    expect(psql(`SELECT concat_ws('|', trade_name, address, city, state, zip) FROM public.customers WHERE cnpj_cpf = '${CNPJ_NEW}';`))
      .toBe('A595 FANTASIA|AVENIDA A595, 10 - CENTRO|VITORIA|ES|29010000')
    expect(psql(`SELECT customer_id IS NOT NULL FROM public.bls WHERE id = '${BL_NEW}';`)).toBe('t')
  })

  it('o Cliente já cadastrado com o CNPJ não muda', () => {
    const run = onboard(BL_EXISTING, CNPJ_EXISTING, receitaProfile)
    expect(run.stderr).toBe('')
    expect(psql(`SELECT concat_ws('|', name, trade_name, address, city, state, zip) FROM public.customers WHERE id = ${existingId};`))
      .toBe('A595 EXISTENTE LTDA|Rua Antiga, 1|Serra|ES|29160000')
    expect(psql(`SELECT customer_id FROM public.bls WHERE id = '${BL_EXISTING}';`)).toBe(String(existingId))
  })

  it('sem perfil, a chamada de antes continua: Cliente só com CNPJ e razão social', () => {
    const run = onboard(BL_NO_PROFILE, CNPJ_NO_PROFILE, undefined)
    expect(run.stderr).toBe('')
    expect(psql(`SELECT concat_ws('|', name, coalesce(address, '-'), coalesce(state, '-'), coalesce(zip, '-')) FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}';`))
      .toBe('A595 CLIENTE LTDA|-|-|-')
  })

  it('UF e CEP fora do formato viram nulos; perfil que não é objeto é recusado', () => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.customer_contact_change_events WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}');
      DELETE FROM public.customer_contact_box_links WHERE contact_id IN (SELECT id FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}'));
      DELETE FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}');
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}');
      UPDATE public.bls SET customer_id = NULL, review_status = 'pending_review', customer_reconciliation_status = 'missing_customer' WHERE id = '${BL_NO_PROFILE}';
      DELETE FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}';
      SET session_replication_role = origin;
    `)
    const refused = onboard(BL_NO_PROFILE, CNPJ_NO_PROFILE, ['endereço'])
    expect(refused.stderr).toMatch(/Dados cadastrais do cliente em formato inválido/)
    expect(psql(`SELECT count(*) FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}';`)).toBe('0')

    const run = onboard(BL_NO_PROFILE, CNPJ_NO_PROFILE, { address: 'RUA B, 2', state: 'Espírito Santo', zip: '2901' })
    expect(run.stderr).toBe('')
    expect(psql(`SELECT concat_ws('|', address, coalesce(state, '-'), coalesce(zip, '-')) FROM public.customers WHERE cnpj_cpf = '${CNPJ_NO_PROFILE}';`))
      .toBe('RUA B, 2|-|-')
  })

  it('só authenticated executa a função nova; anon e PUBLIC não', () => {
    const signature = 'public.complete_review_customer_group(text[], bigint, text, text, text, uuid, jsonb)'
    expect(psql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE')::text || '|' || has_function_privilege('anon', '${signature}', 'EXECUTE')::text;`)).toBe('true|false')
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname = 'complete_review_customer_group';`)).toBe('1')
  })
})
