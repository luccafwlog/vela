import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// S01 — fronteiras de segurança das RPCs auditadas (#659.2, #660.1/3).
// Prova executada contra o replay local (scripts/setup-local-pg.sh):
// grant efetivo, revogação de sessão e guardas no ponto de entrada.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl =
  process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

// Bloco de fixtures exclusivo deste arquivo.
const CUSTOMER_ID = 619701
const BL_ID = 'S01-701-BL'
const PORTAL_SUB = 'aaaaaaaa-0000-4000-8000-000000000701'
const STAFF_SUB = 'bbbbbbbb-0000-4000-8000-000000000702'
const OTHER_SUB = 'cccccccc-0000-4000-8000-000000000703'
const LOGIN_SENTINEL = '2026-01-01T00:00:00Z'

function psql(sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
  }).trim()
}

function runAs(role: 'authenticated' | 'anon', sub: string | null, claims: string | null, sql: string) {
  const settings =
    `SET LOCAL ROLE ${role};` +
    (sub === null ? '' : `SELECT set_config('request.jwt.claim.sub', '${sub}', true);`) +
    (claims === null ? '' : `SELECT set_config('request.jwt.claims', '${claims}', true);`)
  return spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-d', databaseUrl,
      '-c', `BEGIN; ${settings} ${sql} COMMIT;`],
    { encoding: 'utf8' },
  )
}

function portalCall(sub: string, iat: number | string | null, sql: string) {
  const claims =
    iat === null ? '{}' : JSON.stringify({ sub, iat: typeof iat === 'number' ? iat : iat })
  return runAs('authenticated', sub, claims, sql)
}

function lastLoginIsSentinel() {
  return (
    psql(
      `SELECT last_login_at = '${LOGIN_SENTINEL}'::timestamptz ` +
        `FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};`,
    ) === 't'
  )
}

describeLocal('S01 — fronteiras de segurança das RPCs auditadas', () => {
  beforeAll(() => {
    psql(`INSERT INTO public.carriers (id, name) VALUES (${CUSTOMER_ID}, 'Carrier S01')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.vessels (id, name, carrier_id) VALUES (${CUSTOMER_ID}, 'Vessel S01', ${CUSTOMER_ID})
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${CUSTOMER_ID}, ${CUSTOMER_ID}, 'S01-701')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${CUSTOMER_ID}, '61970100000135', 'Cliente S01')
      ON CONFLICT (id) DO NOTHING;`)
    // O fixture emite uma invoice abaixo; o CE preenchido satisfaz o gate de
    // emissão universal introduzido pela migration 047.
    psql(`INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante) VALUES ('${BL_ID}', ${CUSTOMER_ID}, ${CUSTOMER_ID}, '123456789012345')
      ON CONFLICT (id) DO NOTHING;`)
    // Inserir cliente auto-provisiona a conta do Portal (inativa); ativar por UPDATE.
    psql(`INSERT INTO auth.users (id, email) VALUES
      ('${PORTAL_SUB}', 's01-portal@example.test'),
      ('${STAFF_SUB}', 's01-staff@example.test'),
      ('${OTHER_SUB}', 's01-other@example.test')
      ON CONFLICT (id) DO NOTHING;`)
    psql(`INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
      ('${STAFF_SUB}', 'Staff S01', 'administrativo', true),
      ('${OTHER_SUB}', 'Outro S01', 'operacoes', true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, active = true;`)
    psql(`UPDATE public.customer_portal_accounts SET auth_user_id = '${PORTAL_SUB}', active = true,
      contact_email = 's01@example.test', login_cnpj = '61970100000135',
      account_situation = 'ativo', recovery_email = 's01-rec@example.test',
      recovery_email_status = 'ok', credentials_revoked_at = NULL,
      last_login_at = '${LOGIN_SENTINEL}'::timestamptz
      WHERE customer_id = ${CUSTOMER_ID};`)
  })

  afterAll(() => {
    for (const sql of [
      `DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i
        JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${BL_ID}');`,
      `DELETE FROM public.alert_items WHERE alert_id IN
        (SELECT id FROM public.alerts WHERE entity_id = '${BL_ID}');`,
      `DELETE FROM public.alerts WHERE entity_id = '${BL_ID}';`,
      `DELETE FROM public.invoices WHERE customer_id = ${CUSTOMER_ID};`,
      `DELETE FROM public.bls WHERE id = '${BL_ID}';`,
      `DELETE FROM public.customer_portal_accounts WHERE customer_id = ${CUSTOMER_ID};`,
      `DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};`,
      `DELETE FROM public.user_profiles WHERE id IN ('${STAFF_SUB}', '${OTHER_SUB}');`,
      `DELETE FROM auth.users WHERE id IN ('${PORTAL_SUB}', '${STAFF_SUB}', '${OTHER_SUB}');`,
      `DELETE FROM public.voyages WHERE id = ${CUSTOMER_ID};`,
      `DELETE FROM public.vessels WHERE id = ${CUSTOMER_ID};`,
      `DELETE FROM public.carriers WHERE id = ${CUSTOMER_ID};`,
    ]) {
      spawnSync('psql', ['-X', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
    }
  })

  it('fecha EXECUTE de upsert_portal_invoice_exception para anon e authenticated', () => {
    const signature = 'public.upsert_portal_invoice_exception(bigint,text)'
    expect(psql(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`)).toBe('f')
    // Chamada direta como Portal é negada no catálogo, sem tocar em alertas.
    const before = psql(`SELECT count(*) FROM public.alert_items;`)
    const denied = portalCall(PORTAL_SUB, Math.floor(Date.now() / 1000), `SELECT public.upsert_portal_invoice_exception(1, '${BL_ID}');`)
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('42501')
    expect(psql(`SELECT count(*) FROM public.alert_items;`)).toBe(before)
  })

  it('token revogado (iat anterior) não hidrata o overview nem atualiza last_login_at', () => {
    psql(`UPDATE public.customer_portal_accounts SET credentials_revoked_at = now(),
      last_login_at = '${LOGIN_SENTINEL}'::timestamptz WHERE customer_id = ${CUSTOMER_ID};`)
    const iat = Math.floor(Date.now() / 1000) - 3600
    const revoked = portalCall(PORTAL_SUB, iat, `SELECT public.portal_get_session_overview_v2();`)
    expect(revoked.status).not.toBe(0)
    expect(revoked.stderr).toContain('28000')
    expect(lastLoginIsSentinel()).toBe(true)
  })

  it('nega qualquer token emitido antes do marco de revogação, sem janela de tolerância', () => {
    const now = Math.floor(Date.now() / 1000)
    psql(`UPDATE public.customer_portal_accounts
      SET credentials_revoked_at = to_timestamp(${now}) + interval '3 seconds',
        last_login_at = '${LOGIN_SENTINEL}'::timestamptz WHERE customer_id = ${CUSTOMER_ID};`)
    const justBefore = portalCall(PORTAL_SUB, now, `SELECT public.portal_get_session_overview_v2();`)
    expect(justBefore.status).not.toBe(0)
    expect(justBefore.stderr).toContain('28000')
    expect(lastLoginIsSentinel()).toBe(true)

    psql(`UPDATE public.customer_portal_accounts
      SET credentials_revoked_at = to_timestamp(${now}),
        last_login_at = '${LOGIN_SENTINEL}'::timestamptz WHERE customer_id = ${CUSTOMER_ID};`)
    const after = portalCall(PORTAL_SUB, now + 1, `SELECT public.portal_get_session_overview_v2();`)
    expect(after.status, `${after.stdout}\n${after.stderr}`).toBe(0)
    const payload = after.stdout
      .split('\n')
      .find((line) => line.includes('"customer_id"')) as string
    expect(JSON.parse(payload).customer_id).toBe(CUSTOMER_ID)
  })

  it('iat ausente ou malformado com revogação ativa nega com mensagem genérica (sem vazar cast)', () => {
    const now = Math.floor(Date.now() / 1000)
    psql(`UPDATE public.customer_portal_accounts
      SET credentials_revoked_at = to_timestamp(${now}),
        last_login_at = '${LOGIN_SENTINEL}'::timestamptz WHERE customer_id = ${CUSTOMER_ID};`)
    const missing = portalCall(PORTAL_SUB, null, `SELECT public.portal_get_session_overview_v2();`)
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('28000')

    const malformed = portalCall(PORTAL_SUB, 'nao-numero', `SELECT public.portal_get_session_overview_v2();`)
    expect(malformed.status).not.toBe(0)
    expect(malformed.stderr).toContain('28000')
    expect(malformed.stderr).not.toContain('double precision')
    expect(malformed.stderr).not.toContain('22P02')
    expect(lastLoginIsSentinel()).toBe(true)
  })

  it('escala v2 nega sessão Portal antes de validar payload (42501, sem criar porto)', () => {
    const now = Math.floor(Date.now() / 1000)
    psql(`UPDATE public.customer_portal_accounts SET credentials_revoked_at = NULL,
      last_login_at = '${LOGIN_SENTINEL}'::timestamptz WHERE customer_id = ${CUSTOMER_ID};`)
    const denied = portalCall(
      PORTAL_SUB,
      now,
      `SELECT public.save_voyage_escala_terminal_state_v2(${CUSTOMER_ID}, 'BRZZZ', 0, '[]', NULL, '{}', 't');`,
    )
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('42501')
    expect(denied.stderr).not.toContain('22023')
    expect(psql(`SELECT count(*) FROM public.ports WHERE locode = 'BRZZZ';`)).toBe('0')
  })

  it('import nega sessão Portal antes de ler payload (42501, sem persistência)', () => {
    const now = Math.floor(Date.now() / 1000)
    const before = psql(`SELECT count(*) FROM public.bls;`)
    const denied = portalCall(
      PORTAL_SUB,
      now,
      `SELECT public.import_bl_freight_transactional('{"a":1}'::jsonb, '${PORTAL_SUB}');`,
    )
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('42501')
    expect(denied.stderr).not.toContain('22023')
    expect(psql(`SELECT count(*) FROM public.bls;`)).toBe(before)
  })

  it('ator divergente no import é negado sem nenhuma alteração persistida', () => {
    const now = Math.floor(Date.now() / 1000)
    const beforeBls = psql(`SELECT count(*) FROM public.bls;`)
    const beforeAudit = psql(`SELECT count(*) FROM public.audit_logs;`)
    const denied = portalCall(
      STAFF_SUB,
      now,
      `SELECT public.import_bl_freight_transactional('[]'::jsonb, '${OTHER_SUB}');`,
    )
    expect(denied.status).not.toBe(0)
    expect(denied.stderr).toContain('42501')
    expect(psql(`SELECT count(*) FROM public.bls;`)).toBe(beforeBls)
    expect(psql(`SELECT count(*) FROM public.audit_logs;`)).toBe(beforeAudit)
  })

  it('trigger legítimo segue gerando/resolvendo o alerta de exceção após o fechamento', () => {
    // Semeia o alerta pelo caminho do dono e resolve pelo caminho legítimo do
    // trigger de emissão: a cadeia interna precisa sobreviver ao REVOKE.
    psql(`UPDATE public.customer_portal_accounts SET recovery_email = NULL WHERE customer_id = ${CUSTOMER_ID};`)
    psql(`BEGIN; SELECT set_config('request.jwt.claim.sub', '${STAFF_SUB}', true);
      SELECT public.upsert_portal_invoice_exception(619701, '${BL_ID}'); COMMIT;`)
    expect(
      psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'portal_excecao_critica_fatura' AND a.entity_id = '${BL_ID}'
        ORDER BY i.id DESC LIMIT 1;`),
    ).toBe('active')

    psql(`UPDATE public.customer_portal_accounts SET recovery_email = 's01-rec@example.test'
      WHERE customer_id = ${CUSTOMER_ID};`)
    const now = Math.floor(Date.now() / 1000)
    const issued = portalCall(
      STAFF_SUB,
      now,
      `INSERT INTO public.invoices (id, invoice_number, customer_id, bl_id, total_brl, status, pix_payload)
       VALUES (619702, 'S01-INV-702', ${CUSTOMER_ID}, '${BL_ID}', 50.00, 'issued', 'S01-FIXTURE');`,
    )
    expect(issued.status).toBe(0)
    expect(
      psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
        WHERE i.item_type = 'portal_excecao_critica_fatura' AND a.entity_id = '${BL_ID}'
        ORDER BY i.id DESC LIMIT 1;`),
    ).toBe('resolved')
  })
})
