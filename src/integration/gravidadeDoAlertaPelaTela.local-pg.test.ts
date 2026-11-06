// Migration 603 (ADR 0130): a gravidade de um tipo de alerta é trocada na tela
// Regras de alertas, só pelo Administrativo e com motivo. A troca vale para o
// catálogo e para os alertas abertos do tipo, os resolvidos guardam a que
// tinham, o próximo alerta nasce com a nova e a troca fica no Histórico de
// ações com o autor e o motivo.
//
// Namespace exclusivo: usuários ...000000603NNN, registros 'A603-*'. O tipo
// usado (`voyage_export_after_atd`, Normal de fábrica) volta à gravidade
// original no fim, mesmo se um caso falhar.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000603001'
const FIN = '00000000-0000-0000-0000-000000603002'
const DOC = '00000000-0000-0000-0000-000000603003'
const EQU = '00000000-0000-0000-0000-000000603004'
const OPE = '00000000-0000-0000-0000-000000603005'
const USERS = [ADM, FIN, DOC, EQU, OPE]
const USER_LIST = USERS.map((id) => `'${id}'`).join(', ')
const TYPE = 'voyage_export_after_atd'
const REASON = 'Exportação parada atrasa o ADR de Saída do armador'

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

/** SQLSTATE da chamada como o usuário ('00000' quando passa). */
function sqlstateAs(user: string, call: string): string {
  const run = asUser(user, `DO $$ BEGIN PERFORM ${call}; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SQLSTATE=%', SQLSTATE; END $$;`)
  if (run.status === 0) return '00000'
  return /SQLSTATE=([0-9A-Z]{5})/.exec(run.stderr)?.[1] ?? run.stderr
}

const AS_SERVICE = `SET request.jwt.claim.role = 'service_role';`

function setSeverity(severity: string, reason = REASON): string {
  return `public.set_alert_type_severity('${TYPE}', '${severity}', '${reason.replace(/'/g, "''")}')`
}

function itemSeverity(entityId: string): string {
  return psql(`SELECT i.severity FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_id = '${entityId}' AND i.item_type = '${TYPE}' ORDER BY i.id DESC LIMIT 1;`)
}

let originalSeverity = 'normal'

function cleanup() {
  psql(`
    UPDATE public.alert_type_catalog SET severity = '${originalSeverity}' WHERE type = '${TYPE}';
    DELETE FROM public.alerts WHERE entity_id LIKE 'A603-%';
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'alert_type' AND changed_by IN (${USER_LIST});
    DELETE FROM public.user_profiles WHERE id IN (${USER_LIST});
    DELETE FROM auth.users WHERE id IN (${USER_LIST});
    SET session_replication_role = origin;
  `)
}

describeLocal('Gravidade do alerta trocada pela tela (migration 603)', () => {
  beforeAll(() => {
    originalSeverity = psql(`SELECT severity FROM public.alert_type_catalog WHERE type = '${TYPE}';`) || 'normal'
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADM}', 'a603-adm@example.test'), ('${FIN}', 'a603-fin@example.test'), ('${DOC}', 'a603-doc@example.test'),
        ('${EQU}', 'a603-equ@example.test'), ('${OPE}', 'a603-ope@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${ADM}', 'A603 Ana', 'administrativo', true), ('${FIN}', 'A603 Rafael', 'financeiro', true),
        ('${DOC}', 'A603 Paula', 'documentacao', true), ('${EQU}', 'A603 Bruno', 'equipamentos', true),
        ('${OPE}', 'A603 Carlos', 'operacoes', true);
    `)
    // Um alerta aberto e um resolvido do tipo.
    psql(`${AS_SERVICE}
      SELECT public.upsert_alert_item('${TYPE}', 'voyage_pod_schedule', 'A603-ABERTO', 'Teste 603', 'teste_603', 'operacoes', '{}'::jsonb, NULL);
      SELECT public.upsert_alert_item('${TYPE}', 'voyage_pod_schedule', 'A603-RESOLVIDO', 'Teste 603', 'teste_603', 'operacoes', '{}'::jsonb, NULL);
      SELECT public.resolve_alert_item('${TYPE}', 'voyage_pod_schedule', 'A603-RESOLVIDO', 'teste_603');`)
  })

  afterAll(cleanup)

  it('parte da gravidade de fábrica: Exportação pendente pós-ATD é Normal', () => {
    expect(originalSeverity).toBe('normal')
    expect(itemSeverity('A603-ABERTO')).toBe('normal')
  })

  it('só o Administrativo troca a gravidade: os outros quatro setores recebem 42501', () => {
    for (const user of [FIN, DOC, EQU, OPE]) {
      expect(sqlstateAs(user, setSeverity('critical')), user).toBe('42501')
    }
    expect(psql(`SELECT severity FROM public.alert_type_catalog WHERE type = '${TYPE}';`)).toBe('normal')
  })

  it('recusa motivo curto, gravidade inválida e tipo fora do catálogo ou aposentado', () => {
    expect(sqlstateAs(ADM, setSeverity('critical', 'curto'))).toBe('22023')
    expect(sqlstateAs(ADM, `public.set_alert_type_severity('${TYPE}', 'urgente', '${REASON}')`)).toBe('22023')
    expect(sqlstateAs(ADM, `public.set_alert_type_severity('tipo_que_nao_existe', 'critical', '${REASON}')`)).toBe('P0002')
    // Aposentado (347): fica fora da tela e da troca.
    expect(sqlstateAs(ADM, `public.set_alert_type_severity('invoice_overdue', 'critical', '${REASON}')`)).toBe('P0002')
  })

  it('o Administrativo troca para Crítico: o catálogo e o alerta aberto mudam, o resolvido guarda a gravidade que tinha', () => {
    const result = asUser(ADM, `SELECT ${setSeverity('critical')};`)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ type: TYPE, previous_severity: 'normal', severity: 'critical' })
    expect(JSON.parse(result.stdout).active_items).toBeGreaterThanOrEqual(1)

    expect(psql(`SELECT severity FROM public.alert_type_catalog WHERE type = '${TYPE}';`)).toBe('critical')
    expect(itemSeverity('A603-ABERTO')).toBe('critical')
    expect(itemSeverity('A603-RESOLVIDO')).toBe('normal')
  })

  it('a troca fica no Histórico de ações com o autor, a gravidade anterior e o motivo', () => {
    expect(psql(`SELECT concat_ws('|', old_value, new_value, justification)
      FROM public.audit_logs WHERE entity_type = 'alert_type' AND entity_id = '${TYPE}'
        AND field_name = 'severity' AND changed_by = '${ADM}' ORDER BY id DESC LIMIT 1;`))
      .toBe(`normal|critical|${REASON}`)
  })

  it('a tela lê a gravidade vigente, os abertos e a última troca, para qualquer setor', () => {
    const row = asUser(OPE, `SELECT concat_ws('|', severity, active_items >= 1, changed_by_name, previous_severity, change_reason)
      FROM public.list_alert_type_settings() WHERE type = '${TYPE}';`)
    expect(row.stderr).toBe('')
    expect(row.stdout).toBe(`critical|t|A603 Ana|normal|${REASON}`)
    // Só tipos ativos: o aposentado não aparece.
    expect(asUser(OPE, `SELECT count(*) FROM public.list_alert_type_settings() WHERE type = 'invoice_overdue';`).stdout).toBe('0')
    // Sem usuário interno, nada.
    expect(sqlstateAs('00000000-0000-0000-0000-000000603999', 'public.list_alert_type_settings()')).toBe('42501')
  })

  it('o próximo alerta do tipo já nasce com a gravidade nova', () => {
    psql(`${AS_SERVICE}
      SELECT public.upsert_alert_item('${TYPE}', 'voyage_pod_schedule', 'A603-NOVO', 'Teste 603', 'teste_603', 'operacoes', '{}'::jsonb, NULL);`)
    expect(itemSeverity('A603-NOVO')).toBe('critical')
  })

  it('trocar para a gravidade que já vale é recusado (tela velha) e a troca de volta desfaz', () => {
    expect(sqlstateAs(ADM, setSeverity('critical'))).toBe('40001')

    const back = asUser(ADM, `SELECT ${setSeverity('normal', 'Volta ao padrão depois do teste de gravidade')};`)
    expect(back.stderr).toBe('')
    expect(psql(`SELECT severity FROM public.alert_type_catalog WHERE type = '${TYPE}';`)).toBe('normal')
    expect(itemSeverity('A603-ABERTO')).toBe('normal')
    expect(itemSeverity('A603-NOVO')).toBe('normal')
  })
})
