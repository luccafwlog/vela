import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 297: a recusa definitiva do envio marca a claim como recusada, e a
// produtora não a devolve como candidata por 24 h, mesmo liberada ou com mais
// de 30 minutos. Antes, o CE recusado voltava a cada rodada (~250 recusas/dia).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99297001
const VESSEL_ID = 99297002
const VOYAGE_ID = 99297003
const PORT_ID = 99297004
const PORT = 'BRR97'
const CUSTOMER = 99297011
const CONTACT = 99297021
const TERMINAL = '29729700-0000-4000-8000-0000000000a1'
const BERTH = '29729700-0000-4000-8000-0000000000b1'
const BL = 'B297-SOLTA'
const CLAIM = `aviso_atracacao_nob:${CUSTOMER}:${BERTH}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function candidateClaims(asOf: string): string[] {
  const output = psql(`SELECT public.evaluate_and_dispatch_automatic_communications(${asOf});`)
  return (JSON.parse(output) as Array<{ claim_key: string }>).map((candidate) => candidate.claim_key).filter((key) => key === CLAIM)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r297_alerts AS SELECT id FROM public.alerts WHERE entity_type = 'customer' AND entity_id = '${CUSTOMER}';
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM r297_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM r297_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM r297_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r297_alerts);
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${CUSTOMER}:%';
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${CONTACT};
    DELETE FROM public.customer_contacts WHERE customer_id = ${CUSTOMER};
    DELETE FROM public.audit_logs WHERE entity_id = '${BL}';
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE_ID};
    DELETE FROM public.depots WHERE id = '${TERMINAL}';
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.ports WHERE id = ${PORT_ID};
    SET session_replication_role = origin;
  `)
}

function migration297Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'reject_customer_communication_automation_claim';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration297Applied, 'migration297Applied (recusa de Comunicado não cicla)')

describeLocal('297 — claim recusada não volta como candidata dentro da janela', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ports (id, name, locode) VALUES (${PORT_ID}, 'Porto R297', '${PORT}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${TERMINAL}', 'T297A', 'Terminal R297', 'terminal_portuario', ${PORT_ID});
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador R297');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio R297', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'R297V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'CLIENTE R297', '${syntheticCnpj(297011)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT}, ${CUSTOMER}, 'Contato R297', 'docs-r297@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${CONTACT}, 'documentacao_operacao');
      INSERT INTO public.voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES ('${BERTH}', ${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${TERMINAL}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, terminal_id, sentido, modalidade, source) VALUES
        (${VOYAGE_ID}, '${PORT}', ${PORT_ID}, '${TERMINAL}', 'importacao', 'carga_solta', 'operational_data');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, terminal_id, pod_port_id) VALUES
        ('${BL}', ${VOYAGE_ID}, ${CUSTOMER}, 'CNSHA', '${PORT}', 'carga_solta', 'pending', 'calculated', 'ok', NULL, NULL);
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('recusa marca a claim, abre comunicado_recusado e segura a candidata por 24 h', () => {
    expect(candidateClaims('now()')).toEqual([CLAIM])

    expect(psql(`SELECT public.reject_customer_communication_automation_claim('${CLAIM}', 'Anexos inválidos.');`)).toBe('t')
    expect(psql(`SELECT rejection_reason FROM public.customer_communication_automation_claims WHERE claim_key = '${CLAIM}';`)).toBe('Anexos inválidos.')
    expect(psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER}';`)).toBe('active')

    // Sem a recusa, os dois casos abaixo devolviam a candidata.
    expect(candidateClaims(`now() + interval '1 hour'`)).toEqual([])
    psql(`SELECT public.release_customer_communication_automation_claim('${CLAIM}');`)
    expect(candidateClaims('now()')).toEqual([])

    // Passada a janela, a produtora tenta de novo e limpa a marca.
    expect(candidateClaims(`now() + interval '25 hours'`)).toEqual([CLAIM])
    expect(psql(`SELECT rejected_at IS NULL FROM public.customer_communication_automation_claims WHERE claim_key = '${CLAIM}';`)).toBe('t')
  })

  it('é server-only', () => {
    expect(() => execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `SET request.jwt.claim.role = 'authenticated'; SELECT public.reject_customer_communication_automation_claim('${CLAIM}', 'x');`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow(/server-only/)
  })
})
