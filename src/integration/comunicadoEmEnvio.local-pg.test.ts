import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 298 (plano dos e-mails, 1B): o Comunicado nasce "pendente" (Em
// envio) e o recálculo nunca o deixa "simulado" por falta de decisão.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const customerId = 99298001
const communicationId = 99298001

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function attempt(key: string, status: string, providerId: string | null, suffix: string): string {
  return `INSERT INTO public.customer_communication_attempts (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode)
    VALUES (${communicationId}, 'x***@example.test', '${key}', '${status}', ${providerId ? `'${providerId}'` : 'NULL'}, 'r298-${suffix}', 'real');`
}

function status(): string {
  return psql(`SELECT status FROM public.customer_communications WHERE id = ${communicationId};`)
}

function cleanup(): void {
  psql(`
    DELETE FROM public.customer_communication_attempts WHERE communication_id = ${communicationId};
    DELETE FROM public.customer_communications WHERE id = ${communicationId};
    SET session_replication_role = replica;
    DELETE FROM public.customers WHERE id = ${customerId};
    SET session_replication_role = origin;
  `)
}

function migration298Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT pg_get_constraintdef(oid) LIKE '%pendente%' FROM pg_constraint WHERE conname = 'customer_communications_status_check';`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration298Applied, 'migration298Applied (Comunicado nasce Em envio)')

describeLocal('298 — Comunicado nasce Em envio', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(298001)}', 'R298 Em envio');
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, dispatch_id)
      VALUES (${communicationId}, ${customerId}, 'institucional', 'avisos_gerais', 'pendente', '00000000-0000-0000-0000-000099298001');
    `)
  })
  afterAll(cleanup)

  it('a criação atômica grava pendente, não simulado', () => {
    const def = psql(`SELECT pg_get_functiondef('public.create_customer_communication_atomic_legacy_070(bigint,text,text,bigint,text,uuid,bigint,integer,uuid,text,text,text,uuid,text[])'::regprocedure);`)
    expect(def).toContain(`p_attempt_discriminator, 'pendente', p_dispatch_id`)
    expect(def).not.toContain(`'simulado', p_dispatch_id`)
  })

  it('sem tentativa decidida, o recálculo fica em pendente; com sucesso e pendente, parcial', () => {
    expect(psql(`SELECT public.refresh_customer_communication_status(${communicationId});`)).toBe('pendente')

    // Aceito pelo provedor sem id: ainda em envio.
    psql(attempt('sha256:a', 'aceito', null, 'a1'))
    expect(status()).toBe('pendente')

    // Outro destinatário confirmado enquanto o primeiro segue pendente: parcial.
    psql(attempt('sha256:b', 'aceito', 'prov-b', 'b1'))
    expect(status()).toBe('parcial')

    // O pendente confirma: enviado.
    psql(`UPDATE public.customer_communication_attempts SET provider_message_id = 'prov-a' WHERE idempotency_key = 'r298-a1';
          SELECT public.refresh_customer_communication_status(${communicationId});`)
    expect(status()).toBe('enviado')
  })

  it('falha com tentativa ainda pendente não fecha como falha', () => {
    psql(`DELETE FROM public.customer_communication_attempts WHERE communication_id = ${communicationId};
          UPDATE public.customer_communications SET status = 'pendente' WHERE id = ${communicationId};`)
    psql(attempt('sha256:c', 'falha_transitoria', null, 'c1'))
    expect(status()).toBe('falha')
    psql(attempt('sha256:d', 'aceito', null, 'd1'))
    expect(status()).toBe('pendente')
  })
})
