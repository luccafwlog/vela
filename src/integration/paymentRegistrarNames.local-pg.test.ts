import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const registrarId = '10000000-0000-0000-0000-000000000221'
const viewerId = '20000000-0000-0000-0000-000000000221'
const inactiveId = '30000000-0000-0000-0000-000000000221'
const customerId = 9922101
const invoiceId = 9922101
const otherInvoiceId = 9922102
const paymentWithAuthor = 9922101
const paymentWithoutAuthor = 9922102
const paymentNotRequested = 9922103

function psql(sql: string) {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function namesAs(role: 'authenticated' | 'anon', userId?: string) {
  const claims = userId ? `SELECT set_config('request.jwt.claim.sub', '${userId}', true);` : ''
  return spawnPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-d', databaseUrl,
    '-c', `BEGIN; SET LOCAL ROLE ${role}; ${claims}
      SELECT payment_id || '|' || registered_by_name
      FROM public.list_payment_registrar_names(ARRAY[${paymentWithAuthor}, ${paymentWithoutAuthor}]::bigint[])
      ORDER BY payment_id;
      COMMIT;`,
  ], { encoding: 'utf8' })
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.payments WHERE invoice_id IN (${invoiceId}, ${otherInvoiceId});
    DELETE FROM public.invoices WHERE id IN (${invoiceId}, ${otherInvoiceId});
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.user_profiles WHERE id IN ('${registrarId}', '${viewerId}', '${inactiveId}');
    DELETE FROM auth.users WHERE id IN ('${registrarId}', '${viewerId}', '${inactiveId}');
    SET session_replication_role = origin;
  `)
}

describeLocal('migration 221 — nome de quem registrou a baixa', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${registrarId}', 'registrar-221@example.test'),
        ('${viewerId}', 'viewer-221@example.test'),
        ('${inactiveId}', 'inactive-221@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${registrarId}', 'Autor da Baixa 221', 'administrativo', true),
        ('${viewerId}', 'Leitor Não Admin 221', 'documentacao', true),
        ('${inactiveId}', 'Leitor Inativo 221', 'documentacao', false);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(221001)}', 'R221 CLIENTE');
      SET session_replication_role = replica;
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status) VALUES
        (${invoiceId}, 'R221-INV', ${customerId}, 150, 'paid'),
        (${otherInvoiceId}, 'R221-INV-OUTRA', ${customerId}, 10, 'paid');
      INSERT INTO public.payments (id, invoice_id, amount_brl, payment_method, paid_at, registered_by, bank_reference) VALUES
        (${paymentWithAuthor}, ${invoiceId}, 100, 'pix', now(), '${registrarId}', 'teste'),
        (${paymentWithoutAuthor}, ${invoiceId}, 50, 'pix', now(), NULL, NULL),
        (${paymentNotRequested}, ${otherInvoiceId}, 10, 'pix', now(), '${viewerId}', NULL);
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('devolve ao usuário ativo não-admin só o autor das baixas pedidas', () => {
    const result = namesAs('authenticated', viewerId)

    expect(result.status, result.stderr).toBe(0)
    // A baixa sem autor não gera linha; a baixa não pedida não vaza o nome do leitor.
    expect(result.stdout.trim().split('\n').filter((line) => line.includes('|'))).toEqual([`${paymentWithAuthor}|Autor da Baixa 221`])
  })

  it('nega um usuário interno inativo', () => {
    const inactive = namesAs('authenticated', inactiveId)

    expect(inactive.status).not.toBe(0)
    expect(inactive.stderr).toContain('42501')
  })

  it('nega um usuário anônimo', () => {
    const anonymous = namesAs('anon')

    expect(anonymous.status).not.toBe(0)
    expect(anonymous.stderr).toContain('42501')
  })

  it('não é executável por PUBLIC nem anon', () => {
    const grants = psql(`
      SELECT has_function_privilege('anon', 'public.list_payment_registrar_names(bigint[])', 'EXECUTE')::text
        || ',' || has_function_privilege('authenticated', 'public.list_payment_registrar_names(bigint[])', 'EXECUTE')::text
    `)

    expect(grants).toBe('false,true')
  })
})
