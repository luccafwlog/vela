import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 425 (auditoria run-3, notas de endurecimento): guardas antes do
// trabalho e Cliente desativado fora do Portal.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const OPS = '41300000-0000-4000-8000-000000000001'
const ADM = '41300000-0000-4000-8000-000000000002'
const ADM_INATIVO = '41300000-0000-4000-8000-000000000003'
const PORTAL = '41300000-0000-4000-8000-000000000004'
const COM_FATURA = 413001
const SEM_PENDENCIA = 413002
const CARRIER = 413010
const VESSEL = 413011
const VOYAGE = 413012
const BL = 'C413-BL'
const INVOICE = 413020

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration413Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._assert_service_caller()') IS NOT NULL;`) === 't'
  } catch {
    return false
  }
}

// Sessão autenticada própria (transação descartada), com o SQLSTATE no erro.
function as(sub: string, sql: string, role = 'authenticated') {
  const started = Date.now()
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL lock_timeout = '1s';
     SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role })}';
     SET LOCAL ROLE ${role === 'service_role' ? 'service_role' : 'authenticated'};
     ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '').trim(), error: result.stderr ?? '', ms: Date.now() - started }
}

function holdLock(key: string, seconds: number): Promise<void> {
  const child = spawn('psql', ['-X', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('${key}', 0)); SELECT pg_sleep(${seconds}); COMMIT;`], { stdio: 'ignore' })
  return new Promise((resolve) => child.on('close', () => resolve()))
}

async function lockIsHeld(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (psql(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted;`) !== '0') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('a sessão de apoio não pegou a trava')
}

function cleanup() {
  spawnPsql(['-X', '-q', '-d', databaseUrl, '-c', `
    SET session_replication_role = replica;
    DELETE FROM public.invoice_bls WHERE invoice_id = ${INVOICE};
    DELETE FROM public.invoices WHERE id = ${INVOICE};
    DELETE FROM public.bls WHERE id = '${BL}';
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.audit_logs WHERE entity_type = 'customer' AND entity_id IN ('${COM_FATURA}', '${SEM_PENDENCIA}');
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id IN (${COM_FATURA}, ${SEM_PENDENCIA});
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${COM_FATURA}, ${SEM_PENDENCIA});
    DELETE FROM public.customers WHERE id IN (${COM_FATURA}, ${SEM_PENDENCIA});
    DELETE FROM auth.sessions WHERE user_id = '${PORTAL}';
    DELETE FROM auth.refresh_tokens WHERE user_id = '${PORTAL}';
    DELETE FROM public.user_profiles WHERE id IN ('${OPS}', '${ADM}', '${ADM_INATIVO}');
    DELETE FROM auth.users WHERE id IN ('${OPS}', '${ADM}', '${ADM_INATIVO}', '${PORTAL}');
  `], { encoding: 'utf8' })
}

const describeLocal = describeWithProbe(migration413Applied, 'migration413Applied (guardas antes do trabalho)')

describeLocal('425 — guardas antes do trabalho e Cliente desativado fora do Portal', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${ADM}';
      CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
      CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, user_id text);
      INSERT INTO auth.users (id, email) VALUES ('${OPS}', 'c413-ops@example.test'), ('${ADM}', 'c413-adm@example.test'),
        ('${ADM_INATIVO}', 'c413-adm-inativo@example.test'), ('${PORTAL}', 'c413-portal@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${OPS}', 'Operações C413', 'operacoes', true),
        ('${ADM}', 'Administrativo C413', 'administrativo', true),
        ('${ADM_INATIVO}', 'Administrativo inativo C413', 'administrativo', false);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${COM_FATURA}, '${syntheticCnpj(41301)}', 'Cliente C413 com fatura'),
        (${SEM_PENDENCIA}, '${syntheticCnpj(41302)}', 'Cliente C413 sem pendência');
      UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL}', active = true, account_situation = 'ativo'
        WHERE customer_id = ${SEM_PENDENCIA};
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
        VALUES (${COM_FATURA}, 'Fixture: gate aberto', '${ADM}', now() + interval '1 day');
      INSERT INTO auth.sessions (user_id) VALUES ('${PORTAL}');
      INSERT INTO auth.refresh_tokens (user_id) VALUES ('${PORTAL}');
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier C413');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel C413', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V413', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL}', ${VOYAGE}, ${COM_FATURA}, 'CE413');
      INSERT INTO public.invoices (id, invoice_number, customer_id, total_brl, status, pix_payload)
        VALUES (${INVOICE}, 'C413-INV', ${COM_FATURA}, 50.00, 'issued', 'C413');
      INSERT INTO public.invoice_bls (invoice_id, bl_id) VALUES (${INVOICE}, '${BL}');
    `)
  })

  afterAll(cleanup)

  it('baixa de 8 argumentos recusa quem não é do Financeiro antes de entrar na fila do B/L', async () => {
    const holder = holdLock(`bl:${BL}`, 4)
    await lockIsHeld()
    const call = as(OPS, `SELECT public.register_ledger_invoice_payment(${INVOICE}, 10, 'pix', now(), NULL, 'manual', NULL, '${OPS}'::uuid)`)
    expect(call.status).not.toBe(0)
    expect(call.error).toContain('42501')
    expect(call.error).not.toContain('55P03')
    await holder
  }, 20_000)

  it('current_user_role não devolve papel de perfil desativado', () => {
    expect(as(ADM, `SELECT coalesce(public.current_user_role(), '<nulo>')`).out).toBe('administrativo')
    expect(as(ADM_INATIVO, `SELECT coalesce(public.current_user_role(), '<nulo>')`).out).toBe('<nulo>')
  })

  it('desativar o Cliente encerra as sessões do Portal e grava o marco de revogação', () => {
    const result = as(ADM, `SELECT public.deactivate_customer(${SEM_PENDENCIA}, 'Fixture C413')->>'deactivated'`)
    expect(result.error).toBe('')
    expect(result.out).toBe('true')
    expect(psql(`SELECT count(*) FROM auth.sessions WHERE user_id = '${PORTAL}'`)).toBe('0')
    expect(psql(`SELECT count(*) FROM auth.refresh_tokens WHERE user_id = '${PORTAL}'`)).toBe('0')
    expect(psql(`SELECT credentials_revoked_at IS NOT NULL FROM public.customer_portal_accounts WHERE customer_id = ${SEM_PENDENCIA}`)).toBe('t')
  })

  it('rotinas do sistema recusam outro chamador e aceitam service_role e pg_cron', () => {
    // O GRANT já fecha a API; a guarda vale mesmo se um GRANT futuro abrir.
    const asUser = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
      `BEGIN; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ADM, role: 'authenticated' })}';
       SELECT public.reconcile_import_effects_queue_alert(); COMMIT;`], { encoding: 'utf8' })
    expect(asUser.status).not.toBe(0)
    expect(asUser.stderr).toContain('42501')
    expect(as(ADM, `SELECT 'ok' FROM (SELECT public.reconcile_import_effects_queue_alert()) AS chamada`, 'service_role').out).toBe('ok')
    expect(psql(`BEGIN; SELECT 'ok' FROM (SELECT public.reconcile_import_effects_queue_alert()) AS chamada; ROLLBACK;`)).toBe('ok')
  })
})
