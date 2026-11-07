// Migration 620 (ADR 0133, D6): cada fechamento do ADR entra na fila do e-mail
// "ADR fechado"; a leitura reserva a linha e traz o resumo e os destinatários
// (todo usuário interno ativo, sem a conta de integração); o fechamento da
// linha volta à fila na falha e desiste depois de 5 tentativas.
//
// Namespace exclusivo: Viagem 961101, usuários ...000000611001/2/3.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const VOYAGE = 961101
const REPORT = '61100000-0000-4000-8000-000000000001'
const ACTIVE = '00000000-0000-0000-0000-000000611001'
const INACTIVE = '00000000-0000-0000-0000-000000611002'
const INTEGRATION = '00000000-0000-0000-0000-000000611003'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const AS_SERVICE = `SET request.jwt.claim.role = 'service_role';`
type Pending = { rows: Array<{ id: number; report_id: string; port: string; closed_by_name: string | null; signoffs: Array<{ department: string; signed_by_name: string | null }> }>; recipients: string[] }
const pending = (): Pending => JSON.parse(psql(`${AS_SERVICE} SELECT public.adr_closed_email_pending(50);`)) as Pending
const mine = (p: Pending) => p.rows.filter((r) => r.report_id === REPORT)
const outbox = () => psql(`SELECT string_agg(status || ':' || attempts, ',' ORDER BY id) FROM public.adr_closed_email_outbox WHERE report_id = '${REPORT}';`)

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.adr_closed_email_outbox WHERE report_id = '${REPORT}';
    DELETE FROM public.agency_departure_report_department_signoffs WHERE report_id = '${REPORT}';
    DELETE FROM public.agency_departure_reports WHERE id = '${REPORT}';
    DELETE FROM public.voyages WHERE id = ${VOYAGE};
    DELETE FROM public.user_profiles WHERE id IN ('${ACTIVE}', '${INACTIVE}', '${INTEGRATION}');
    DELETE FROM auth.users WHERE id IN ('${ACTIVE}', '${INACTIVE}', '${INTEGRATION}');
    SET session_replication_role = origin;
  `)
}

describeLocal('ADR fechado avisa por e-mail (migration 620)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ACTIVE}', 'A611-Ativo@Example.test'), ('${INACTIVE}', 'a611-inativo@example.test'), ('${INTEGRATION}', 'a611-integracao@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active, account_kind) VALUES
        ('${ACTIVE}', 'A611 Ana', 'documentacao', true, 'pessoa'),
        ('${INACTIVE}', 'A611 Ivo', 'operacoes', false, 'pessoa'),
        ('${INTEGRATION}', 'A611 Robô', 'administrativo', true, 'integracao');
      SET session_replication_role = replica;
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE}, 1, 'A611', 'active');
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, status) VALUES ('${REPORT}', ${VOYAGE}, 'BRVIX', 'open');
      INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at) VALUES
        ('${REPORT}', 'documentacao', '${ACTIVE}', now()), ('${REPORT}', 'operacoes', NULL, now()), ('${REPORT}', 'equipamentos', '${ACTIVE}', now());
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('o ADR aberto não entra na fila; fechar entra uma vez', () => {
    expect(outbox()).toBe('')
    psql(`UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = '${ACTIVE}' WHERE id = '${REPORT}';`)
    expect(outbox()).toBe('pending:0')
  })

  it('a leitura reserva a linha e traz o resumo e só os usuários internos ativos', () => {
    const first = pending()
    const rows = mine(first)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ port: 'BRVIX', closed_by_name: 'A611 Ana' })
    expect(rows[0].signoffs.map((s) => `${s.department}:${s.signed_by_name ?? '-'}`)).toEqual(['documentacao:A611 Ana', 'equipamentos:A611 Ana', 'operacoes:-'])
    expect(first.recipients).toContain('a611-ativo@example.test')
    expect(first.recipients).not.toContain('a611-inativo@example.test')
    expect(first.recipients).not.toContain('a611-integracao@example.test')
    // Reservada: a rodada seguinte não pega a mesma linha.
    expect(mine(pending())).toHaveLength(0)
    expect(outbox()).toBe('pending:1')
  })

  it('falha volta à fila; enviado fecha; reabrir e fechar de novo gera outro e-mail', () => {
    const id = Number(psql(`SELECT id FROM public.adr_closed_email_outbox WHERE report_id = '${REPORT}';`))
    psql(`${AS_SERVICE} SELECT public.adr_closed_email_finish(${id}, 'retry', 'teste');`)
    expect(outbox()).toBe('pending:1')
    psql(`${AS_SERVICE} SELECT public.adr_closed_email_finish(${id}, 'sent');`)
    expect(outbox()).toBe('sent:1')

    psql(`UPDATE public.agency_departure_reports SET status = 'open', closed_at = NULL WHERE id = '${REPORT}';
      UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now() + interval '1 second' WHERE id = '${REPORT}';`)
    expect(outbox()).toBe('sent:1,pending:0')
  })

  it('depois de 5 tentativas, a linha desiste', () => {
    psql(`UPDATE public.adr_closed_email_outbox SET attempts = 5 WHERE report_id = '${REPORT}' AND status = 'pending';`)
    const id = Number(psql(`SELECT id FROM public.adr_closed_email_outbox WHERE report_id = '${REPORT}' AND status = 'pending';`))
    expect(mine(pending())).toHaveLength(0)
    psql(`${AS_SERVICE} SELECT public.adr_closed_email_finish(${id}, 'retry', 'teste');`)
    expect(outbox()).toBe('sent:1,failed:5')
  })

  it('a fila e as funções ficam fora do alcance do usuário logado', () => {
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.adr_closed_email_pending(integer)', 'EXECUTE');`)).toBe('f')
    expect(psql(`SELECT has_table_privilege('authenticated', 'public.adr_closed_email_outbox', 'SELECT');`)).toBe('f')
  })
})
