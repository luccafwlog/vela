import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Itens B27 e A23 do plano docs/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md
// (migration 238): o alerta fecha pela origem, conferida no servidor; a
// conferência sem fato de origem se resolve com justificativa no histórico.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const USER = '23823800-0000-4000-8000-000000000001'
const CARRIER_ID = 99238001
const VESSEL_ID = 99238002
const VOYAGE_ID = 99238003
const CUSTOMER_ID = 99238004
const BL_CALC = 'A238-CALC'
const BL_ISSUE = 'A238-ISSUE'
const BL_RESEND = 'A238-RESEND'
const BL_UNLOCK = 'A238-UNLOCK'
const BL_ABUSE = 'A238-ABUSE'
const ALL_BLS = [BL_CALC, BL_ISSUE, BL_RESEND, BL_UNLOCK, BL_ABUSE].map((id) => `'${id}'`).join(', ')

/** Como o servidor (`service_role`): produtores e Edge Functions. */
function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function asUser(sql: string): { ok: boolean; output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${USER}'; SET LOCAL request.jwt.claim.role = 'authenticated'; ${sql}; COMMIT;`],
  { encoding: 'utf8' })
  return { ok: result.status === 0, output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

function openAlert(type: string, blId: string) {
  psql(`SELECT public.upsert_alert_item('${type}', 'bl', '${blId}', 'Alerta de teste A238', 'a238_fixture', '{}'::jsonb, '/bls/${blId}');`)
}

function itemStatus(type: string, blId: string): string {
  return psql(`SELECT i.status FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = 'bl' AND a.entity_id = '${blId}' ORDER BY i.id DESC LIMIT 1;`)
}

function itemId(type: string, blId: string): string {
  return psql(`SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = 'bl' AND a.entity_id = '${blId}' ORDER BY i.id DESC LIMIT 1;`)
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE a238_alerts AS SELECT id FROM public.alerts WHERE (entity_type = 'bl' AND entity_id IN (${ALL_BLS})) OR (entity_type = 'portal_email_event' AND entity_id = '316001');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a238_alerts));
    DELETE FROM public.alert_item_dismissals WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM a238_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM a238_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM a238_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM a238_alerts);
    DELETE FROM public.customer_communication_bls WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.customer_communications WHERE customer_id = ${CUSTOMER_ID};
    DELETE FROM public.ce_unlock_zpt_status WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.charge_calculations WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.audit_logs WHERE entity_id IN (${ALL_BLS});
    DELETE FROM public.bls WHERE id IN (${ALL_BLS});
    DELETE FROM public.customers WHERE id = ${CUSTOMER_ID};
    DELETE FROM public.voyages WHERE id = ${VOYAGE_ID};
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    DELETE FROM public.user_profiles WHERE id = '${USER}';
    DELETE FROM auth.users WHERE id = '${USER}';
    SET session_replication_role = origin;
  `)
}

function migration238Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('_billing_alert_origin_resolved', 'resolve_alert_item_with_justification');`) === '2'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration238Applied, 'migration238Applied (alertas fecham pela origem)')

describeLocal('238 — alertas fecham pela origem ou com justificativa (B27, A23)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${USER}', 'doc-a238@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${USER}', 'Documentação A238', 'documentacao', true);
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador A238');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio A238', ${CARRIER_ID});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${VOYAGE_ID}, ${VESSEL_ID}, 'A238V', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${CUSTOMER_ID}, 'CLIENTE A238 LTDA', '${syntheticCnpj(238004)}');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, ce_mercante)
      VALUES ('${BL_CALC}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A238O', 'A238P', 'container', 'pending', 'review_required', 'ok', NULL),
             ('${BL_ISSUE}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A238O', 'A238P', 'container', 'pending', 'calculated', 'ok', NULL),
             ('${BL_RESEND}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A238O', 'A238P', 'container', 'pending', 'calculated', 'ok', '992380000000001'),
             ('${BL_UNLOCK}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A238O', 'A238P', 'container', 'pending', 'calculated', 'ok', '992380000000002'),
             ('${BL_ABUSE}', ${VOYAGE_ID}, ${CUSTOMER_ID}, 'A238O', 'A238P', 'container', 'pending', 'calculated', 'ok', NULL);
      INSERT INTO public.charge_calculations (bl_id, source, status, calculation_key, quantity, total_value_brl)
      VALUES ('${BL_CALC}', 'auto', 'review_required', 'a238:review', 1, 0);
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('B27: o bloqueio de cálculo só fecha quando o servidor vê o cálculo válido', () => {
    openAlert('billing_calculation_blocked', BL_CALC)
    const early = asUser(`SELECT public.resolve_billing_alert('billing_calculation_blocked', '${BL_CALC}', '{"resolution":"calculation_valid"}'::jsonb)`)
    expect(early.output).toBe('f')
    expect(itemStatus('billing_calculation_blocked', BL_CALC)).toBe('active')

    psql(`SET session_replication_role = replica;
      UPDATE public.charge_calculations SET status = 'calculated', total_value_brl = 1300 WHERE bl_id = '${BL_CALC}';
      UPDATE public.bls SET charge_status = 'calculated' WHERE id = '${BL_CALC}';
      SET session_replication_role = origin;`)
    const resolved = asUser(`SELECT public.resolve_billing_alert('billing_calculation_blocked', '${BL_CALC}', '{"resolution":"calculation_valid"}'::jsonb)`)
    expect(resolved.output).toBe('t')
    expect(itemStatus('billing_calculation_blocked', BL_CALC)).toBe('resolved')
  })

  it('B27: a falha de emissão só fecha com o B/L faturado', () => {
    openAlert('billing_auto_issue_failed', BL_ISSUE)
    expect(asUser(`SELECT public.resolve_billing_alert('billing_auto_issue_failed', '${BL_ISSUE}', '{}'::jsonb)`).output).toBe('f')
    expect(itemStatus('billing_auto_issue_failed', BL_ISSUE)).toBe('active')

    psql(`SET session_replication_role = replica; UPDATE public.bls SET financial_status = 'invoiced' WHERE id = '${BL_ISSUE}'; SET session_replication_role = origin;`)
    expect(asUser(`SELECT public.resolve_billing_alert('billing_auto_issue_failed', '${BL_ISSUE}', '{}'::jsonb)`).output).toBe('t')
    expect(itemStatus('billing_auto_issue_failed', BL_ISSUE)).toBe('resolved')
  })

  it('A23: o reenvio do Comunicado de CE e Taxas fecha "Reenviar Comunicado"; o envio anterior à troca não', () => {
    // Comunicado criado antes da troca de CE: não vale como reenvio.
    psql(`SET session_replication_role = replica;
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, created_at)
      VALUES (99238101, ${CUSTOMER_ID}, 'ce_mercante_taxas', 'documentacao', 'simulado', now() - interval '1 hour');
      INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (99238101, '${BL_RESEND}');
      SET session_replication_role = origin;`)
    openAlert('comunicado_ce_reenvio_pendente', BL_RESEND)
    psql(`UPDATE public.customer_communications SET status = 'enviado' WHERE id = 99238101;`)
    expect(itemStatus('comunicado_ce_reenvio_pendente', BL_RESEND)).toBe('active')

    // Reenvio depois da troca: fecha o alerta, com o Comunicado no histórico.
    psql(`SET session_replication_role = replica;
      INSERT INTO public.customer_communications (id, customer_id, kind, nature, status, attempt_discriminator)
      VALUES (99238102, ${CUSTOMER_ID}, 'ce_mercante_taxas', 'documentacao', 'simulado', 1);
      INSERT INTO public.customer_communication_bls (communication_id, bl_id) VALUES (99238102, '${BL_RESEND}');
      SET session_replication_role = origin;`)
    psql(`UPDATE public.customer_communications SET status = 'enviado' WHERE id = 99238102;`)
    expect(itemStatus('comunicado_ce_reenvio_pendente', BL_RESEND)).toBe('resolved')
    expect(psql(`SELECT metadata->>'communication_id' FROM public.alert_item_events
      WHERE alert_item_id = ${itemId('comunicado_ce_reenvio_pendente', BL_RESEND)} AND event_type = 'resolved';`)).toBe('99238102')
  })

  it('A23: a conciliação ZPT do CE atual fecha "CE trocado depois do Desbloqueio"; a de outro CE não', () => {
    openAlert('ce_trocado_com_desbloqueio', BL_UNLOCK)
    psql(`INSERT INTO public.ce_unlock_zpt_status (bl_id, ce_mercante, status, zpt_status, reconciled_by)
      VALUES ('${BL_UNLOCK}', '992380000000099', 'unlocked', 'Desbloqueado', '${USER}');`)
    expect(itemStatus('ce_trocado_com_desbloqueio', BL_UNLOCK)).toBe('active')
    psql(`UPDATE public.ce_unlock_zpt_status SET ce_mercante = '992380000000002' WHERE bl_id = '${BL_UNLOCK}';`)
    expect(itemStatus('ce_trocado_com_desbloqueio', BL_UNLOCK)).toBe('resolved')
  })

  it('A23: "Resolver com justificativa" exige motivo, grava autor e motivo e vale só para conferência sem fato', () => {
    openAlert('portal_abuso_login', BL_ABUSE)
    const id = itemId('portal_abuso_login', BL_ABUSE)
    const blank = asUser(`SELECT public.resolve_alert_item_with_justification(${id}, '   ')`)
    expect(blank.ok).toBe(false)
    expect(blank.error).toMatch(/Informe a justificativa/)

    const resolved = asUser(`SELECT public.resolve_alert_item_with_justification(${id}, 'Tentativas eram do próprio Cliente, confirmado por telefone')`)
    expect(resolved.error).toBe('')
    expect(itemStatus('portal_abuso_login', BL_ABUSE)).toBe('resolved')
    expect(psql(`SELECT actor_id || '|' || (metadata->>'reason') FROM public.alert_item_events
      WHERE alert_item_id = ${id} AND event_type = 'resolved';`)).toBe(`${USER}|Tentativas eram do próprio Cliente, confirmado por telefone`)

    openAlert('billing_auto_issue_failed', BL_ABUSE)
    const withOrigin = asUser(`SELECT public.resolve_alert_item_with_justification(${itemId('billing_auto_issue_failed', BL_ABUSE)}, 'Fechar à mão')`)
    expect(withOrigin.ok).toBe(false)
    expect(withOrigin.error).toMatch(/fecha sozinho quando a origem é corrigida/)
  })

  it('316: evento de e-mail em investigação resolve com justificativa; o mesmo tipo por B/L, não', async () => {
    const { canResolveWithJustification } = await import('../services/alerts')
    const sql = (entity: string) => psql(`SELECT public._alert_item_resolved_with_justification('portal_reprocessamento_falhou', '${entity}');`)
    expect(sql('portal_email_event')).toBe('t')
    expect(sql('bl')).toBe('f')
    expect(canResolveWithJustification('portal_reprocessamento_falhou', 'portal_email_event')).toBe(true)
    expect(canResolveWithJustification('portal_reprocessamento_falhou', 'bl')).toBe(false)
    expect(psql(`SELECT public._alert_item_resolved_with_justification('desbloqueio_ce_aviso_nao_enviado', 'customer');`)).toBe('t')

    psql(`SELECT public.upsert_alert_item('portal_reprocessamento_falhou', 'portal_email_event', '316001', 'Evento ambíguo', 'a316_fixture', '{}'::jsonb, '/alertas');`)
    const eventItem = psql(`SELECT i.id FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'portal_reprocessamento_falhou' AND a.entity_type = 'portal_email_event' AND a.entity_id = '316001' AND i.status = 'active';`)
    const resolved = asUser(`SELECT public.resolve_alert_item_with_justification(${eventItem}, 'Conferido no provedor: entregue')`)
    expect(resolved.error).toBe('')
    expect(psql(`SELECT status FROM public.alert_items WHERE id = ${eventItem};`)).toBe('resolved')
  })

  it('A23: a lista de tipos com justificativa é a mesma no banco e na tela', async () => {
    const { ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION } = await import('../services/alerts')
    expect(psql(`SELECT array_to_string(public._alert_types_resolved_with_justification(), ',');`))
      .toBe(ALERT_TYPES_RESOLVED_WITH_JUSTIFICATION.join(','))
  })
})
