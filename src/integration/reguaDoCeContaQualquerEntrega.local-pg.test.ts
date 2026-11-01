import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 563 (revisão da release 2026-11-01, decisão do dono): a régua do
// CE e Taxas considera o Cliente × Viagem feito quando qualquer tentativa foi
// entregue. Antes só a tentativa da régua (discriminador 0) contava, e o CE
// enviado à mão depois de a tentativa 0 falhar voltava a sair pela régua.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99563001
const VESSEL_ID = 99563002
const VOYAGE_ID = 99563003
const CUSTOMER_ID = 99563004
const EMAIL = 'doc-e563@example.test'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Comunicado do CE e Taxas com uma tentativa ao contato. */
function ceCommunication(discriminator: number, status: string, attemptStatus: string, providerId: string | null): void {
  psql(`
    SET session_replication_role = replica;
    WITH c AS (
      INSERT INTO public.customer_communications (customer_id, kind, nature, anchor_voyage_id, anchor_port, status, attempt_discriminator)
      VALUES (${CUSTOMER_ID}, 'ce_mercante_taxas', 'documentacao', ${VOYAGE_ID}, NULL, '${status}', ${discriminator})
      RETURNING id
    )
    INSERT INTO public.customer_communication_attempts
      (communication_id, recipient_masked, recipient_key, status, provider_message_id, idempotency_key, dispatch_mode)
    SELECT c.id, 'd***@e***.test', public.customer_communication_recipient_key('${EMAIL}'), '${attemptStatus}',
      ${providerId ? `'${providerId}'` : 'NULL'}, 'e563:' || c.id, 'real'
    FROM c;
    SET session_replication_role = origin;`)
}

function pending(): string {
  return psql(`SELECT coalesce(array_to_string(public.customer_communication_target_pending_recipients(
    'ce_mercante_taxas', ${CUSTOMER_ID}, ${VOYAGE_ID}, NULL, NULL, ARRAY['${EMAIL}']), ','), 'FEITO');`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.customer_communication_attempts WHERE communication_id IN (SELECT id FROM public.customer_communications WHERE customer_id = ${CUSTOMER_ID});
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration563Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'customer_communication_target_pending_recipients'
      AND prosrc NOT LIKE '%attempt_discriminator = 0%';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration563Applied, 'migration563Applied (régua do CE conta qualquer entrega)')

describeLocal('563 — a régua do CE e Taxas conta a entrega de qualquer tentativa', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E563');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E563', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'E563V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE E563', '${syntheticCnpj(563004)}');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('tentativa da régua que falhou deixa o CE pendente', () => {
    ceCommunication(0, 'falha', 'falha_transitoria', null)
    expect(pending()).toBe(EMAIL)
  })

  it('o envio manual entregue (Disparo ou reenvio, tentativa 1) fecha o alvo: a régua não reenvia', () => {
    ceCommunication(1, 'enviado', 'entregue', 'msg-e563-1')
    expect(pending()).toBe('FEITO')
  })
})
