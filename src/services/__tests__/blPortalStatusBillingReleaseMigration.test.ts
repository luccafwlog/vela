import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Migration 501: `get_bl_portal_status` devolve `billing_access_ready`, a mesma
// condição da pendência "Acesso ao portal nao provisionado" da Revisão. Tudo
// roda numa transação desfeita no fim; nenhuma linha fica no banco.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const userId = '00000000-0000-0000-0000-000000050101'

function psqlRows(sql: string) {
  const output = execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' })
  return output.trim().split('\n').filter((line) => /^BL-501-/.test(line))
}

describeLocal('migration 501: status do Portal do B/L com a Liberação de faturamento', () => {
  it('responde a mesma condição da Revisão para Liberação vigente, ausente e vencida', () => {
    const rows = psqlRows(`
      BEGIN;
      SET LOCAL session_replication_role = replica;
      INSERT INTO auth.users (id) VALUES ('${userId}');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${userId}', 'Teste 501', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (990501, '99050100000101', 'Liberação vigente'),
        (990502, '99050100000102', 'Sem Liberação'),
        (990503, '99050100000103', 'Liberação vencida');
      INSERT INTO public.customer_contacts (customer_id, email) VALUES
        (990501, 'a@exemplo.test'), (990502, 'b@exemplo.test'), (990503, 'c@exemplo.test');
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, granted_at, review_at) VALUES
        (990501, 'teste', '${userId}', now(), now() + interval '10 days'),
        (990503, 'teste', '${userId}', now() - interval '5 days', now() - interval '1 day');
      INSERT INTO public.bls (id, voyage_id, customer_id, ce_mercante, financial_status) VALUES
        ('BL-501-A', 990501, 990501, '990501000000001', 'invoiced'),
        ('BL-501-B', 990501, 990502, '990501000000002', 'pending'),
        ('BL-501-C', 990501, 990503, '990501000000003', 'pending');
      SET LOCAL session_replication_role = origin;
      SET LOCAL ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
      SELECT b.id, s->>'portal_access_ready', s->>'billing_access_ready'
      FROM unnest(ARRAY['BL-501-A', 'BL-501-B', 'BL-501-C']) AS b(id)
      CROSS JOIN LATERAL (SELECT public.get_bl_portal_status(b.id) AS s) AS status
      ORDER BY b.id;
      RESET ROLE;
      SELECT b.id, cardinality(public.compute_bl_review_pendencies(b.id)) = 0
      FROM unnest(ARRAY['BL-501-A', 'BL-501-B', 'BL-501-C']) AS b(id)
      ORDER BY b.id;
      ROLLBACK;
    `)

    expect(rows).toEqual([
      // get_bl_portal_status: B/L, Portal pronto, Portal pronto ou Liberação vigente.
      'BL-501-A|false|true',
      'BL-501-B|false|false',
      'BL-501-C|false|false',
      // Revisão: sem pendência exatamente quando billing_access_ready.
      'BL-501-A|t',
      'BL-501-B|f',
      'BL-501-C|f',
    ])
  })
})
