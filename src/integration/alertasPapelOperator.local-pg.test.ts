import { execPsql } from './localPsql'
import { expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 328 (lote 5b, achado P1): o envio de alertas trata o papel legado
// `operator` como Documentação, como o resto do sistema. Cada caso roda numa
// transação desfeita no fim: os demais usuários de Documentação e do
// Administrativo do banco local ficam inativos só dentro dela, para o
// resultado depender apenas dos usuários do teste.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const OPERATOR_ID = '32800000-0000-4000-8000-000000000001'
const ADMIN_ID = '32800000-0000-4000-8000-000000000002'
const ENTITY_ID = 'P328-CLIENTE'
// Tipo crítico cuja audiência é só a Documentação.
const DOC_CRITICAL_TYPE = 'review_customer_unlinked'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function migration328Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT position('operator' IN prosrc) > 0 FROM pg_proc WHERE proname = 'fanout_alert_item_for_department';`) === 't'
  } catch {
    return false
  }
}

/**
 * Prepara o cenário, abre o item (que dispara `fanout_alert_item_for_department`)
 * e devolve as entregas e falhas do item; tudo desfeito no fim.
 */
function openDocAlert(options: { operatorActive: boolean; adminActive: boolean; replayWithoutDepartment?: boolean }): string {
  return psql(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    UPDATE public.user_profiles SET active = false WHERE role IN ('documentacao', 'operator', 'administrativo');
    SET LOCAL session_replication_role = origin;
    INSERT INTO auth.users (id, email) VALUES ('${OPERATOR_ID}', 'operator-328@example.test'), ('${ADMIN_ID}', 'admin-328@example.test');
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
      ('${OPERATOR_ID}', 'Operador legado 328', 'operator', ${options.operatorActive}),
      ('${ADMIN_ID}', 'Administrativo 328', 'administrativo', ${options.adminActive});
    SET LOCAL session_replication_role = origin;
    SET LOCAL request.jwt.claim.role = 'service_role';
    SELECT public.upsert_alert_item('${DOC_CRITICAL_TYPE}', 'customer', '${ENTITY_ID}', 'Teste 328', 'p328_test', 'documentacao', '{}'::jsonb, NULL) IS NOT NULL AS opened;
    ${options.replayWithoutDepartment ? `
    DELETE FROM public.internal_notifications n USING public.alerts a WHERE a.id = n.alert_id AND a.entity_id = '${ENTITY_ID}';
    DELETE FROM public.alert_notification_failures f USING public.alerts a WHERE a.id = f.alert_id AND a.entity_id = '${ENTITY_ID}';
    SELECT public.fanout_alert_item(i.alert_id, i.id, e.id) FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id
      JOIN public.alert_item_events e ON e.alert_item_id = i.id
      WHERE a.entity_id = '${ENTITY_ID}' ORDER BY e.id DESC LIMIT 1;` : ''}
    SELECT 'entrega:' || CASE n.recipient_id WHEN '${OPERATOR_ID}' THEN 'operator' WHEN '${ADMIN_ID}' THEN 'admin' ELSE 'outro' END
      || ':' || n.recipient_department || ':' || n.is_fallback
      FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
      WHERE a.entity_id = '${ENTITY_ID}' ORDER BY 1;
    SELECT 'falha:' || f.department FROM public.alert_notification_failures f JOIN public.alerts a ON a.id = f.alert_id
      WHERE a.entity_id = '${ENTITY_ID}';
    ROLLBACK;
  `)
}

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line.startsWith('entrega:') || line.startsWith('falha:'))
}

describeWithProbe(migration328Applied, 'migration 328 (alertas ao papel operator)')('Alertas ao papel legado operator (migration 328, P1)', () => {
  it('o usuário operator ativo recebe o alerta de Documentação, sem fallback ao Administrativo', () => {
    expect(lines(openDocAlert({ operatorActive: true, adminActive: true }))).toEqual(['entrega:operator:documentacao:false'])
  })

  it('a entrega sem Departamento informado (fanout_alert_item) também alcança o operator', () => {
    expect(lines(openDocAlert({ operatorActive: true, adminActive: true, replayWithoutDepartment: true })))
      .toEqual(['entrega:operator:documentacao:false'])
  })

  it('sem ninguém ativo na Documentação, o crítico segue para o Administrativo', () => {
    expect(lines(openDocAlert({ operatorActive: false, adminActive: true }))).toEqual(['entrega:admin:administrativo:true'])
  })

  it('sem Documentação nem Administrativo ativos, a falha fica registrada', () => {
    expect(lines(openDocAlert({ operatorActive: false, adminActive: false }))).toEqual(['falha:documentacao'])
  })
})
