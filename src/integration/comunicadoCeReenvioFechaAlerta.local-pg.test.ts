import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Plano dos e-mails, 3.1 (D5): o "Reenviar CE e Taxas" da tela cria o Comunicado
// pela mesma RPC da Edge (`create_customer_communication_atomic`), com novo
// discriminador. Desde a migration 302 ele nasce `pendente`; só o envio real
// (enviado/parcial) fecha `comunicado_ce_reenvio_pendente` (gatilho da 238). O
// reenvio que fica em simulação ou ainda em envio não fecha.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99314001
const VESSEL_ID = 99314002
const VOYAGE_ID = 99314003
const CUSTOMER_ID = 99314004
const BL_A = 'E314-CE-A'
const BL_B = 'E314-CE-B'
const ALL_BLS = [BL_A, BL_B].map((id) => `'${id}'`).join(', ')

/** Como a Edge Function (`service_role`). */
function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function itemStatus(blId: string): string {
  return psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_ce_reenvio_pendente' AND a.entity_type = 'bl' AND a.entity_id = '${blId}' ORDER BY i.id DESC LIMIT 1;`)
}

/** O que a Edge faz no reenvio: registra o Comunicado com os B/Ls do Cliente na Viagem. */
function createResend(discriminator: number): number {
  return Number(psql(`SELECT public.create_customer_communication_atomic(
    ${CUSTOMER_ID}, 'ce_mercante_taxas', 'documentacao', ${VOYAGE_ID}, NULL, NULL, NULL, ${discriminator}, NULL,
    NULL, NULL, NULL, NULL, ARRAY['${BL_A}', '${BL_B}']);`))
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE e314_alerts AS SELECT id FROM public.alerts WHERE entity_type = 'bl' AND entity_id IN (${ALL_BLS});
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e314_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e314_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM e314_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM e314_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM e314_alerts);
    DELETE FROM public.customer_communication_bls WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.audit_logs WHERE entity_id IN (${ALL_BLS});
    DELETE FROM public.bls WHERE id IN (${ALL_BLS});
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function prerequisites(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_trigger WHERE tgname = 'resolve_ce_resend_alert_on_communication_sent';`) === '1'
      && psql(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.customer_communications'::regclass
        AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%pendente%';`) !== '0'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(prerequisites, 'gatilho da migration 238 e status pendente da 302')

describeLocal('3.1 — Reenviar CE e Taxas fecha "Reenviar Comunicado de CE e Taxas" só quando sai', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E314');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E314', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'E314V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE E314 LTDA', '${syntheticCnpj(314004)}');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, ce_mercante)
      VALUES ('${BL_A}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', '993140000000001'),
             ('${BL_B}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', '993140000000002');
      -- O CE e Taxas automático saiu antes da troca de CE.
      INSERT INTO public.customer_communications (customer_id, kind, nature, anchor_voyage_id, anchor_port, status, attempt_discriminator, created_at)
      VALUES (${CUSTOMER_ID}, 'ce_mercante_taxas', 'documentacao', ${VOYAGE_ID}, 'BRSSZ', 'enviado', 0, now() - interval '1 day');
      SET session_replication_role = origin;
    `)
    // A troca do CE abre o alerta nos dois B/Ls.
    for (const bl of [BL_A, BL_B]) {
      psql(`SELECT public.upsert_alert_item('comunicado_ce_reenvio_pendente', 'bl', '${bl}', 'CE trocado depois do Comunicado', 'e314_fixture', '{}'::jsonb, '/bls/${bl}');`)
    }
  })
  afterAll(cleanup)

  it('o reenvio nasce "Em envio" e não fecha o alerta; em simulação também não', () => {
    const id = createResend(1)
    expect(psql(`SELECT status FROM public.customer_communications WHERE id = ${id};`)).toBe('pendente')
    expect(itemStatus(BL_A)).toBe('active')

    psql(`UPDATE public.customer_communications SET status = 'simulado' WHERE id = ${id};`)
    expect(itemStatus(BL_A)).toBe('active')
    expect(itemStatus(BL_B)).toBe('active')
  })

  it('o reenvio que sai (enviado) fecha o alerta de todos os B/Ls do Comunicado', () => {
    const id = createResend(2)
    psql(`UPDATE public.customer_communications SET status = 'enviado' WHERE id = ${id};`)
    expect(itemStatus(BL_A)).toBe('resolved')
    expect(itemStatus(BL_B)).toBe('resolved')
    expect(psql(`SELECT e.metadata->>'communication_id' FROM public.alert_item_events e
      JOIN public.alert_items i ON i.id = e.alert_item_id JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_id = '${BL_A}' AND i.item_type = 'comunicado_ce_reenvio_pendente' AND e.event_type = 'resolved';`)).toBe(String(id))
  })
})
