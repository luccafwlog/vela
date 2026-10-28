// Migration 484 (revisão da PR #1070; decisões do dono de 2026-10-27): a
// Invoice de Demurrage na troca de CNPJ do B/L respeita o gate do novo
// Cliente e não herda a citação da cancelada; a troca de Cliente enfileira a
// emissão retida; a reemissão por datas sai mesmo com o gate fechado para o
// Cliente que já via a Invoice. Cada cenário roda numa transação desfeita.
//
// Namespace exclusivo: Clientes 99848001/99848002, Viagem 99848010, B/L R484-A.
import { spawnPsql } from './localPsql'
import { describe, expect, it } from 'vitest'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

const ADM = '00000000-0000-0000-0000-000000848001'
const A = 99848001
const B = 99848002

function fixtures(gateFor: number[]) {
  const releases = gateFor.map((customer) =>
    `INSERT INTO public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
     VALUES (${customer}, 'Fixture 484', '${ADM}', now() + interval '1 day');`).join('\n')
  return `
    INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'r484@example.test');
    INSERT INTO public.user_profiles (id, full_name, role, active) VALUES ('${ADM}', 'R484 Adm', 'administrativo', true);
    INSERT INTO public.customers (id, cnpj_cpf, name) VALUES (${A}, '11222333000181', 'R484 CLIENTE A'), (${B}, '11444777000161', 'R484 CLIENTE B');
    INSERT INTO public.customer_demurrage_agreements (customer_id, free_days, p1_usd, p2_usd, valid_from, active)
    VALUES (${A}, 5, 100, 200, '2026-01-01', true), (${B}, 5, 100, 200, '2026-01-01', true);
    INSERT INTO public.carriers (id, name) VALUES (99848002, 'R484 Carrier');
    INSERT INTO public.vessels (id, name, carrier_id) VALUES (99848003, 'R484 NAVIO', 99848002);
    INSERT INTO public.voyages (id, vessel_id, voyage_number, status) VALUES (99848010, 99848003, 'R484A', 'active');
    ${releases}
    INSERT INTO public.bls (id, voyage_id, customer_id, pol, pod, cargo_mode, financial_status, charge_status, demurrage_roe_manual, demurrage_roe, ce_mercante)
    VALUES ('R484-A', 99848010, ${A}, 'CNSHA', 'BRSSA', 'container', 'pending', 'not_calculated', true, 5.5, '998480000000001');
    INSERT INTO public.bl_containers (bl_id, container_number, type, discharge_date, return_date)
    VALUES ('R484-A', 'RVCU4840001', '40HC', '2026-07-01', '2026-09-20');
    SET LOCAL vela.demurrage_internal = 'on';
    SELECT set_config('request.jwt.claim.sub', '${ADM}', true), set_config('request.jwt.claim.role', 'authenticated', true);
    SELECT public.issue_demurrage_invoice_for_bl('R484-A', NULL) IS NOT NULL;
  `
}

/** Roda o cenário numa transação desfeita; devolve as linhas que começam com '>'. */
function scenario(sql: string): { lines: string[]; stderr: string } {
  const run = spawnPsql(['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl, '-c', `BEGIN; ${sql} ROLLBACK;`],
    { encoding: 'utf8' })
  return { lines: run.stdout.split('\n').filter((line) => line.startsWith('>')), stderr: run.stderr }
}

const invoices = `SELECT '>' || string_agg(customer_id || ':' || status || ':' || coalesce(replaces_invoice_id::text, '-'), ',' ORDER BY id)
  FROM public.demurrage_invoices WHERE bl_id = 'R484-A';`

describeLocal('Demurrage na troca de CNPJ e na reemissão por datas (migration 484)', () => {
  it('P6 e M5: novo Cliente sem gate — a Invoice é cancelada, nada é emitido nem avisado, e a emissão fica na fila', () => {
    const { lines, stderr } = scenario(`
      ${fixtures([A])}
      UPDATE public.bls SET customer_id = ${B} WHERE id = 'R484-A';
      ${invoices}
      SELECT '>avisos=' || count(*) FROM public.portal_notifications WHERE customer_id = ${B} AND type = 'demurrage_issued';
      SELECT '>fila=' || count(*) FROM public.import_pending_effects WHERE entity_id = 'R484-A' AND effect_kind = 'demurrage_billing';
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual([`>${A}:cancelled:-`, '>avisos=0', '>fila=1'])
  })

  it('M3: novo Cliente com gate — a cópia sai na hora sem herdar a citação da Invoice do Cliente anterior', () => {
    const { lines, stderr } = scenario(`
      ${fixtures([A, B])}
      UPDATE public.bl_containers SET return_date = '2026-09-22' WHERE bl_id = 'R484-A';
      SELECT public._reconcile_demurrage_after_dates(ARRAY['R484-A'], '${ADM}') IS NOT NULL;
      UPDATE public.bls SET customer_id = ${B} WHERE id = 'R484-A';
      SELECT '>' || string_agg(customer_id || ':' || status || ':' || CASE WHEN replaces_invoice_id IS NULL THEN '-' ELSE 'cita' END, ',' ORDER BY id)
        FROM public.demurrage_invoices WHERE bl_id = 'R484-A';
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines).toEqual([`>${A}:cancelled:-,${A}:cancelled:cita,${B}:issued:-`])
  })

  it('P7: datas mudam com o gate do Cliente já fechado — a substituta sai mesmo assim', () => {
    const { lines, stderr } = scenario(`
      ${fixtures([A])}
      DELETE FROM public.customer_billing_portal_releases WHERE customer_id = ${A};
      SELECT '>gate=' || coalesce(public._demurrage_issue_block_reason('R484-A'), 'aberto');
      UPDATE public.bl_containers SET return_date = '2026-09-22' WHERE bl_id = 'R484-A';
      SELECT '>reemissao=' || (public._reconcile_demurrage_after_dates(ARRAY['R484-A'], '${ADM}')->0->'reissue'->>'status');
    `)
    expect(stderr).not.toMatch(/ERROR/)
    expect(lines[0]).toMatch(/^>gate=Faturamento bloqueado pelo Portal/)
    expect(lines[1]).toBe('>reemissao=issued')
  })
})
