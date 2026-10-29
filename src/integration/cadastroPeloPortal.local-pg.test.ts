import { execPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

// Migration 503: endereço mudado pelo Cliente no Perfil do Portal aparece em
// Alterações do cadastro como do Cliente, não de um "Usuário interno". A
// trilha (`customer_audit_timeline`) diz quando o autor é a conta do Portal.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '50100000-0000-4000-8000-000000000001'
const PORTAL = '50100000-0000-4000-8000-000000000002'
const CUSTOMER = 5010010

function scenario(sql: string): string[] {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'adm501@example.test'), ('${PORTAL}', 'portal501@example.test');
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADM}', 'Adm 501', 'administrativo', true);
    INSERT INTO public.customers (id, cnpj_cpf, name, address, city) VALUES (${CUSTOMER}, '50100000000110', 'Cliente 501', 'Rua Velha, 1', 'Santos');
    INSERT INTO public.customer_portal_accounts (customer_id, auth_user_id, active, account_situation, recovery_email, recovery_email_status)
      VALUES (${CUSTOMER}, '${PORTAL}', true, 'ativo', 'cliente501@example.test', 'ok');
    SET LOCAL session_replication_role = origin;
    ${sql}
    ROLLBACK;
  `], { encoding: 'utf8' }).trim().split(/\r?\n/)
}
const asPortal = `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${PORTAL}';`
const asAdmin = `RESET ROLE; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${ADM}';`
const asOwnerByAdmin = `RESET ROLE; SET LOCAL request.jwt.claim.role = 'service_role'; SET LOCAL request.jwt.claim.sub = '${ADM}';`

describeLocal('migration 503 — cadastro mudado pelo Cliente no Portal', () => {
  it('a trilha do Cliente marca a mudança do Perfil do Portal como do Portal, e a do usuário interno não', () => {
    const out = scenario(`
      ${asPortal}
      SELECT public.portal_update_profile(p_address => 'Rua Nova, 2') IS NOT NULL;
      ${asOwnerByAdmin}
      UPDATE public.customers SET city = 'Itajaí' WHERE id = ${CUSTOMER};
      ${asAdmin}
      SELECT field_name || '=' || new_value || '|portal=' || changed_by_portal
        FROM public.customer_audit_timeline(${CUSTOMER}) WHERE field_name IN ('address', 'city') ORDER BY field_name;
    `)
    expect(out).toContain('address=Rua Nova, 2|portal=true')
    expect(out).toContain('city=Itajaí|portal=false')
  })
})
