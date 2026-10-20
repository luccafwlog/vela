import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 340 (incidente de 2026-10-20, Sentry VELA-21/22/23): os GRANTs do
// schema public saem das migrations, não dos default privileges do projeto. A
// branch staging nasceu só da cadeia e recusava (42501) leituras que produção
// aceitava. Esta suíte roda depois do replay limpo e falha na PR quando uma
// tabela nova ou uma migration deixa o banco diferente do contrato abaixo.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADMIN = '34000000-0000-4000-8000-000000000001'
const DML = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const
// Tabelas sem DELETE para service_role, como em produção (append-only).
const SERVICE_ROLE_NO_DELETE = ['audit_logs', 'bl_receivables', 'invoice_items', 'invoices', 'ledger_settlements', 'payments']

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Executa como o papel da Data API, numa transação desfeita no fim. */
function runAs(role: 'authenticated' | 'service_role', sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${ADMIN}';
     SET LOCAL request.jwt.claim.role = '${role}'; ${sql}; ROLLBACK;`], { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function publicTablesWhere(condition: string): string[] {
  const rows = psql(`SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm') AND (${condition})
    ORDER BY c.relname;`)
  return rows ? rows.split('\n') : []
}

function cleanup() {
  psql(`DELETE FROM public.user_profiles WHERE id = '${ADMIN}'; DELETE FROM auth.users WHERE id = '${ADMIN}';`)
}

function migration340Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT has_table_privilege('authenticated', 'public.agency_departure_report_signoffs', 'SELECT');`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration340Applied, 'migration340Applied (GRANTs explícitos do public)')

describeLocal('340 — GRANTs do replay iguais ao contrato de produção', () => {
  beforeAll(() => {
    cleanup()
    psql(`INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'admin-g340@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADMIN}', 'Admin G340', 'administrativo', true);`)
  })
  afterAll(cleanup)

  it('authenticated lê as tabelas das telas que davam 42501, sob RLS', () => {
    // VELA-23: embeds do Relatório Próprio de Agência.
    const report = runAs('authenticated', `SELECT count(*) FROM public.agency_departure_reports r
      LEFT JOIN public.agency_departure_report_signoffs s ON s.report_id = r.id
      LEFT JOIN public.agency_departure_report_department_signoffs d ON d.report_id = r.id
      LEFT JOIN public.agency_departure_report_occurrences o ON o.report_id = r.id`)
    expect(report.error).toBe('')
    expect(report.ok).toBe(true)
    // VELA-22: a policy de customer_communication_box_kinds lê customer_portal_accounts.
    const boxes = runAs('authenticated', `SELECT count(*) FROM public.customer_communication_box_kinds WHERE kind = 'institucional';
      SELECT count(*) FROM public.customer_communication_boxes; SELECT count(*) FROM public.customer_portal_accounts`)
    expect(boxes.error).toBe('')
    expect(boxes.ok).toBe(true)
  })

  it('service_role lê e escreve bls e itau_pix_charges', () => {
    for (const table of ['bls', 'itau_pix_charges']) {
      for (const privilege of DML) {
        expect(psql(`SELECT has_table_privilege('service_role', 'public.${table}', '${privilege}');`), `${table} ${privilege}`).toBe('t')
      }
    }
    const read = runAs('service_role', 'SELECT count(*) FROM public.bls; SELECT count(*) FROM public.itau_pix_charges')
    expect(read.error).toBe('')
    expect(read.ok).toBe(true)
  })

  it('service_role lê toda tabela do public e escreve nelas, menos o DELETE das append-only', () => {
    expect(publicTablesWhere(`NOT has_table_privilege('service_role', c.oid, 'SELECT')`)).toEqual([])
    const incomplete = publicTablesWhere(`c.relkind IN ('r', 'p') AND c.relname <> ALL (ARRAY[${SERVICE_ROLE_NO_DELETE.map((t) => `'${t}'`).join(', ')}])
      AND NOT (has_table_privilege('service_role', c.oid, 'INSERT') AND has_table_privilege('service_role', c.oid, 'UPDATE')
        AND has_table_privilege('service_role', c.oid, 'DELETE'))`)
    expect(incomplete).toEqual([])
    expect(publicTablesWhere(`has_table_privilege('service_role', c.oid, 'DELETE')
      AND c.relname = ANY (ARRAY[${SERVICE_ROLE_NO_DELETE.map((t) => `'${t}'`).join(', ')}])`)).toEqual([])
  })

  it('anon e authenticated não têm TRUNCATE, TRIGGER nem REFERENCES em nada', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) {
        expect(publicTablesWhere(`has_table_privilege('${role}', c.oid, '${privilege}')`), `${role} ${privilege}`).toEqual([])
      }
    }
  })

  it('anon não tem privilégio de tabela no public (o Portal pré-login usa só RPC)', () => {
    const anyPrivilege = DML.map((privilege) => `has_table_privilege('anon', c.oid, '${privilege}')`).join(' OR ')
    expect(publicTablesWhere(anyPrivilege)).toEqual([])
  })
})
