// Etapa 10 do plano de correção das importações (migration 182; ADR 0078,
// itens 13 e 15). A reimportação não muda o POD de B/L em COD (a ficha
// continua corrigindo); B/L criado depois da omissão entra como afetado, com
// disposição Transbordo; o documento da fatura lê a cópia congelada na emissão,
// não o Cliente nem o B/L vivos.
//
// Namespace exclusivo: ids 99230xxx, B/Ls 'A230-*', usuário ...0000002300NN.
import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000230001'
const carrierId = 99230001
const vesselId = 99230002
const voyageId = 99230003
const customerId = 99230004
const omissionId = 99230005
const invoiceId = 99230006
const codBl = 'A230-COD'
const lateBl = 'A230-LATE'

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asAdmin(sql: string): { stdout: string; stderr: string } {
  const run = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.invoice_document_snapshots WHERE invoice_id = ${invoiceId};
    DELETE FROM public.invoice_bls WHERE invoice_id = ${invoiceId};
    DELETE FROM public.invoices WHERE id = ${invoiceId};
    DELETE FROM public.bl_transshipments WHERE bl_id IN ('${codBl}', '${lateBl}');
    DELETE FROM public.voyage_omissions WHERE id = ${omissionId};
    DELETE FROM public.bls WHERE id IN ('${codBl}', '${lateBl}');
    DELETE FROM public.audit_logs WHERE entity_id IN ('${codBl}', '${lateBl}', '${voyageId}', '${invoiceId}') OR changed_by = '${adminId}';
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}) OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id = ${customerId});
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('COD na reimportação e documento da fatura (migration 182)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'a230-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'A230 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name, address, city, state)
      VALUES (${customerId}, '99230004000123', 'A230 CLIENTE ORIGINAL', 'Rua A230, 1', 'Vitória', 'ES');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'A230 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'A230 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'A230', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status)
      VALUES ('${codBl}', ${voyageId}, ${customerId}, 'A230O', 'A230D', 'container', 'pending', 'not_calculated');
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, reason, omitted_by)
      VALUES (${omissionId}, ${voyageId}, 'A230X', 'A230D', 'A230 omissão', '${adminId}');
      INSERT INTO public.bl_transshipments (bl_id, omission_id, disposition, created_by)
      VALUES ('${codBl}', ${omissionId}, 'cod', '${adminId}');
      SET session_replication_role = replica;
      UPDATE public.bls SET ce_mercante = '992300000000001' WHERE id = '${codBl}';
    `)
  })

  afterAll(cleanup)

  it('a reimportação mantém o POD do B/L em COD; a ficha corrige', () => {
    psql(`BEGIN;
      SELECT set_config('vela.invoice_basis_source', 'bl_reimport_correction', true);
      UPDATE public.bls SET pod = 'A230X' WHERE id = '${codBl}';
      COMMIT;`)
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${codBl}';`)).toBe('A230D')

    psql(`UPDATE public.bls SET pod = 'A230Z' WHERE id = '${codBl}';`)
    expect(psql(`SELECT pod FROM public.bls WHERE id = '${codBl}';`)).toBe('A230Z')
    // Corrigir o POD não desfaz nem cria COD.
    expect(psql(`SELECT disposition FROM public.bl_transshipments WHERE bl_id = '${codBl}';`)).toBe('cod')
    psql(`UPDATE public.bls SET pod = 'A230D' WHERE id = '${codBl}';`)
  })

  it('B/L importado depois da omissão entra como afetado, Transbordo, com Histórico', () => {
    const created = asAdmin(`INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status)
      VALUES ('${lateBl}', ${voyageId}, ${customerId}, 'A230O', ' a230x ', 'container', 'pending', 'not_calculated');`)
    expect(created.stderr).toBe('')
    expect(psql(`SELECT omission_id || ':' || disposition FROM public.bl_transshipments WHERE bl_id = '${lateBl}';`))
      .toBe(`${omissionId}:transshipment`)
    expect(psql(`SELECT count(*) FROM public.audit_logs WHERE entity_id = '${lateBl}' AND field_name = 'transbordo';`)).toBe('1')
  })

  it('o detalhe da fatura lê o documento congelado na emissão, não os dados vivos', () => {
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, voyage_id, total_brl, status)
      VALUES (${invoiceId}, 'A230-INV', ${customerId}, '${codBl}', ${voyageId}, 100, 'draft');
      INSERT INTO public.invoice_bls (invoice_id, bl_id, subtotal_brl) VALUES (${invoiceId}, '${codBl}', 100);
      SET session_replication_role = origin;
    `)
    // Rascunho não congela; a emissão congela no fim da transação.
    expect(psql(`SELECT count(*) FROM public.invoice_document_snapshots WHERE invoice_id = ${invoiceId};`)).toBe('0')
    // Os gates de emissão (Portal, CE, alertas) não são o assunto aqui: nesta
    // transação só o gatilho da cópia dispara (ENABLE ALWAYS sob réplica).
    psql(`BEGIN;
      ALTER TABLE public.invoices ENABLE ALWAYS TRIGGER trg_capture_invoice_document_snapshot;
      SET LOCAL session_replication_role = replica;
      UPDATE public.invoices SET status = 'issued' WHERE id = ${invoiceId};
      SET CONSTRAINTS public.trg_capture_invoice_document_snapshot IMMEDIATE;
      SET LOCAL session_replication_role = origin;
      ALTER TABLE public.invoices ENABLE TRIGGER trg_capture_invoice_document_snapshot;
      COMMIT;`)
    expect(psql(`SELECT count(*) FROM public.invoice_document_snapshots WHERE invoice_id = ${invoiceId};`)).toBe('1')
    psql(`
      SET session_replication_role = replica;
      UPDATE public.customers SET name = 'A230 CLIENTE RENOMEADO', address = 'Rua Nova' WHERE id = ${customerId};
      UPDATE public.vessels SET name = 'A230 OUTRO NAVIO' WHERE id = ${vesselId};
      UPDATE public.bls SET pol = 'A230Q', pod = 'A230R' WHERE id = '${codBl}';
    `)
    const detail = JSON.parse(asAdmin(`SELECT public.list_invoice_details(${invoiceId});`).stdout) as {
      invoice: { customer_name: string; customer_cnpj_cpf: string; customer_address: string; vessel_name: string; voyage_number: string }
      bls: Array<{ bl_id: string; pol: string; pod: string; vessel_name: string }>
    }
    expect(detail.invoice).toMatchObject({
      customer_name: 'A230 CLIENTE ORIGINAL',
      customer_cnpj_cpf: '99230004000123',
      customer_address: 'Rua A230, 1 — Vitória/ES',
      vessel_name: 'A230 NAVIO',
      voyage_number: 'A230',
    })
    expect(detail.bls.find((bl) => bl.bl_id === codBl)).toMatchObject({ pol: 'A230O', pod: 'A230D', vessel_name: 'A230 NAVIO' })
  })
})
