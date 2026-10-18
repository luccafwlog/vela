import { execPsql, spawnPsql } from './localPsql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describeWithProbe, syntheticCnpj } from './localTestData'

// Migration 304 (plano dos e-mails, itens 1C, 2.6, 2.7 e 4.5): a escala dos
// Comunicados vem só do Histórico da Viagem, o CE e Taxas é por Cliente ×
// Viagem, B/L cancelado e Cliente desativado não viram alvo, o detector usa os
// alvos da produtora e o Cliente sem contato abre alerta.
// Reproduz o caso de produção: ETA só em audit_logs (data pura), snapshot sem
// o porto, escala reincluída (deleted = 'false') e B/L BRVIT numa escala BRVIX.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const CARRIER_ID = 99300001
const VESSEL_ID = 99300002
const VOYAGE_NOA = 99300003
const VOYAGE_CE = 99300004
const CUSTOMER_A = 99300011
const CUSTOMER_OFF = 99300012
const CUSTOMER_NOCONTACT = 99300013
const CONTACT_A = 99300021
const CONTACT_OFF = 99300022
const BL_A = 'B300-A'
const BL_A_CANCELLED = 'B300-A-CANC'
const BL_OFF = 'B300-OFF'
const BL_NOCONTACT = 'B300-NOCONTACT'
const BL_CE_SSZ = 'B300-CE-SSZ'
const BL_CE_VIX = 'B300-CE-VIX'
const ALL_BLS = [BL_A, BL_A_CANCELLED, BL_OFF, BL_NOCONTACT, BL_CE_SSZ, BL_CE_VIX].map((id) => `'${id}'`).join(', ')
const CUSTOMERS = [CUSTOMER_A, CUSTOMER_OFF, CUSTOMER_NOCONTACT].join(', ')
const NOA_CLAIM = `aviso_chegada_noa:${CUSTOMER_A}:${VOYAGE_NOA}:BRVIX`
const CE_CLAIM = `ce_mercante_taxas:${CUSTOMER_A}:${VOYAGE_CE}`

function psql(sql: string): string {
  return execPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryPsql(sql: string): { output: string; error: string } {
  const result = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; ${sql}`], { encoding: 'utf8' })
  return { output: (result.stdout ?? '').trim(), error: (result.stderr ?? '').trim() }
}

type Candidate = { claim_key: string; kind: string; customer_id: number; port: string; milestone_at: string; bl_ids: string[] }

function candidates(asOf = 'now()'): Candidate[] {
  return (JSON.parse(psql(`SELECT public.evaluate_and_dispatch_automatic_communications(${asOf});`)) as Candidate[])
    .filter((candidate) => [CUSTOMER_A, CUSTOMER_OFF, CUSTOMER_NOCONTACT].includes(candidate.customer_id))
}

function alertItem(type: string, entityType: string, entityId: string): { status: string; message: string } | null {
  const row = psql(`SELECT i.status || '|' || i.message FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
    WHERE i.item_type = '${type}' AND a.entity_type = '${entityType}' AND a.entity_id = '${entityId}' ORDER BY i.id DESC LIMIT 1;`)
  if (!row) return null
  const [status, ...message] = row.split('|')
  return { status: status!, message: message.join('|') }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    CREATE TEMP TABLE e300_alerts AS SELECT id FROM public.alerts
      WHERE (entity_type = 'customer' AND entity_id IN ('${CUSTOMER_A}', '${CUSTOMER_OFF}', '${CUSTOMER_NOCONTACT}'))
         OR (entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${VOYAGE_NOA}::%');
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT id FROM public.alert_items WHERE alert_id IN (SELECT id FROM e300_alerts));
    DELETE FROM public.internal_notifications WHERE alert_id IN (SELECT id FROM e300_alerts);
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM e300_alerts);
    DELETE FROM public.alerts WHERE id IN (SELECT id FROM e300_alerts);
    DELETE FROM public.customer_communication_automation_claims
      WHERE claim_key LIKE '%:${CUSTOMER_A}:%' OR claim_key LIKE '%:${CUSTOMER_OFF}:%' OR claim_key LIKE '%:${CUSTOMER_NOCONTACT}:%';
    DELETE FROM public.customer_communication_bls WHERE bl_id IN (${ALL_BLS});
    DELETE FROM public.customer_communications WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.customer_contact_box_links WHERE contact_id IN (${CONTACT_A}, ${CONTACT_OFF});
    DELETE FROM public.customer_contacts WHERE customer_id IN (${CUSTOMERS});
    DELETE FROM public.audit_logs WHERE entity_id IN (${ALL_BLS}) OR (entity_type = 'voyage_pod_schedule' AND entity_id LIKE '${VOYAGE_NOA}::%');
    DELETE FROM public.bls WHERE id IN (${ALL_BLS});
    DELETE FROM public.customers WHERE id IN (${CUSTOMERS});
    DELETE FROM public.voyages WHERE id IN (${VOYAGE_NOA}, ${VOYAGE_CE});
    DELETE FROM public.vessels WHERE id = ${VESSEL_ID};
    DELETE FROM public.carriers WHERE id = ${CARRIER_ID};
    SET session_replication_role = origin;
  `)
}

function migration304Applied(): boolean {
  if (!enabled) return false
  try {
    return psql(`SELECT count(*) FROM pg_proc WHERE proname = 'customer_communication_automation_targets';`) === '1'
  } catch {
    return false
  }
}

const describeLocal = describeWithProbe(migration304Applied, 'migration304Applied (escala única dos Comunicados)')

describeLocal('304 — escala única, CE por Viagem, filtros e alvos do detector', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.carriers (id, name) VALUES (${CARRIER_ID}, 'Armador E300');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${VESSEL_ID}, 'Navio E300', ${CARRIER_ID});
      -- Snapshot sem o porto, como em produção: a escala só existe no histórico.
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status, pod_schedule_snapshot) VALUES
        (${VOYAGE_NOA}, ${VESSEL_ID}, 'E300N', 'active', '{}'::jsonb),
        (${VOYAGE_CE}, ${VESSEL_ID}, 'E300C', 'active', '{}'::jsonb);
      INSERT INTO public.customers (id, name, cnpj_cpf, deactivated_at) VALUES
        (${CUSTOMER_A}, 'CLIENTE E300 A', '${syntheticCnpj(300011)}', NULL),
        (${CUSTOMER_OFF}, 'CLIENTE E300 DESATIVADO', '${syntheticCnpj(300012)}', now()),
        (${CUSTOMER_NOCONTACT}, 'CLIENTE E300 SEM CONTATO', '${syntheticCnpj(300013)}', NULL);
      INSERT INTO public.customer_contacts (id, customer_id, name, email, is_primary) VALUES
        (${CONTACT_A}, ${CUSTOMER_A}, 'Contato E300', 'docs-e300@example.test', true),
        (${CONTACT_OFF}, ${CUSTOMER_OFF}, 'Contato E300 off', 'off-e300@example.test', true);
      INSERT INTO public.customer_contact_box_links (contact_id, box_code) VALUES
        (${CONTACT_A}, 'documentacao_operacao'), (${CONTACT_OFF}, 'documentacao_operacao');
      INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, review_status, cancelled_at, ce_mercante) VALUES
        ('${BL_A}', ${VOYAGE_NOA}, ${CUSTOMER_A}, 'CNSHA', 'BRVIT', 'container', 'pending', 'calculated', 'ok', NULL, NULL),
        ('${BL_A_CANCELLED}', ${VOYAGE_NOA}, ${CUSTOMER_A}, 'CNSHA', 'BRVIT', 'container', 'pending', 'calculated', 'ok', now(), NULL),
        ('${BL_OFF}', ${VOYAGE_NOA}, ${CUSTOMER_OFF}, 'CNSHA', 'BRVIT', 'container', 'pending', 'calculated', 'ok', NULL, NULL),
        ('${BL_NOCONTACT}', ${VOYAGE_NOA}, ${CUSTOMER_NOCONTACT}, 'CNSHA', 'BRVIX', 'container', 'pending', 'calculated', 'ok', NULL, NULL),
        ('${BL_CE_SSZ}', ${VOYAGE_CE}, ${CUSTOMER_A}, 'CNSHA', 'BRSSZ', 'container', 'invoiced', 'calculated', 'ok', NULL, '261000000000001'),
        ('${BL_CE_VIX}', ${VOYAGE_CE}, ${CUSTOMER_A}, 'CNSHA', 'VITORIA', 'container', 'invoiced', 'calculated', 'ok', NULL, '261000000000002');
      -- ETA de data pura daqui a 2 dias; escala excluída e reincluída.
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_at) VALUES
        ('voyage_pod_schedule', '${VOYAGE_NOA}::BRVIX', 'eta', NULL, to_char(current_date + 2, 'YYYY-MM-DD'), now() - interval '3 hours'),
        ('voyage_pod_schedule', '${VOYAGE_NOA}::BRVIX', 'deleted', 'false', 'true', now() - interval '2 hours'),
        ('voyage_pod_schedule', '${VOYAGE_NOA}::BRVIX', 'deleted', 'true', 'false', now() - interval '1 hour');
      SET session_replication_role = origin;
    `)
  })
  afterAll(cleanup)

  it('4.5: data pura é lida no fuso de Brasília e a função é STABLE', () => {
    expect(psql(`SELECT public.customer_communication_safe_timestamptz('2026-10-18') = '2026-10-18 03:00:00+00'::timestamptz;`)).toBe('t')
    expect(psql(`SELECT public.customer_communication_safe_timestamptz('2026-10-18T09:30') = '2026-10-18 12:30:00+00'::timestamptz;`)).toBe('t')
    expect(psql(`SELECT public.customer_communication_safe_timestamptz('2026-10-18T09:30:00-03:00') = '2026-10-18 12:30:00+00'::timestamptz;`)).toBe('t')
    expect(psql(`SELECT public.customer_communication_safe_timestamptz('lixo') IS NULL;`)).toBe('t')
    expect(psql(`SELECT provolatile FROM pg_proc WHERE proname = 'customer_communication_safe_timestamptz';`)).toBe('s')
    expect(psql(`SELECT public.customer_communication_milestone_label('2026-10-18');`)).toBe('18/10/2026')
    expect(psql(`SELECT public.customer_communication_milestone_label('2026-10-18T12:30:00Z');`)).toBe('18/10/2026 09:30')
  })

  it('1C.1: escala lida do histórico, com porto normalizado e deleted = false', () => {
    expect(psql(`SELECT port || '|' || eta_text || '|' || deleted FROM public.customer_communication_scale_schedules(${VOYAGE_NOA}, 'BRVIT');`))
      .toBe(`BRVIX|${psql(`SELECT to_char(current_date + 2, 'YYYY-MM-DD');`)}|false`)
    const validation = JSON.parse(psql(`SELECT public.customer_communication_anchor_validation(${CUSTOMER_A}, 'aviso_chegada_noa', ${VOYAGE_NOA}, 'BRVIX', NULL, ARRAY['${BL_A}']);`)) as { ok: boolean; milestone_at: string }
    expect(validation).toMatchObject({ ok: true, milestone_at: psql(`SELECT to_char(current_date + 2, 'YYYY-MM-DD');`) })
  })

  it('1C/2.7: a produtora gera o NOA do Cliente com ETA só no histórico; cancelado, desativado e sem contato ficam fora', () => {
    const noa = candidates().filter((candidate) => candidate.kind === 'aviso_chegada_noa')
    expect(noa).toEqual([expect.objectContaining({ claim_key: NOA_CLAIM, customer_id: CUSTOMER_A, port: 'BRVIX', bl_ids: [BL_A] })])
    expect(noa[0]!.milestone_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // 2.7: o Cliente sem contato abre o alerta, que cita o NOA.
    const unreachable = alertItem('nob_sem_destinatario', 'customer', String(CUSTOMER_NOCONTACT))
    expect(unreachable).toMatchObject({ status: 'active' })
    expect(unreachable!.message).toContain('NOA da viagem E300N (BRVIX)')
    // 314: o metadata leva o CNPJ, para "Abrir Cliente" abrir a ficha do Cliente.
    expect(psql(`SELECT (i.metadata ->> 'customer_cnpj') = (SELECT c.cnpj_cpf FROM public.customers c WHERE c.id = ${CUSTOMER_NOCONTACT})
      FROM public.alert_items i JOIN public.alerts a ON a.id = i.alert_id
      WHERE i.item_type = 'nob_sem_destinatario' AND a.entity_type = 'customer' AND a.entity_id = '${CUSTOMER_NOCONTACT}'
      ORDER BY i.id DESC LIMIT 1;`)).toBe('t')
    // Cliente desativado não vira alvo nem alerta.
    expect(alertItem('nob_sem_destinatario', 'customer', String(CUSTOMER_OFF))).toBeNull()
  })

  it('1C: a RPC aceita o NOA com B/L BRVIT na escala BRVIX e recusa B/L cancelado', () => {
    const created = tryPsql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_A}, 'aviso_chegada_noa', 'avisos_operacionais',
      ${VOYAGE_NOA}, 'BRVIX', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_A}']::text[]);`)
    expect(created.error).toBe('')
    expect(Number(created.output)).toBeGreaterThan(0)
    expect(tryPsql(`BEGIN; SELECT public.create_customer_communication_atomic(${CUSTOMER_A}, 'aviso_chegada_noa', 'avisos_operacionais',
      ${VOYAGE_NOA}, 'BRVIX', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_A_CANCELLED}']::text[]); ROLLBACK;`).error)
      .toMatch(/B\/L cancelado não recebe Comunicado/)
  })

  it('2.6: o detector lista os Clientes pendentes, o simulado fecha a parte dele e a escala sem alvo fecha o item', () => {
    const entity = `${VOYAGE_NOA}::BRVIX`
    psql(`UPDATE public.customer_communications SET status = 'pendente' WHERE customer_id = ${CUSTOMER_A} AND kind = 'aviso_chegada_noa';`)
    psql(`SELECT public.detect_customer_communication_alerts();`)
    let item = alertItem('comunicado_noa_pendente', 'voyage_pod_schedule', entity)
    expect(item?.status).toBe('active')
    expect(item!.message).toContain('CLIENTE E300 A')
    expect(item!.message).toContain('CLIENTE E300 SEM CONTATO')
    expect(item!.message).not.toContain('DESATIVADO')
    // Data pura: o alerta mostra só a data.
    expect(item!.message).toMatch(/\(ETA \d{2}\/\d{2}\/\d{4}\)/)

    psql(`UPDATE public.customer_communications SET status = 'simulado' WHERE customer_id = ${CUSTOMER_A} AND kind = 'aviso_chegada_noa';`)
    psql(`SELECT public.detect_customer_communication_alerts();`)
    item = alertItem('comunicado_noa_pendente', 'voyage_pod_schedule', entity)
    expect(item!.message).not.toContain('CLIENTE E300 A')
    expect(candidates().some((candidate) => candidate.claim_key === NOA_CLAIM)).toBe(false)

    psql(`SET session_replication_role = replica; UPDATE public.bls SET cancelled_at = now() WHERE id = '${BL_NOCONTACT}'; SET session_replication_role = origin;`)
    psql(`SELECT public.detect_customer_communication_alerts();`)
    expect(alertItem('comunicado_noa_pendente', 'voyage_pod_schedule', entity)?.status).toBe('resolved')
    psql(`SET session_replication_role = replica; UPDATE public.bls SET cancelled_at = NULL WHERE id = '${BL_NOCONTACT}'; SET session_replication_role = origin;`)
  })

  it('2.7: o alerta de Cliente sem destinatário fecha quando a janela vence', () => {
    candidates()
    expect(alertItem('nob_sem_destinatario', 'customer', String(CUSTOMER_NOCONTACT))?.status).toBe('active')
    candidates(`now() + interval '5 days'`)
    expect(alertItem('nob_sem_destinatario', 'customer', String(CUSTOMER_NOCONTACT))?.status).toBe('resolved')
  })

  it('1C.2: CE e Taxas com B/Ls em dois PODs é registrado por Viagem e não volta como candidato', () => {
    // As rodadas anteriores já pegaram a claim; liberada, o CE volta a ser candidato.
    psql(`UPDATE public.customer_communication_automation_claims SET released_at = now() WHERE claim_key = '${CE_CLAIM}';`)
    const ce = candidates().filter((candidate) => candidate.kind === 'ce_mercante_taxas')
    expect(ce).toEqual([expect.objectContaining({ claim_key: CE_CLAIM, port: 'BRSSZ / BRVIX', bl_ids: [BL_CE_SSZ, BL_CE_VIX] })])
    expect((JSON.parse(psql(`SELECT public.customer_local_charges_communication_payload(${VOYAGE_CE}, ${CUSTOMER_A});`)) as { port: string }).port)
      .toBe('BRSSZ / BRVIX')

    // A tela manda o porto nulo; a runner manda o da produtora: mesmo registro.
    const manual = tryPsql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_A}, 'ce_mercante_taxas', 'documentacao',
      ${VOYAGE_CE}, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_CE_SSZ}', '${BL_CE_VIX}']::text[]);`)
    expect(manual.error).toBe('')
    const automatic = tryPsql(`SELECT public.create_customer_communication_atomic(${CUSTOMER_A}, 'ce_mercante_taxas', 'documentacao',
      ${VOYAGE_CE}, 'BRSSZ', NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, ARRAY['${BL_CE_SSZ}', '${BL_CE_VIX}']::text[]);`)
    expect(automatic.output).toBe(manual.output)
    expect(psql(`SELECT anchor_port FROM public.customer_communications WHERE id = ${manual.output};`)).toBe('BRSSZ / BRVIX')

    psql(`UPDATE public.customer_communications SET status = 'simulado' WHERE id = ${manual.output};`)
    psql(`UPDATE public.customer_communication_automation_claims SET released_at = now() WHERE claim_key = '${CE_CLAIM}';`)
    expect(candidates().some((candidate) => candidate.claim_key === CE_CLAIM)).toBe(false)
  })
})
