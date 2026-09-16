import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const customerId = 9701
const communicationId = 9701

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
    SET session_replication_role = replica;
    DELETE FROM public.portal_provisioning_events WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    SET session_replication_role = origin;
  `)
}

describeLocal('S07 — estado parcial por tentativa', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '99070100000151', 'S07 Partial QA');
      INSERT INTO public.customer_communications (
        id, customer_id, kind, nature, status, dispatch_id
      ) VALUES (
        ${communicationId}, ${customerId}, 'institucional', 'avisos_gerais', 'simulado', '00000000-0000-0000-0000-000000009701'
      );
    `)
  })

  afterAll(cleanup)

  it('persiste bloqueio sem tentativas como falha retryable', () => {
    expect(psql(`SELECT public.mark_customer_communication_dispatch_blocked(${communicationId});`)).toBe('falha')
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('falha')
  })

  it('muda de enviado para parcial quando outra tentativa falha mesmo com a mesma máscara', () => {
    psql(`
      INSERT INTO public.customer_communication_attempts (
        communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode
      ) VALUES (
        ${communicationId}, 'f***@example.test', 'sha256:recipient-a', 'aceito', 'provider-9701', 's07-partial-real', 'real'
      );
    `)
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('enviado')

    psql(`
      INSERT INTO public.customer_communication_attempts (
        communication_id, recipient_masked, recipient_key, status, idempotency_key, dispatch_mode
      ) VALUES (
        ${communicationId}, 'f***@example.test', 'sha256:recipient-b', 'falha_permanente', 's07-partial-failed', 'real'
      );
    `)
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('parcial')

    psql(`
      INSERT INTO public.customer_communication_attempts (
        communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode
      ) VALUES (
        ${communicationId}, 'f***@example.test', 'sha256:recipient-b', 'aceito', 'provider-9701-retry', 's07-partial-retry', 'real'
      );
    `)
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)).toBe('enviado')
  })
})
