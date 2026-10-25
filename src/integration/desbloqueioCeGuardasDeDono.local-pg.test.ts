import { spawn } from 'node:child_process'
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 427 (auditoria run-3, notas de endurecimento): Desbloqueio de CE
// confere o dono antes das travas e não abre visão sem Cliente.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const PORTAL_A = '41500000-0000-4000-8000-000000000001'
const CUSTOMER_A = 415001
const CUSTOMER_B = 415002
const CARRIER = 415010
const VESSEL = 415011
const VOYAGE = 415012
const BL_B = 'C415-BL-B'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration415Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('IF src<>''request'' THEN rid:=NULL' in prosrc) > 0 FROM pg_proc WHERE proname = 'ce_unlock_prepare_upload';`) === 't'
  } catch {
    return false
  }
}

// Sessão do Portal A; `role` define o papel do Postgres (as funções privadas
// do desbloqueio só são alcançáveis pelo dono, então a chamada direta delas
// roda como superusuário com o JWT do Portal).
function asPortal(sql: string, pgRole: 'authenticated' | 'postgres' = 'authenticated') {
  const started = Date.now()
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL lock_timeout = '1s';
     ${pgRole === 'authenticated' ? 'SET LOCAL ROLE authenticated;' : ''}
     SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: PORTAL_A, role: 'authenticated', iat: Math.floor(Date.now() / 1000) + 60 })}';
     ${sql}; COMMIT;`], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '').trim(), error: result.stderr ?? '', ms: Date.now() - started }
}

function sqlstate(error: string): string | undefined {
  return /ERROR:\s+([0-9A-Z]{5}):/.exec(error)?.[1]
}

function holdBlRow(seconds: number): Promise<void> {
  const child = spawn('psql', ['-X', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SELECT 1 FROM public.bls WHERE id = '${BL_B}' FOR UPDATE; SELECT pg_sleep(${seconds}); COMMIT;`], { stdio: 'ignore' })
  return new Promise((resolve) => child.on('close', () => resolve()))
}

async function rowIsLocked(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (psql(`SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'bls' AND l.mode = 'RowShareLock' AND l.granted`) !== '0') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('a sessão de apoio não travou o B/L')
}

function cleanup() {
  spawnPsql(['-X', '-q', '-d', databaseUrl, '-c', `
    SET session_replication_role = replica;
    DELETE FROM public.ce_unlock_email_outbox WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.ce_unlock_documents WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM ce_unlock_private.upload_attempts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.ce_unlock_vip_customers WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.bls WHERE id = '${BL_B}';
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.vessels WHERE id = ${VESSEL};
    DELETE FROM public.carriers WHERE id = ${CARRIER};
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM public.customers WHERE id IN (${CUSTOMER_A}, ${CUSTOMER_B});
    DELETE FROM auth.users WHERE id = '${PORTAL_A}';
  `], { encoding: 'utf8' })
}

const describeLocal = describeWithProbe(migration415Applied, 'migration415Applied (Desbloqueio de CE: guardas de dono)')

describeLocal('427 — Desbloqueio de CE confere o dono antes das travas', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${PORTAL_A}', 'c415-a@example.test');
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${CUSTOMER_A}, '${syntheticCnpj(41501)}', 'Cliente C415 A'), (${CUSTOMER_B}, '${syntheticCnpj(41502)}', 'Cliente C415 B');
      UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_A}', active = true, account_situation = 'ativo'
        WHERE customer_id = ${CUSTOMER_A};
      INSERT INTO public.ce_unlock_vip_customers (customer_id, enabled) VALUES (${CUSTOMER_A}, true);
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER}, 'Carrier C415');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL}, 'Vessel C415', ${CARRIER});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, ${VESSEL}, 'V415', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL_B}', ${VOYAGE}, ${CUSTOMER_B}, 'CE415');
    `)
  })

  afterAll(cleanup)

  it('documento VIP anual não herda o request_id do contexto', () => {
    const context = JSON.stringify({ source: 'vip_annual', type: 'termo', request_id: '41500000-0000-4000-8000-0000000000ff', file_name: 'termo.pdf', size_bytes: 100 })
    const result = asPortal(`SELECT public.ce_unlock_prepare_upload('${context}'::jsonb)->>'id'`)
    expect(result.error).toBe('')
    expect(psql(`SELECT request_id IS NULL FROM public.ce_unlock_documents WHERE id = '${result.out}'`)).toBe('t')
  })

  it('a visão sem Cliente das funções privadas exige perfil interno', () => {
    expect(sqlstate(asPortal(`SELECT ce_unlock_private.list(NULL, '{}'::jsonb, 1)`, 'postgres').error)).toBe('42501')
    expect(sqlstate(asPortal(`SELECT ce_unlock_private.vip_json(NULL)`, 'postgres').error)).toBe('42501')
  })

  it('rascunho do Portal com B/L de outro Cliente é recusado antes de travar o B/L', async () => {
    const holder = holdBlRow(4)
    await rowIsLocked()
    const draft = asPortal(`SELECT public.portal_ce_unlock_command('draft', '${JSON.stringify({ bl_ids: [BL_B], request_key: '41500000-0000-4000-8000-0000000000d1' })}'::jsonb)`)
    expect(sqlstate(draft.error)).toBe('42501')
    expect(draft.error).not.toContain('55P03')
    await holder
  }, 20_000)

  it('aviso de Cliente desativado não sai da fila de e-mail', () => {
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.ce_unlock_email_outbox (customer_id, request_id, kind, subject, body)
        VALUES (${CUSTOMER_B}, gen_random_uuid(), 'changes_requested', 'Assunto C415', 'Corpo C415');
    `)
    // Desde a 458 a leitura reserva a linha: solta a reserva antes de cada
    // leitura (noutra transação), para o zero vir do Cliente desativado e não
    // da reserva.
    const pending = () => {
      psql(`UPDATE public.ce_unlock_email_outbox SET claimed_until = NULL WHERE customer_id = ${CUSTOMER_B}`)
      return psql(`SELECT count(*) FROM jsonb_array_elements(public.ce_unlock_email_pending(100)) o WHERE (o->>'customer_id')::bigint = ${CUSTOMER_B}`)
    }
    expect(pending()).toBe('1')
    psql(`SET vela.allow_customer_state = 'on'; UPDATE public.customers SET deactivated_at = now() WHERE id = ${CUSTOMER_B}`)
    expect(pending()).toBe('0')
  })
})
