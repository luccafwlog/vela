// Migration 613 (ADR 0133, D8): reforço por tempo e gravidade do item. O
// Administrativo configura "vira Crítico depois de N horas aberto"; a rotina
// escala o alerta Normal esquecido e avisa de novo; o detector não o rebaixa;
// reabrir recomeça; o marco crítico do produtor vale acima do tipo; e a troca
// de gravidade do tipo para Normal não rebaixa o item escalado.
//
// Namespace exclusivo: usuários ...000000604NNN, registros 'A604-*'. O tipo
// usado (`voyage_schedule_date_pending`, que nenhuma outra suíte troca) volta ao estado de fábrica no fim.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000604001'
const OPE = '00000000-0000-0000-0000-000000604002'
const USERS = [ADM, OPE]
const USER_LIST = USERS.map((id) => `'${id}'`).join(', ')
const TYPE = 'voyage_schedule_date_pending'
const REASON = 'Exportação esquecida atrasa o ADR de Saída'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(user: string, sql: string): { stdout: string; stderr: string; status: number | null } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${user}'; ${sql}`],
  { encoding: 'utf8' })
  return { stdout: run.stdout.trim(), stderr: run.stderr, status: run.status }
}

function sqlstateAs(user: string, call: string): string {
  const run = asUser(user, `DO $$ BEGIN PERFORM ${call}; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SQLSTATE=%', SQLSTATE; END $$;`)
  if (run.status === 0) return '00000'
  return /SQLSTATE=([0-9A-Z]{5})/.exec(run.stderr)?.[1] ?? run.stderr
}

const AS_SERVICE = `SET request.jwt.claim.role = 'service_role';`

function upsert(entityId: string, metadata = '{}'): string {
  return `${AS_SERVICE} SELECT public.upsert_alert_item('${TYPE}', 'voyage_pod_schedule', '${entityId}', 'Teste 613', 'teste_613', 'operacoes', '${metadata}'::jsonb, NULL) IS NOT NULL;`
}

function item(entityId: string): string {
  return psql(`SELECT concat_ws('|', i.status, i.severity, i.escalated_at IS NOT NULL) FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${entityId}' AND i.item_type = '${TYPE}';`)
}

/** Recua a abertura da ocorrência atual, como se o alerta estivesse aberto há mais tempo. */
function age(entityId: string, hours: number) {
  psql(`UPDATE public.alert_item_events e SET created_at = now() - interval '${hours} hours'
    FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE e.alert_item_id = i.id AND e.occurrence_id = i.occurrence_id AND a.entity_id = '${entityId}' AND i.item_type = '${TYPE}';`)
}

function notifications(entityId: string): number {
  return Number(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
    WHERE a.entity_id = '${entityId}' AND n.recipient_id = '${OPE}';`))
}

let original = 'normal|'

function cleanup() {
  const [severity, hours] = original.split('|')
  psql(`
    UPDATE public.alert_type_catalog SET severity = '${severity}', escalate_after_hours = ${hours ? Number(hours) : 'NULL'} WHERE type = '${TYPE}';
    DELETE FROM public.alerts WHERE entity_id LIKE 'A604-%';
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'alert_type' AND changed_by IN (${USER_LIST});
    DELETE FROM public.user_profiles WHERE id IN (${USER_LIST});
    DELETE FROM auth.users WHERE id IN (${USER_LIST});
    SET session_replication_role = origin;
  `)
}

describeLocal('Reforço por tempo dos alertas (migration 613)', () => {
  beforeAll(() => {
    original = psql(`SELECT concat_ws('|', severity, COALESCE(escalate_after_hours::text, '')) FROM public.alert_type_catalog WHERE type = '${TYPE}';`) || 'normal|'
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'a604-adm@example.test'), ('${OPE}', 'a604-ope@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADM}', 'A604 Ana', 'administrativo', true), ('${OPE}', 'A604 Carlos', 'operacoes', true);
    `)
  })

  afterAll(cleanup)

  it('só o Administrativo configura o reforço, com motivo, e a tela lê o valor', () => {
    expect(sqlstateAs(OPE, `public.set_alert_type_escalation('${TYPE}', 4, '${REASON}')`)).toBe('42501')
    expect(sqlstateAs(ADM, `public.set_alert_type_escalation('${TYPE}', 4, 'curto')`)).toBe('22023')
    expect(sqlstateAs(ADM, `public.set_alert_type_escalation('${TYPE}', 0, '${REASON}')`)).toBe('22023')
    expect(asUser(ADM, `SELECT public.set_alert_type_escalation('${TYPE}', 4, '${REASON}');`).stderr).toBe('')
    expect(sqlstateAs(ADM, `public.set_alert_type_escalation('${TYPE}', 4, '${REASON}')`)).toBe('40001')
    expect(asUser(OPE, `SELECT concat_ws('|', escalate_after_hours, escalation_changed_by_name, escalation_reason)
      FROM public.list_alert_type_settings() WHERE type = '${TYPE}';`).stdout).toBe(`4|A604 Ana|${REASON}`)
  })

  it('o alerta Normal aberto há mais de N horas vira Crítico e avisa de novo; o recente fica', () => {
    psql(upsert('A604-VELHO'))
    psql(upsert('A604-NOVO'))
    age('A604-VELHO', 5)
    const before = notifications('A604-VELHO')

    expect(Number(psql(`SELECT public.escalate_aged_alert_items();`))).toBeGreaterThanOrEqual(1)
    expect(item('A604-VELHO')).toBe('active|critical|t')
    expect(item('A604-NOVO')).toBe('active|normal|f')
    expect(notifications('A604-VELHO')).toBe(before + 1)
    // Rodar de novo não escala nem avisa outra vez.
    psql(`SELECT public.escalate_aged_alert_items();`)
    expect(notifications('A604-VELHO')).toBe(before + 1)
  })

  it('a conferência que reabre o mesmo alerta não o rebaixa; fechar e reabrir recomeça', () => {
    psql(upsert('A604-VELHO'))
    expect(item('A604-VELHO')).toBe('active|critical|t')

    psql(`${AS_SERVICE} SELECT public.resolve_alert_item('${TYPE}', 'voyage_pod_schedule', 'A604-VELHO', 'teste_613');`)
    psql(upsert('A604-VELHO'))
    expect(item('A604-VELHO')).toBe('active|normal|f')
  })

  it('o marco crítico do produtor vale acima do tipo Normal, e o marco Normal seguinte volta a Normal', () => {
    psql(upsert('A604-MARCO', '{"milestone": "atrasado", "severity": "critical"}'))
    expect(item('A604-MARCO')).toBe('active|critical|f')
    psql(upsert('A604-MARCO', '{"milestone": "no_prazo"}'))
    expect(item('A604-MARCO')).toBe('active|normal|f')
  })

  it('a troca do tipo para Normal pela tela não rebaixa o alerta escalado', () => {
    age('A604-NOVO', 5)
    psql(`SELECT public.escalate_aged_alert_items();`)
    expect(item('A604-NOVO')).toBe('active|critical|t')

    expect(asUser(ADM, `SELECT public.set_alert_type_severity('${TYPE}', 'critical', '${REASON}');`).stderr).toBe('')
    expect(asUser(ADM, `SELECT public.set_alert_type_severity('${TYPE}', 'normal', '${REASON}');`).stderr).toBe('')
    expect(item('A604-NOVO')).toBe('active|critical|t')
    expect(item('A604-MARCO')).toBe('active|normal|f')
  })

  it('tirar o reforço (NULL) para de escalar os novos', () => {
    expect(asUser(ADM, `SELECT public.set_alert_type_escalation('${TYPE}', NULL, '${REASON}');`).stderr).toBe('')
    psql(upsert('A604-SEM'))
    age('A604-SEM', 50)
    psql(`SELECT public.escalate_aged_alert_items();`)
    expect(item('A604-SEM')).toBe('active|normal|f')
  })
})
