import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const voyageId = 9524001
const carrierId = 9524001
const vesselId = 9524001
const terminalId = '00000000-0000-0000-0000-000000952401'
const reportId = '00000000-0000-0000-0000-000000952402'
const adminId = '00000000-0000-0000-0000-000000952411'
const opsId = '00000000-0000-0000-0000-000000952412'
const docsId = '00000000-0000-0000-0000-000000952413'
const equipmentId = '00000000-0000-0000-0000-000000952414'
const entityId = `${voyageId}::BRSSZ::TST524`

function psql(sql: string) {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${adminId}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('migration 323 — runtime do agregado de alertas do ADR', () => {
  beforeAll(() => {
    psql(`
      SET request.jwt.claim.role = 'service_role';
      SET request.jwt.claim.sub = '${adminId}';
      DELETE FROM public.internal_notifications WHERE entity_id = '${entityId}';
      DELETE FROM public.alert_notification_failures WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${entityId}');
      DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}');
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}');
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id='${entityId}');
      DELETE FROM public.alerts WHERE entity_id = '${entityId}';
      DELETE FROM public.agency_departure_reports WHERE id = '${reportId}';
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.depots WHERE id = '${terminalId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');

      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin-323@example.test'), ('${opsId}', 'ops-323@example.test'),
        ('${docsId}', 'docs-323@example.test'), ('${equipmentId}', 'equipment-323@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Admin 323', 'administrativo', true), ('${opsId}', 'Ops 323', 'operacoes', true),
        ('${docsId}', 'Docs 323', 'documentacao', true), ('${equipmentId}', 'Equipment 323', 'equipamentos', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 323') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 323', ${carrierId}) ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.depots (id, code, name, tipo, port_id)
      SELECT '${terminalId}', 'TST524', 'Terminal 524', 'terminal_portuario', id FROM public.ports WHERE locode = 'BRSSZ';
      INSERT INTO public.voyages (id, vessel_id, voyage_number) VALUES (${voyageId}, ${vesselId}, 'VOY-323') ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.agency_departure_reports (id, voyage_id, port, terminal_id, terminal_port_id)
      SELECT '${reportId}', ${voyageId}, 'BRSSZ', '${terminalId}', id FROM public.ports WHERE locode = 'BRSSZ';
      INSERT INTO public.voyage_escala_terminal_state (voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd)
      SELECT ${voyageId}, 'BRSSZ', id, '${terminalId}', now() - interval '21 days', now() - interval '20 days'
      FROM public.ports WHERE locode = 'BRSSZ';
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by)
      VALUES ('voyage_pod_schedule', '${voyageId}::BRSSZ', 'atd', NULL,
        to_char((now() - interval '20 days')::date, 'YYYY-MM-DD'), '${adminId}');
      UPDATE public.agency_report_pending_baselines
      SET captured_at = now() - interval '30 days'
      WHERE baseline_key = 'agency_report_deadline_missed';
      SELECT public.reconcile_agency_report_alerts('${reportId}', true, true);
    `)
  })

  afterAll(() => {
    psql(`
      DELETE FROM public.internal_notifications WHERE entity_id = '${entityId}';
      DELETE FROM public.alert_notification_failures WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id = '${entityId}');
      DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}');
      DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}');
      DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts WHERE entity_id='${entityId}');
      DELETE FROM public.alerts WHERE entity_id = '${entityId}';
      DELETE FROM public.agency_departure_reports WHERE id = '${reportId}';
      DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id = ${voyageId};
      DELETE FROM public.voyages WHERE id = ${voyageId};
      DELETE FROM public.vessels WHERE id = ${vesselId};
      DELETE FROM public.carriers WHERE id = ${carrierId};
      DELETE FROM public.depots WHERE id = '${terminalId}';
      DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');
      DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');
      DELETE FROM auth.users WHERE id IN ('${adminId}', '${opsId}', '${docsId}', '${equipmentId}');
    `)
  })

  it('abre dois itens por departamento no mesmo agregado e faz fan-out', () => {
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}' AND i.status='active' AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed');`)).toBe('6')
    expect(psql(`SELECT count(*) FROM public.internal_notifications WHERE entity_id='${entityId}' AND recipient_id IN ('${opsId}', '${docsId}', '${equipmentId}') AND item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed');`)).toBe('10')
    expect(psql(`SELECT count(DISTINCT a.id) FROM public.alerts a WHERE a.entity_id='${entityId}' AND a.entity_type='agency_departure_report' AND a.type='aggregate';`)).toBe('1')
  })

  it('é idempotente e reabre a responsabilidade quando uma seção volta a pendente', () => {
    const eventsBefore = psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id=e.alert_item_id JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}' AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed');`)
    expect(psql(`SELECT (public.reconcile_agency_report_alerts('${reportId}', true, true)->>'changed');`)).toBe('0')
    expect(psql(`SELECT count(*) FROM public.alert_item_events e JOIN public.alert_items i ON i.id=e.alert_item_id JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}' AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed');`)).toBe(eventsBefore)

    psql(`
      SET request.jwt.claim.role = 'service_role';
      SET request.jwt.claim.sub = '${adminId}';
      INSERT INTO public.agency_departure_report_signoffs (report_id, section, state, department, signed_by, signed_at)
      SELECT '${reportId}', section, 'confirmed', department, '${adminId}', now()
      FROM (VALUES
        ('datas', 'operacoes'), ('carga_descarregada', 'documentacao'), ('carga_carregada', 'equipamentos'),
        ('veiculos', 'equipamentos'), ('vazios_embarcados', 'equipamentos'), ('vazios_descarregados', 'documentacao')
      ) AS sections(section, department)
      ON CONFLICT (report_id, section) DO UPDATE SET state='confirmed', signed_by='${adminId}', signed_at=now();
      INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at)
      VALUES ('${reportId}', 'operacoes', '${adminId}', now())
      ON CONFLICT (report_id, department) DO UPDATE SET signed_by='${adminId}', signed_at=now();
      SELECT public.reconcile_agency_report_alerts('${reportId}', true, true);
      UPDATE public.agency_departure_report_signoffs SET state='pending', signed_by=NULL, signed_at=NULL
      WHERE report_id='${reportId}' AND section='datas';
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('agency_departure_report_signoff', '${reportId}::datas', 'state', 'confirmed', 'pending', '${adminId}', 'reabertura 323');
    `)
    expect(psql(`SELECT (signed_at IS NULL)::text FROM public.agency_departure_report_department_signoffs WHERE report_id='${reportId}' AND department='operacoes';`)).toBe('true')
    expect(psql(`SELECT count(*) FROM public.alert_items i JOIN public.alerts a ON a.id=i.alert_id WHERE a.entity_id='${entityId}' AND i.department='operacoes' AND i.status='active' AND i.item_type IN ('agency_report_department_pending', 'agency_report_deadline_missed');`)).toBe('2')
  })
})
