import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 339 (incidente de 2026-10-20, Sentry VELA-24/VELA-25): um B/L
// importado sem Cliente fazia a prontidão de CE e Taxas dar RAISE (22023) e
// derrubava a rodada inteira da régua e do detector, para todos os Clientes.
// `SET enable_nestloop = off` força o plano que falhou em produção: o filtro de
// prontidão empurrado para o scan de `bls`, antes do JOIN com `customers`.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99339001
const VESSEL_ID = 99339002
const VOYAGE_ID = 99339003
const CUSTOMER_A = 99339011
const CUSTOMER_B = 99339012
const CONTACT_A = 99339021
const CONTACT_B = 99339022
const BLS = ['B339-A', 'B339-B', 'B339-SEM-CLIENTE']
const CLAIM_A = `ce_mercante_taxas:${CUSTOMER_A}:${VOYAGE_ID}`
const CLAIM_B = `ce_mercante_taxas:${CUSTOMER_B}:${VOYAGE_ID}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET enable_nestloop = off; ${sql}`],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE e339_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'customer' AND entity_id IN ('${CUSTOMER_A}', '${CUSTOMER_B}'))
         OR entity_id = '${VOYAGE_ID}' OR entity_id LIKE '${VOYAGE_ID}::%';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e339_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM e339_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM e339_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM e339_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${VOYAGE_ID}%';
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACT_A}, ${CONTACT_B});
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.audit_logs WHERE entity_id IN (${BLS.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.bls WHERE id IN (${BLS.map((id) => `'${id}'`).join(', ')});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration339Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT (public.customer_local_charges_communication_readiness(1, NULL) ->> 'reason_code') = 'sem_cliente';`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration339Applied, 'migration339Applied (prontidão sem Cliente não dá RAISE)')

describeLocal('339 — B/L sem Cliente não derruba a rodada dos Comunicados', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E339');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E339', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'E339V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES
        (${CUSTOMER_A}, 'CLIENTE E339 A', '${syntheticCnpj(339011)}'),
        (${CUSTOMER_B}, 'CLIENTE E339 B', '${syntheticCnpj(339012)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT_A}, ${CUSTOMER_A}, 'Contato A', 'a-e339@example.test', true),
        (${CONTACT_B}, ${CUSTOMER_B}, 'Contato B', 'b-e339@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES
        (${CONTACT_A}, 'documentacao_operacao'), (${CONTACT_B}, 'financeiro');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, ce_mercante) VALUES
        ('${BLS[0]}', ${VOYAGE_ID}, ${CUSTOMER_A}, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', '133905000000001'),
        ('${BLS[1]}', ${VOYAGE_ID}, ${CUSTOMER_B}, 'CNSHA', 'BRSSZ', 'container', 'paid', 'calculated', 'ok', '133905000000002'),
        ('${BLS[2]}', ${VOYAGE_ID}, NULL, 'CNSHA', 'BRSSZ', 'container', 'pending', 'calculated', 'pending_review', NULL);
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('a prontidão devolve "não pronto" com Viagem ou Cliente ausente, sem RAISE', () => {
    const noCustomer = JSON.parse(psql(`SELECT public.customer_local_charges_communication_readiness(${VOYAGE_ID}, NULL);`))
    expect(noCustomer).toMatchObject({ ready: false, reason_code: 'sem_cliente', bl_count: 0, reasons: ['sem_cliente'], bls: [] })
    const noVoyage = JSON.parse(psql(`SELECT public.customer_local_charges_communication_readiness(NULL, ${CUSTOMER_A});`))
    expect(noVoyage).toMatchObject({ ready: false, reason_code: 'sem_viagem' })
  })

  it('os alvos da régua seguem listando os outros Clientes da mesma Viagem', () => {
    const claims = psql(`SELECT string_agg(claim_key, ',' ORDER BY claim_key) FROM public.customer_communication_automation_targets(now())
      WHERE voyage_id = ${VOYAGE_ID} AND kind = 'ce_mercante_taxas';`)
    expect(claims).toBe([CLAIM_A, CLAIM_B].join(','))
  }, 60_000)

  it('a régua (dispatch) e o detector rodam e devolvem os Clientes elegíveis', () => {
    const candidates = JSON.parse(psql(`SELECT public.evaluate_and_dispatch_automatic_communications(now());`)) as Array<{ claim_key: string }>
    const keys = candidates.map((candidate) => candidate.claim_key)
    expect(keys).toEqual(expect.arrayContaining([CLAIM_A, CLAIM_B]))
    expect(keys.some((key) => key.includes('null'))).toBe(false)
    expect(() => psql(`SELECT public.detect_customer_communication_alerts();`)).not.toThrow()
  }, 60_000)
})
