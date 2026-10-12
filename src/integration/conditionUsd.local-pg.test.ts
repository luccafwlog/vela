import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { syntheticCnpj } from './localTestData'

// Migration 171: a Condição de Cliente vale na moeda do item. Antes, item em
// USD saía pelo valor da tabela e gravava override_applied = true.
// Migration 172: item com condição ativa não troca de moeda, e os B/Ls não
// faturados que ainda carregam a linha errada são recalculados.

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const actorId = '00000000-0000-0000-0000-000000171001'
const customerId = 99217101
const otherCustomerId = 99217109
const carrierId = 99217102
const vesselId = 99217103
const voyageId = 99217104
const chargeTableId = 99217105
const docUsd = 99217106
const thdUsd = 99217107
const blFeeBrl = 99217108
const bl = { usd: 'R171-BL-U', dual: 'R171-BL-D', other: 'R171-BL-O', stale: 'R171-BL-S', invoiced: 'R171-BL-F' }
const migration172 = fileURLToPath(new URL('../../supabase/migrations/172_moeda_do_item_com_condicao_e_recalculo_usd.sql', import.meta.url))
const allBls = Object.values(bl)
// A linha USD exige ROE configurado para o saldo do recebível; o banco
// descartável pode não ter. Só o que esta suíte inserir é removido.
let insertedRoe = false

function psql(sql: string): string {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
    `SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '${actorId}'; ${sql}`], { encoding: 'utf8' }).trim()
}

// Com a integração ligada, a suíte roda sempre: sem a 171 aplicada ela falha
// no primeiro teste, em vez de ser pulada em silêncio.
const describeLocal = enabled ? describe : describe.skip

function calculate(blId: string) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.role = 'authenticated';
    SET LOCAL request.jwt.claim.sub = '${actorId}';
    SELECT public.calculate_bl_local_charges('${blId}', '${actorId}'::uuid, true);
    COMMIT;
  `], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

/** chave|unitário USD|total USD|unitário BRL|total BRL|override aplicado */
function lines(blId: string) {
  return psql(`SELECT string_agg(concat_ws('|', calculation_key, coalesce(unit_value_usd::text, '-'), coalesce(total_value_usd::text, '-'),
      coalesce(unit_value_brl::text, '-'), coalesce(total_value_brl::text, '-'), override_applied), ',' ORDER BY calculation_key)
    FROM public.charge_calculations WHERE bl_id = '${blId}'`)
}

function cleanup() {
  const bls = `ARRAY['${allBls.join("','")}']::text[]`
  const customers = `(${customerId}, ${otherCustomerId})`
  psql(`
    SET session_replication_role = replica;
    DELETE FROM public.alert_items WHERE metadata->>'bl_id' LIKE 'R171-%';
    DELETE FROM public.bl_receivables WHERE bl_id = ANY(${bls});
    DELETE FROM public.import_pending_effects WHERE entity_id = ANY(${bls});
    DELETE FROM public.charge_calculations WHERE bl_id = ANY(${bls});
    DELETE FROM public.pricing_rule_versions WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.bl_containers WHERE bl_id = ANY(${bls});
    DELETE FROM public.bls WHERE id = ANY(${bls});
    DELETE FROM public.customer_rate_overrides WHERE customer_id IN ${customers};
    DELETE FROM public.charge_table_items WHERE charge_table_id = ${chargeTableId};
    DELETE FROM public.charge_tables WHERE id = ${chargeTableId};
    DELETE FROM public.voyages WHERE id = ${voyageId};
    DELETE FROM public.vessels WHERE id = ${vesselId};
    DELETE FROM public.carriers WHERE id = ${carrierId};
    DELETE FROM public.portal_email_attempts WHERE account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id IN ${customers}));
    DELETE FROM public.portal_provisioning_events WHERE customer_id IN (SELECT id FROM public.customers WHERE id IN ${customers}) OR account_id IN (SELECT id FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id IN ${customers}));
    DELETE FROM public.customer_portal_accounts WHERE customer_id IN (SELECT id FROM public.customers WHERE id IN ${customers});
    DELETE FROM public.customers WHERE id IN ${customers};
    DELETE FROM public.audit_logs WHERE changed_by = '${actorId}';
    DELETE FROM public.user_profiles WHERE id = '${actorId}';
    DELETE FROM auth.users WHERE id = '${actorId}';
    SET session_replication_role = origin;
  `)
}

describeLocal('171 — Condição de Cliente em item em dólar', () => {
  beforeAll(() => {
    cleanup()
    insertedRoe = psql(`SET session_replication_role = replica;
      INSERT INTO public.exchange_rate_reference (id, roe, effective_date, source) VALUES (1, 5.5, CURRENT_DATE, 'manual')
      ON CONFLICT (id) DO NOTHING RETURNING id;`) === '1'
    psql(`
      INSERT INTO auth.users (id, email) VALUES ('${actorId}', 'condicao-usd-171@example.test');
      INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${actorId}', 'Administrativo 171', 'administrativo', true)
        ON CONFLICT (id) DO UPDATE SET role = 'administrativo', active = true;
      INSERT INTO public.customers (id, cnpj_cpf, name) VALUES
        (${customerId}, '${syntheticCnpj(171001)}', 'Cliente 171'),
        (${otherCustomerId}, '${syntheticCnpj(171009)}', 'Cliente 171 sem condição');
      INSERT INTO public.carriers (id, name) VALUES (${carrierId}, 'Carrier 171');
      INSERT INTO public.vessels (id, name, carrier_id) VALUES (${vesselId}, 'Vessel 171', ${carrierId});
      INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (${voyageId}, ${vesselId}, 'R171', 'active');
      INSERT INTO public.charge_tables (id, name, pod, valid_from, active, cargo_mode)
        VALUES (${chargeTableId}, 'Tabela 171', 'R171POD', CURRENT_DATE - 30, true, 'container');
      INSERT INTO public.charge_table_items (id, charge_table_id, name, applies_to, value_brl, unit_value_brl, unit_value_usd, application_basis, category, cargo_profile, currency)
        VALUES (${docUsd}, ${chargeTableId}, 'Documentação', 'bl', 0, NULL, 35, 'bl', 'other_charge', 'any', 'USD'),
               (${thdUsd}, ${chargeTableId}, 'THD', 'container', 0, NULL, 100, 'container_distinct_voyage', 'base', 'standard', 'USD'),
               (${blFeeBrl}, ${chargeTableId}, 'B/L Fee', 'bl', 600, 600, NULL, 'bl', 'base', 'any', 'BRL');
      INSERT INTO public.customer_rate_overrides (customer_id, charge_item_id, override_value, valid_from, active) VALUES
        (${customerId}, ${docUsd}, 30, CURRENT_DATE - 60, true),
        (${customerId}, ${thdUsd}, 80, CURRENT_DATE - 60, true),
        (${customerId}, ${blFeeBrl}, 450, CURRENT_DATE - 60, true);
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ('${bl.usd}', ${voyageId}, ${customerId}, 'R171POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
             ('${bl.dual}', ${voyageId}, ${customerId}, 'R171POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
             ('${bl.other}', ${voyageId}, ${otherCustomerId}, 'R171POD', 'container', 'pending', 'not_calculated', 'reconciled', NULL),
             ('${bl.stale}', ${voyageId}, ${customerId}, 'R171POD', 'container', 'pending', 'calculated', 'reconciled', NULL);
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES
        ('${bl.usd}', 'RUSD1710001', '22G1', false, false),
        ('${bl.dual}', 'RUSD1710002', '22G1', true, true),
        ('${bl.other}', 'RUSD1710003', '22G1', false, false),
        ('${bl.stale}', 'RUSD1710004', '22G1', false, false);
      SET session_replication_role = replica;
      -- B/L faturado sem fatura de verdade: as travas de faturamento ficam de fora.
      INSERT INTO public.bls (id, voyage_id, customer_id, pod, cargo_mode, financial_status, charge_status, customer_reconciliation_status, ce_mercante)
      VALUES ('${bl.invoiced}', ${voyageId}, ${customerId}, 'R171POD', 'container', 'invoiced', 'calculated', 'reconciled', NULL);
      INSERT INTO public.bl_containers (bl_id, container_number, type, is_imo, is_oog) VALUES ('${bl.invoiced}', 'RUSD1710005', '22G1', false, false);
      SET session_replication_role = origin;
    `)
  })

  afterAll(() => {
    cleanup()
    if (insertedRoe) psql(`SET session_replication_role = replica; DELETE FROM public.exchange_rate_reference WHERE id = 1;`)
  })

  it('item em USD sai pelo valor negociado; item em BRL continua igual', () => {
    calculate(bl.usd)
    expect(lines(bl.usd)).toBe([
      `auto:item:${docUsd}|30.00|30.00|-|-|t`,
      `auto:item:${thdUsd}|80.00|80.00|-|-|t`,
      `auto:item:${blFeeBrl}|-|-|450.00|450.00|t`,
    ].join(','))
  })

  it('container IMO e OOG ao mesmo tempo parte do THD negociado em USD (× 2,5)', () => {
    calculate(bl.dual)
    expect(lines(bl.dual)).toContain(`auto:item:${thdUsd}:imo_oog|200.00|200.00|-|-|t`)
  })

  it('Cliente sem condição paga o valor da tabela, sem override marcado', () => {
    calculate(bl.other)
    expect(lines(bl.other)).toBe([
      `auto:item:${docUsd}|35.00|35.00|-|-|f`,
      `auto:item:${thdUsd}|100.00|100.00|-|-|f`,
      `auto:item:${blFeeBrl}|-|-|600.00|600.00|f`,
    ].join(','))
  })

  it('172: B/L não faturado com a linha errada é recalculado; o faturado fica como está', () => {
    // A linha como a 129 gravava: valor da tabela (US$ 35) com a condição dada como aplicada.
    psql(`
      SET session_replication_role = replica;
      INSERT INTO public.charge_calculations (bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
        unit_value_usd, total_value_usd, override_applied, calculated_at)
      VALUES ('${bl.stale}', ${chargeTableId}, ${docUsd}, 'auto', 'calculated', 'auto:item:${docUsd}', 1, 35, 35, true, now()),
             ('${bl.invoiced}', ${chargeTableId}, ${docUsd}, 'auto', 'calculated', 'auto:item:${docUsd}', 1, 35, 35, true, now());
      SET session_replication_role = origin;
    `)
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-d', databaseUrl, '-f', migration172], { encoding: 'utf8', stdio: 'pipe' })
    expect(lines(bl.stale)).toContain(`auto:item:${docUsd}|30.00|30.00|-|-|t`)
    expect(lines(bl.invoiced)).toBe(`auto:item:${docUsd}|35.00|35.00|-|-|t`)
  })

  it('172: item com condição ativa não troca de moeda; sem condição ativa, troca', () => {
    const blocked = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c',
      `UPDATE public.charge_table_items SET currency = 'BRL', unit_value_brl = 150, unit_value_usd = NULL WHERE id = ${docUsd};`], { encoding: 'utf8' })
    expect(blocked.status).not.toBe(0)
    expect(blocked.stderr).toContain('condição(ões) de Cliente ativa(s)')
    expect(psql(`SELECT currency FROM public.charge_table_items WHERE id = ${docUsd}`)).toBe('USD')

    psql(`UPDATE public.customer_rate_overrides SET active = false WHERE charge_item_id = ${docUsd};
      UPDATE public.charge_table_items SET currency = 'BRL', unit_value_brl = 150, unit_value_usd = NULL WHERE id = ${docUsd};`)
    expect(psql(`SELECT currency FROM public.charge_table_items WHERE id = ${docUsd}`)).toBe('BRL')
  })
})
