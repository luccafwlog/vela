import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
const effectActionId = '00000000-0000-0000-0000-000000051191'
const duplicateEffectActionId = '00000000-0000-0000-0000-000000051192'
const postInvoiceEffectActionId = '00000000-0000-0000-0000-000000051193'

function psql(sql: string, role: 'service_role' | 'authenticated' = 'service_role'): string {
  return execFileSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`,
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
    WHERE source_action_id = '${effectActionId}'::uuid OR entity_id = '${blId}';
    DELETE FROM public.ledger_settlements
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = '${blId}');
    DELETE FROM public.invoice_receivable_links WHERE bl_id = '${blId}';
    DELETE FROM public.invoice_lifecycle_events
    WHERE invoice_id IN (SELECT id FROM public.invoices WHERE bl_id = '${blId}');
    DELETE FROM public.invoice_bls WHERE bl_id = '${blId}';
    DELETE FROM public.invoice_items WHERE bl_id = '${blId}';
    DELETE FROM public.bl_receivables WHERE bl_id = '${blId}';
    DELETE FROM public.invoices WHERE bl_id = '${blId}';
    DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
    DELETE FROM public.bl_containers WHERE bl_id = '${blId}';
    DELETE FROM public.bls WHERE id = '${blId}';
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
      VALUES (${customerId}, '04252011000110', 'Cliente CE Auto 051');
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
      ) VALUES (
        '${blId}', ${voyageId}, ${customerId}, 'CEAUTO', 'container',
        'pending', 'not_calculated', 'reconciled', NULL
      );
      INSERT INTO public.bl_containers (bl_id, container_number)
      VALUES ('${blId}', 'MSCU1234567');
    `)
  })

  afterAll(cleanup)

  it('calcula, emite e cria o recebível sem conta pronta do Portal', () => {
    const result = JSON.parse(psql(`
      UPDATE public.bls
      SET ce_mercante = '123456789012345'
      WHERE id = '${blId}';
      SELECT jsonb_build_object(
        'financial_status', (SELECT financial_status FROM public.bls WHERE id = '${blId}'),
        'charge_status', (SELECT charge_status FROM public.bls WHERE id = '${blId}'),
        'invoice_count', (SELECT count(*) FROM public.invoices WHERE bl_id = '${blId}'),
        'item_count', (SELECT count(*) FROM public.invoice_items WHERE bl_id = '${blId}'),
        'receivable_count', (SELECT count(*) FROM public.bl_receivables WHERE bl_id = '${blId}'),
        'portal_account_ready_count', (SELECT count(*) FROM public.customer_portal_accounts
          WHERE customer_id = ${customerId}
            AND active = true
            AND account_situation = 'ativo'
            AND auth_user_id IS NOT NULL)
      );
    `, 'authenticated')) as {
      financial_status: string
      charge_status: string
      invoice_count: number
      item_count: number
      receivable_count: number
      portal_account_ready_count: number
    }

    expect(result).toMatchObject({
      financial_status: 'invoiced',
      charge_status: 'ready_for_billing',
      invoice_count: 1,
      item_count: 1,
      receivable_count: 1,
      portal_account_ready_count: 0,
    })
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
