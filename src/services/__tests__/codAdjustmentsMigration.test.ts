import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/313_cod_adjustment_settlement.sql'), 'utf8')
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = migration.indexOf('$function$;', start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('contrato da liquidação de ajustes de COD', () => {
  it('reaproveita invoice_refunds e exige origem payment XOR COD', () => {
    expect(migration).toContain('ALTER COLUMN payment_id DROP NOT NULL')
    expect(migration).toMatch(/cod_adjustment_id BIGINT[\s\S]*REFERENCES public\.cod_adjustments\(id\) ON DELETE RESTRICT/i)
    expect(migration).toMatch(/CONSTRAINT invoice_refunds_origin_check[\s\S]*\(\(payment_id IS NULL\) <> \(cod_adjustment_id IS NULL\)\)/i)
    expect(migration).toMatch(/invoice_refunds_cod_adjustment_key[\s\S]*cod_adjustment_id/i)
    expect(migration).not.toMatch(/CREATE TABLE public\.cod_adjustments/i)
  })

  it('define o gate Financeiro/Admin/Administrativo sem alargar is_admin', () => {
    expect(migration).toMatch(/role IN \('admin', 'administrativo', 'financeiro'\)/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.is_financeiro_user\(\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_financeiro_user\(\) TO authenticated/i)
    expect(functionBody('settle_cod_adjustment')).toMatch(/is_financeiro_user\(\)/i)
    expect(functionBody('settle_invoice_refund')).toMatch(/is_financeiro_user\(\)/i)
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_admin[\s\S]*role IN \('admin', 'administrativo', 'financeiro'\)/i)
  })

  it('mantém cod_adjustments sem policy de escrita e liquida por RPC', () => {
    expect(migration).not.toMatch(/CREATE POLICY cod_adjustments_(insert|update|delete)/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.settle_cod_adjustment\(\s*p_adjustment_id BIGINT/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.settle_cod_adjustment\(BIGINT, UUID, BIGINT, TEXT\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.settle_cod_adjustment\(BIGINT, UUID, BIGINT, TEXT\) TO authenticated/i)
  })

  it('aplica abatimento antes de criar restituição de excedente', () => {
    const body = functionBody('settle_cod_adjustment')
    expect(body.indexOf('apply_cod_open_balance_offset')).toBeGreaterThan(-1)
    expect(body.indexOf('apply_cod_open_balance_offset')).toBeLessThan(body.indexOf('INSERT INTO public.invoice_refunds'))
    expect(body).toMatch(/payment_id, cod_adjustment_id, amount_brl/i)
    expect(body).toMatch(/'pending'/i)
  })

  it('preserva emissão complementar e cancelar/reemitir como pendências manuais', () => {
    const body = functionBody('settle_cod_adjustment')
    expect(body).not.toMatch(/action NOT IN \('offset_open_balance', 'refund_overpayment'\)/i)
    expect(body).toMatch(/complementary_invoice|cancel_and_reissue|manual_charge_review/i)
    expect(body).toMatch(/p_document_id|p_resulting_document_id/i)
    expect(body).toMatch(/resulting_document_type/i)
  })

  it('grava o id do refund no ajuste liquidado', () => {
    const body = functionBody('settle_cod_adjustment')
    expect(body).toMatch(/resulting_document_id\s*=\s*CASE[\s\S]*WHEN v_refund_id IS NOT NULL THEN v_refund_id/i)
  })

  it('expõe uma operação transacional para concluir documentos manuais', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.settle_cod_adjustment[\s\S]*p_resulting_document_id/i)
    expect(migration).toMatch(/is_financeiro_user\(\)/i)
  })

  it('regrava a baixa de restituição com o mesmo gate', () => {
    const body = functionBody('settle_invoice_refund')
    expect(body).toMatch(/UPDATE public\.invoice_refunds[\s\S]*status = 'settled'/i)
    expect(body).toMatch(/INSERT INTO public\.audit_logs/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.settle_invoice_refund\(BIGINT, UUID\) FROM PUBLIC, anon/i)
  })

  it('expõe origem do crédito no RPC já consumido pela UI', () => {
    expect(migration).toMatch(/RETURNS TABLE \([\s\S]*payment_id BIGINT,[\s\S]*cod_adjustment_id BIGINT/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_invoice_refunds\(BIGINT\) TO authenticated/i)
  })
})

describeLocal('comportamento efetivo da liquidação de COD no Postgres local', () => {
  const adminId = '63000000-0000-0000-0000-000000000001'
  const opsId = '63000000-0000-0000-0000-000000000002'
  const equipmentId = '63000000-0000-0000-0000-000000000003'
  const customerId = 630001
  const portalUserId = '63000000-0000-0000-0000-000000000004'
  const carrierId = 630002
  const vesselId = 630003
  const voyageId = 630004
  const offsetOmissionId = 630005
  const refundOmissionId = 630006
  const blId = 'T7-313-BL'

  function psql(sql: string) {
    return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
  }

  function callAs(role: string, userId: string, sql: string) {
    return spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', `BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT set_config('request.jwt.claim.sub','${userId}',true); ${sql}; COMMIT;`], { encoding: 'utf8' })
  }

  beforeAll(() => {
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 't7-313-admin@example.test'),
        ('${opsId}', 't7-313-ops@example.test'),
        ('${equipmentId}', 't7-313-equipment@example.test'),
        ('${portalUserId}', 't7-313-portal@example.test')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'T7 Financeiro', 'financeiro', true),
        ('${opsId}', 'T7 Operacoes', 'operacoes', true),
        ('${equipmentId}', 'T7 Equipamentos', 'equipamentos', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '99630001000187', 'Cliente T7 313')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
      INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
      VALUES (${customerId}, 'Financeiro T7', 't7-313@example.test', 'financeiro', true)
      ON CONFLICT DO NOTHING;
      INSERT INTO public.customer_portal_accounts (
        customer_id, active, auth_user_id, account_situation, recovery_email, recovery_email_status
      ) VALUES (
        ${customerId}, true, '${portalUserId}', 'ativo', 't7-313-recovery@example.test', 'ok'
      )
      ON CONFLICT (customer_id) DO UPDATE SET
        active = true,
        auth_user_id = '${portalUserId}',
        account_situation = 'ativo',
        recovery_email = 't7-313-recovery@example.test',
        recovery_email_status = 'ok';
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier T7 313') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel T7 313', ${carrierId}) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'T7-313', 'active') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.bls (
        id, voyage_id, customer_id, cargo_mode, pod, financial_status,
        review_status, customer_reconciliation_status, ce_mercante
      )
      VALUES ('${blId}', ${voyageId}, ${customerId}, 'container', 'BRSSA', 'invoiced', 'ok', 'reconciled', 'T7-313-CE')
      ON CONFLICT (id) DO UPDATE SET
        pod = EXCLUDED.pod,
        customer_id = EXCLUDED.customer_id,
        ce_mercante = EXCLUDED.ce_mercante,
        review_status = 'ok',
        customer_reconciliation_status = 'reconciled';
      INSERT INTO public.voyage_omissions (id, voyage_id, omitted_pod, discharge_pod, reason)
      VALUES (${offsetOmissionId}, ${voyageId}, 'BRVIX', 'BRSSA', 'T7 313 offset'),
        (${refundOmissionId}, ${voyageId}, 'BRSSA', 'BRVIX', 'T7 313 refund')
      ON CONFLICT (id) DO NOTHING;
      DELETE FROM public.invoice_refunds WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number = 'T7-313-INV');
      DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
      DELETE FROM public.invoices WHERE invoice_number = 'T7-313-INV';
      INSERT INTO public.invoices (invoice_number, customer_id, bl_id, total_brl, total_paid_brl, balance_brl, status)
      VALUES ('T7-313-INV', ${customerId}, '${blId}', 100, 10, 90, 'partially_paid');
      DELETE FROM public.cod_adjustments WHERE bl_id = '${blId}';
      INSERT INTO public.cod_adjustments(bl_id, omission_id, original_value_brl, new_destination_value_brl, difference_brl, paid_amount_brl, outstanding_balance_brl, offset_amount_brl, refund_amount_brl, action, created_by)
      VALUES ('${blId}', ${offsetOmissionId}, 100, 80, -20, 10, 90, 20, 0, 'offset_open_balance', '${adminId}'),
        ('${blId}', ${refundOmissionId}, 100, 70, -30, 95, 5, 5, 25, 'refund_overpayment', '${adminId}');
    `)
  })

  afterAll(() => {
    psql(`
      SET session_replication_role = replica;
      DELETE FROM public.invoice_refunds WHERE invoice_id IN (SELECT id FROM public.invoices WHERE invoice_number = 'T7-313-INV');
      DELETE FROM public.cod_adjustments WHERE bl_id = '${blId}';
      DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
      DELETE FROM public.invoices WHERE invoice_number = 'T7-313-INV';
      DELETE FROM public.voyage_omissions WHERE id IN (${offsetOmissionId}, ${refundOmissionId});
      DELETE FROM public.bls WHERE id = '${blId}';
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
      DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
      DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${opsId}', '${equipmentId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${opsId}', '${equipmentId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${opsId}', '${equipmentId}', '${portalUserId}');
      SET session_replication_role = origin;
    `)
  })

  it('liquida abatimento antes da restituição e bloqueia portas indevidas', () => {
    const equipmentRead = callAs('authenticated', equipmentId, 'SELECT count(*) FROM public.cod_adjustments;')
    expect(equipmentRead.status).toBe(0)
    const equipmentCount = equipmentRead.stdout.trim().split(/\r?\n/).findLast((line) => /^\d+$/.test(line))
    expect(Number(equipmentCount)).toBeGreaterThanOrEqual(2)

    const invoiceId = psql("SELECT id FROM public.invoices WHERE invoice_number = 'T7-313-INV';")
    const manualInsertOutput = psql(`
      INSERT INTO public.cod_adjustments
        (bl_id, omission_id, original_value_brl, new_destination_value_brl, difference_brl,
         paid_amount_brl, outstanding_balance_brl, offset_amount_brl, refund_amount_brl,
         action, created_by)
      VALUES ('${blId}', ${offsetOmissionId}, 100, 95, -5, 10, 90, 5, 0,
              'complementary_invoice', '${adminId}')
      RETURNING id;
    `)
    const manualId = manualInsertOutput.split(/\r?\n/).findLast((line) => /^\d+$/.test(line))
    expect(manualId).toMatch(/^\d+$/)
    const manual = callAs('authenticated', adminId, `SELECT public.settle_cod_adjustment(${manualId}, '${adminId}', ${invoiceId}, 'invoice')`)
    expect(manual.status, `${manual.stdout}\n${manual.stderr}`).toBe(0)
    expect(psql(`SELECT status || '|' || resulting_document_type || '|' || resulting_document_id FROM public.cod_adjustments WHERE id = ${manualId};`)).toBe(`settled|invoice|${invoiceId}`)

    const offset = callAs('authenticated', adminId, `SELECT public.settle_cod_adjustment((SELECT id FROM public.cod_adjustments WHERE omission_id = ${offsetOmissionId} AND action = 'offset_open_balance' AND status = 'pending'), '${adminId}')`)
    expect(offset.status).toBe(0)
    expect(psql("SELECT status || '|' || total_brl || '|' || balance_brl FROM public.invoices WHERE invoice_number = 'T7-313-INV';")).toBe('partially_paid|100.00|65.00')

    const refund = callAs('authenticated', adminId, `SELECT public.settle_cod_adjustment((SELECT id FROM public.cod_adjustments WHERE omission_id = ${refundOmissionId}), '${adminId}')`)
    expect(refund.status).toBe(0)
    expect(psql(`SELECT payment_id IS NULL || '|' || (cod_adjustment_id IS NOT NULL) || '|' || status FROM public.invoice_refunds WHERE cod_adjustment_id = (SELECT id FROM public.cod_adjustments WHERE omission_id = ${refundOmissionId});`)).toBe('true|true|pending')

    const refundId = psql(`SELECT id FROM public.invoice_refunds WHERE cod_adjustment_id = (SELECT id FROM public.cod_adjustments WHERE omission_id = ${refundOmissionId});`)
    const settleRefund = callAs('authenticated', adminId, `SELECT public.settle_invoice_refund(${refundId}, '${adminId}')`)
    expect(settleRefund.status).toBe(0)

    const directWrite = callAs('authenticated', adminId, `UPDATE public.cod_adjustments SET status = 'cancelled' WHERE omission_id = ${offsetOmissionId}`)
    expect(directWrite.status).not.toBe(0)
    expect(`${directWrite.stdout}\n${directWrite.stderr}`).toMatch(/permission denied|42501|row-level security/i)

    const ops = callAs('authenticated', opsId, `SELECT public.settle_cod_adjustment((SELECT id FROM public.cod_adjustments WHERE omission_id = ${offsetOmissionId} AND action = 'offset_open_balance' AND status = 'settled'), '${opsId}')`)
    expect(ops.status).not.toBe(0)
    expect(`${ops.stdout}\n${ops.stderr}`).toMatch(/42501|sem permissao|Apenas Financeiro/i)
  })
})
