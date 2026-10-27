// Lote 8 das correções decididas pelo dono em 2026-10-27 (migration 476; ADRs
// 0107 e 0108): sino só do setor responsável (com o Financeiro avisado nos
// quatro tipos da exceção), alerta resolvido fora do sino, fim da dispensa,
// "Resolver com justificativa" nos tipos de origem externa, "Aberto em" da
// ocorrência atual, justificativa no Histórico de ações e CNPJ nos alertas de
// contato.
//
// Namespace exclusivo: usuários ...000000476NNN, Cliente 476001, registros 'A476-*'.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000476001'
const FIN = '00000000-0000-0000-0000-000000476002'
const DOC = '00000000-0000-0000-0000-000000476003'
const EQU = '00000000-0000-0000-0000-000000476004'
const OPE = '00000000-0000-0000-0000-000000476005'
const USERS = [ADM, FIN, DOC, EQU, OPE]
const USER_LIST = USERS.map((id) => `'${id}'`).join(', ')
const CUSTOMER = 476001
const CNPJ = '47600147600147'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(user: string, sql: string): { stdout: string; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${user}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr }
}

const AS_SERVICE = `SET request.jwt.claim.role = 'service_role';`

function upsert(type: string, entityType: string, entityId: string, department: string): string {
  return `SELECT public.upsert_alert_item('${type}', '${entityType}', '${entityId}', 'Teste 476', 'teste_476', '${department}', '{}'::jsonb, NULL) IS NOT NULL;`
}

function recipients(entityId: string): string {
  return psql(`SELECT coalesce(string_agg(up.role, ',' ORDER BY up.role), '')
    FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
    JOIN public.user_profiles up ON up.id = n.recipient_id
    WHERE a.entity_id = '${entityId}' AND n.recipient_id IN (${USER_LIST});`)
}

function itemOf(entityId: string): string {
  return psql(`SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${entityId}' ORDER BY i.id DESC LIMIT 1;`)
}

function cleanup() {
  psql(`
    DELETE FROM public.alerts WHERE entity_id LIKE 'A476-%' OR (entity_type = 'customer' AND entity_id = '${CUSTOMER}');
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'alert_item' AND changed_by IN (${USER_LIST});
    DELETE FROM public.customers WHERE id = ${CUSTOMER};
    DELETE FROM public.user_profiles WHERE id IN (${USER_LIST});
    DELETE FROM auth.users WHERE id IN (${USER_LIST});
    SET session_replication_role = origin;
  `)
}

describeLocal('Alertas e sino decididos pelo dono (migration 476)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADM}', 'a476-adm@example.test'), ('${FIN}', 'a476-fin@example.test'), ('${DOC}', 'a476-doc@example.test'),
        ('${EQU}', 'a476-equ@example.test'), ('${OPE}', 'a476-ope@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADM}', 'A476 Ana', 'administrativo', true), ('${FIN}', 'A476 Rafael', 'financeiro', true),
        ('${DOC}', 'A476 Paula', 'documentacao', true), ('${EQU}', 'A476 Bruno', 'equipamentos', true),
        ('${OPE}', 'A476 Carlos', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER}, 'A476 Atlântica', '${CNPJ}');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('ponto 2: o sino entrega ao setor responsável; nos quatro tipos da exceção, também ao Financeiro', () => {
    psql(`${AS_SERVICE}
      ${upsert('pix_unreconciled', 'pix_transaction', 'A476-PIX', 'administrativo')}
      ${upsert('voyage_schedule_date_pending', 'voyage_pod_schedule', 'A476-ESCALA', 'operacoes')}
      ${upsert('review_portal_not_ready', 'customer', 'A476-PORTAL', 'documentacao')}`)
    // Antes iam também à Documentação e a Equipamentos (Pix) e à Documentação (escala).
    expect(recipients('A476-PIX')).toBe('administrativo,financeiro')
    expect(recipients('A476-ESCALA')).toBe('operacoes')
    // Antes ia também ao Administrativo.
    expect(recipients('A476-PORTAL')).toBe('documentacao')
  })

  it('ponto 2: o alerta resolvido sai do sino e do número sem marcar como lido; reaberto, volta', () => {
    const unread = () => Number(asUser(OPE, 'SELECT public.count_unread_internal_notifications();').stdout)
    const listed = () => asUser(OPE, `SELECT count(*) FROM public.list_internal_notifications(true, 100) AS row
      WHERE row->>'entity_id' = 'A476-TERM';`).stdout
    const before = unread()
    psql(`${AS_SERVICE} ${upsert('voyage_terminal_date_pending', 'voyage_escala_terminal', 'A476-TERM', 'operacoes')}`)
    expect(unread()).toBe(before + 1)
    expect(listed()).toBe('1')

    psql(`${AS_SERVICE} SELECT public.resolve_alert_item('voyage_terminal_date_pending', 'voyage_escala_terminal', 'A476-TERM', 'teste_476');`)
    expect(unread()).toBe(before)
    expect(listed()).toBe('0')
    // A notificação não foi marcada como lida: só saiu porque o alerta fechou.
    expect(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
      WHERE a.entity_id = 'A476-TERM' AND n.recipient_id = '${OPE}' AND n.read_at IS NULL;`)).toBe('1')

    psql(`${AS_SERVICE} ${upsert('voyage_terminal_date_pending', 'voyage_escala_terminal', 'A476-TERM', 'operacoes')}`)
    expect(unread()).toBe(before + 1)
    expect(listed()).toBe('1')
  })

  it('ponto 3: a dispensa saiu; dispensa antiga não esconde o alerta e não há filtro de dispensados', () => {
    expect(psql(`SELECT to_regprocedure('public.dismiss_alert_item(bigint,text,timestamp with time zone)') IS NULL;`)).toBe('t')
    psql(`${AS_SERVICE} ${upsert('voyage_export_after_atd', 'voyage', 'A476-DISP', 'operacoes')}`)
    const item = itemOf('A476-DISP')
    // Dispensa gravada antes da 476, ainda no prazo: acabou na hora.
    psql(`INSERT INTO public.alert_item_dismissals (alert_item_id, occurrence_id, reason, dismissed_by, review_at)
      SELECT id, occurrence_id, 'antiga', '${ADM}', now() + interval '5 days' FROM public.alert_items WHERE id = ${item};`)
    expect(asUser(DOC, `SELECT count(*) FROM public.list_alert_queue_page('active', NULL, 0, 100, 'operacoes') AS row
      WHERE (row->>'item_id')::bigint = ${item};`).stdout).toBe('1')
    expect(asUser(DOC, `SELECT public.count_alert_queue('dismissed');`).stderr).toMatch(/Filtro inválido/)
    expect(psql(`SELECT pg_get_function_result('public.summarize_alert_queue_by_department()'::regprocedure);`))
      .toBe('TABLE(department text, active_count bigint, is_legacy boolean)')
  })

  it('ALE-D06: "Aberto em" é a abertura da ocorrência atual', () => {
    psql(`${AS_SERVICE} ${upsert('voyage_export_after_atd', 'voyage', 'A476-REAB', 'operacoes')}`)
    const item = itemOf('A476-REAB')
    psql(`UPDATE public.alert_item_events SET created_at = now() - interval '40 days' WHERE alert_item_id = ${item};
      UPDATE public.alert_items SET created_at = now() - interval '40 days' WHERE id = ${item};
      ${AS_SERVICE} SELECT public.resolve_alert_item('voyage_export_after_atd', 'voyage', 'A476-REAB', 'teste_476');
      ${upsert('voyage_export_after_atd', 'voyage', 'A476-REAB', 'operacoes')}`)
    expect(asUser(DOC, `SELECT ((row->>'opened_at')::timestamptz > now() - interval '1 hour')::text
      FROM public.list_alert_queue_page('active', NULL, 0, 100, 'operacoes') AS row
      WHERE (row->>'item_id')::bigint = ${item};`).stdout).toBe('true')
  })

  it('ponto 3 (b) e ALE-D08: consulta Itaú parada resolve com justificativa, não reabre com a mesma causa e vai ao Histórico de ações', () => {
    const open = () => psql(`${AS_SERVICE} ${upsert('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'A476-ITAU', 'administrativo')}`)
    const status = () => psql(`SELECT status FROM public.alert_items WHERE id = ${itemOf('A476-ITAU')};`)
    open()
    const item = itemOf('A476-ITAU')
    const resolved = asUser(FIN, `SELECT public.resolve_alert_item_with_justification(${item}, 'Itaú fora do ar, suporte avisado') IS NOT NULL;`)
    expect(resolved.stderr).toBe('')
    expect(status()).toBe('resolved')

    // A varredura seguinte, com a consulta ainda parada, não reabre.
    open()
    expect(status()).toBe('resolved')

    // A consulta voltou (a varredura resolve) e parou de novo: reabre.
    psql(`${AS_SERVICE} SELECT public.resolve_alert_item('itau_pix_consulta_parada', 'itau_pix_checkpoint', 'A476-ITAU', 'teste_476');`)
    open()
    expect(status()).toBe('active')

    expect(asUser(ADM, `SELECT concat_ws('|', l.field_name, l.old_value, l.new_value, l.justification, up.full_name)
      FROM public.audit_logs l JOIN public.user_profiles up ON up.id = l.changed_by
      WHERE l.entity_type = 'alert_item' AND l.entity_id = '${item}';`).stdout)
      .toBe('status|itau_pix_consulta_parada|resolved|Itaú fora do ar, suporte avisado|A476 Rafael')
  })

  it('ALE-D12: "Caixa de comunicação sem destinatário" guarda o CNPJ do Cliente', () => {
    psql(`${AS_SERVICE} SELECT public.upsert_alert_item('caixa_sem_destinatario', 'customer', '${CUSTOMER}', 'Teste 476', 'teste_476',
      '{"box_code": "financeiro"}'::jsonb, '/clientes') IS NOT NULL;`)
    expect(psql(`SELECT i.metadata->>'customer_cnpj' FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER}' AND i.item_type = 'caixa_sem_destinatario';`)).toBe(CNPJ)
  })
})
