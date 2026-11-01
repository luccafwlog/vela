import { execPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 559: escritas que não deixavam linha no Histórico de ações
// (liberação de faturamento, fechamento e terminal do ADR, Pix tratado,
// criação do Embarque de vazios) passam a deixar, com autor e motivo.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER_ID = '55955900-0000-4000-8000-000000000001'
const CARRIER_ID = 99559001
const VESSEL_ID = 99559002
const VOYAGE_ID = 99559003
const CUSTOMER_ID = 99559011
const RELEASE_ID = 99559021
const REPORT_ID = '55955900-0000-4000-8000-0000000000a1'
const E2E = 'E559TESTEPIXTRATADO'
const PORT = 'BRZ59'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Executa como a sessão do usuário (o autor do Histórico vem de `auth.uid()`). */
function asSession(sql: string): string {
  return psql(`BEGIN; SET LOCAL request.jwt.claim.sub = '${USER_ID}'; ${sql}; COMMIT;`)
}

function trail(entityType: string, entityId: string): string[] {
  const out = psql(`SELECT field_name, coalesce(old_value, '-'), coalesce(new_value, '-'), coalesce(changed_by::text, '-'), coalesce(justification, '-')
    FROM public.audit_logs WHERE entity_type = '${entityType}' AND entity_id = '${entityId}' ORDER BY id`)
  return out ? out.split('\n') : []
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE changed_by = '${USER_ID}'
      OR entity_id IN ('${RELEASE_ID}', '${VOYAGE_ID}::${PORT}', '${E2E}');
    DELETE FROM public.itau_pix_receipts WHERE end_to_end_id = '${E2E}';
    DELETE FROM public.agency_departure_reports WHERE id = '${REPORT_ID}';
    DELETE FROM public.customer_billing_portal_releases WHERE id = ${RELEASE_ID};
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER_ID}';
    DELETE FROM auth.users WHERE id = '${USER_ID}';
    SET session_replication_role = origin;
  `)
}

function migration559Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'audit_agency_departure_report_changes';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration559Applied, 'migration559Applied (Histórico cobre escritas sem rastro)')

describeLocal('559 — escritas sem rastro passam a ter Histórico', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER_ID}', 'financeiro-559@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER_ID}', 'Fernanda 559', 'administrativo', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador 559');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio 559', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'V559', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE 559 LTDA', '${syntheticCnpj(559011)}');
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status) VALUES ('${REPORT_ID}', ${VOYAGE_ID}, '${PORT}', 'open');
      INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status)
        VALUES ('${E2E}', 'TX559', 150.25, '2031-05-08 10:00-03', 'review');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('liberar faturamento no Portal grava a criação com a justificativa; editar depois não herda o motivo', () => {
    asSession(`INSERT INTO public.customer_billing_portal_releases (id, customer_id, justification, granted_by, review_at)
      OVERRIDING SYSTEM VALUE VALUES (${RELEASE_ID}, ${CUSTOMER_ID}, 'Cliente com garantia bancária', '${USER_ID}', now() + interval '30 days')`)
    asSession(`UPDATE public.customer_billing_portal_releases SET review_at = review_at + interval '1 day' WHERE id = ${RELEASE_ID}`)
    const rows = trail('customer_billing_portal_releases', String(RELEASE_ID))
    expect(rows[0]).toMatch(new RegExp(`^criado\\|-\\|\\{.*\\|${USER_ID}\\|Cliente com garantia bancária$`))
    expect(rows[1]).toMatch(new RegExp(`^review_at\\|.*\\|${USER_ID}\\|-$`))
    // A revogação: o motivo gravado na coluna vira a justificativa.
    asSession(`UPDATE public.customer_billing_portal_releases SET revoked_at = now(), revoked_by = '${USER_ID}', revoke_reason = 'Garantia vencida' WHERE id = ${RELEASE_ID}`)
    expect(trail('customer_billing_portal_releases', String(RELEASE_ID)).filter((row) => row.startsWith('revoke_reason|')))
      .toEqual([`revoke_reason|-|Garantia vencida|${USER_ID}|Garantia vencida`])
  })

  it('fechar o ADR de Saída grava a linha do fechamento, na chave da reabertura', () => {
    psql(`SET session_replication_role = replica; UPDATE public.agency_departure_reports SET status = 'open' WHERE id = '${REPORT_ID}'; SET session_replication_role = origin;`)
    asSession(`SET LOCAL session_replication_role = origin; UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = '${USER_ID}' WHERE id = '${REPORT_ID}'`)
    expect(trail('agency_departure_report', `${VOYAGE_ID}::${PORT}`)).toEqual([`status|open|closed|${USER_ID}|-`])
  })

  it('marcar o Pix como tratado grava o motivo escrito', () => {
    asSession(`UPDATE public.itau_pix_receipts SET handled_at = now(), handled_by = '${USER_ID}', handled_note = 'Pix de outro banco, devolvido', status = 'handled' WHERE end_to_end_id = '${E2E}'`)
    const rows = trail('itau_pix_receipts', E2E)
    expect(rows.find((row) => row.startsWith('handled_note|'))).toBe(`handled_note|-|Pix de outro banco, devolvido|${USER_ID}|Pix de outro banco, devolvido`)
  })
})
