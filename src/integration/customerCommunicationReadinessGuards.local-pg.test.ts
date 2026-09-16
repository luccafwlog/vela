import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const customerId = 9710
const carrierId = 9711
const vesselId = 9712
const voyageId = 9713
const blId = 'S10-READINESS-BL'
const communicationId = 9714
const customerCnpj = syntheticCnpj(101001)

function psql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function cleanup(): void {
  psql(`
    DELETE FROM public.customer_communication_attempts WHERE communication_id = ${communicationId};
    DELETE FROM public.customer_communications WHERE id = ${communicationId};
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE 'ce_mercante_taxas:${customerId}:%';
    DELETE FROM public.bls WHERE id = '${blId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    SET session_replication_role = replica;
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    SET session_replication_role = origin;
  `)
}

describeLocal('S10 — guardas de readiness de CE Mercante', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '${customerCnpj}', 'S10 Readiness QA');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S10 Readiness');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S10 Readiness', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'S10R', 'active');
      SET session_replication_role = replica;
      INSERT INTO public.bls (
        id, voyage_id, customer_id, cargo_mode, ce_mercante, financial_status,
        review_status, customer_reconciliation_status
      ) VALUES (
        '${blId}', ${voyageId}, ${customerId}, 'container', '123456789012345',
        'invoiced', 'reviewed', 'reconciled'
      );
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('protege criação, claim e envio, revalidando todos os B/Ls da viagem', () => {
    psql(`
      INSERT INTO public.customer_communications (
        id, customer_id, kind, nature, anchor_voyage_id, status
      ) VALUES (
        ${communicationId}, ${customerId}, 'ce_mercante_taxas', 'documentacao', ${voyageId}, 'simulado'
      );
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES ('ce_mercante_taxas:${customerId}:${voyageId}');
    `)
    expect(psql(`SELECT public.customer_local_charges_communication_dispatch_ready(${voyageId}, ${customerId})->>'ready';`)).toBe('true')

    psql(`UPDATE public.bls SET ce_mercante = NULL WHERE id = '${blId}';`)
    expect(() => psql(`SELECT public.customer_local_charges_communication_dispatch_ready(${voyageId}, ${customerId});`)).toThrow(/Prontidão financeira bloqueada|P0003/)
    expect(() => psql(`
      INSERT INTO public.customer_communications (
        customer_id, kind, nature, anchor_voyage_id, attempt_discriminator, status
      ) VALUES (
        ${customerId}, 'ce_mercante_taxas', 'documentacao', ${voyageId}, 1, 'simulado'
      );
    `)).toThrow(/Prontidão financeira bloqueada|P0003/)

    expect(psql(`
      INSERT INTO public.customer_communication_automation_claims (claim_key)
      VALUES ('ce_mercante_taxas:${customerId}:${voyageId}:stale');
      SELECT count(*) FROM public.customer_communication_automation_claims
      WHERE claim_key = 'ce_mercante_taxas:${customerId}:${voyageId}:stale';
    `)).toBe('0')
  })
})
