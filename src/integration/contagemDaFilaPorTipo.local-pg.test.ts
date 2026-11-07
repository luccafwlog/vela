// Migration 631 (ADR 0136): o número de cada cartão do mapa da tela Regras de
// alertas conta o que a pessoa vê na fila. O alerta técnico (629) conta só
// para a conta Dev; o da equipe conta para todos.
// Cada cenário roda numa transação desfeita no fim e compara antes e depois,
// para não depender de alertas que já estejam abertos no banco local.
//
// Namespace exclusivo: usuários ...000000622001/2, entidades 'A622-*'.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const DEV = '00000000-0000-0000-0000-000000622001'
const ADM = '00000000-0000-0000-0000-000000622002'
const USERS = `'${DEV}', '${ADM}'`
const TYPES = `'rotina_http_falhou', 'billing_auto_issue_failed'`

function sql(q: string): string[] {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim().split('\n').filter((line) => line.startsWith('>'))
}

const asUser = (id: string) => `SET LOCAL "request.jwt.claims" = '{"sub":"${id}","role":"authenticated"}'; SET LOCAL ROLE authenticated;`

function counts(id: string, name: string, moment: string): string {
  return `${asUser(id)}
    SELECT '>${moment}|${name}|' || t.type || '|' || COALESCE(c.active_count, 0)
      FROM unnest(ARRAY[${TYPES}]) AS t(type)
      LEFT JOIN public.count_alert_queue_by_type() c ON c.type = t.type
      ORDER BY t.type;
    RESET ROLE;`
}

/** Linhas ">momento|quem|tipo|n" viram { 'quem|tipo': depois - antes }. */
function deltas(lines: string[]): Record<string, number> {
  const before: Record<string, number> = {}
  const out: Record<string, number> = {}
  for (const line of lines) {
    const [moment, who, type, n] = line.slice(1).split('|')
    const key = `${who}|${type}`
    if (moment === 'antes') before[key] = Number(n)
    else out[key] = Number(n) - (before[key] ?? 0)
  }
  return out
}

local('Contagem da fila por tipo (migration 631)', () => {
  const cleanup = () => sql(`SET session_replication_role = replica;
    DELETE FROM public.user_profiles WHERE id IN (${USERS});
    DELETE FROM auth.users WHERE id IN (${USERS});
    SET session_replication_role = origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users (id, email) VALUES ('${DEV}', 'a622-dev@example.test'), ('${ADM}', 'a622-adm@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active, is_dev) VALUES
        ('${DEV}', 'A622 Dev', 'administrativo', true, true),
        ('${ADM}', 'A622 Adm', 'administrativo', true, false);`)
  })
  afterAll(cleanup)

  it('o técnico conta só para a conta Dev; o da equipe, para os dois', () => {
    const lines = sql(`BEGIN;
      ${counts(DEV, 'dev', 'antes')}
      ${counts(ADM, 'adm', 'antes')}
      SET LOCAL request.jwt.claim.role = 'service_role';
      SELECT public.upsert_alert_item('rotina_http_falhou', 'cron_http', 'A622-HTTP', 'Teste 631', 'teste_631', 'administrativo', '{}'::jsonb, NULL) IS NOT NULL;
      SELECT public.upsert_alert_item('billing_auto_issue_failed', 'bl', 'A622-BL', 'Teste 631', 'teste_631', 'documentacao', '{}'::jsonb, NULL) IS NOT NULL;
      RESET request.jwt.claim.role;
      ${counts(DEV, 'dev', 'depois')}
      ${counts(ADM, 'adm', 'depois')}
      ROLLBACK;`)
    expect(deltas(lines)).toEqual({
      'dev|billing_auto_issue_failed': 1,
      'dev|rotina_http_falhou': 1,
      'adm|billing_auto_issue_failed': 1,
      'adm|rotina_http_falhou': 0,
    })
  })

  it('sem sessão de usuário interno ativo, recusa', () => {
    expect(() => sql(`SELECT '>x|' || count(*) FROM public.count_alert_queue_by_type();`)).toThrow(/Sem permissão/)
  })
})
