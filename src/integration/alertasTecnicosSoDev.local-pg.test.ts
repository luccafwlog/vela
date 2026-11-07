// Migration 620 (ADR 0133): alertas técnicos vão só para a conta Dev.
// - Tipo técnico (Rotina agendada com resposta de erro, Consulta Itaú...):
//   sino só da conta Dev; a fila e a contagem escondem dos demais.
// - Causa técnica (Aviso do Desbloqueio com falha de envio): só a conta Dev;
//   a mesma regra com causa no contato (sem destinatário) segue com a equipe.
// - Mistos (Faturamento automático falhou): a equipe e a conta Dev.
// Cada cenário roda numa transação desfeita no fim.
//
// Namespace exclusivo: usuários ...000000620001/2/3, entidades 'A620-*'.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const local = process.env.LOCAL_PG_INTEGRATION === '1' ? describe : describe.skip
const DEV = '00000000-0000-0000-0000-000000620001'
const ADM = '00000000-0000-0000-0000-000000620002'
const DOC = '00000000-0000-0000-0000-000000620003'
const USERS = `'${DEV}', '${ADM}', '${DOC}'`

function sql(q: string): string[] {
  return execPsql(['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    .replaceAll(String.fromCharCode(13), '').trim().split('\n').filter((line) => line.startsWith('>'))
}

const asUser = (id: string) => `SET LOCAL "request.jwt.claims" = '{"sub":"${id}","role":"authenticated"}'; SET LOCAL ROLE authenticated;`

/** Abre o item como serviço; devolve quem recebeu no sino e quem enxerga na fila e na contagem. */
function scenario(type: string, entityType: string, entityId: string, metadata: object, department: string): string[] {
  const meta = JSON.stringify(metadata).replaceAll("'", "''")
  const sees = (id: string, name: string) => `${asUser(id)}
    SELECT '>fila|${name}|' || count(*) FROM public.list_alert_queue_page('active', NULL, 0, 100, NULL) q
      WHERE q->>'entity_id' = '${entityId}';
    RESET ROLE;`
  return sql(`BEGIN;
    SET LOCAL request.jwt.claim.role = 'service_role';
    SELECT public.upsert_alert_item('${type}', '${entityType}', '${entityId}', 'Teste 620', 'teste_620', '${department}', '${meta}'::jsonb, NULL) IS NOT NULL;
    SELECT '>sino|' || string_agg(n.recipient_id::text, ',' ORDER BY n.recipient_id)
      FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
      WHERE a.entity_id = '${entityId}' AND n.recipient_id IN (${USERS});
    RESET request.jwt.claim.role;
    ${sees(DEV, 'dev')}
    ${sees(ADM, 'adm')}
    ROLLBACK;`)
}

local('Alertas técnicos só para a conta Dev (migration 620)', () => {
  const cleanup = () => sql(`SET session_replication_role = replica;
    DELETE FROM public.user_profiles WHERE id IN (${USERS});
    DELETE FROM auth.users WHERE id IN (${USERS});
    SET session_replication_role = origin;`)
  beforeAll(() => {
    cleanup()
    sql(`INSERT INTO auth.users (id, email) VALUES ('${DEV}', 'a620-dev@example.test'), ('${ADM}', 'a620-adm@example.test'), ('${DOC}', 'a620-doc@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active, is_dev) VALUES
        ('${DEV}', 'A620 Dev', 'administrativo', true, true),
        ('${ADM}', 'A620 Adm', 'administrativo', true, false),
        ('${DOC}', 'A620 Doc', 'documentacao', true, false);`)
  })
  afterAll(cleanup)

  it('Rotina agendada com resposta de erro: sino e fila só da conta Dev', () => {
    const lines = scenario('rotina_http_falhou', 'cron_http', 'A620-HTTP', {}, 'administrativo')
    expect(lines).toContain(`>sino|${DEV}`)
    expect(lines).toContain('>fila|dev|1')
    expect(lines).toContain('>fila|adm|0')
  })

  it('Consulta de Pix do Itaú parada: sai do Financeiro e vai só à conta Dev', () => {
    const lines = scenario('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'A620-ITAU', {}, 'financeiro')
    expect(lines).toContain(`>sino|${DEV}`)
    expect(lines).toContain('>fila|adm|0')
  })

  it('Aviso do Desbloqueio não enviado: falha de envio só à conta Dev; sem destinatário, com a equipe', () => {
    const failed = scenario('desbloqueio_ce_aviso_nao_enviado', 'customer', 'A620-1', { status: 'failed' }, 'administrativo')
    expect(failed).toContain(`>sino|${DEV}`)
    expect(failed).toContain('>fila|adm|0')
    const skipped = scenario('desbloqueio_ce_aviso_nao_enviado', 'customer', 'A620-2', { status: 'skipped' }, 'administrativo')
    expect(skipped).toContain(`>sino|${DEV},${ADM}`)
    expect(skipped).toContain('>fila|adm|1')
  })

  it('Faturamento automático falhou: a Documentação e a conta Dev', () => {
    const lines = scenario('billing_auto_issue_failed', 'bl', 'A620-BL', {}, 'documentacao')
    expect(lines).toContain(`>sino|${DEV},${DOC}`)
    expect(lines).toContain('>fila|adm|1')
  })
})
