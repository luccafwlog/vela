// Etapa 14 do plano de correção das importações (migration 189; ADR 0078,
// item 9). Toda importação grava no Histórico de cada registro alterado o tipo
// de importação e o contexto (Viagem, Manifesto), além de quem, quando e os
// valores, sem lote, arquivo nem linha.
//
// Namespace exclusivo: ids 99236xxx, containers 'AZCU236xxxx', usuário ...0000002360NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const userId = '00000000-0000-0000-0000-000000236001'
const carrierId = 99236001
const vesselId = 99236002
const voyageId = 99236003
const cnpj = '99236004000130'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${userId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.vazios_importacao_containers WHERE manifest_id IN (SELECT id FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId});
    DELETE FROM public.vazios_importacao_manifests WHERE voyage_id = ${voyageId};
    DELETE FROM public.manifestos_mercante WHERE voyage_id = ${voyageId};
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}')
      OR account_id IN (SELECT a.id FROM public.customer_portal_accounts a JOIN public.customers c ON c.id = a.customer_id WHERE c.cnpj_cpf = '${cnpj}');
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}');
    DELETE FROM public.customer_contacts WHERE customer_id IN (SELECT id FROM public.customers WHERE cnpj_cpf = '${cnpj}');
    DELETE FROM public.customers WHERE cnpj_cpf = '${cnpj}';
    DELETE FROM public.audit_logs WHERE changed_by = '${userId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${userId}';
    DELETE FROM auth.users WHERE id = '${userId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('Rastro das importações no Histórico (migration 189)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${userId}', 'a236-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'A236 Documentação', 'documentacao', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A236 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A236 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A236', 'active');
    `)
  })

  afterAll(cleanup)

  it('Vazios de Importação: o manifesto criado leva tipo, Viagem e Manifesto', () => {
    const rows = [{ container_number: 'AZCU2360001', container_type: '40HC', tare_kg: 3800, pol: 'CNSHA', pod: 'BRVIX' }]
    const result = asUser(`SELECT public.import_vazios_importacao_transactional(${voyageId}, 'A236', '${userId}',
      '${JSON.stringify(rows)}'::jsonb, '[{"pol":"CNSHA","pod":"BRVIX","numero":"1226A23600001"}]'::jsonb);`)
    expect(result.stderr).toBe('')
    expect(psql(`SELECT DISTINCT justification FROM public.audit_logs
      WHERE changed_by = '${userId}' AND entity_type = 'vazios_importacao_manifests';`))
      .toBe('Importação de Vazios de Importação · Viagem A236 NAVIO A236 · Manifesto 1226A23600001')
  })

  it('Base de Clientes: o Cliente criado leva o tipo de importação; fora de importação não há contexto', () => {
    expect(asUser(`SELECT public.apply_customer_base_row_atomic('${cnpj}', 'A236 CLIENTE', NULL, NULL, NULL, NULL, NULL,
      '["a236@example.test"]'::jsonb, '${userId}', false);`).stderr).toBe('')
    expect(psql(`SELECT justification FROM public.audit_logs WHERE changed_by = '${userId}' AND entity_type = 'customers' AND field_name = 'criado';`))
      .toBe('Importação de Base de Clientes')

    // Edição manual na mesma sessão de banco, em outra transação: sem contexto de importação.
    asUser(`UPDATE public.customers SET trade_name = 'A236 FANTASIA' WHERE cnpj_cpf = '${cnpj}';`)
    expect(psql(`SELECT COALESCE(justification, '-') FROM public.audit_logs WHERE changed_by = '${userId}' AND entity_type = 'customers' AND field_name = 'trade_name';`))
      .toBe('-')
  })
})
