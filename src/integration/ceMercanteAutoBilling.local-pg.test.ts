import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000051101'
const customerId = 995111
const carrierId = 995112
const vesselId = 995113
const voyageId = 995114
const chargeTableId = 995115
const chargeItemId = 995116
const blId = 'CE-AUTO-051-1'
const peerBlId = 'CE-AUTO-051-2'
const blockedBlId = 'CE-AUTO-051-3'
const workerOriginBlId = 'CE-AUTO-051-4'
const workerPeerBlId = 'CE-AUTO-051-5'
const effectActionId = '00000000-0000-0000-0000-000000051191'
const duplicateEffectActionId = '00000000-0000-0000-0000-000000051192'
const postInvoiceEffectActionId = '00000000-0000-0000-0000-000000051193'
const customerCnpj = syntheticCnpj(51101)
const allBlIds = [blId, peerBlId, blockedBlId, workerOriginBlId, workerPeerBlId]

function psql(
  sql: string,
  role: 'service_role' | 'authenticated' = 'service_role',
  jwtSub = actorId,
): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${jwtSub}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function psqlAsDatabaseRole(
  sql: string,
  databaseRole: 'authenticated' | 'service_role' = 'authenticated',
  jwtRole: 'authenticated' | 'service_role' = databaseRole,
  jwtSub = actorId,
): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET ROLE ${databaseRole}; SET request.jwt.claim.role = '${jwtRole}'; SET request.jwt.claim.sub = '${jwtSub}'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

function cleanup(): void {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.import_effect_attempts
    WHERE effect_id IN (SELECT id FROM public.import_pending_effects
      WHERE source_action_id IN ('${effectActionId}'::uuid, '${duplicateEffectActionId}'::uuid)
         OR entity_id = '${blId}');
    DELETE FROM public.import_pending_effects
    WHERE source_action_id IN ('${effectActionId}'::uuid, '${duplicateEffectActionId}'::uuid)
       OR entity_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.ledger_settlements
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]));
    DELETE FROM public.invoice_receivable_links WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.invoice_lifecycle_events
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]));
    DELETE FROM public.invoice_bls WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.invoice_items WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.invoices WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.bl_containers WHERE bl_id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.bls WHERE id = ANY(ARRAY['${allBlIds.join("','")}']::text[]);
    DELETE FROM public.charge_table_items WHERE id = ${chargeItemId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('CE Mercante — faturamento automático server-side', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email)
      VALUES ('${actorId}', 'ce-auto-051@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active)
      VALUES ('${actorId}', 'CE Auto 051', 'admin', true);
      INSERT INTO public.customers (id, cnpj_cpf, name)
      VALUES (${customerId}, '${customerCnpj}', 'Cliente CE Auto 051');
      INSERT INTO public.carriers (id, name)
      VALUES (${carrierId}, 'Carrier CE Auto 051');
      INSERT INTO public.vessels (id, name, carrier_id)
      VALUES (${vesselId}, 'Vessel CE Auto 051', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status)
      VALUES (${voyageId}, ${vesselId}, 'CE-AUTO-051', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela CE Auto 051', 'CEAUTO', CURRENT_DATE, true, 'container');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency
      ) VALUES (
        ${chargeItemId}, ${chargeTableId}, 'Taxa CE Auto 051', 'bl', 125,
        125, 'bl', 'base', 'any', 'BRL'
      );
      INSERT INTO public.bls (
        id, voyage_id, customer_id, pod, cargo_mode, financial_status,
        charge_status, customer_reconciliation_status, ce_mercante
      ) VALUES
        ('${blId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
          'pending', 'not_calculated', 'reconciled', NULL),
        ('${peerBlId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
          'pending', 'not_calculated', 'reconciled', '123456789012346'),
        ('${blockedBlId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
          'pending', 'not_calculated', 'missing_customer', '123456789012347'),
        ('${workerOriginBlId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
          'pending', 'not_calculated', 'reconciled', '123456789012348'),
        ('${workerPeerBlId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
          'pending', 'not_calculated', 'reconciled', '123456789012349');
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES
        ('${blId}', 'MSCU1234567'),
        ('${peerBlId}', 'MSCU1234567'),
        ('${blockedBlId}', 'MSCU1234568'),
        ('${workerOriginBlId}', 'MSCU1234569'),
        ('${workerPeerBlId}', 'MSCU1234569');
    `)
  })

  afterAll(cleanup)

  it('calcula, emite e cria o recebível sem conta pronta do Portal', () => {
    psqlAsDatabaseRole(`
      DO $$
      BEGIN
        PERFORM public.apply_ce_mercante_update(
          '${blId}', '123456789012345', '${actorId}'::uuid
        );
      END
      $$;
    `, 'authenticated', 'authenticated', actorId)

    const result = JSON.parse(psql(`
      SELECT jsonb_build_object(
        'financial_status', (SELECT financial_status FROM public.bls WHERE id = '${blId}'),
        'charge_status', (SELECT charge_status FROM public.bls WHERE id = '${blId}'),
        'invoice_count', (SELECT count(*) FROM public.invoices WHERE bl_id = '${blId}'),
        'item_count', (SELECT count(*) FROM public.invoice_items WHERE bl_id = '${blId}'),
        'receivable_count', (SELECT count(*) FROM public.bl_receivables WHERE bl_id = '${blId}'),
        'active_local_billing_effect_count', (SELECT count(*) FROM public.import_pending_effects
          WHERE entity_id = '${blId}'
            AND effect_kind = 'local_billing'
            AND status IN ('pending', 'running', 'retry_wait')),
        'portal_account_ready_count', (SELECT count(*) FROM public.customer_portal_accounts
          WHERE customer_id = ${customerId}
            AND active = true
            AND account_situation = 'ativo'
            AND auth_user_id IS NOT NULL),
        'peer_invoice_count', (SELECT count(*) FROM public.invoices WHERE bl_id = '${peerBlId}')
      );
    `)) as {
      financial_status: string
      charge_status: string
      invoice_count: number
      item_count: number
      receivable_count: number
      active_local_billing_effect_count: number
      portal_account_ready_count: number
      peer_invoice_count: number
    }

    expect(result).toMatchObject({
      financial_status: 'invoiced',
      charge_status: 'ready_for_billing',
      invoice_count: 1,
      item_count: 1,
      receivable_count: 1,
      active_local_billing_effect_count: 0,
      portal_account_ready_count: 0,
      peer_invoice_count: 0,
    })
  })

  it('fatura apenas o B/L de origem quando o worker encontra outro B/L com CE no mesmo container', () => {
    const workerPayload = JSON.parse(psql(`
      SELECT public._run_import_effect_local_charges('${workerOriginBlId}', '${actorId}'::uuid);
    `)) as {
      results: Array<{ bl_id: string; status: string; reason?: string }>
    }

    expect(workerPayload.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ bl_id: workerOriginBlId, status: 'invoiced' }),
    ]))
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${workerOriginBlId}';`)).toBe('1')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${workerPeerBlId}';`)).toBe('0')
    expect(Number(psql(`SELECT count(*) FROM public.charge_calculations WHERE bl_id = '${workerPeerBlId}';`))).toBeGreaterThan(0)
  })

  it('preserva bloqueio de reconciliação como resultado recuperável do worker', () => {
    const blockedPayload = JSON.parse(psql(`
      SELECT public._run_import_effect_local_charges('${blockedBlId}', '${actorId}'::uuid);
    `)) as {
      results: Array<{ bl_id: string; status: string; reason?: string }>
    }

    expect(blockedPayload.results).toEqual([
      expect.objectContaining({
        bl_id: blockedBlId,
        status: 'blocked',
        reason: 'customer_reconciliation_pending',
      }),
    ])
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${blockedBlId}';`)).toBe('0')
  })

  it('enfileira a recuperação quando o service role não traz auth.uid()', () => {
    psql(`
      UPDATE public.bls
      SET customer_reconciliation_status = 'reconciled'
      WHERE id = '${blockedBlId}';
    `, 'service_role', '')

    expect(psql(`
      SELECT count(*)
      FROM public.import_pending_effects
      WHERE entity_id = '${blockedBlId}'
        AND effect_kind = 'local_billing'
        AND created_by = '00000000-0000-0000-0000-000000000000'::uuid;
    `)).toBe('1')
  })

  it('mantém a emissão automática inacessível ao papel authenticated real', () => {
    expect(() => psqlAsDatabaseRole(`
      SELECT public.auto_bill_bl_after_ce_mercante('${blId}', '${actorId}'::uuid);
    `)).toThrow()
    expect(psql(`SELECT has_function_privilege('authenticated', 'public.auto_bill_bl_after_ce_mercante(text,uuid)', 'EXECUTE');`)).toBe('f')
  })

  it('processa efeito atrasado como no-op depois da emissão imediata', () => {
    const effectId = Number(psql(`
      INSERT INTO public.import_pending_effects(
        source_action_id, effect_kind, entity_id, created_by, source_snapshot
      )
      VALUES (
        '${effectActionId}'::uuid, 'local_billing', '${blId}', '${actorId}'::uuid,
        jsonb_build_object('source', 'ce_mercante_auto_billing')
      )
      RETURNING id;
    `))
    const duplicateEffectId = Number(psql(`
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (
        '${duplicateEffectActionId}'::uuid, 'local_billing', '${blId}', '${actorId}'::uuid
      )
      RETURNING id;
    `))

    expect(psql(`SELECT status FROM public.import_pending_effects WHERE id = ${duplicateEffectId};`)).toBe('superseded')
    expect(psql(`SELECT superseded_by_effect_id FROM public.import_pending_effects WHERE id = ${duplicateEffectId};`)).toBe(String(effectId))

    psql(`
      SET import_effects.entity_prefix = '${blId}';
      SELECT public.claim_import_effects('ce-auto-051-worker', 10, 300);
    `)
    const processed = JSON.parse(psql(`
      SELECT public.process_import_effect(${effectId}, 'ce-auto-051-worker');
    `)) as { effect: { status: string; result: { results: Array<{ status: string; idempotent: boolean }> } } }

    expect(processed.effect.status).toBe('succeeded')
    expect(processed.effect.result.results[0]).toMatchObject({ status: 'already_invoiced', idempotent: true })

    const postInvoiceEffectId = Number(psql(`
      INSERT INTO public.import_pending_effects(source_action_id, effect_kind, entity_id, created_by)
      VALUES (
        '${postInvoiceEffectActionId}'::uuid, 'local_billing', '${blId}', '${actorId}'::uuid
      )
      RETURNING id;
    `))
    expect(psql(`SELECT status FROM public.import_pending_effects WHERE id = ${postInvoiceEffectId};`)).toBe('superseded')
    expect(psql(`SELECT result->>'already_invoiced' FROM public.import_pending_effects WHERE id = ${postInvoiceEffectId};`)).toBe('true')
    expect(psql(`SELECT count(*) FROM public.invoices WHERE bl_id = '${blId}';`)).toBe('1')
  })
})
