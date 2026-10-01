import { execFileSync, spawnSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Migration 121: SOC/COC. O B/L é soberano, o Baplie preenche o que o B/L não
// declarou, item com applies_to_soc = false não conta container SOC e
// container SOC não entra em fatura de Demurrage.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000120001'
const blId = 'SOC120-BL'
const carrierId = 1200011
const vesselId = 1200012
const voyageId = 1200013
const chargeTableId = 1200014
const dropOffItemId = 1200015
const handlingItemId = 1200016
const customerId = 1200017
const pod = 'BRSOC'
// A: B/L diz SOC. B: só o Baplie diz SOC. C: B/L COC x Baplie SOC. D: ninguém informa.
const [socByBl, socByBaplie, conflict, unknown] = ['SOCU1200001', 'SOCU1200002', 'SOCU1200003', 'SOCU1200004']

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', sql], { encoding: 'utf8' }).trim()
}

function asAuthenticated(sql: string): { ok: boolean; output: string } {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '${actorId}'; ${sql} COMMIT;`,
  ], { encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}`.trim() }
}

function cleanup() {
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.demurrage_invoice_items WHERE invoice_id IN (SELECT id FROM public.demurrage_invoices WHERE bl_id = '${blId}');
    DELETE FROM public.demurrage_invoices WHERE bl_id = '${blId}';
    DELETE FROM public.import_pending_effects WHERE entity_id IN ('${voyageId}', '${blId}');
    DELETE FROM public.audit_logs WHERE entity_id IN ('${voyageId}', '${blId}');
    DELETE FROM public.charge_calculations WHERE bl_id = '${blId}';
    DELETE FROM public.bl_containers WHERE bl_id = '${blId}';
    DELETE FROM public.bls WHERE id = '${blId}';
    DELETE FROM public.import_batches WHERE voyage_id = ${voyageId};
    DELETE FROM public.baplie_containers WHERE voyage_id = ${voyageId};
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.customers WHERE id = ${customerId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

function ownership(containerNumber: string): string {
  return psql(`SELECT COALESCE(ownership, '-') || ',' || COALESCE(ownership_source, '-')
    FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${containerNumber}'`)
}

function quantity(itemId: number): string {
  return psql(`SELECT COALESCE(max(quantity)::numeric(12,2)::text, '0')
    FROM public.resolve_bl_local_charge_items('${blId}', '${pod}') WHERE charge_item_id = ${itemId}`)
}

function containerId(containerNumber: string): string {
  return psql(`SELECT id FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number = '${containerNumber}'`)
}

describeLocal('SOC/COC — B/L soberano, taxas e Demurrage', () => {
  beforeAll(() => {
    cleanup()
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'soc120@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'SOC 120', 'administrativo', true);
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'SOC120 Carrier');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'SOC120 Vessel', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'S120', 'active');
      INSERT INTO public.customers (id, name, cnpj_cpf) VALUES (${customerId}, 'Cliente SOC 120', '11222333000181');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
      VALUES (${chargeTableId}, 'Tabela SOC 120', '${pod}', '2026-01-01', true, 'container');
      INSERT INTO public.charge_table_items (
        id, charge_table_id, name, applies_to, value_brl, unit_value_brl,
        application_basis, category, cargo_profile, currency, applies_to_soc
      ) VALUES
        (${dropOffItemId}, ${chargeTableId}, 'Drop Off Fee', 'container', 150, 150, 'container_distinct_voyage', 'base', 'any', 'BRL', false),
        (${handlingItemId}, ${chargeTableId}, 'Handling', 'container', 100, 100, 'container_distinct_voyage', 'base', 'any', 'BRL', true);
      INSERT INTO public.baplie_containers (voyage_id, container_number, status, is_imo, is_oog, ownership) VALUES
        (${voyageId}, '${socByBl}', 'full', false, false, 'COC'),
        (${voyageId}, '${socByBaplie}', 'full', false, false, 'SOC'),
        (${voyageId}, '${conflict}', 'full', false, false, 'SOC'),
        (${voyageId}, '${unknown}', 'full', false, false, NULL);
    `)
  })

  afterAll(cleanup)

  it('importa o B/L com o B/L soberano e o Baplie preenchendo só o que faltou', () => {
    const payload = JSON.stringify([{
      id: blId,
      voyage_id: voyageId,
      pod,
      customer_id: customerId,
      containers: [
        { container_number: socByBl, type: '40HC', ownership: 'SOC' },
        { container_number: socByBaplie, type: '40HC', ownership: null },
        { container_number: conflict, type: '40HC', ownership: 'COC' },
        { container_number: unknown, type: '40HC' },
      ],
    }])
    const result = asAuthenticated(`SELECT public.import_bl_freight_with_metadata('${payload}'::jsonb, '${actorId}',
      '{"filename":"bl-120.xlsx","voyage_id":${voyageId},"cargo_mode":"container"}'::jsonb);`)
    expect(result.ok, result.output).toBe(true)

    expect(ownership(socByBl)).toBe('SOC,bl')
    expect(ownership(socByBaplie)).toBe('SOC,baplie')
    expect(ownership(conflict)).toBe('COC,bl')
    expect(ownership(unknown)).toBe('-,-')
  })

  it('Drop Off conta só os COC (e os não informados); a taxa comum conta todos', () => {
    expect(quantity(dropOffItemId)).toBe('2.00')
    expect(quantity(handlingItemId)).toBe('4.00')
  })

  it('correção manual exige justificativa, vale contra o Baplie e muda a contagem', () => {
    const id = containerId(unknown)
    const blank = asAuthenticated(`SELECT public.set_bl_container_ownership(${id}, 'SOC', '  ');`)
    expect(blank.ok).toBe(false)
    expect(blank.output).toContain('justificativa')

    const result = asAuthenticated(`SELECT public.set_bl_container_ownership(${id}, 'SOC', 'Cliente confirmou que o container e dele.');`)
    expect(result.ok, result.output).toBe(true)
    expect(ownership(unknown)).toBe('SOC,manual')
    expect(quantity(dropOffItemId)).toBe('1.00')

    const reapply = asAuthenticated(`SELECT public.apply_baplie_physical_flags_atomic(${voyageId}, NULL, '${actorId}');`)
    expect(reapply.ok, reapply.output).toBe(true)
    expect(ownership(unknown)).toBe('SOC,manual')
  })

  it('container SOC nunca fica em atraso de Demurrage', () => {
    psql(`UPDATE public.bl_containers SET demurrage_status = 'overdue' WHERE bl_id = '${blId}' AND container_number IN ('${socByBl}', '${conflict}')`)
    expect(psql(`SELECT string_agg(container_number || ':' || demurrage_status, ',' ORDER BY container_number)
      FROM public.bl_containers WHERE bl_id = '${blId}' AND container_number IN ('${socByBl}', '${conflict}')`))
      .toBe(`${socByBl}:within_free_time,${conflict}:overdue`)
  })

  it('Portal mostra SOC sem devolução nem dias de Demurrage', () => {
    psql(`UPDATE public.bls SET customer_id = ${customerId}, ce_mercante = '120000000000001' WHERE id = '${blId}';
      UPDATE public.bl_containers SET discharge_date = CURRENT_DATE - 60 WHERE bl_id = '${blId}' AND container_number IN ('${socByBl}', '${conflict}')`)
    const containers = psql(`SELECT string_agg(c->>'container_number' || ':' || (c->>'status') || ':' || COALESCE(c->>'demurrage_days', '-'), ',' ORDER BY c->>'container_number')
      FROM jsonb_array_elements(public._portal_list_operation_bls_without_transshipment_core(${customerId})) AS bl,
           jsonb_array_elements(bl->'containers') AS c
      WHERE c->>'container_number' IN ('${socByBl}', '${conflict}')`)
    expect(containers).toBe(`${socByBl}:soc:-,${conflict}:em_demurrage:39`)
  })

  it('container SOC não entra em fatura de Demurrage', () => {
    const id = containerId(socByBl)
    const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
      BEGIN;
      INSERT INTO public.demurrage_invoices (id, doc_number, bl_id, customer_id, status) VALUES (1200099, 'DEM-SOC-120', '${blId}', ${customerId}, 'draft');
      INSERT INTO public.demurrage_invoice_items (
        invoice_id, container_id, container_number, container_type, discharge_date, return_date, total_days, free_days, subtotal_usd
      ) VALUES (1200099, ${id}, '${socByBl}', '40HC', '2026-09-01', '2026-09-20', 19, 7, 100);
      ROLLBACK;
    `], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('é SOC')
  })
})
