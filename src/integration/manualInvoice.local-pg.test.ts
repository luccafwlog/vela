import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000098701'
const operatorId = '00000000-0000-0000-0000-000000098702'
const portalAId = '00000000-0000-0000-0000-000000098703'
const portalBId = '00000000-0000-0000-0000-000000098704'
const customerA = 998701
const customerB = 998702
const carrierId = 998703
const vesselId = 998704
const voyageA = 998705
const voyageB = 998706
const blA = 'MAN-098-A'
const blB = 'MAN-098-B'
const customerACnpj = syntheticCnpj(98701)
const customerBCnpj = syntheticCnpj(98702)

function psql(sql: string, role: 'service_role' | 'authenticated' = 'service_role', sub = adminId): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${sub}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string, sub: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${sub}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function sqlError(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error)
  }
  return ''
}

function cleanup(): void {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (${customerA}, ${customerB}));
    DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (${customerA}, ${customerB}));
    DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM public.invoices WHERE customer_id IN (${customerA}, ${customerB}));
    DELETE FROM public.invoices WHERE customer_id IN (${customerA}, ${customerB});
    DELETE FROM public.audit_logs WHERE entity_type = 'invoice' AND entity_id IN ('MAN-098-A', 'MAN-098-B');
    DELETE FROM public.bls WHERE id IN ('${blA}', '${blB}');
    DELETE FROM public.voyages WHERE id IN (${voyageA}, ${voyageB});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerA}, ${customerB});
    DELETE FROM public.customers WHERE id IN (${customerA}, ${customerB});
    DELETE FROM auth.users WHERE id IN ('${adminId}', '${operatorId}', '${portalAId}', '${portalBId}');
    DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${operatorId}');
    SET session_replication_role = origin;
  `)
}

function createInvoice(customerId: number, item = 'Serviço especial', options: { description?: string; quantity?: number; unitValue?: number; blId?: string; voyageId?: number } = {}) {
  const result = psql(`
    SELECT public.create_manual_invoice(
      ${customerId},
      '${item}',
      ${options.quantity ?? 2},
      ${options.unitValue ?? 125.5},
      ${options.description ? `'${options.description}'` : 'NULL'},
      ${options.blId ? `'${options.blId}'` : 'NULL'},
      ${options.voyageId ?? 'NULL'},
      '${adminId}'::uuid
    );
  `)
  return JSON.parse(result) as {
    invoice_id: number
    invoice_number: string
    invoice_type: string
    status: string
    total_brl: number
    balance_brl: number
    bl_id: string | null
    voyage_id: number | null
  }
}

describeLocal('fatura avulsa flexível — PostgreSQL local', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin-098@example.test'),
        ('${operatorId}', 'operator-098@example.test'),
        ('${portalAId}', 'portal-a-098@example.test'),
        ('${portalBId}', 'portal-b-098@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Admin 098', 'administrativo', true),
        ('${operatorId}', 'Operator 098', 'operator', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerA}, '${customerACnpj}', 'Cliente manual A'),
        (${customerB}, '${customerBCnpj}', 'Cliente manual B');
      UPDATE public.customer_portal_accounts
      SET auth_user_id = CASE customer_id WHEN ${customerA} THEN '${portalAId}'::uuid ELSE '${portalBId}'::uuid END,
          active = true,
          account_situation = 'ativo',
          recovery_email = CASE customer_id WHEN ${customerA} THEN 'portal-a-098@example.test' ELSE 'portal-b-098@example.test' END,
          recovery_email_status = 'ok'
      WHERE customer_id IN (${customerA}, ${customerB});
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier manual 098');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel manual 098', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyageA}, ${vesselId}, 'MANUAL-098-A', 'active'),
        (${voyageB}, ${vesselId}, 'MANUAL-098-B', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES
        ('${blA}', ${voyageA}, ${customerA}, 'BRSSZ', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
        ('${blB}', ${voyageA}, ${customerB}, 'BRSSZ', 'container', 'pending', 'not_calculated', 'reconciled', NULL);
    `)
  })

  afterAll(cleanup)

  it('inclui o saldo das faturas avulsas no resumo autenticado do Portal', () => {
    createInvoice(customerA, 'Saldo avulso no Portal', { quantity: 1, unitValue: 1 })
    const overview = JSON.parse(asUser(`SELECT public.portal_get_session_overview_v2();`, portalAId)) as { pending_balance: number }

    expect(overview.pending_balance).toBe(1)
  })

  it('emite sem contexto, com viagem e com BL, calculando o total no banco', () => {
    const noContext = createInvoice(customerA, 'Taxa administrativa', { description: 'Sem referência operacional', quantity: 2, unitValue: 125.5 })
    const voyageOnly = createInvoice(customerA, 'Acompanhamento', { voyageId: voyageA })
    const withBl = createInvoice(customerA, 'Serviço vinculado', { blId: blA })

    expect(noContext).toMatchObject({ invoice_type: 'manual', status: 'issued', total_brl: 251, balance_brl: 251, bl_id: null, voyage_id: null })
    expect(voyageOnly.voyage_id).toBe(voyageA)
    expect(withBl).toMatchObject({ bl_id: blA, voyage_id: voyageA })
    expect(psql(`SELECT count(*) FROM public.invoice_items WHERE invoice_id = ${noContext.invoice_id} AND source = 'manual' AND total_value_brl = 251;`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.invoice_bls WHERE invoice_id IN (${noContext.invoice_id}, ${voyageOnly.invoice_id}, ${withBl.invoice_id});`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.invoice_receivable_links WHERE invoice_id IN (${noContext.invoice_id}, ${voyageOnly.invoice_id}, ${withBl.invoice_id});`)).toBe('0')
    expect(psql(`SELECT pix_payload IS NOT NULL FROM public.invoices WHERE id = ${noContext.invoice_id};`)).toBe('t')
    expect(psql(`SELECT count(*) FROM public.invoice_lifecycle_events WHERE invoice_id = ${noContext.invoice_id} AND event_type = 'issued';`)).toBe('1')
  })

  it('rejeita cliente, BL, viagem e usuário inválidos sem deixar invoice parcial', () => {
    const before = Number(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerA} AND invoice_type = 'manual';`))
    expect(sqlError(() => psql(`SELECT public.create_manual_invoice(${customerA}, 'BL de outro cliente', 1, 10, NULL, '${blB}', NULL, '${adminId}'::uuid);`))).toMatch(/não pertence|nao pertence/i)
    expect(sqlError(() => psql(`SELECT public.create_manual_invoice(${customerA}, 'Viagem incoerente', 1, 10, NULL, '${blA}', ${voyageB}, '${adminId}'::uuid);`))).toMatch(/não pertence|nao pertence/i)
    expect(sqlError(() => psql(`SELECT public.create_manual_invoice(${customerA}, 'Sem permissão', 1, 10, NULL, NULL, NULL, '${operatorId}'::uuid);`, 'authenticated', operatorId))).toMatch(/permissao|permissão/i)
    expect(Number(psql(`SELECT count(*) FROM public.invoices WHERE customer_id = ${customerA} AND invoice_type = 'manual';`))).toBe(before)
  })

  it('cancela sem alterar o status financeiro do BL e reconcilia pelo pagamento genérico', () => {
    const cancellable = createInvoice(customerA, 'Cancelável', { blId: blA })
    expect(JSON.parse(psql(`SELECT public.cancel_invoice(${cancellable.invoice_id}, 'Teste manual 098', '${adminId}'::uuid);`))).toMatchObject({ status: 'cancelled' })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${cancellable.invoice_id};`)).toBe('cancelled')
    expect(psql(`SELECT financial_status FROM public.bls WHERE id = '${blA}';`)).toBe('pending')

    const payable = createInvoice(customerA, 'Reconciliação')
    const reconciliation = JSON.parse(psql(`SELECT public.reconcile_invoice_payment_by_txid('${payable.invoice_number}', ${payable.total_brl}, now());`)) as { matched: boolean; settled: boolean }
    expect(reconciliation).toMatchObject({ matched: true, settled: true })
    expect(psql(`SELECT status FROM public.invoices WHERE id = ${payable.invoice_id};`)).toBe('paid')
    expect(psql(`SELECT count(*) FROM public.ledger_settlements WHERE invoice_id = ${payable.invoice_id};`)).toBe('0')
  })

  it('lista no Portal só para o cliente autenticado, inclusive sem BL', () => {
    const invoiceA = createInvoice(customerA, 'Visível no Portal', { description: 'Descrição no Portal' })
    const invoiceB = createInvoice(customerB, 'Privada do cliente B')
    const portalRows = JSON.parse(asUser(`SELECT COALESCE(jsonb_agg(to_jsonb(row)), '[]'::jsonb) FROM public.portal_list_invoices() AS row;`, portalAId)) as Array<{ id: number; invoice_type: string; bls: string[] }>
    expect(portalRows.some((row) => row.id === invoiceA.invoice_id && row.invoice_type === 'manual' && row.bls.length === 0)).toBe(true)
    expect(portalRows.some((row) => row.id === invoiceB.invoice_id)).toBe(false)
    const detail = JSON.parse(asUser(`SELECT public.portal_invoice_details(${invoiceA.invoice_id});`, portalAId)) as { invoice: { invoice_type: string; notes: string }; bls: unknown[] }
    expect(detail).toMatchObject({ invoice: { invoice_type: 'manual', notes: 'Descrição no Portal' }, bls: [] })
    expect(sqlError(() => asUser(`SELECT public.portal_invoice_details(${invoiceB.invoice_id});`, portalAId))).toMatch(/não encontrada|nao encontrada/i)
  })
})
