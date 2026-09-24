import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migration 083 (ADR 0070): o Portal trava toda emissão, inclusive a
// automática pelo CE. A saída é ativar o Portal ou o Administrativo conceder a
// Liberação de faturamento sem Portal; as duas emitem o que ficou retido.
// Migration 085: o e-mail de contato não é condição de nada disso, e a fatura
// retida sai com as taxas do dia do CE.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const adminId = '00000000-0000-0000-0000-000000083101'
const docId = '00000000-0000-0000-0000-000000083102'
const portalUserId = '00000000-0000-0000-0000-000000083103'
const customerId = 995831
const carrierId = 995832
const vesselId = 995833
const voyageId = 995834
const chargeTableId = 995835
const chargeItemId = 995836
const heldBlId = 'PORTAL-083-1'
const secondBlId = 'PORTAL-083-2'
const activationBlId = 'PORTAL-083-3'
const allBlIds = [heldBlId, secondBlId, activationBlId]
const blList = `ARRAY['${allBlIds.join("','")}']::text[]`
const customerCnpj = syntheticCnpj(83101)
const HOLD = 'Acesso ao portal nao provisionado'

function psql(sql: string, role: 'service_role' | 'authenticated' = 'service_role', sub = adminId): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${sub}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

// Executa como o papel `authenticated` real do banco: RLS e grants valem.
function asUser(sql: string, sub: string): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${sub}'; ${sql}`,
  ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function sqlError(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error)
  }
  return ''
}

function setCe(blId: string, ce: string): void {
  asUser(`SELECT public.apply_ce_mercante_update('${blId}', '${ce}', '${adminId}'::uuid);`, adminId)
}

function blState(blId: string) {
  return JSON.parse(psql(`
    SELECT jsonb_build_object(
      'financial_status', financial_status,
      'billing_hold_reason', billing_hold_reason,
      'invoice_count', (SELECT count(*) FROM public.invoices WHERE bl_id = '${blId}'),
      'active_effects', (SELECT count(*) FROM public.import_pending_effects
        WHERE entity_id = '${blId}' AND effect_kind = 'local_billing'
          AND status IN ('pending', 'running', 'retry_wait', 'blocked'))
    ) FROM public.bls WHERE id = '${blId}';
  `)) as { financial_status: string; billing_hold_reason: string | null; invoice_count: number; active_effects: number }
}

function invoiceTotal(blId: string): string {
  return psql(`SELECT total_brl FROM public.invoices WHERE bl_id = '${blId}';`)
}

function setPrice(value: number): void {
  psql(`UPDATE public.charge_table_items SET value_brl = ${value}, unit_value_brl = ${value} WHERE id = ${chargeItemId};`)
}

function portalAlert(): string {
  return psql(`
    SELECT COALESCE(string_agg(ai.status || '/' || ai.department, ','), '')
    FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id
    WHERE ai.item_type = 'review_portal_not_ready' AND a.entity_type = 'customer'
      AND a.entity_id = '${customerId}';
  `)
}

function cleanup(): void {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_item_events WHERE alert_item_id IN (SELECT i.id FROM public.alert_items i
      JOIN public.alerts a ON a.id = i.alert_id WHERE a.entity_id IN ('${customerId}', '${heldBlId}', '${secondBlId}', '${activationBlId}'));
    DELETE FROM public.alert_items WHERE alert_id IN (SELECT id FROM public.alerts
      WHERE entity_id IN ('${customerId}', '${heldBlId}', '${secondBlId}', '${activationBlId}'));
    DELETE FROM public.alerts WHERE entity_id IN ('${customerId}', '${heldBlId}', '${secondBlId}', '${activationBlId}');
    DELETE FROM public.import_effect_attempts WHERE effect_id IN (SELECT id FROM public.import_pending_effects WHERE entity_id = ANY(${blList}));
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${blList});
    DELETE FROM public.ledger_settlements WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = ANY(${blList}));
    DELETE FROM public.invoice_receivable_links WHERE bl_id = ANY(${blList});
    DELETE FROM public.invoice_lifecycle_events WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = ANY(${blList}));
    DELETE FROM public.invoice_bls WHERE bl_id = ANY(${blList});
    DELETE FROM public.invoice_items WHERE bl_id = ANY(${blList});
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${blList});
    DELETE FROM public.invoices WHERE bl_id = ANY(${blList});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${blList});
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${blList});
    DELETE FROM public.bls WHERE id = ANY(${blList});
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${customerId};
    DELETE FROM public.customer_contacts WHERE customer_id = ${customerId};
    DELETE FROM public.customer_portal_accounts WHERE customer_id = ${customerId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.audit_logs WHERE changed_by IN ('${adminId}', '${docId}');
    DELETE FROM public.user_profiles WHERE id IN ('${adminId}', '${docId}');
    DELETE FROM auth.users WHERE id IN ('${adminId}', '${docId}', '${portalUserId}');
    SET session_replication_role = origin;
  `)
}

describeLocal('Portal como trava universal e Liberação de faturamento sem Portal (083)', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'adm-083@example.test'),
        ('${docId}', 'doc-083@example.test'),
        ('${portalUserId}', 'portal-083@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES
        ('${adminId}', 'Administrativo 083', 'administrativo', true),
        ('${docId}', 'Documentação 083', 'documentacao', true);
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${customerId}, '${customerCnpj}', 'Cliente Portal 083');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 083');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 083', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'PORTAL-083', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela 083', 'PTL083', CURRENT_DATE, true, 'container');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (${chargeItemId}, ${chargeTableId}, 'Taxa 083', 'bl', 90, 90, 'bl', 'base', 'any', 'BRL');
      INSERT INTO public.bls (
        id, voyage_id, customer_id, pod, cargo_mode, financial_status,
        charge_status, customer_reconciliation_status, ce_mercante
      ) VALUES
        ('${heldBlId}', ${voyageId}, ${customerId}, 'PTL083', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
        ('${secondBlId}', ${voyageId}, ${customerId}, 'PTL083', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
        ('${activationBlId}', ${voyageId}, ${customerId}, 'PTL083', 'container', 'pending', 'not_calculated', 'reconciled', NULL);
      INSERT INTO public.bl_containers (bl_id, container_number) VALUES
        ('${heldBlId}', 'PTLU0830001'), ('${secondBlId}', 'PTLU0830002'), ('${activationBlId}', 'PTLU0830003');
    `)
  })

  afterAll(cleanup)

  it('retém a fatura do CE sem Portal, sem acionar a fila, e avisa a Documentação e o Administrativo', () => {
    setCe(heldBlId, '083000000000001')

    expect(blState(heldBlId)).toMatchObject({
      financial_status: 'pending',
      billing_hold_reason: HOLD,
      invoice_count: 0,
    })
    // `apply_ce_mercante_update` ainda registra o efeito legado de cálculo.
    // Processado, ele termina como sucesso retido, não como bloqueio da fila.
    const effectId = Number(psql(`SELECT id FROM public.import_pending_effects
      WHERE entity_id = '${heldBlId}' AND effect_kind = 'local_billing' AND status = 'pending' ORDER BY id DESC LIMIT 1;`))
    expect(effectId).toBeGreaterThan(0)
    psql(`SET import_effects.entity_prefix = '${heldBlId}'; SELECT public.claim_import_effects('portal-083-worker', 10, 300);`)
    const processed = JSON.parse(psql(`SELECT public.process_import_effect(${effectId}, 'portal-083-worker');`)) as {
      effect: { status: string; result: { results: Array<{ status: string; reason: string }> } }
    }
    expect(processed.effect.status).toBe('succeeded')
    expect(processed.effect.result.results[0]).toMatchObject({ status: 'held', reason: 'portal_not_provisioned' })
    expect(blState(heldBlId)).toMatchObject({ billing_hold_reason: HOLD, invoice_count: 0, active_effects: 0 })
    expect(Number(psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${heldBlId}';`))).toBeGreaterThan(0)
    expect(portalAlert()).toBe('active/documentacao')
    expect(psql(`SELECT audience_departments::text FROM public.alert_type_catalog WHERE type = 'review_portal_not_ready';`))
      .toBe('{documentacao,administrativo}')
  })

  it('não deixa a Documentação conceder nem aceita liberação sem justificativa ou com data passada', () => {
    expect(sqlError(() => asUser(`SELECT public.grant_customer_billing_portal_release(${customerId}, 'Cliente sem e-mail', now() + interval '7 days');`, docId)))
      .toContain('Somente o Administrativo')
    expect(sqlError(() => asUser(`SELECT public.grant_customer_billing_portal_release(${customerId}, '  ', now() + interval '7 days');`, adminId)))
      .toContain('Justificativa')
    expect(sqlError(() => asUser(`SELECT public.grant_customer_billing_portal_release(${customerId}, 'Cliente sem e-mail', now() - interval '1 day');`, adminId)))
      .toContain('data de revisão')
    expect(sqlError(() => asUser(`INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customerId}, 'direto', '${adminId}', now() + interval '1 day');`, adminId))).toContain('permission denied')
    expect(blState(heldBlId).invoice_count).toBe(0)
  })

  it('não concede com revisão além de 30 dias', () => {
    expect(sqlError(() => asUser(`SELECT public.grant_customer_billing_portal_release(${customerId}, 'Prazo longo', now() + interval '45 days');`, adminId)))
      .toContain('no máximo 30 dias')
    expect(blState(heldBlId).invoice_count).toBe(0)
  })

  it('conceder a Liberação, mesmo sem contato com e-mail, emite a retida com a taxa do dia do CE', () => {
    // 085: a fatura não é enviada por e-mail; o Cliente não tem nenhum contato.
    expect(psql(`SELECT count(*) FROM public.customer_contacts WHERE customer_id = ${customerId};`)).toBe('0')
    // A tabela mudou depois do CE: a retida continua com o valor do dia do CE.
    setPrice(120)
    const result = JSON.parse(asUser(
      `SELECT public.grant_customer_billing_portal_release(${customerId}, 'Cliente sem e-mail até o fim do mês', now() + interval '7 days');`,
      adminId,
    )) as { release_id: number; reprocess: { issued: number; gate_open: boolean } }

    expect(result.reprocess).toMatchObject({ gate_open: true, issued: 1 })
    expect(blState(heldBlId)).toMatchObject({ financial_status: 'invoiced', billing_hold_reason: null, invoice_count: 1 })
    expect(invoiceTotal(heldBlId)).toBe('90.00')
    expect(portalAlert()).toBe('resolved/documentacao')
    expect(asUser(`SELECT granted_by || '|' || justification FROM public.customer_billing_portal_releases WHERE id = ${result.release_id};`, docId))
      .toBe(`${adminId}|Cliente sem e-mail até o fim do mês`)
  })

  it('com a Liberação vigente, o CE seguinte emite direto, com a tabela do dia', () => {
    setCe(secondBlId, '083000000000002')
    expect(blState(secondBlId)).toMatchObject({ financial_status: 'invoiced', invoice_count: 1 })
    expect(invoiceTotal(secondBlId)).toBe('120.00')
  })

  it('revogada ou vencida, a trava volta e o Alerta reaparece na retenção seguinte', () => {
    asUser(`SELECT public.revoke_customer_billing_portal_release(${customerId}, 'Cliente regularizou o cadastro');`, adminId)
    expect(psql(`SELECT public.customer_billing_access_ready(${customerId});`)).toBe('f')

    // Vencimento: uma liberação nova cuja data de revisão já passou.
    psql(`INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, granted_at, review_at)
      VALUES (${customerId}, 'Liberação vencida', '${adminId}', now() - interval '10 days', now() - interval '1 day');`)
    expect(psql(`SELECT public.customer_billing_access_ready(${customerId});`)).toBe('f')

    setCe(activationBlId, '083000000000003')
    expect(blState(activationBlId)).toMatchObject({ financial_status: 'pending', billing_hold_reason: HOLD, invoice_count: 0 })
    expect(portalAlert()).toBe('active/documentacao')
  })

  it('a Liberação vale sem nenhum contato com e-mail', () => {
    // Inserida direto (sem a RPC) para não reprocessar o B/L retido que o
    // teste seguinte, de ativação do Portal, precisa encontrar.
    psql(`UPDATE public.customer_billing_portal_releases SET revoked_at = now(), revoked_by = '${adminId}',
      revoke_reason = 'Troca no teste' WHERE customer_id = ${customerId} AND revoked_at IS NULL;
      INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
      VALUES (${customerId}, 'Nova liberação', '${adminId}', now() + interval '3 days');`)
    expect(psql(`SELECT count(*) FROM public.customer_contacts WHERE customer_id = ${customerId} AND deactivated_at IS NULL;`)).toBe('0')
    expect(psql(`SELECT public.customer_billing_access_ready(${customerId});`)).toBe('t')
  })

  it('ativar o Portal reprocessa o Cliente e emite o que ficou retido, com a taxa do dia do CE', () => {
    setPrice(150)
    psql(`UPDATE public.customer_billing_portal_releases SET revoked_at = now(), revoked_by = '${adminId}',
      revoke_reason = 'Encerrada no teste' WHERE customer_id = ${customerId} AND revoked_at IS NULL;`)
    psql(`UPDATE public.customer_portal_accounts SET auth_user_id = '${portalUserId}', active = true,
      account_situation = 'ativo', recovery_email = 'portal-083-rec@example.test', recovery_email_status = 'ok'
      WHERE customer_id = ${customerId};`)

    const result = JSON.parse(psql(`SELECT public.reprocess_customer_billing_after_portal_activation(${customerId});`)) as {
      issued: number
    }

    expect(result.issued).toBe(1)
    expect(blState(activationBlId)).toMatchObject({ financial_status: 'invoiced', billing_hold_reason: null, invoice_count: 1 })
    expect(invoiceTotal(activationBlId)).toBe('120.00')
    expect(portalAlert()).toBe('resolved/documentacao')
  })

  // 085: e-mail de contato não é pendência em nenhum caso, com ou sem Portal.
  it('a falta de e-mail de contato não é pendência, com ou sem Portal', () => {
    expect(psql(`SELECT array_to_string(public.compute_bl_review_pendencies(${customerId}, 'container', NULL::numeric), ',');`)).toBe('')
    psql(`UPDATE public.customer_portal_accounts SET account_situation = 'suspenso' WHERE customer_id = ${customerId};`)
    expect(psql(`SELECT array_to_string(public.compute_bl_review_pendencies(${customerId}, 'container', NULL::numeric), ',');`))
      .toBe('Acesso ao portal nao provisionado')
    expect(psql(`SELECT active FROM public.alert_type_catalog WHERE type = 'review_customer_email_missing';`)).toBe('f')
  })
})
