import { execPsql, spawnPsql } from './localPsql'
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
const REPORT_ID = '55955900-0000-4000-8000-0000000000a1'
const E2E = 'E559TESTEPIXTRATADO'
const PORT = 'BRZ59'
const TERMINAL_ID = '55955900-0000-4000-8000-0000000000d1'
const EXCEPTION_ID = 99559031
const PORT_ID = 99559041

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-F', '|', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Chama a função como a tela: papel `authenticated`, sessão do usuário. */
function asUser(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER_ID}';
     SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
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
      OR entity_id IN ('${REPORT_ID}', '${E2E}', '${EXCEPTION_ID}')
      OR (entity_type = 'customer_billing_portal_releases' AND entity_id IN (SELECT id::text FROM public.customer_billing_portal_releases WHERE customer_id = ${CUSTOMER_ID}))
      OR (entity_type = 'customer' AND entity_id = '${CUSTOMER_ID}');
    DELETE FROM public.pix_reconciliation_exceptions WHERE id = ${EXCEPTION_ID};
    DELETE FROM public.itau_pix_receipts WHERE end_to_end_id = '${E2E}';
    DELETE FROM public.agency_departure_reports WHERE id = '${REPORT_ID}';
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.depots WHERE id = '${TERMINAL_ID}';
    DELETE FROM public.ports WHERE id = ${PORT_ID};
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
      INSERT INTO public.ports (id, name, locode, country) VALUES (${PORT_ID}, 'Porto 559', '${PORT}', 'BR');
      INSERT INTO public.depots (id, code, name, active) VALUES ('${TERMINAL_ID}', 'T559', 'Terminal 559', true);
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status, terminal_id, terminal_port_id)
        VALUES ('${REPORT_ID}', ${VOYAGE_ID}, '${PORT}', 'open', '${TERMINAL_ID}', ${PORT_ID});
      INSERT INTO public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status)
        VALUES ('${E2E}', 'TX559', 150.25, '2031-05-08 10:00-03', 'review');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('liberar faturamento no Portal (função da tela) grava a criação com a justificativa; revogar grava o motivo', () => {
    const grant = asUser(`SELECT public.grant_customer_billing_portal_release(${CUSTOMER_ID}, 'Cliente com garantia bancária', now() + interval '10 days')`)
    expect(grant.error).toBe('')
    const releaseId = psql(`SELECT id FROM public.customer_billing_portal_releases WHERE customer_id = ${CUSTOMER_ID}`)
    const created = trail('customer_billing_portal_releases', releaseId)
    expect(created[0]).toMatch(new RegExp(`^criado\\|-\\|\\{.*\\|${USER_ID}\\|Cliente com garantia bancária$`))
    // Editar a data de revisão depois não herda o motivo antigo.
    asSession(`UPDATE public.customer_billing_portal_releases SET review_at = review_at + interval '1 day' WHERE id = ${releaseId}`)
    expect(trail('customer_billing_portal_releases', releaseId).find((row) => row.startsWith('review_at|'))).toMatch(new RegExp(`\\|${USER_ID}\\|-$`))
    const revoke = asUser(`SELECT public.revoke_customer_billing_portal_release(${CUSTOMER_ID}, 'Garantia vencida')`)
    expect(revoke.error).toBe('')
    expect(trail('customer_billing_portal_releases', releaseId).filter((row) => row.startsWith('revoke_reason|')))
      .toEqual([`revoke_reason|-|Garantia vencida|${USER_ID}|Garantia vencida`])
  })

  it('fechar o ADR por terminal grava a linha na chave do próprio ADR, a mesma da reabertura pela tela', () => {
    asSession(`UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = '${USER_ID}' WHERE id = '${REPORT_ID}'`)
    expect(trail('agency_departure_report', REPORT_ID)).toEqual([`status|open|closed|${USER_ID}|-`])
    expect(psql(`SELECT public._audit_entity_label('agency_departure_report', '${REPORT_ID}')`)).toBe(`Navio 559 / V559 · ${PORT} · Terminal 559`)
  })

  it('marcar o Pix como tratado (função da tela) grava o motivo escrito', () => {
    asSession(`SELECT public._itau_pix_close_receipt('${E2E}', 'Pix de outro banco, devolvido', '${USER_ID}')`)
    const rows = trail('itau_pix_receipts', E2E)
    expect(rows.find((row) => row.startsWith('handled_note|'))).toBe(`handled_note|-|Pix de outro banco, devolvido|${USER_ID}|Pix de outro banco, devolvido`)
  })

  it('exceção de Pix: criação e resolução gravam; a reimportação que só renova updated_at não', () => {
    psql(`INSERT INTO public.pix_reconciliation_exceptions (id, import_key, line_number, amount_brl, reason)
      VALUES (${EXCEPTION_ID}, 'importacao-559', 1, 80, 'unmatched')`)
    psql(`UPDATE public.pix_reconciliation_exceptions SET updated_at = now() + interval '1 minute' WHERE id = ${EXCEPTION_ID}`)
    asSession(`UPDATE public.pix_reconciliation_exceptions SET status = 'resolved', resolved_at = now(), resolved_by = '${USER_ID}' WHERE id = ${EXCEPTION_ID}`)
    const fields = trail('pix_reconciliation_exceptions', String(EXCEPTION_ID)).map((row) => row.split('|')[0])
    expect(fields).toContain('criado')
    expect(fields).toContain('status')
    expect(fields.filter((field) => field === 'updated_at')).toHaveLength(0)
  })
})
