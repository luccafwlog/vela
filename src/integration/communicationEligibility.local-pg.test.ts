import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// S06 — elegibilidade de caixas e da régua no Postgres descartável.
// Opt-in (`LOCAL_PG_INTEGRATION=1` + `LOCAL_DATABASE_URL`); sem o banco local
// a suíte pula sem falhar. Cobre D11 (composição por cliente/ciclo), a
// revalidação pré-envio (quitação/disputa/supressão/caixa) e o fallback
// auditado do principal.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000010602'
const customerId = 99020601
const otherCustomerId = 99020602
const carrierId = 99020603
const vesselId = 99020604
const voyageId = 99020605
const invoiceIds = Array.from({ length: 12 }, (_, index) => 99220600 + index + 1)

function localPsql(sql: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

type Candidate = { invoice_id: number; customer_id: number; attempt_discriminator: number }

function claimAll(): Candidate[] {
  return JSON.parse(localPsql(`
    SELECT public.claim_demurrage_dunning_candidates('2026-09-10T12:00:00Z'::timestamptz, 50);
  `)) as Candidate[]
}

describeLocal('S06 — elegibilidade de comunicados e da régua (D11 + revalidação)', () => {
  beforeAll(() => {
    const bls = invoiceIds.map((id) => `('S06-GRP-BL-${id}', ${voyageId}, ${customerId}, 'container')`).join(',\n        ')
    const invoices = invoiceIds
      .map((id) => `(${id}, 'S06-GRP-${id}', 'S06-GRP-BL-${id}', ${customerId}, '2026-09-01', '2026-09-01', 100, 5.5, 550, 'manual', 'issued')`)
      .join(',\n        ')
    localPsql(`
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_communication_dunning_invoices WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_communications WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.bls WHERE id LIKE 'S06-GRP-BL-%';
      DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customers WHERE id IN (${customerId}, ${otherCustomerId});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${adminId}';
      DELETE FROM public.alert_item_events WHERE actor_id = '${adminId}';
      DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN ('${customerId}', '${otherCustomerId}');
      DELETE FROM public.user_profiles WHERE id = '${adminId}';
      DELETE FROM auth.users WHERE id = '${adminId}';
      DELETE FROM public.portal_suppressed_emails WHERE email LIKE 's06-grp-%@example.test';
      DELETE FROM public.customer_communication_suppressions WHERE email LIKE 's06-grp-%@example.test';

      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 's06-elig@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${adminId}', 'S06 Elig', 'admin', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '99020601000123', 'Cliente S06 D11'), (${otherCustomerId}, '99020602000178', 'Outro S06');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier S06');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel S06', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'S06', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode) VALUES ${bls};
      INSERT INTO public.demurrage_invoices
        (id, doc_number, bl_id, customer_id, doc_date, first_billed_at, total_usd, current_roe, current_total_brl, roe_source, status)
      VALUES ${invoices};
      -- Mesmos 3 contatos elegíveis para as 12 faturas.
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES
        (${customerId}, 'Principal', 's06-grp-a@example.test', 'financeiro', true),
        (${customerId}, 'Financeiro B', 's06-grp-b@example.test', 'financeiro', false),
        (${customerId}, 'Demurrage C', 's06-grp-c@example.test', 'financeiro', false),
        (${otherCustomerId}, 'Outro', 's06-grp-outro@example.test', 'financeiro', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code)
      SELECT cc.id, 'financeiro' FROM public.customer_contacts cc
      WHERE cc.customer_id = ${customerId} AND cc.email IN ('s06-grp-b@example.test', 's06-grp-c@example.test')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_contact_box_links (contact_id, box_code)
      SELECT cc.id, 'demurrage' FROM public.customer_contacts cc
      WHERE cc.customer_id = ${customerId} AND cc.email = 's06-grp-c@example.test'
      ON CONFLICT DO NOTHING;
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
    `)
  })

  afterAll(() => {
    localPsql(`
      DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_communication_dunning_invoices WHERE demurrage_invoice_id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.demurrage_invoices WHERE id = ANY(ARRAY[${invoiceIds.join(',')}]::bigint[]);
      DELETE FROM public.customer_communications WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.bls WHERE id LIKE 'S06-GRP-BL-%';
      DELETE FROM public.customer_contact_change_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customer_contacts WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      SET session_replication_role = replica;
      DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${otherCustomerId});
      DELETE FROM public.customers WHERE id IN (${customerId}, ${otherCustomerId});
      SET session_replication_role = origin;
      DELETE FROM public.audit_logs WHERE changed_by = '${adminId}';
      DELETE FROM public.alert_item_events WHERE actor_id = '${adminId}';
      DELETE FROM public.alerts WHERE entity_type = 'customer' AND entity_id IN ('${customerId}', '${otherCustomerId}');
      DELETE FROM public.user_profiles WHERE id = '${adminId}';
      DELETE FROM auth.users WHERE id = '${adminId}';
      DELETE FROM public.portal_suppressed_emails WHERE email LIKE 's06-grp-%@example.test';
      DELETE FROM public.customer_communication_suppressions WHERE email LIKE 's06-grp-%@example.test';
      UPDATE public.app_settings SET demurrage_dunning_interval_days = 7 WHERE id = 1;
    `)
  })

  it('D11 — as 12 faturas do mesmo cliente/ciclo saem juntas no 1º lote útil', () => {
    const claimed = claimAll().filter((candidate) => invoiceIds.includes(Number(candidate.invoice_id)))
    expect(claimed).toHaveLength(12)
    // Mesmo ciclo: um único discriminador para compor uma mensagem.
    expect(new Set(claimed.map((candidate) => Number(candidate.attempt_discriminator)))).toEqual(new Set([1]))
    for (const candidate of claimed) {
      expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${candidate.invoice_id});`)).toBe('t')
    }
    for (const candidate of claimed) {
      localPsql(`SELECT public.release_demurrage_dunning_claim(${candidate.invoice_id}, ${candidate.attempt_discriminator});`)
    }
  })

  it('D11 — grupos que atravessam o limite do claim mantêm membership e idempotência exatas', () => {
    const firstGroup = invoiceIds.slice(0, 8)
    const secondGroup = invoiceIds.slice(8)
    const createGroup = (ids: number[]) => localPsql(`
      SELECT public.create_customer_dunning_group_atomic(
        ${customerId}, 1, ARRAY[${ids.join(',')}]::bigint[], ${voyageId}, 'BRSSZ', 'Vessel S06', 'S06', NULL
      );
    `)

    const firstCommunication = createGroup(firstGroup)
    const firstRetry = createGroup(firstGroup)
    const secondCommunication = createGroup(secondGroup)

    expect(firstRetry).toBe(firstCommunication)
    expect(secondCommunication).not.toBe(firstCommunication)
    expect(localPsql(`
      SELECT count(*) FROM public.customer_communication_dunning_groups
      WHERE customer_id = ${customerId} AND attempt_discriminator = 1;
    `)).toBe('2')
    expect(localPsql(`
      SELECT count(*) FROM public.customer_communication_dunning_invoices m
      JOIN public.customer_communication_dunning_groups g ON g.communication_id = m.communication_id
      WHERE g.customer_id = ${customerId} AND g.attempt_discriminator = 1;
    `)).toBe('12')
  })

  it('destinatário fora do cliente não é autorizado', () => {
    const allowed = localPsql(`
      SELECT public.customer_communication_recipient_allowed(
        ${customerId},
        (SELECT id FROM public.customer_contacts WHERE customer_id = ${otherCustomerId} LIMIT 1),
        'cobranca_demurrage', 'caixa', NULL);
    `)
    expect(allowed).toBe('f')
    const own = localPsql(`
      SELECT count(*) FROM public.customer_contacts cc
      WHERE cc.customer_id = ${customerId}
        AND public.customer_communication_recipient_allowed(${customerId}, cc.id, 'cobranca_demurrage', 'caixa', NULL);
    `)
    expect(own).toBe('3')
  })

  it('revalidação: quitação e disputa excluem a fatura sem travar as demais', () => {
    const [quitada, disputada] = [invoiceIds[0]!, invoiceIds[1]!]
    localPsql(`UPDATE public.demurrage_invoices SET paid_at = '2026-09-09' WHERE id = ${quitada};`)
    localPsql(`UPDATE public.demurrage_invoices SET dispute_open = true WHERE id = ${disputada};`)
    try {
      expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${quitada});`)).toBe('f')
      expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${disputada});`)).toBe('f')
      const claimed = claimAll().filter((candidate) => invoiceIds.includes(Number(candidate.invoice_id)))
      expect(claimed.some((candidate) => Number(candidate.invoice_id) === quitada)).toBe(false)
      expect(claimed.some((candidate) => Number(candidate.invoice_id) === disputada)).toBe(false)
      expect(claimed.length).toBeGreaterThan(0)
      for (const candidate of claimed) {
        localPsql(`SELECT public.release_demurrage_dunning_claim(${candidate.invoice_id}, ${candidate.attempt_discriminator});`)
      }
    } finally {
      localPsql(`UPDATE public.demurrage_invoices SET paid_at = NULL, dispute_open = false WHERE id IN (${quitada}, ${disputada});`)
    }
  })

  it('caixa sem vínculo pausa; reparo religa só o principal com auditoria', () => {
    localPsql(`
      DELETE FROM public.customer_contact_box_links l
      USING public.customer_contacts cc
      WHERE l.contact_id = cc.id AND cc.customer_id = ${customerId}
        AND l.box_code IN ('demurrage', 'financeiro');
    `)
    expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceIds[2]});`)).toBe('f')

    const repaired = JSON.parse(localPsql(`
      SELECT public.repair_customer_contact_box_fallbacks(${customerId}, NULL, 'demurrage');
    `)) as { success: boolean; relinked_boxes: string[]; blocked_boxes: string[] }
    expect(repaired.success).toBe(true)
    expect(repaired.relinked_boxes).toEqual(['demurrage'])

    const demurrageLinks = localPsql(`
      SELECT string_agg(cc.email, ',' ORDER BY cc.email)
      FROM public.customer_contact_box_links l
      JOIN public.customer_contacts cc ON cc.id = l.contact_id
      WHERE cc.customer_id = ${customerId} AND l.box_code = 'demurrage';
    `)
    expect(demurrageLinks).toBe('s06-grp-a@example.test')

    const events = localPsql(`
      SELECT count(*) FROM public.customer_contact_change_events
      WHERE customer_id = ${customerId} AND change_summary->>'action' = 'bounce_fallback_repair';
    `)
    expect(Number(events)).toBeGreaterThanOrEqual(1)
    expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceIds[2]});`)).toBe('t')
  })

  it('supressão total pausa o cliente sem vazar para outro', () => {
    localPsql(`
      INSERT INTO public.customer_communication_suppressions (email, reason)
      VALUES ('s06-grp-a@example.test', 'complaint'), ('s06-grp-b@example.test', 'complaint'), ('s06-grp-c@example.test', 'complaint')
      ON CONFLICT (email) DO UPDATE SET reason = 'complaint';
    `)
    expect(localPsql(`SELECT public.demurrage_dunning_candidate_sendable(${invoiceIds[3]});`)).toBe('f')
    const claimed = claimAll().filter((candidate) => invoiceIds.includes(Number(candidate.invoice_id)))
    expect(claimed).toHaveLength(0)
  })
})
