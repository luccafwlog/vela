// Migration 349 (revisão dos alertas de 2026-10-21, docs/revisao-alertas-2026-10.md;
// decisões P1 e P2 do dono). Cada caso falha sem a migration:
// - P1: a Invoice de Demurrage sem pagamento cancelada e reemitida pela mudança
//   de datas não deixa o alerta "Datas mudaram" aberto quando a reemissão
//   cobriu todas as caixas;
// - P1: com caixa sem cobrança, o alerta abre e fecha sozinho quando a caixa
//   entra numa Invoice emitida;
// - P2: "Resolver com justificativa" aceita `demurrage_invoice_dates_changed` e
//   `comunicado_recusado`; o Comunicado recusado justificado não reabre na
//   próxima falha do mesmo Comunicado e reabre quando outro falha.
//
// Namespace exclusivo: ids 99349xxx, B/Ls 'R349-*', containers 'RQCU349xxxx',
// porto 'BRR49', usuário ...000000349001. A limpeza roda com
// `session_replication_role = replica`, porque Invoice cancelada recusa mudança.
import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000349001'
const customerId = 99349001
const carrierId = 99349002
const vesselId = 99349003
const voyage = { full: 99349010, lost: 99349011, negotiated: 99349012, comms: 99349013 }
const voyageIds = Object.values(voyage).join(', ')
const bl = { full: 'R349-FA', lostA: 'R349-OA', lostB: 'R349-OB', negotiated: 'R349-NA', comms: 'R349-CS' }
const blList = Object.values(bl).map((id) => `'${id}'`).join(', ')
const box = { full: 'RQCU3490001', lostShared: 'RQCU3490011', lostGone: 'RQCU3490012', negotiated: 'RQCU3490021' }
const discharge = '2026-07-01'
const returned = '2026-09-20'

// Comunicados (fixture da migration 297): Cliente próprio, NOB devido pela
// Atracação de dois dias atrás e NOA devido pelo ETA daqui a dois dias.
const commsCustomer = 99349101
const portId = 99349104
const port = 'BRR49'
const contactId = 99349121
const terminal = '34934900-0000-4000-8000-0000000000a1'
const berth = '34934900-0000-4000-8000-0000000000b1'
const nobClaim = `aviso_atracacao_nob:${commsCustomer}:${berth}`
const noaClaim = `aviso_chegada_noa:${commsCustomer}:${voyage.comms}:${port}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asServer(sql: string): string {
  return psql(`SET request.jwt.claim.role = 'service_role'; ${sql}`)
}

function asAdmin(sql: string) {
  return spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${adminId}';
    ${sql};
    COMMIT;
  `], { encoding: 'utf8' })
}

function adminJson<T>(sql: string): T {
  const result = asAdmin(sql)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null') as T
}

type IssueResult = { status: string; invoice_id?: number; anchor_bl_id?: string; complementary?: boolean }

function issue(blId: string): IssueResult {
  return JSON.parse(psql(`SET vela.demurrage_internal = 'on';
    SELECT public.issue_demurrage_invoice_for_bl('${blId}', 'R349-DEM-${blId}-' || floor(random() * 1e9)::bigint)`)) as IssueResult
}

function containerId(blId: string, number: string): number {
  return Number(psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${number}'`))
}

function datesAlert(invoiceId: number): string {
  return psql(`SELECT COALESCE((SELECT i.status FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'demurrage_invoice_dates_changed' AND a.entity_type = 'demurrage_invoice' AND a.entity_id = '${invoiceId}'
    ORDER BY i.id DESC LIMIT 1), 'sem item')`)
}

function refusalItem(): { id: string; status: string; message: string; claims: string } {
  const row = psql(`SELECT i.id || '|' || i.status || '|' || i.message || '|' ||
      COALESCE((SELECT string_agg(c->>'claim_key', ',' ORDER BY c->>'claim_key') FROM jsonb_array_elements(i.metadata->'claims') AS c), '')
    FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
    WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${commsCustomer}'
    ORDER BY i.id DESC LIMIT 1`)
  const [id, status, message, claims] = row.split('|')
  return { id, status, message, claims }
}

function justify(itemId: string, reason: string) {
  return asAdmin(`SELECT public.resolve_alert_item_with_justification(${itemId}, '${reason}')`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE r349_invoices AS SELECT id FROM public.demurrage_invoices WHERE bl_id IN (${blList});
    CREATE TEMP TABLE r349_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'demurrage_invoice' AND entity_id IN (SELECT id::text FROM r349_invoices))
         OR (entity_type = 'customer' AND entity_id IN ('${customerId}', '${commsCustomer}'))
         OR (entity_type = 'bl' AND entity_id IN (${blList}));
    CREATE TEMP TABLE r349_items AS SELECT id FROM public.alert_items
      WHERE alert_id IN (SELECT id FROM r349_alerts) OR metadata->>'bl_id' LIKE 'R349-%';
    DELETE FROM public.internal_notifications WHERE alert_item_id IN (SELECT id FROM r349_items) OR alert_id IN (SELECT id FROM r349_alerts);
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM r349_items);
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM r349_items);
    DELETE FROM public.alert_notification_failures WHERE alert_item_id IN (SELECT id FROM r349_items) OR alert_id IN (SELECT id FROM r349_alerts);
    DELETE FROM public.alert_items WHERE id IN (SELECT id FROM r349_items);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM r349_alerts);
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id IN (${blList}));
    DELETE FROM public.import_pending_effects WHERE entity_id IN (${blList});
    DELETE FROM public.portal_notifications WHERE customer_id IN (${customerId}, ${commsCustomer}) OR bl_id IN (${blList});
    DELETE FROM public.itau_pix_charges WHERE demurrage_invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_calculation_snapshots WHERE demurrage_invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_mutation_requests WHERE invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_refunds WHERE invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_dunning_claims WHERE demurrage_invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_invoice_history WHERE invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.demurrage_invoices WHERE id IN (SELECT id FROM r349_invoices);
    DELETE FROM public.customer_demurrage_agreements WHERE customer_id = ${customerId};
    DELETE FROM public.customer_reconciliation_queue WHERE bl_id IN (${blList});
    DELETE FROM public.customer_communication_automation_claims WHERE claim_key LIKE '%:${commsCustomer}:%';
    DELETE FROM public.customer_contact_box_links WHERE contact_id = ${contactId};
    DELETE FROM public.customer_contacts WHERE customer_id = ${commsCustomer};
    DELETE FROM public.bl_containers WHERE bl_id IN (${blList});
    DELETE FROM public.bls WHERE id IN (${blList});
    DELETE FROM public.voyage_escala_operation_fronts WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_escala_terminal_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.depots WHERE id = '${terminal}';
    DELETE FROM public.voyage_documental_pending WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.voyage_documental_state WHERE voyage_id IN (${voyageIds});
    DELETE FROM public.audit_logs WHERE changed_by = '${adminId}' OR entity_id IN (${blList})
      OR (entity_type = 'voyage_pod_schedule' AND entity_id = '${voyage.comms}::${port}')
      OR (entity_type IN ('demurrage_invoice', 'demurrage_invoices') AND entity_id IN (SELECT id::text FROM r349_invoices));
    DELETE FROM public.voyages WHERE id IN (${voyageIds});
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.ports WHERE id = ${portId};
    SET session_replication_role = origin;
    SET vela.retention = 'on';
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (${customerId}, ${commsCustomer})
      OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${commsCustomer}));
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${commsCustomer}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (${customerId}, ${commsCustomer});
    DELETE FROM public.customers WHERE id IN (${customerId}, ${commsCustomer});
    DELETE FROM public.user_profiles WHERE id = '${adminId}';
    DELETE FROM auth.users WHERE id = '${adminId}';
  `)
}

function migrationApplied() {
  if (!enabled) return false
  try {
    return psql(`SELECT to_regprocedure('public._resolve_demurrage_dates_changed_billed(bigint,bigint)') IS NOT NULL`) === 't'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migrationApplied, 'migration 349 (_resolve_demurrage_dates_changed_billed)')

describeLocal('349 — datas da Demurrage fecham com a cobrança; justificativa nas datas e no Comunicado recusado', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'r349-admin@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${adminId}', 'R349 Administrativo', 'administrativo', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${syntheticCnpj(349001)}', 'R349 CLIENTE');
      INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, p1_usd, p2_usd, valid_from, active)
      VALUES (${customerId}, 5, 100, 200, '2026-01-01', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'R349 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'R349 NAVIO', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES
        (${voyage.full}, ${vesselId}, 'R349A', 'active'),
        (${voyage.lost}, ${vesselId}, 'R349B', 'active'),
        (${voyage.negotiated}, ${vesselId}, 'R349C', 'active'),
        (${voyage.comms}, ${vesselId}, 'R349D', 'active');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status,
                              demurrage_roe_manual, demurrage_roe) VALUES
        ('${bl.full}', ${voyage.full}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5),
        ('${bl.lostA}', ${voyage.lost}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5),
        ('${bl.lostB}', ${voyage.lost}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5),
        ('${bl.negotiated}', ${voyage.negotiated}, ${customerId}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5);
      INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date) VALUES
        ('${bl.full}', '${box.full}', '40HC', '${discharge}', '${returned}'),
        ('${bl.lostA}', '${box.lostShared}', '40HC', '${discharge}', '${returned}'),
        ('${bl.lostB}', '${box.lostShared}', '40HC', '${discharge}', '${returned}'),
        ('${bl.lostB}', '${box.lostGone}', '40HC', '${discharge}', '${returned}'),
        ('${bl.negotiated}', '${box.negotiated}', '40HC', '${discharge}', '${returned}');

      SET session_replication_role = replica;
      INSERT INTO public.ports (id, name, locode) VALUES (${portId}, 'Porto R349', '${port}');
      INSERT INTO public.depots (id, code, name, tipo, port_id) VALUES ('${terminal}', 'T349A', 'Terminal R349', 'terminal_portuario', ${portId});
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${commsCustomer}, 'CLIENTE R349 COMUNICADOS', '${syntheticCnpj(349101)}');
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${contactId}, ${commsCustomer}, 'Contato R349', 'docs-r349@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES (${contactId}, 'documentacao_operacao');
      INSERT INTO public.voyage_escala_terminal_state (id, voyage_id, port, port_id, terminal_id, terminal_atb)
      VALUES ('${berth}', ${voyage.comms}, '${port}', ${portId}, '${terminal}', now() - interval '2 days');
      INSERT INTO public.voyage_escala_operation_fronts (voyage_id, port, port_id, terminal_id, sentido, modalidade, source) VALUES
        (${voyage.comms}, '${port}', ${portId}, '${terminal}', 'importacao', 'carga_solta', 'operational_data');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, terminal_id, pod_port_id) VALUES
        ('${bl.comms}', ${voyage.comms}, ${commsCustomer}, 'CNSHA', '${port}', 'carga_solta', 'pending', 'calculated', 'ok', NULL, NULL);
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${voyage.comms}::${port}', 'eta', NULL, to_char(now() + interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now() - interval '1 hour');
      SET session_replication_role = origin;
    `)
  })

  afterAll(cleanup)

  it('P1: reemissão que cobre todas as caixas não deixa o alerta aberto', () => {
    const first = issue(bl.full)
    expect(first.status).toBe('issued')
    const invoiceId = Number(first.invoice_id)

    const corrected = adminJson<{ demurrage: { demurrage_invoices: Array<Record<string, unknown>> } }>(
      `SELECT public.set_container_dates(${containerId(bl.full, box.full)}, '${discharge}', '2026-09-22', 'Terminal corrigiu a devolução (R349)')`)
    expect(corrected.demurrage.demurrage_invoices).toEqual([expect.objectContaining({
      invoice_id: invoiceId, status: 'cancelled', reissue_complete: true, unbilled_containers: [],
    })])
    // Antes: alerta ativo na Invoice cancelada, sem nada que o fechasse.
    expect(datesAlert(invoiceId)).not.toBe('active')
  })

  it('P1: caixa sem cobrança abre o alerta, que fecha quando a caixa entra numa Invoice emitida', () => {
    const first = issue(bl.lostB)
    expect(first).toMatchObject({ status: 'issued', anchor_bl_id: bl.lostA })
    const invoiceId = Number(first.invoice_id)

    // A caixa própria do B/L B vira SOC: a reemissão não a cobra.
    psql(`UPDATE public.bl_containers SET ownership = 'SOC' WHERE bl_id = '${bl.lostB}' AND container_number = '${box.lostGone}'`)
    const corrected = adminJson<{ demurrage: { demurrage_invoices: Array<Record<string, unknown>> } }>(
      `SELECT public.set_container_dates(${containerId(bl.lostA, box.lostShared)}, '${discharge}', '2026-09-22', 'Terminal corrigiu a devolução (R349)')`)
    expect(corrected.demurrage.demurrage_invoices).toEqual([expect.objectContaining({
      invoice_id: invoiceId, status: 'cancelled', reissue_complete: false, unbilled_containers: [box.lostGone],
    })])
    expect(datesAlert(invoiceId)).toBe('active')

    // A conferência desfaz o SOC e a Demurrage da caixa é emitida.
    psql(`UPDATE public.bl_containers SET ownership = NULL WHERE bl_id = '${bl.lostB}' AND container_number = '${box.lostGone}'`)
    expect(issue(bl.lostB)).toMatchObject({ status: 'issued', complementary: true })
    expect(datesAlert(invoiceId)).toBe('resolved')
    expect(psql(`SELECT e.metadata->>'resolution' FROM public.alert_item_events AS e
      JOIN public.alert_items AS i ON i.id = e.alert_item_id JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND a.entity_id = '${invoiceId}' AND e.event_type = 'resolved'
      ORDER BY e.id DESC LIMIT 1`)).toBe('containers_billed')
  })

  it('P2: a conferência das datas de Invoice negociada se resolve com justificativa', () => {
    const first = issue(bl.negotiated)
    const invoiceId = Number(first.invoice_id)
    psql(`SET session_replication_role = replica;
      UPDATE public.demurrage_invoices SET discount_type = 'comercial', discount_mode = 'percent', discount_value = 10 WHERE id = ${invoiceId};`)
    expect(asAdmin(`SELECT public.set_container_dates(${containerId(bl.negotiated, box.negotiated)}, '${discharge}', '2026-10-05', 'Terminal corrigiu a devolução (R349)')`).status).toBe(0)
    expect(datesAlert(invoiceId)).toBe('active')

    const itemId = psql(`SELECT i.id FROM public.alert_items AS i JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'demurrage_invoice_dates_changed' AND a.entity_id = '${invoiceId}' AND i.status = 'active'`)
    const resolved = justify(itemId, 'Desconto refeito na Invoice nova (R349)')
    // Antes: "Este alerta fecha sozinho quando a origem é corrigida".
    expect(resolved.stderr).toBe('')
    expect(datesAlert(invoiceId)).toBe('resolved')
  })

  it('P2: Comunicado recusado justificado só reabre quando outro Comunicado falha', () => {
    // A produtora cria a claim do NOB devido; a 1ª recusa por dado abre o alerta.
    asServer(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    expect(asServer(`SELECT (public.defer_customer_communication_automation_claim('${nobClaim}', 'Prontidão financeira bloqueada', false))->>'alerted'`)).toBe('true')
    const opened = refusalItem()
    expect(opened.status).toBe('active')
    expect(opened.claims).toBe(nobClaim)

    const resolved = justify(opened.id, 'Cliente avisado por telefone; envio manual (R349)')
    expect(resolved.stderr).toBe('')
    expect(refusalItem().status).toBe('resolved')
    expect(psql(`SELECT refusal_acknowledged_at IS NOT NULL FROM public.customer_communication_automation_claims WHERE claim_key = '${nobClaim}'`)).toBe('t')

    // A próxima tentativa do mesmo NOB recusa de novo: o alerta não reabre.
    asServer(`SELECT public.defer_customer_communication_automation_claim('${nobClaim}', 'Prontidão financeira bloqueada', false)`)
    expect(refusalItem().status).toBe('resolved')

    // Outro Comunicado do Cliente (o NOA) recusa: reabre, só com ele.
    asServer(`INSERT INTO public.customer_communication_automation_claims (claim_key) VALUES ('${noaClaim}') ON CONFLICT (claim_key) DO NOTHING;
      SELECT public.reject_customer_communication_automation_claim('${noaClaim}', 'B/Ls inválidos.')`)
    const reopened = refusalItem()
    expect(reopened.status).toBe('active')
    expect(reopened.claims).toBe(noaClaim)
    expect(reopened.message).not.toContain(nobClaim)
    expect(psql(`SELECT count(*) FROM public.alert_item_events AS e JOIN public.alert_items AS i ON i.id = e.alert_item_id
      JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${commsCustomer}'
        AND e.event_type = 'opened'`)).toBe('2')

    // O envio do NOB não muda nada; o do NOA fecha.
    asServer(`SELECT public.complete_customer_communication_automation_claim('${nobClaim}')`)
    expect(refusalItem().status).toBe('active')
    // O envio zera as duas marcas: a rodada não confere mais esse Cliente por ele.
    expect(psql(`SELECT (refusal_alerted_at IS NOT NULL)::text || '|' || (refusal_acknowledged_at IS NOT NULL)::text
      FROM public.customer_communication_automation_claims WHERE claim_key = '${nobClaim}'`)).toBe('false|false')
    asServer(`SELECT public.complete_customer_communication_automation_claim('${noaClaim}')`)
    expect(refusalItem().status).toBe('resolved')
  })

  it('P2: claim justificada que deixa de ser devida perde o reconhecimento e, se voltar a falhar, reabre', () => {
    const marks = () => psql(`SELECT (refusal_alerted_at IS NOT NULL)::text || '|' || (refusal_acknowledged_at IS NOT NULL)::text
      FROM public.customer_communication_automation_claims WHERE claim_key = '${nobClaim}'`)
    asServer(`SELECT public.defer_customer_communication_automation_claim('${nobClaim}', 'Prontidão financeira bloqueada', false)`)
    expect(refusalItem().status).toBe('active')
    expect(justify(refusalItem().id, 'Conferido por telefone (R349 saída)').stderr).toBe('')
    expect(marks()).toBe('true|true')

    // O Cliente é desativado: o NOB deixa de ser devido. Antes, a rodada da
    // produtora só conferia Cliente com o item ativo e as marcas ficavam.
    psql(`UPDATE public.customers SET deactivated_at = now() WHERE id = ${commsCustomer}`)
    asServer(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    expect(marks()).toBe('false|false')

    // Reativado, o NOB volta a ser devido e recusa: episódio novo, o alerta reabre.
    psql(`UPDATE public.customers SET deactivated_at = NULL WHERE id = ${commsCustomer}`)
    asServer(`SELECT public.defer_customer_communication_automation_claim('${nobClaim}', 'Prontidão financeira bloqueada', false)`)
    const reopened = refusalItem()
    expect(reopened.status).toBe('active')
    expect(reopened.claims).toBe(nobClaim)
  })

  it('P2: claim justificada que sai e volta a ser devida sem falha nova não reabre', () => {
    const round = () => asServer(`SELECT public.evaluate_and_dispatch_automatic_communications(now())`)
    const opened = () => psql(`SELECT count(*) FROM public.alert_item_events AS e JOIN public.alert_items AS i ON i.id = e.alert_item_id
      JOIN public.alerts AS a ON a.id = i.alert_id
      WHERE i.item_type = 'comunicado_recusado' AND a.entity_type = 'customer' AND a.entity_id = '${commsCustomer}'
        AND e.event_type = 'opened'`)
    const setEta = (days: number) => psql(`SET session_replication_role = replica;
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${voyage.comms}::${port}', 'eta', NULL, to_char(now() + interval '${days} days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now());
      SET session_replication_role = origin;`)
    const noaMarks = () => psql(`SELECT (refusal_alerted_at IS NOT NULL)::text || '|' || (refusal_acknowledged_at IS NOT NULL)::text
      FROM public.customer_communication_automation_claims WHERE claim_key = '${noaClaim}'`)

    // NOB e NOA no alerta, justificado: os dois ficam reconhecidos.
    asServer(`INSERT INTO public.customer_communication_automation_claims (claim_key) VALUES ('${noaClaim}') ON CONFLICT (claim_key) DO NOTHING;
      SELECT public.reject_customer_communication_automation_claim('${noaClaim}', 'B/Ls inválidos.')`)
    const open = refusalItem()
    expect(open.status).toBe('active')
    expect(open.claims).toBe([noaClaim, nobClaim].sort().join(','))
    expect(justify(open.id, 'Cliente avisado por telefone (R349 volta)').stderr).toBe('')
    expect(noaMarks()).toBe('true|true')
    const openedBefore = opened()

    // ETA adiado para daqui a 20 dias: o NOA deixa de ser devido e sai.
    setEta(20)
    round()
    expect(noaMarks()).toBe('false|false')
    expect(refusalItem().status).toBe('resolved')

    // ETA de volta a 2 dias, sem adiamento, recusa nem envio: o NOA não reentra
    // pela recusa antiga e o item continua resolvido, sem ocorrência nova.
    setEta(2)
    round()
    expect(noaMarks()).toBe('false|false')
    expect(refusalItem().status).toBe('resolved')
    expect(opened()).toBe(openedBefore)

    // A falha nova do NOA reabre, como episódio novo.
    asServer(`SELECT public.reject_customer_communication_automation_claim('${noaClaim}', 'B/Ls inválidos.')`)
    const reopened = refusalItem()
    expect(reopened.status).toBe('active')
    expect(reopened.claims).toBe(noaClaim)
  })

  it('P2: a lista de tipos com justificativa tem os dois tipos', () => {
    expect(psql(`SELECT public._alert_item_resolved_with_justification('demurrage_invoice_dates_changed', 'demurrage_invoice')
      AND public._alert_item_resolved_with_justification('comunicado_recusado', 'customer')`)).toBe('t')
  })
})
