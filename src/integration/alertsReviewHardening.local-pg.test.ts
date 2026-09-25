import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const voyageId = 9525001
const scaleEntityId = `${voyageId}::BRSSZ`
const terminalId = '00000000-0000-0000-0000-000000952501'
const adminId = '00000000-0000-0000-0000-000000952511'
const opsId = '00000000-0000-0000-0000-000000952512'
const docsId = '00000000-0000-0000-0000-000000952513'

function psql(sql: string) {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('migrations 338 — comportamento real no Postgres', () => {
  beforeAll(() => {
    psql(`
      DELETE FROM public.internal_notifications WHERE recipient_id IN ('${opsId}', '${docsId}') OR entity_id LIKE '${voyageId}::%';
      DELETE FROM public.alert_notification_failures WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alerts WHERE entity_id LIKE '${voyageId}::%';
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyage_export_schedules WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${voyageId};
      DELETE FROM public.carriers WHERE id = ${voyageId};
      DELETE FROM public.depots WHERE id = '${terminalId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${opsId}', '${docsId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${opsId}', '${docsId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${opsId}', '${docsId}');

      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin-338@example.test'), ('${opsId}', 'ops-338@example.test'), ('${docsId}', 'docs-338@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Admin 338', 'administrativo', true), ('${opsId}', 'Ops 338', 'operacoes', true), ('${docsId}', 'Docs 338', 'documentacao', true);
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.internal_notifications WHERE recipient_id IN ('${opsId}', '${docsId}') OR entity_id LIKE '${voyageId}::%';
      DELETE FROM public.alert_notification_failures WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id LIKE '${voyageId}::%');
      DELETE FROM public.alerts WHERE entity_id LIKE '${voyageId}::%';
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyage_export_schedules WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${voyageId};
      DELETE FROM public.carriers WHERE id = ${voyageId};
      DELETE FROM public.depots WHERE id = '${terminalId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${opsId}', '${docsId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${opsId}', '${docsId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${opsId}', '${docsId}');
    `)
  })

  it('entrega a notificação para toda a audiência e abre nova ocorrência ao avançar o marco', () => {
    psql(`
      SELECT public.upsert_alert_item(
        'voyage_schedule_date_pending', 'voyage_pod_schedule', '${scaleEntityId}',
        'ATA pendente', 'alerts_338_test', 'operacoes',
        '{"milestone":"ata"}'::jsonb, NULL
      );
      SELECT public.upsert_alert_item(
        'voyage_schedule_date_pending', 'voyage_pod_schedule', '${scaleEntityId}',
        'ETB pendente', 'alerts_338_test', 'operacoes',
        '{"milestone":"etb"}'::jsonb, NULL
      );
    `)
    expect(psql(`SELECT count(*) FROM public.internal_notifications WHERE entity_id = '${scaleEntityId}' AND recipient_id IN ('${opsId}', '${docsId}');`)).toBe('4')
    expect(psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id = e.alert_item_id JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id = '${scaleEntityId}' AND e.event_type = 'opened';`)).toBe('2')
    expect(psql(`SELECT count(*) FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${scaleEntityId}') AND destination IS NULL;`)).toBe('1')
  })

  it('remove execução authenticated dos sete reconciliadores do Bloco 4', () => {
    const signatures = [
      'public.reconcile_voyage_bl_expected_alerts(bigint,text)',
      'public.reconcile_voyage_baplie_missing_alerts(bigint,text)',
      'public.reconcile_voyage_baplie_coverage_alerts(bigint,text)',
      'public.reconcile_voyage_ce_mercante_missing_alerts(bigint,text)',
      'public.reconcile_voyage_schedule_date_alerts(bigint,text,text)',
      'public.reconcile_voyage_export_after_atd_alerts(bigint,text,text,text)',
      'public.reconcile_voyage_operation_alerts(bigint,text)',
    ]
    for (const signature of signatures) {
      expect(psql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`)).toBe('f')
    }
  })

  it('resolve o código do terminal como identidade pública', () => {
    psql(`
      INSERT INTO public.depots (id, code, name, tipo, port_id)
      SELECT '${terminalId}', 'TST338', 'Terminal 338', 'terminal_portuario', id
      FROM public.ports WHERE locode = 'BRSSZ';
    `)
    expect(psql(`SELECT public.voyage_terminal_code('${terminalId}');`)).toBe('TST338')
  })
})
