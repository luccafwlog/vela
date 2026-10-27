import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 470 (lote 5 do plano de correções, decisões do dono de 2026-10-27).
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '47000000-0000-4000-8000-000000000001'
const PORTAL = '47000000-0000-4000-8000-000000000002'
const CUSTOMER = 4700010

function scenario(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'adm470@example.test'), ('${PORTAL}', 'portal470@example.test');
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADM}', 'Adm 470', 'administrativo', true);
    INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER}, '47000000000110', 'Cliente 470');
    INSERT INTO public.customer_portal_accounts (customer_id, auth_user_id, active, account_situation, recovery_email, recovery_email_status)
      VALUES (${CUSTOMER}, '${PORTAL}', true, 'ativo', 'cliente470@example.test', 'ok');
    INSERT INTO public.carriers (id, name) VALUES (4700001, 'Carrier 470');
    INSERT INTO public.vessels (id, name, carrier_id) VALUES (4700002, 'Navio 470', 4700001);
    INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (4700003, 4700002, 'V470', 'active');
    INSERT INTO public.bls (id, voyage_id, customer_id, cargo_mode, ce_mercante, pod) VALUES ('B470A', 4700003, ${CUSTOMER}, 'container', '470000000000001', 'BRSSZ');
    SET LOCAL session_replication_role = origin;
    ${sql}
    ROLLBACK;
  `], { encoding: 'utf8' }).trim().split(/\r?\n/)
}
const asPortal = `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${PORTAL}';`
const asAdmin = `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${ADM}';`
const asOwner = `RESET ROLE; SET LOCAL request.jwt.claim.role = 'service_role';`

describeLocal('migration 470 — Portal do Cliente', () => {
  it('a Espiadinha da aba BLs aplica o filtro de omissão revertida, como o Portal do Cliente (POR-D02)', () => {
    const out = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, onward_vessel_name, reverted_at)
        VALUES (4700100, 4700003, 'BRSSZ', 'BRRIG', 'Navio Seguinte', now());
      INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition) VALUES ('B470A', 4700100, 'transshipment');
      SET LOCAL session_replication_role = origin;
      ${asPortal}
      SELECT 'cliente=' || coalesce((SELECT x->>'transshipment' FROM jsonb_array_elements(public.portal_list_operation_bls()) x WHERE x->>'bl_id' = 'B470A'), 'nulo');
      ${asAdmin}
      SELECT 'inspecao=' || coalesce((SELECT x->>'transshipment' FROM jsonb_array_elements(public.portal_inspect_list_operation_bls(${CUSTOMER})) x WHERE x->>'bl_id' = 'B470A'), 'nulo');
    `)
    expect(out).toContain('cliente=nulo')
    expect(out).toContain('inspecao=nulo')
  })

  it('a consolidada desfeita pelo Cliente traz o motivo no detalhe, sem fatura nova (POR-D03)', () => {
    const out = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, pix_payload, invoice_type)
        VALUES (4700200, 'INV-470-C', ${CUSTOMER}, 10, 'issued', 'PIX470', 'consolidated');
      INSERT INTO public.bl_receivables (id, bl_id, customer_id, original_amount_brl, balance_brl) VALUES (4700400, 'B470A', ${CUSTOMER}, 10, 10);
      INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status) VALUES (4700200, 4700400, 'B470A', 10, 'active');
      SET LOCAL session_replication_role = origin;
      ${asPortal}
      SELECT public.portal_obsolete_consolidation(4700200) IS NOT NULL;
      ${asOwner}
      SELECT 'motivo=' || coalesce(public._portal_invoice_details_core(${CUSTOMER}, 4700200) #>> '{invoice,obsolete_reason}', 'nulo')
        || '|nova=' || coalesce(public._portal_invoice_details_core(${CUSTOMER}, 4700200) #>> '{invoice,replaced_by_invoice_id}', 'nenhuma');
    `)
    expect(out).toContain('motivo=Desfeita pelo cliente pelo portal.|nova=nenhuma')
  })

  it('a notificação "Disputa registrada" abre Faturamento → Demurrage na Disputa (POR-D06)', () => {
    const out = scenario(`
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, total_usd, status) VALUES (4700300, 'DEM-470', 'B470A', ${CUSTOMER}, 100, 'issued');
      SET LOCAL session_replication_role = origin;
      ${asPortal}
      SELECT public.portal_add_dispute_message(4700300, 'Contesto as datas do container.') IS NOT NULL;
      ${asOwner}
      SELECT 'link=' || link || '|disputa=' || (SELECT id FROM public.demurrage_disputes WHERE demurrage_invoice_id = 4700300)
        FROM public.portal_notifications WHERE customer_id = ${CUSTOMER} AND type = 'dispute_opened';
    `)
    const line = out.find((l) => l.startsWith('link=')) ?? ''
    const [, link, dispute] = line.match(/^link=(.*)\|disputa=(\d+)$/) ?? []
    expect(link).toBe(`/portal/billing?tab=demurrage&disputas=1&disputa=${dispute}`)
  })
})
