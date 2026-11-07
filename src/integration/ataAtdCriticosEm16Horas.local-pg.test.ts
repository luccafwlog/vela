// Migration 615 (ADR 0133, D3): 16 horas depois do ETA sem ATA, ou do ETD sem
// ATD, o alerta de data muda de marco, vira Crítico e avisa de novo. Antes das
// 16 horas continua Normal; gravar a data fecha.
//
// Namespace exclusivo: Viagem 960601 (sem linha em `voyages`; a conferência lê
// o audit da escala e o estado do terminal), terminal 'T606', usuário
// ...000000606001.
import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const VOYAGE = 960601
const PORT = 'BRSSZ'
const SCALE = `${VOYAGE}::${PORT}`
const TERMINAL = '60600000-0000-4000-8000-000000000001'
const OPE = '00000000-0000-0000-0000-000000606001'

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const AS_SERVICE = `SET request.jwt.claim.role = 'service_role';`
const reconcile = () => psql(`${AS_SERVICE} SELECT public.reconcile_voyage_schedule_date_alerts(${VOYAGE}, '${PORT}', 'teste_615');`)

function item(type: string, entityId: string): string {
  return psql(`SELECT concat_ws('|', i.status, i.severity, i.metadata->>'milestone') FROM public.alert_items i
    JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${entityId}' AND i.item_type = '${type}';`)
}

function message(type: string, entityId: string): string {
  return psql(`SELECT i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE a.entity_id = '${entityId}' AND i.item_type = '${type}';`)
}

function notifications(entityId: string): number {
  return Number(psql(`SELECT count(*) FROM public.internal_notifications n JOIN public.alerts a ON a.id = n.alert_id
    WHERE a.entity_id = '${entityId}' AND n.recipient_id = '${OPE}';`))
}

function setEta(isoWithOffset: string) {
  psql(`INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value)
    VALUES ('voyage_pod_schedule', '${SCALE}', 'eta', NULL, '${isoWithOffset}');`)
}

function cleanup() {
  psql(`
    DELETE FROM public.alerts WHERE entity_id = '${SCALE}' OR entity_id LIKE '${SCALE}::%';
    SET session_replication_role = replica;
    DELETE FROM public.audit_logs WHERE entity_type = 'voyage_pod_schedule' AND entity_id = '${SCALE}';
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${VOYAGE};
    DELETE FROM public.depots WHERE id = '${TERMINAL}';
    DELETE FROM public.internal_notifications WHERE recipient_id = '${OPE}';
    DELETE FROM public.user_profiles WHERE id = '${OPE}';
    DELETE FROM auth.users WHERE id = '${OPE}';
    SET session_replication_role = origin;
  `)
}

/** Instante de Brasília a `hours` horas atrás, no formato que a tela grava. */
function hoursAgo(hours: number): string {
  return psql(`SELECT to_char((now() - interval '${hours} hours') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') || '-03:00';`)
}

describeLocal('ATA e ATD críticos em 16 horas (migration 615)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${OPE}', 'a606-ope@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${OPE}', 'A606 Carlos', 'operacoes', true);
      SET session_replication_role = replica;
      INSERT INTO public.depots (id, code, name, tipo) VALUES ('${TERMINAL}', 'T606', 'Terminal 615', 'terminal_portuario');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('ETA de poucas horas sem ATA: alerta Normal, marco ATA', () => {
    setEta(hoursAgo(2))
    reconcile()
    expect(item('voyage_schedule_date_pending', SCALE)).toBe('active|normal|ata')
    expect(message('voyage_schedule_date_pending', SCALE)).not.toContain('16 horas')
  })

  it('16 horas depois do ETA sem ATA: o mesmo alerta vira Crítico e avisa de novo', () => {
    const before = notifications(SCALE)
    setEta(hoursAgo(17))
    reconcile()
    expect(item('voyage_schedule_date_pending', SCALE)).toBe('active|critical|ata_atrasado')
    expect(message('voyage_schedule_date_pending', SCALE)).toContain('há mais de 16 horas sem ATA')
    expect(notifications(SCALE)).toBe(before + 1)
    // A conferência seguinte não avisa outra vez.
    reconcile()
    expect(notifications(SCALE)).toBe(before + 1)
  })

  it('16 horas depois do ETD sem ATD: Crítico; antes disso, Normal; ATD gravado fecha', () => {
    const term = `${SCALE}::T606`
    psql(`
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('voyage_pod_schedule', '${SCALE}', 'ata', NULL, '${hoursAgo(40)}');
      SET session_replication_role = replica;
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb, terminal_etd)
        VALUES (${VOYAGE}, '${PORT}', 1, '${TERMINAL}', now() - interval '30 hours', now() - interval '30 hours', now() - interval '3 hours');
      SET session_replication_role = origin;`)
    reconcile()
    expect(item('voyage_terminal_date_pending', term)).toBe('active|normal|atd')

    psql(`SET session_replication_role = replica;
      UPDATE public.voyage_escala_terminal_state SET terminal_etd = now() - interval '17 hours' WHERE voyage_id = ${VOYAGE};
      SET session_replication_role = origin;`)
    reconcile()
    expect(item('voyage_terminal_date_pending', term)).toBe('active|critical|atd_atrasado')
    expect(message('voyage_terminal_date_pending', term)).toContain('há mais de 16 horas sem ATD')

    psql(`SET session_replication_role = replica;
      UPDATE public.voyage_escala_terminal_state SET terminal_atd = now() - interval '1 hour' WHERE voyage_id = ${VOYAGE};
      SET session_replication_role = origin;`)
    reconcile()
    expect(item('voyage_terminal_date_pending', term)).toMatch(/^resolved\|/)
  })
})
